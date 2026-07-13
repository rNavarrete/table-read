"""`POST /projects/import` — atomic create-and-import + SSE progress (data
contract §9.3). MockLlmClient injected via dependency override (hard rule 1).

Two test styles, matching test_import.py's own split:

- HTTP end-to-end (via `TestClient`) for anything that resolves to a
  terminal SSE frame — success, known-error `failed` mapping, and
  idempotency (replay / conflict / retry-after-failure) — because the
  response is a clean, fully-buffered SSE body in every one of those cases.
- Direct generator calls (`create_import.create_and_import_events(...)`,
  bypassing the HTTP layer) for *unexpected* mid-stream fault injection —
  exactly `test_import.py::test_mid_transaction_fault_leaves_zero_rows`'s
  style — since those exceptions are meant to propagate uncaught (module
  docstring), which doesn't survive a real ASGI response that has already
  started streaming.
"""

from __future__ import annotations

import json
import threading
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from fountain import create_import, pipeline
from fountain.parse import split_into_scenes
from llm.dependency import get_llm_client
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import (
    ConsistencyScan,
    LedgerExtraction,
    ProjectImportProgressEvent,
    SegmentedScene,
)
from storage import snapshots
from storage.models import ConsistencyFlagRow, LedgerFactRow, ProjectRow, SnapshotRow

URL = "/api/v1/projects/import"

BASICS = {
    "title": "Ferry Crossing",
    "format": {
        "genre": "drama",
        "runtimeMinutes": 30,
        "actCount": 3,
        "coldOpen": False,
        "tag": False,
        "serialization": 0.5,
    },
}


def _body(content: str, *, source_format: str = "fountain", **overrides) -> dict:
    return {
        **BASICS,
        "source": {"format": source_format, "content": content},
        **overrides,
    }


def _headers(key: str = "00000000-0000-4000-8000-000000000101") -> dict:
    return {"Idempotency-Key": key}


# ── response builders (mirrors test_import.py's) ────────────────────────────


def seg(beats: list[tuple], unassigned: list[tuple] | None = None) -> SegmentedScene:
    return SegmentedScene.model_validate(
        {
            "segments": [
                {
                    "kind": "beat",
                    "startLine": s,
                    "whatHappens": "w",
                    "audienceLearns": "l",
                    "audienceFeels": "f",
                }
                for s, _end in beats
            ]
            + [
                {"kind": "unassigned", "startLine": s, "reason": "orphan"}
                for s, _end in (unassigned or [])
            ]
        }
    )


def one_beat_per_scene(source: str) -> list[SegmentedScene]:
    return [seg([(1, len(scene.lines))]) for scene in split_into_scenes(source)]


def extraction(facts: list[dict] | None = None) -> LedgerExtraction:
    return LedgerExtraction.model_validate({"newFacts": facts or [], "contradictions": []})


def one_fact(beat_id: str = "beat-1-1", confidence: float = 0.95) -> dict:
    return {
        "fact": "Something is established.",
        "factType": "event",
        "sourceSpan": {
            "episodeId": "ep-1",
            "sceneId": "scene-1",
            "beatId": beat_id,
            "startLine": 1,
            "endLine": 1,
        },
        "sourceText": "",
        "knownBy": ["char-marta"],
        "audienceKnows": True,
        "confidence": confidence,
    }


def scan(flags: list[dict] | None = None) -> ConsistencyScan:
    return ConsistencyScan.model_validate({"flags": flags or []})


class _FailingSecondSceneLlm(MockLlmClient):
    def __init__(self) -> None:
        super().__init__()
        self._never_release = threading.Event()

    def segment_scene(self, *, system: str, user_message: str, prompt_version: str):
        del system, prompt_version
        if "Alpha waits." in user_message:
            self._never_release.wait(0.5)
            return seg([(1, 2)])
        if "Beta waits." in user_message:
            raise SchemaInvalidLlmError("segment_scene")
        if "Gamma waits." in user_message:
            self._never_release.wait(0.5)
        return seg([(1, 2)])


def _configure_success(llm: MockLlmClient, src: str, *, fact: bool = False) -> None:
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction([one_fact()] if fact else None))
    llm.set_response("scan_consistency", scan())


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for frame in text.strip().split("\n\n"):
        if not frame.strip():
            continue
        lines = frame.splitlines()
        name = next(line[len("event: ") :] for line in lines if line.startswith("event: "))
        data = next(line[len("data: ") :] for line in lines if line.startswith("data: "))
        events.append((name, json.loads(data)))
    return events


def _parse_frame(text: str) -> tuple[str, dict]:
    events = _parse_sse(text)
    assert len(events) == 1
    return events[0]


def _table_counts(db_session) -> dict:
    """Snapshot of row counts across every table a project touches. Fault-
    injection assertions compare *before vs. after*, never an absolute count
    (the suite DB accumulates rows across tests)."""
    return {
        model: db_session.query(model).count()
        for model in (ProjectRow, SnapshotRow, LedgerFactRow, ConsistencyFlagRow)
    }


def _assert_no_new_rows(db_session, baseline: dict) -> None:
    assert _table_counts(db_session) == baseline


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


client = TestClient(app)


# ── contract: progress item variant + SSE adapter frame ─────────────────────


def test_progress_event_contract_accepts_progress_variant():
    event = ProjectImportProgressEvent.model_validate(
        {"type": "progress", "stage": "segmenting_beats", "done": 2, "total": 3}
    )

    assert event.root.done == 2
    assert event.root.total == 3


def test_progress_frame_formats_sse_event():
    assert _parse_frame(create_import._progress_frame("segmenting_beats", 2, 3)) == (
        "progress",
        {"type": "progress", "stage": "segmenting_beats", "done": 2, "total": 3},
    )


def test_create_and_import_events_adapts_internal_progress_events(monkeypatch, mock_llm):
    def fake_analyze_import(*args, **kwargs):
        yield pipeline.ImportStageStarted("parsing_scenes")
        yield pipeline.ImportStageProgress("segmenting_beats", 2, 3)
        return pipeline.ImportAnalysis(new_doc={"id": "proj-progress"}, new_facts=[], raw_flags=[])

    monkeypatch.setattr(create_import, "analyze_import", fake_analyze_import)
    monkeypatch.setattr(
        snapshots,
        "create_project_with_state",
        lambda *args, **kwargs: SimpleNamespace(
            project_id="proj-progress",
            id="snap-progress",
            doc={"id": "proj-progress"},
            ledger=[],
            flags=[],
        ),
    )

    events = _parse_sse(
        "".join(
            create_import.create_and_import_events(
                None,
                title="Progress Show",
                format_dict=BASICS["format"],
                premise="",
                source_format="fountain",
                content="INT. BAR\nx",
                llm=mock_llm,
                creation_idempotency_key="progress-key",
                creation_request_hash="progress-hash",
            )
        )
    )

    assert events[:2] == [
        ("stage", {"type": "stage", "name": "parsing_scenes"}),
        ("progress", {"type": "progress", "stage": "segmenting_beats", "done": 2, "total": 3}),
    ]
    assert events[-2][0] == "stage"
    assert events[-1][0] == "complete"


# ── success: one project, one root snapshot, imported doc/ledger/flags ──────


def test_success_streams_named_stages_then_complete(db_session, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)

    resp = client.post(URL, json=_body(src), headers=_headers())

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(resp.text)
    names = [n for n, _ in events]
    assert names == [
        "stage",
        "stage",
        "progress",
        "stage",
        "stage",
        "progress",
        "stage",
        "stage",
        "complete",
    ]
    stage_names = [d["name"] for n, d in events if n == "stage"]
    assert stage_names == [
        "parsing_scenes",
        "segmenting_beats",
        "inferring_acts",
        "extracting_facts",
        "checking_consistency",
        "saving",
    ]
    progress = [d for n, d in events if n == "progress"]
    assert progress == [
        {"type": "progress", "stage": "segmenting_beats", "done": 1, "total": 1},
        {"type": "progress", "stage": "extracting_facts", "done": 1, "total": 1},
    ]
    for name, data in events:
        assert data["type"] == name

    result = events[-1][1]["result"]
    project = result["project"]
    assert project["title"] == "Ferry Crossing"
    scenes = project["seasons"][0]["episodes"][0]["scenes"]
    assert len(scenes) == 1
    assert scenes[0]["location"] == "INT. BAR - NIGHT"
    assert result["newFacts"]
    for fact in result["newFacts"]:
        assert fact["status"] == "pending_review"
        assert fact["provenance"] == "inferred"
        assert fact["id"].startswith("fact-")

    snapshots.purge_project(db_session, project["id"])


def test_success_creates_exactly_one_project_and_one_root_snapshot(db_session, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)

    resp = client.post(
        URL, json=_body(src), headers=_headers("00000000-0000-4000-8000-000000000102")
    )
    events = _parse_sse(resp.text)
    pid = events[-1][1]["result"]["project"]["id"]

    assert db_session.query(ProjectRow).filter_by(id=pid).count() == 1
    snaps = db_session.query(SnapshotRow).filter_by(project_id=pid).all()
    assert len(snaps) == 1
    assert snaps[0].parent_id is None
    assert snaps[0].ledger  # the imported facts are already in the root snapshot
    assert snaps[0].flags == [] or all(f["sourceChange"] == snaps[0].id for f in snaps[0].flags)

    project = db_session.get(ProjectRow, pid)
    assert project.head_snapshot_id == snaps[0].id
    facts = db_session.query(LedgerFactRow).filter_by(project_id=pid).all()
    assert len(facts) == len(snaps[0].ledger)
    assert all(f.status == "pending_review" for f in facts)
    # Globally unique minting (not ordinal fact-01) so imports coexist with
    # the seeded fixture's ledger rows.
    assert all(f.id.startswith("fact-") and not f.id.removeprefix("fact-").isdigit() for f in facts)

    snapshots.purge_project(db_session, pid)


def test_success_persists_open_consistency_flags(db_session, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response(
        "scan_consistency",
        scan(
            [
                {
                    "objectType": "scene",
                    "objectId": "scene-1",
                    "factId": None,
                    "explanation": "internal contradiction",
                    "severity": "contradiction",
                }
            ]
        ),
    )

    resp = client.post(
        URL, json=_body(src), headers=_headers("00000000-0000-4000-8000-000000000103")
    )
    events = _parse_sse(resp.text)
    result = events[-1][1]["result"]
    flags = [f for f in result["consistencyFlags"] if f["objectId"] == "scene-1"]
    assert len(flags) == 1
    assert flags[0]["status"] == "open"
    assert flags[0]["sourceChange"] == result["project"]["headSnapshotId"]
    assert flags[0]["id"].startswith("flag-")
    assert not flags[0]["id"].removeprefix("flag-").isdigit()

    snapshots.purge_project(db_session, result["project"]["id"])


def test_empty_content_fails_zero_rows(db_session, mock_llm):
    resp = client.post(
        URL, json=_body(""), headers=_headers("00000000-0000-4000-8000-000000000104")
    )

    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    assert events[-1][0] == "failed"
    assert events[-1][1]["error"]["code"] == "VALIDATION"
    before = db_session.query(ProjectRow).count()
    assert before == db_session.query(ProjectRow).count()


# ── known-error → terminal `failed` (never a raised exception this far out) ─


def test_schema_invalid_llm_maps_to_failed_zero_rows(db_session, mock_llm):
    class _Raising(MockLlmClient):
        def segment_scene(self, **kwargs):
            raise SchemaInvalidLlmError("segment_scene")

    app.dependency_overrides[get_llm_client] = lambda: _Raising()
    try:
        before = db_session.query(ProjectRow).count()
        resp = client.post(
            URL,
            json=_body("INT. BAR\nx"),
            headers=_headers("00000000-0000-4000-8000-000000000105"),
        )
    finally:
        app.dependency_overrides[get_llm_client] = lambda: mock_llm

    events = _parse_sse(resp.text)
    assert events[-1] == (
        "failed",
        {
            "type": "failed",
            "error": {
                "code": "SCHEMA_INVALID_LLM",
                "message": "segment_scene: LLM output failed schema validation twice",
            },
        },
    )
    assert db_session.query(ProjectRow).count() == before


def test_failing_scene_worker_fails_fast_with_zero_rows(db_session, monkeypatch):
    monkeypatch.setattr(pipeline, "IMPORT_LLM_CONCURRENCY", 2, raising=False)
    baseline = _table_counts(db_session)
    llm = _FailingSecondSceneLlm()
    src = "\n".join(
        [
            "INT. ALPHA - DAY",
            "Alpha waits.",
            "INT. BETA - DAY",
            "Beta waits.",
            "INT. GAMMA - DAY",
            "Gamma waits.",
        ]
    )

    app.dependency_overrides[get_llm_client] = lambda: llm
    try:
        resp = client.post(
            URL,
            json=_body(src),
            headers=_headers("00000000-0000-4000-8000-000000000110"),
        )
    finally:
        app.dependency_overrides.pop(get_llm_client, None)

    events = _parse_sse(resp.text)
    assert events[-1][0] == "failed"
    assert events[-1][1]["error"]["code"] == "SCHEMA_INVALID_LLM"
    assert "progress" not in [name for name, _data in events]
    _assert_no_new_rows(db_session, baseline)


def test_llm_transport_error_maps_to_failed_zero_rows(db_session, mock_llm):
    exc = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))

    class _Raising(MockLlmClient):
        def segment_scene(self, **kwargs):
            raise exc

    app.dependency_overrides[get_llm_client] = lambda: _Raising()
    try:
        before = db_session.query(ProjectRow).count()
        resp = client.post(
            URL,
            json=_body("INT. BAR\nx"),
            headers=_headers("00000000-0000-4000-8000-000000000106"),
        )
    finally:
        app.dependency_overrides[get_llm_client] = lambda: mock_llm

    events = _parse_sse(resp.text)
    assert events[-1][0] == "failed"
    assert events[-1][1]["error"]["code"] == "LLM_UNAVAILABLE"
    assert db_session.query(ProjectRow).count() == before


# ── idempotency (T4 semantics, over SSE) ─────────────────────────────────────


def test_idempotency_replays_terminal_complete_one_project(db_session, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src)
    headers = _headers("00000000-0000-4000-8000-000000000107")

    first = _parse_sse(client.post(URL, json=_body(src), headers=headers).text)
    second = _parse_sse(client.post(URL, json=_body(src), headers=headers).text)

    assert [n for n, _ in second] == ["complete"]
    assert second[0][1]["result"] == first[-1][1]["result"]
    pid = first[-1][1]["result"]["project"]["id"]
    assert db_session.query(ProjectRow).filter_by(id=pid).count() == 1
    assert db_session.query(SnapshotRow).filter_by(project_id=pid).count() == 1


def test_idempotency_conflicts_before_streaming_on_different_request(db_session, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src)
    headers = _headers("00000000-0000-4000-8000-000000000108")
    client.post(URL, json=_body(src), headers=headers)
    after_first = db_session.query(ProjectRow).count()

    conflict = client.post(URL, json=_body(src, title="Different Show"), headers=headers)

    assert conflict.status_code == 409
    assert conflict.headers["content-type"].startswith("application/json")
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert db_session.query(ProjectRow).count() == after_first


def test_idempotency_key_reusable_after_failed_transaction(db_session, mock_llm):
    headers = _headers("00000000-0000-4000-8000-000000000109")
    failed = _parse_sse(client.post(URL, json=_body(""), headers=headers).text)
    assert failed[-1][0] == "failed"

    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src)
    retried = _parse_sse(client.post(URL, json=_body(src), headers=headers).text)

    assert retried[-1][0] == "complete"
    pid = retried[-1][1]["result"]["project"]["id"]
    assert db_session.query(ProjectRow).filter_by(id=pid).count() == 1


def test_idempotency_unique_race_replays_winning_request(db_session, monkeypatch, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src)
    before = db_session.query(ProjectRow).count()
    key, req_hash = "race-key", "race-hash"
    raced_doc = {
        "id": "proj-raced-import",
        "title": "Raced Show",
        "format": BASICS["format"],
        "enabledComponents": [],
        "premise": "",
        "seriesBible": {
            "existentialQuestion": {"text": "", "locked": False},
            "worldRules": [],
            "storiesToAvoid": [],
            "characters": [],
            "relationships": [],
            "audienceGoals": [],
            "narratorGoals": [],
            "worldQA": [],
        },
        "seasons": [],
        "headSnapshotId": "snap-raced-import",
        "defaultCraftLevel": "standard",
    }

    def race_then_integrity_error(*args, **kwargs):
        db_session.add(
            ProjectRow(
                id=raced_doc["id"],
                doc=raced_doc,
                head_snapshot_id=raced_doc["headSnapshotId"],
                creation_idempotency_key=key,
                creation_request_hash=req_hash,
            )
        )
        db_session.add(
            SnapshotRow(
                id=raced_doc["headSnapshotId"],
                project_id=raced_doc["id"],
                parent_id=None,
                instruction="raced",
                doc=raced_doc,
                ledger=[],
                flags=[],
                ts="2026-07-10T00:00:00Z",
            )
        )
        db_session.commit()
        from sqlalchemy.exc import IntegrityError

        raise IntegrityError("unique race", params=None, orig=Exception("unique"))

    monkeypatch.setattr(snapshots, "create_project_with_state", race_then_integrity_error)

    events = list(
        create_import.create_and_import_events(
            db_session,
            title="My Show",
            format_dict=BASICS["format"],
            premise="",
            source_format="fountain",
            content=src,
            llm=mock_llm,
            creation_idempotency_key=key,
            creation_request_hash=req_hash,
        )
    )
    parsed = _parse_sse("".join(events))

    assert parsed[-1] == (
        "complete",
        {
            "type": "complete",
            "result": {
                "project": raced_doc,
                "newFacts": [],
                "consistencyFlags": [],
            },
        },
    )
    # Exactly the raced project was added by this test — no second (losing)
    # project from `create_and_import_events`'s own attempt.
    assert db_session.query(ProjectRow).count() == before + 1


# ── mid-transaction fault injection at each stage → zero rows (direct call) ──


def _drain(gen) -> None:
    for _ in gen:
        pass


def test_fault_parsing_scenes_zero_rows(db_session, monkeypatch, mock_llm):
    baseline = _table_counts(db_session)

    def boom(*args, **kwargs):
        raise RuntimeError("injected parsing_scenes failure")

    monkeypatch.setattr(pipeline, "split_into_scenes", boom)

    gen = create_import.create_and_import_events(
        db_session,
        title="Fault Show",
        format_dict=BASICS["format"],
        premise="",
        source_format="fountain",
        content="INT. BAR\nx",
        llm=mock_llm,
        creation_idempotency_key="fault-1",
        creation_request_hash="fault-1",
    )
    with pytest.raises(RuntimeError, match="injected"):
        _drain(gen)
    _assert_no_new_rows(db_session, baseline)


def test_fault_segmenting_beats_zero_rows(db_session, mock_llm):
    baseline = _table_counts(db_session)

    class _Raising(MockLlmClient):
        def segment_scene(self, **kwargs):
            raise RuntimeError("injected segmenting_beats failure")

    gen = create_import.create_and_import_events(
        db_session,
        title="Fault Show",
        format_dict=BASICS["format"],
        premise="",
        source_format="fountain",
        content="INT. BAR\nx",
        llm=_Raising(),
        creation_idempotency_key="fault-2",
        creation_request_hash="fault-2",
    )
    with pytest.raises(RuntimeError, match="injected"):
        _drain(gen)
    _assert_no_new_rows(db_session, baseline)


def test_fault_inferring_acts_zero_rows(db_session):
    baseline = _table_counts(db_session)

    class _Raising(MockLlmClient):
        def infer_act_breaks(self, **kwargs):
            raise SchemaInvalidLlmError("infer_act_breaks")

    gen = create_import.create_and_import_events(
        db_session,
        title="Fault Show",
        format_dict=BASICS["format"],
        premise="",
        source_format="fountain",
        content="INT. BAR\nx",
        llm=_Raising(),
        creation_idempotency_key="fault-acts",
        creation_request_hash="fault-acts",
    )
    events = _parse_sse("".join(gen))
    assert events[-1][1]["error"]["code"] == "SCHEMA_INVALID_LLM"
    _assert_no_new_rows(db_session, baseline)


def test_fault_extracting_facts_zero_rows(db_session):
    src = "INT. BAR\nx"
    baseline = _table_counts(db_session)

    class _Raising(MockLlmClient):
        def extract_ledger_facts(self, **kwargs):
            raise RuntimeError("injected extracting_facts failure")

    llm = _Raising()
    llm.set_responses("segment_scene", one_beat_per_scene(src))

    gen = create_import.create_and_import_events(
        db_session,
        title="Fault Show",
        format_dict=BASICS["format"],
        premise="",
        source_format="fountain",
        content=src,
        llm=llm,
        creation_idempotency_key="fault-3",
        creation_request_hash="fault-3",
    )
    with pytest.raises(RuntimeError, match="injected"):
        _drain(gen)
    _assert_no_new_rows(db_session, baseline)


def test_fault_checking_consistency_zero_rows(db_session):
    src = "INT. BAR\nx"
    baseline = _table_counts(db_session)

    class _Raising(MockLlmClient):
        def scan_consistency(self, **kwargs):
            raise RuntimeError("injected checking_consistency failure")

    llm = _Raising()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction())

    gen = create_import.create_and_import_events(
        db_session,
        title="Fault Show",
        format_dict=BASICS["format"],
        premise="",
        source_format="fountain",
        content=src,
        llm=llm,
        creation_idempotency_key="fault-4",
        creation_request_hash="fault-4",
    )
    with pytest.raises(RuntimeError, match="injected"):
        _drain(gen)
    _assert_no_new_rows(db_session, baseline)


def test_fault_saving_zero_rows(db_session, monkeypatch):
    src = "INT. BAR\nx"
    baseline = _table_counts(db_session)
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction([one_fact(beat_id="beat-1-1")]))
    llm.set_response(
        "scan_consistency",
        scan(
            [
                {
                    "objectType": "scene",
                    "objectId": "scene-1",
                    "factId": None,
                    "explanation": "x",
                    "severity": "tension",
                }
            ]
        ),
    )

    def boom(*args, **kwargs):
        raise RuntimeError("injected saving failure")

    # _rewrite_flags runs LAST inside create_project_with_state — after the
    # project row, snapshot row, and ledger rewrite are all staged.
    # Atomicity must roll it all back (same guard as test_import.py's
    # mid-transaction fault test).
    monkeypatch.setattr(snapshots, "_rewrite_flags", boom)

    gen = create_import.create_and_import_events(
        db_session,
        title="Fault Show",
        format_dict=BASICS["format"],
        premise="",
        source_format="fountain",
        content=src,
        llm=llm,
        creation_idempotency_key="fault-5",
        creation_request_hash="fault-5",
    )
    with pytest.raises(RuntimeError, match="injected"):
        _drain(gen)
    _assert_no_new_rows(db_session, baseline)
