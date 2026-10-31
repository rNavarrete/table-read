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

import copy
import json
import logging
import threading
import time
from datetime import timedelta
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

import routes
from drama_manager import narrative_map_runs, render
from drama_manager.narrative_map_analysis import (
    NARRATIVE_MAP_ANALYSIS_VERSION,
    prepare_narrative_map_source,
)
from drama_manager.narrative_map_runs import execute_run
from fountain import create_import, import_runs, pipeline
from fountain.parse import SceneSpan, split_into_scenes, strip_screenplay_front_matter
from llm.dependency import get_llm_client
from llm.errors import LlmTimeoutError, SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import (
    ConsistencyScan,
    InferredActBreaks,
    InferredNarrativeSceneAnalysisBatch,
    LedgerExtraction,
    NarrativeMapVerification,
    ProjectImportProgressEvent,
    SegmentedScene,
)
from storage import snapshots
from storage.models import (
    ConsistencyFlagRow,
    ImportRunRow,
    ImportRunUnitRow,
    LedgerFactRow,
    NarrativeMapRunRow,
    ProjectRow,
    SnapshotRow,
)

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

    def segment_scene(
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ):
        del system, prompt_version
        if "Alpha waits." in user_message:
            self._never_release.wait(0.5)
            return seg([(1, 2)])
        if "Beta waits." in user_message:
            # Not a schema failure: that degrades one scene instead (T9.11).
            raise LlmTimeoutError("segment_scene")
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


def _progress(stage: str, done: int, total: int, spent_usd: float = 0.0) -> dict:
    """A streamed `progress` frame; the mock runs in demo mode, at $0."""
    return {
        "type": "progress",
        "stage": stage,
        "done": done,
        "total": total,
        "spentUsd": spent_usd,
    }


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
        ("progress", _progress("segmenting_beats", 2, 3)),
    ]
    assert events[-4:-1] == [
        ("stage", {"type": "stage", "name": "saving"}),
        ("progress", _progress("saving", 0, 1)),
        ("progress", _progress("saving", 1, 1)),
    ]
    assert events[-1][0] == "complete"


# ── success: one project, one root snapshot, imported doc/ledger/flags ──────


def test_success_streams_named_stages_then_complete(db_session, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)

    resp = client.post(URL, json=_body(src), headers=_headers())

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(resp.text)
    stage_names = [d["name"] for n, d in events if n == "stage"]
    assert stage_names == [
        "parsing_scenes",
        "segmenting_beats",
        "inferring_acts",
        "inferring_entities",
        "inferring_promises",
        "inferring_overview",
        "extracting_facts",
        "checking_consistency",
        "saving",
    ]
    progress = [d for n, d in events if n == "progress"]
    assert progress == [
        _progress("parsing_scenes", 0, 1),
        _progress("parsing_scenes", 1, 1),
        _progress("segmenting_beats", 0, 1),
        _progress("segmenting_beats", 1, 1),
        _progress("inferring_acts", 0, 1),
        _progress("inferring_acts", 1, 1),
        _progress("inferring_entities", 0, 1),
        _progress("inferring_entities", 1, 1),
        _progress("inferring_promises", 0, 2),
        _progress("inferring_promises", 1, 2),
        _progress("inferring_promises", 2, 2),
        _progress("inferring_overview", 0, 1),
        _progress("inferring_overview", 1, 1),
        _progress("extracting_facts", 0, 1),
        _progress("extracting_facts", 1, 1),
        _progress("checking_consistency", 0, 1),
        _progress("checking_consistency", 1, 1),
        _progress("saving", 0, 1),
        _progress("saving", 1, 1),
    ]
    assert events[-1][0] == "complete"
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
        # Confident, with no quote to verify: accepted, as while writing.
        assert fact["status"] == "active"
        assert fact["provenance"] == "inferred"
        assert fact["id"].startswith("fact-")

    snapshots.purge_project(db_session, project["id"])


def test_create_import_strips_title_sets_and_cast_before_scene_ids(db_session, mock_llm, caplog):
    retained = "INT. FOUR SEASONS HOTEL - NIGHT\nSam sits at the bar."
    source = "\n".join(
        [
            "THE WEST WING",
            '"Pilot"',
            "Written by",
            "FINAL DRAFT",
            "INT. GLASS OFFICE BUILDING",
            "Office Corridor",
            "CAST",
            "SAM",
            "LEO",
            "TEASER",
            "FADE IN:",
            "",
            retained,
        ]
    )
    _configure_success(mock_llm, retained, fact=True)

    with caplog.at_level(logging.INFO, logger="fountain.pipeline"):
        response = client.post(
            URL,
            json=_body(source),
            headers=_headers("00000000-0000-4000-8000-000000000121"),
        )

    result = _parse_sse(response.text)[-1][1]["result"]
    project = result["project"]
    scenes = project["seasons"][0]["episodes"][0]["scenes"]
    serialized = json.dumps(project)

    assert len(scenes) == 1
    assert scenes[0]["id"] == "scene-1"
    assert scenes[0]["location"] == "INT. FOUR SEASONS HOTEL - NIGHT"
    assert scenes[0]["beats"][0]["scriptText"] == retained
    assert "FINAL DRAFT" not in serialized
    assert '"CAST"' not in serialized
    assert mock_llm.invocation_count("segment_scene") == 1
    joined = " ".join(record.getMessage() for record in caplog.records)
    assert "import_front_matter_stripped" in joined
    assert source not in joined

    snapshots.purge_project(db_session, project["id"])


def test_narrative_map_runs_after_import_without_rerunning_it(db_session, mock_llm, monkeypatch):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)

    imported = client.post(URL, json=_body(src), headers=_headers()).text
    project = _parse_sse(imported)[-1][1]["result"]["project"]
    project_id = project["id"]

    assert project["seasons"][0]["episodes"][0]["narrativeMap"] is None
    assert mock_llm.invocation_count("infer_narrative_map") == 0
    assert db_session.query(SnapshotRow).filter_by(project_id=project_id).count() == 1
    assert client.get(f"/api/v1/projects/{project_id}/narrative-map/runs/latest").json() is None

    response = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    )

    assert response.status_code == 202
    run = response.json()
    assert run["status"] == "queued"
    assert run["sceneCount"] == 1
    assert mock_llm.invocation_count("infer_narrative_scene_analysis") == 0

    execute_run(run["id"], mock_llm)
    db_session.expire_all()
    stored_run = db_session.get(NarrativeMapRunRow, run["id"])
    persisted = db_session.get(ProjectRow, project_id)

    assert stored_run.status == "completed"
    assert persisted.doc["seasons"][0]["episodes"][0]["narrativeMap"] is not None
    assert mock_llm.invocation_count("infer_narrative_map") == 0
    assert mock_llm.invocation_count("infer_narrative_scene_analysis") == 1
    assert mock_llm.invocation_count("infer_narrative_map_synthesis") == 1
    assert mock_llm.invocation_count("verify_narrative_map") == 1
    assert db_session.query(SnapshotRow).filter_by(project_id=project_id).count() == 2

    snapshots.purge_project(db_session, project_id)


def test_narrative_map_reuses_a_valid_prior_version_scene_checkpoint(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]
    source = prepare_narrative_map_source(project)
    scene = source.scene_sources[0]
    beat = scene["beats"][0]
    prior = NarrativeMapRunRow(
        id="nmap-prior-version",
        project_id=project_id,
        run_key=f"{project_id}:2.1:{source.source_hash}",
        source_snapshot_id=project["headSnapshotId"],
        source_hash=source.source_hash,
        analysis_version="2.1",
        status="rejected",
        phase="failed",
        scene_count=1,
        completed_scene_count=1,
        attempt_count=1,
        checkpoint={
            "scenePackets": [
                {
                    "sceneId": scene["sceneId"],
                    "act": scene["act"],
                    "location": scene["location"],
                    "summary": "Dan pours a drink while alone in the bar.",
                    "focalCharacterName": None,
                    "dramaticFunction": "Establish Dan's immediate action and situation.",
                    "conflict": "Dan acts alone while the scene withholds his larger purpose.",
                    "stakes": "The drink establishes the state in which Dan faces what follows.",
                    "turnBeatId": beat["beatId"],
                    "turn": "Dan moves from entering the bar to pouring the drink.",
                    "keyMoments": [
                        {
                            "beatId": beat["beatId"],
                            "summary": "Dan pours himself a drink.",
                            "dramaticFunction": "Establish Dan's immediate behavior.",
                            "consequence": "Dan begins the scene occupied by the drink.",
                            "sourceQuote": "Dan pours a drink.",
                        }
                    ],
                }
            ]
        },
    )
    db_session.add(prior)
    db_session.commit()

    response = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    )
    run = response.json()

    assert response.status_code == 202
    assert run["completedSceneCount"] == 1
    execute_run(run["id"], mock_llm)
    db_session.expire_all()
    assert db_session.get(NarrativeMapRunRow, run["id"]).status == "completed"
    assert mock_llm.invocation_count("infer_narrative_scene_analysis") == 0

    snapshots.purge_project(db_session, project_id)


def test_rejected_narrative_map_run_is_not_requeued_for_the_same_analysis_version(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]
    first = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    stored = db_session.get(NarrativeMapRunRow, first["id"])
    stored.status = "rejected"
    stored.phase = "failed"
    stored.error_code = "EVIDENCE_REJECTED"
    stored.error_message = "Rejected for test."
    stored.checkpoint = {"scenePackets": []}
    db_session.commit()

    response = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    )
    retried = response.json()

    assert response.status_code == 202
    assert retried["id"] == first["id"]
    assert retried["status"] == "rejected"
    assert retried["attemptCount"] == first["attemptCount"]

    snapshots.purge_project(db_session, project_id)


def test_unknown_thread_only_rejection_is_resumable_from_cached_synthesis(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]
    first = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    stored = db_session.get(NarrativeMapRunRow, first["id"])
    stored.status = "rejected"
    stored.phase = "failed"
    stored.error_code = "EVIDENCE_REJECTED"
    stored.error_message = "Rejected for test."
    stored.checkpoint = {
        "scenePackets": [],
        "synthesis": {
            "threadMovements": [
                {
                    "threadId": "thread-provisional",
                    "beatId": "beat-1-1",
                    "phase": "setup",
                    "summary": "Dan pours the drink that begins the story thread.",
                }
            ]
        },
        "rejectionDiagnostics": [{"code": "unknown_thread", "path": "threadMovements[0]"}],
    }
    db_session.commit()

    latest = client.get(f"/api/v1/projects/{project_id}/narrative-map/runs/latest").json()
    response = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    )
    resumed = response.json()

    assert latest["retryAllowed"] is True
    assert "only independent verification remains" in latest["errorMessage"]
    assert response.status_code == 202
    assert resumed["id"] == first["id"]
    assert resumed["status"] == "queued"
    assert resumed["attemptCount"] == first["attemptCount"] + 1
    db_session.expire_all()
    checkpoint = db_session.get(NarrativeMapRunRow, first["id"]).checkpoint
    assert checkpoint["threadRepairVersion"] == 1
    assert "rejectionDiagnostics" not in checkpoint
    snapshots.purge_project(db_session, project_id)


def test_unknown_scene_focal_characters_are_resumable_from_cached_synthesis(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]
    first = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    stored = db_session.get(NarrativeMapRunRow, first["id"])
    stored.status = "rejected"
    stored.phase = "failed"
    stored.error_code = "EVIDENCE_REJECTED"
    stored.error_message = "Rejected for test."
    stored.checkpoint = {
        "scenePackets": [],
        "synthesis": {"threadMovements": []},
        "rejectionDiagnostics": [
            {"code": "unknown_character", "path": "sceneTurns[0]"},
        ],
    }
    db_session.commit()

    latest = client.get(f"/api/v1/projects/{project_id}/narrative-map/runs/latest").json()
    response = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    )
    resumed = response.json()

    assert latest["retryAllowed"] is True
    assert "only independent verification remains" in latest["errorMessage"]
    assert response.status_code == 202
    assert resumed["id"] == first["id"]
    assert resumed["status"] == "queued"
    assert resumed["attemptCount"] == first["attemptCount"] + 1
    db_session.expire_all()
    checkpoint = db_session.get(NarrativeMapRunRow, first["id"]).checkpoint
    assert checkpoint["focalCharacterRepairVersion"] == 1
    assert "rejectionDiagnostics" not in checkpoint
    snapshots.purge_project(db_session, project_id)


def test_invalid_verifier_shape_is_resumable_with_one_corrected_verifier_call(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]
    first = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    stored = db_session.get(NarrativeMapRunRow, first["id"])
    stored.status = "failed"
    stored.phase = "failed"
    stored.error_code = "SCHEMA_INVALID_LLM"
    stored.error_message = "The model returned an invalid analysis shape."
    stored.checkpoint = {
        "scenePackets": [],
        "synthesis": {"threadMovements": []},
        "threadRepairVersion": 1,
    }
    db_session.commit()

    latest = client.get(f"/api/v1/projects/{project_id}/narrative-map/runs/latest").json()
    response = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    )
    resumed = response.json()

    assert latest["retryAllowed"] is True
    assert "only one verification call remains" in latest["errorMessage"]
    assert response.status_code == 202
    assert resumed["id"] == first["id"]
    assert resumed["status"] == "queued"
    assert resumed["attemptCount"] == first["attemptCount"] + 1
    db_session.expire_all()
    checkpoint = db_session.get(NarrativeMapRunRow, first["id"]).checkpoint
    assert checkpoint["verifierTransportVersion"] == 1
    assert "verification" not in checkpoint
    snapshots.purge_project(db_session, project_id)


def test_stale_running_narrative_map_is_reported_as_resumable_without_losing_checkpoint(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]
    first = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    stored = db_session.get(NarrativeMapRunRow, first["id"])
    stored.status = "running"
    stored.phase = "scene_analysis"
    stored.completed_scene_count = 1
    stored.checkpoint = {"scenePackets": [{"sceneId": "scene-1"}]}
    stored.updated_at -= timedelta(minutes=5)
    db_session.commit()

    status = client.get(f"/api/v1/projects/{project_id}/narrative-map/runs/latest").json()

    assert status["id"] == first["id"]
    assert status["status"] == "failed"
    assert status["errorCode"] == "WORKER_INTERRUPTED"
    assert status["completedSceneCount"] == 1
    assert status["retryAllowed"] is False
    db_session.expire_all()
    interrupted = db_session.get(NarrativeMapRunRow, first["id"])
    assert interrupted.checkpoint == {"scenePackets": [{"sceneId": "scene-1"}]}
    interrupted.updated_at -= timedelta(minutes=11)
    db_session.commit()

    resumed = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    assert resumed["id"] == first["id"]
    assert resumed["status"] == "queued"
    assert resumed["completedSceneCount"] == 1

    snapshots.purge_project(db_session, project_id)


def test_active_narrative_map_worker_is_never_marked_interrupted(db_session, mock_llm, monkeypatch):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    run = client.post(
        f"/api/v1/projects/{project['id']}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    stored = db_session.get(NarrativeMapRunRow, run["id"])
    stored.status = "running"
    stored.phase = "synthesis"
    stored.updated_at -= timedelta(minutes=5)
    db_session.commit()

    with narrative_map_runs._ACTIVE_RUN_LOCK:
        narrative_map_runs._ACTIVE_RUN_IDS.add(stored.id)
    try:
        status = client.get(f"/api/v1/projects/{project['id']}/narrative-map/runs/latest").json()
    finally:
        with narrative_map_runs._ACTIVE_RUN_LOCK:
            narrative_map_runs._ACTIVE_RUN_IDS.discard(stored.id)

    assert status["status"] == "running"
    assert status["phase"] == "synthesis"
    snapshots.purge_project(db_session, project["id"])


def test_provider_call_heartbeats_a_running_narrative_map(db_session, mock_llm, monkeypatch):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    monkeypatch.setattr(narrative_map_runs, "_RUN_HEARTBEAT_SECONDS", 0.01)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    run = client.post(
        f"/api/v1/projects/{project['id']}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    stored = db_session.get(NarrativeMapRunRow, run["id"])
    stored.status = "running"
    stored.phase = "synthesis"
    stored.updated_at -= timedelta(minutes=5)
    before = stored.updated_at
    db_session.commit()

    narrative_map_runs._call_with_run_heartbeat(stored.id, lambda: time.sleep(0.05))

    db_session.expire_all()
    refreshed = db_session.get(NarrativeMapRunRow, stored.id)
    assert refreshed.updated_at > before
    snapshots.purge_project(db_session, project["id"])


def _scene_analysis(
    scene_id: str, beat_id: str, text: str = "<UNKNOWN>"
) -> InferredNarrativeSceneAnalysisBatch:
    """A scene analysis; the default placeholder text is schema-valid but rejected."""
    return InferredNarrativeSceneAnalysisBatch.model_validate(
        {
            "scenes": [
                {
                    "sceneId": scene_id,
                    "summary": text,
                    "focalCharacterName": None,
                    "dramaticFunction": text,
                    "conflict": text,
                    "stakes": text,
                    "turnBeatId": beat_id,
                    "turn": text,
                    "keyMoments": [
                        {
                            "beatId": beat_id,
                            "summary": text,
                            "dramaticFunction": text,
                            "consequence": text,
                        }
                    ],
                }
            ]
        }
    )


def _spy(monkeypatch, llm: MockLlmClient, op: str) -> list[str]:
    """Record the user message of every `op` call while keeping the mock's answer."""
    seen: list[str] = []
    original = getattr(llm, op)

    def spy(**kwargs):
        seen.append(kwargs["system"] + kwargs["user_message"])
        return original(**kwargs)

    monkeypatch.setattr(llm, op, spy)
    return seen


def _edit_episode(db_session, project_id: str, edit) -> None:
    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        doc = copy.deepcopy(state.doc)
        edit(doc["seasons"][0]["episodes"][0])
        return snapshots.MutationState(doc=doc, ledger=state.ledger, flags=state.flags)

    snapshots.mutate(db_session, project_id, "Test edit", mutator)


def _imported_project(mock_llm, monkeypatch, src: str) -> dict:
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    return _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1]["result"][
        "project"
    ]


def test_narrative_map_rerolls_a_rejected_scene_once_with_the_same_prompt(
    db_session, mock_llm, monkeypatch, caplog
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    project = _imported_project(mock_llm, monkeypatch, src)
    scene = project["seasons"][0]["episodes"][0]["scenes"][0]
    mock_llm.set_responses(
        "infer_narrative_scene_analysis",
        [_scene_analysis(scene["id"], scene["beats"][0]["id"])],
    )
    prompts = _spy(monkeypatch, mock_llm, "infer_narrative_scene_analysis")
    run_id = client.post(f"/api/v1/projects/{project['id']}/narrative-map").json()["id"]

    with caplog.at_level(logging.INFO, logger="drama_manager.narrative_map_runs"):
        execute_run(run_id, mock_llm)
    db_session.expire_all()

    run = db_session.get(NarrativeMapRunRow, run_id)
    assert run.status == "completed"
    assert len(prompts) == 2 and prompts[0] == prompts[1]
    assert "fallbackSceneIds" not in run.checkpoint
    assert "analysisStatus" not in run.checkpoint["scenePackets"][0]
    persisted = db_session.get(ProjectRow, project["id"])
    narrative_map = persisted.doc["seasons"][0]["episodes"][0]["narrativeMap"]
    assert [turn["sceneId"] for turn in narrative_map["sceneTurns"]] == [scene["id"]]
    assert narrative_map["unanalyzedSceneIds"] == []
    joined = " ".join(record.getMessage() for record in caplog.records)
    assert "narrative_map_scene_rejected" in joined
    assert "attempt=2" in joined
    assert src not in joined

    snapshots.purge_project(db_session, project["id"])


def test_narrative_map_never_writes_prose_for_a_scene_that_fails_twice(
    db_session, mock_llm, monkeypatch, caplog
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    project = _imported_project(mock_llm, monkeypatch, src)
    scene = project["seasons"][0]["episodes"][0]["scenes"][0]
    bad = _scene_analysis(scene["id"], scene["beats"][0]["id"])
    mock_llm.set_responses("infer_narrative_scene_analysis", [bad, bad])
    run_id = client.post(f"/api/v1/projects/{project['id']}/narrative-map").json()["id"]

    with caplog.at_level(logging.INFO, logger="drama_manager.narrative_map_runs"):
        execute_run(run_id, mock_llm)
    db_session.expire_all()

    run = db_session.get(NarrativeMapRunRow, run_id)
    persisted = db_session.get(ProjectRow, project["id"])
    # No scene could be read, so there is nothing to synthesise from.
    assert (run.status, run.error_code) == ("rejected", "EVIDENCE_REJECTED")
    assert run.checkpoint["unanalyzedSceneIds"] == [scene["id"]]
    assert run.checkpoint.get("scenePackets", []) == []
    assert "fallbackSceneIds" not in run.checkpoint
    assert mock_llm.invocation_count("infer_narrative_scene_analysis") == 2
    assert mock_llm.invocation_count("infer_narrative_map_synthesis") == 0
    assert persisted.doc["seasons"][0]["episodes"][0]["narrativeMap"] is None
    assert "narrative_map_scene_unanalyzed" in " ".join(r.getMessage() for r in caplog.records)

    snapshots.purge_project(db_session, project["id"])


@pytest.mark.parametrize("lock", ["episode", "narrativeMap"])
def test_locked_map_with_unanalyzed_scenes_is_never_analysed_again(
    db_session, mock_llm, monkeypatch, lock
):
    src = "INT. BAR - NIGHT\nDan pours a drink.\n\nINT. BAR - LATER\nMarta counts the till."
    project = _imported_project(mock_llm, monkeypatch, src)
    first, second = project["seasons"][0]["episodes"][0]["scenes"]
    bad = _scene_analysis(second["id"], second["beats"][0]["id"])
    good = _scene_analysis(first["id"], first["beats"][0]["id"], "Dan pours a drink for himself.")
    mock_llm.set_responses("infer_narrative_scene_analysis", [good, bad, bad])
    url = f"/api/v1/projects/{project['id']}/narrative-map"
    run_id = client.post(url).json()["id"]
    execute_run(run_id, mock_llm)
    db_session.expire_all()
    assert db_session.get(NarrativeMapRunRow, run_id).status == "completed"

    def lock_it(episode: dict) -> None:
        (episode if lock == "episode" else episode["narrativeMap"])["locked"] = True

    _edit_episode(db_session, project["id"], lock_it)
    locked_doc = copy.deepcopy(db_session.get(ProjectRow, project["id"]).doc)

    response = client.post(url)

    assert response.status_code == 409
    db_session.expire_all()
    assert db_session.get(NarrativeMapRunRow, run_id).status == "completed"
    assert mock_llm.invocation_count("infer_narrative_scene_analysis") == 3
    assert db_session.get(ProjectRow, project["id"]).doc == locked_doc

    snapshots.purge_project(db_session, project["id"])


def test_unanalyzed_scene_is_listed_then_analysed_again_on_request(
    db_session, mock_llm, monkeypatch
):
    from llm.mock import _source_data_value

    src = "INT. BAR - NIGHT\nDan pours a drink.\n\nINT. BAR - LATER\nMarta counts the till."
    project = _imported_project(mock_llm, monkeypatch, src)
    first, second = project["seasons"][0]["episodes"][0]["scenes"]

    def overview_covers_second(episode: dict) -> None:
        overview = episode["storyOverview"]
        overview["outline"].append({"sceneId": second["id"], "summary": "Marta counts."})
        overview["beatSheet"].append(
            {"beatId": second["beats"][0]["id"], "label": "Count", "summary": "Marta counts."}
        )

    _edit_episode(db_session, project["id"], overview_covers_second)
    bad = _scene_analysis(second["id"], second["beats"][0]["id"])
    mock_llm.set_responses(
        "infer_narrative_scene_analysis",
        [
            _scene_analysis(first["id"], first["beats"][0]["id"], "Dan pours a drink for himself."),
            bad,
            bad,
        ],
    )
    synthesis_prompts = _spy(monkeypatch, mock_llm, "infer_narrative_map_synthesis")
    verify_prompts = _spy(monkeypatch, mock_llm, "verify_narrative_map")
    url = f"/api/v1/projects/{project['id']}/narrative-map"
    run_id = client.post(url).json()["id"]

    execute_run(run_id, mock_llm)
    db_session.expire_all()

    run = db_session.get(NarrativeMapRunRow, run_id)
    assert run.status == "completed"
    assert run.checkpoint["unanalyzedSceneIds"] == [second["id"]]
    narrative_map = db_session.get(ProjectRow, project["id"]).doc["seasons"][0]["episodes"][0][
        "narrativeMap"
    ]
    assert narrative_map["unanalyzedSceneIds"] == [second["id"]]
    assert [turn["sceneId"] for turn in narrative_map["sceneTurns"]] == [first["id"]]
    spine = _source_data_value(synthesis_prompts[0], "narrative_scene_macro_spine")
    assert [row["sceneId"] for row in spine] == [first["id"]]
    overview = _source_data_value(synthesis_prompts[0], "story_overview")
    assert [row["sceneId"] for row in overview["outline"]] == [first["id"]]
    assert second["beats"][0]["id"] not in {row["beatId"] for row in overview["beatSheet"]}
    audit = _source_data_value(verify_prompts[0], "narrative_map_audit_evidence")
    assert audit["serverCheckedSceneIds"] == [first["id"]]
    assert all(second["id"] not in row["sceneIds"] for row in audit["actScenes"])

    latest = client.get(f"{url}/runs/latest").json()
    assert latest["retryAllowed"] is True
    resumed = client.post(url).json()
    assert (resumed["id"], resumed["status"]) == (run_id, "queued")

    execute_run(run_id, mock_llm)
    db_session.expire_all()

    run = db_session.get(NarrativeMapRunRow, run_id)
    assert run.status == "completed"
    assert run.checkpoint.get("unanalyzedSceneIds", []) == []
    # Only the unanalysed scene is read again; the analysed packet is reused.
    assert mock_llm.invocation_count("infer_narrative_scene_analysis") == 4
    assert mock_llm.invocation_count("infer_narrative_map_synthesis") == 2
    narrative_map = db_session.get(ProjectRow, project["id"]).doc["seasons"][0]["episodes"][0][
        "narrativeMap"
    ]
    assert narrative_map["unanalyzedSceneIds"] == []
    assert [turn["sceneId"] for turn in narrative_map["sceneTurns"]] == [
        first["id"],
        second["id"],
    ]
    assert client.get(f"{url}/runs/latest").json()["retryAllowed"] is False

    snapshots.purge_project(db_session, project["id"])


def test_narrative_map_never_reuses_a_fallback_scene_packet(db_session, mock_llm, monkeypatch):
    """Fallback run -> a run that reused its packet unmarked (as 2.6 did) -> third run."""
    src = "INT. BAR - NIGHT\nDan pours a drink."
    project = _imported_project(mock_llm, monkeypatch, src)
    project_id = project["id"]
    scene = project["seasons"][0]["episodes"][0]["scenes"][0]
    url = f"/api/v1/projects/{project_id}/narrative-map"
    fallback_run_id = client.post(url).json()["id"]
    execute_run(fallback_run_id, mock_llm)
    db_session.expire_all()
    # Runs no longer fall back; stamp this one the way analysis 2.5 recorded it.
    fallback_run = db_session.get(NarrativeMapRunRow, fallback_run_id)
    packet = fallback_run.checkpoint["scenePackets"][0]
    fallback_run.checkpoint = {
        **fallback_run.checkpoint,
        "fallbackSceneIds": [scene["id"]],
        "scenePackets": [{**packet, "analysisStatus": "source_fallback"}],
    }
    db_session.commit()

    db_session.add(
        NarrativeMapRunRow(
            id="nmap-reused-fallback",
            project_id=project_id,
            run_key=f"{project_id}:reusing:{fallback_run.source_hash}",
            source_snapshot_id=fallback_run.source_snapshot_id,
            source_hash=fallback_run.source_hash,
            analysis_version="reusing",
            status="completed",
            phase="completed",
            scene_count=1,
            completed_scene_count=1,
            attempt_count=1,
            checkpoint={"scenePackets": [packet]},
            updated_at=fallback_run.updated_at + timedelta(seconds=1),
        )
    )
    db_session.commit()

    monkeypatch.setattr(narrative_map_runs, "NARRATIVE_MAP_ANALYSIS_VERSION", "third")
    third = client.post(url).json()

    assert third["completedSceneCount"] == 0
    execute_run(third["id"], mock_llm)
    assert mock_llm.invocation_count("infer_narrative_scene_analysis") == 2

    snapshots.purge_project(db_session, project_id)


def test_narrative_map_timeout_preserves_the_completed_import(db_session, mock_llm, monkeypatch):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]
    original_head = project["headSnapshotId"]

    def timeout(*args, **kwargs):
        del args, kwargs
        raise LlmTimeoutError("infer_narrative_scene_analysis", timeout_seconds=1.0)

    monkeypatch.setattr(mock_llm, "infer_narrative_scene_analysis", timeout)
    response = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": original_head},
    )

    assert response.status_code == 202
    run = response.json()
    execute_run(run["id"], mock_llm)
    db_session.expire_all()
    stored_run = db_session.get(NarrativeMapRunRow, run["id"])
    persisted = db_session.get(ProjectRow, project_id)

    assert stored_run.status == "failed"
    assert stored_run.error_code == "LLM_TIMEOUT"
    assert persisted.head_snapshot_id == original_head
    assert persisted.doc["seasons"][0]["episodes"][0]["narrativeMap"] is None
    assert db_session.query(SnapshotRow).filter_by(project_id=project_id).count() == 1

    repeated = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": original_head},
    )
    assert repeated.status_code == 202
    assert repeated.json()["id"] == run["id"]
    assert repeated.json()["status"] == "failed"

    snapshots.purge_project(db_session, project_id)


_PROVIDER_REQUEST = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


def _status_error(cls: type, status: int) -> anthropic.APIStatusError:
    response = httpx.Response(status, request=_PROVIDER_REQUEST)
    return cls(message="provider error", response=response, body=None)


def _fail_first_call(monkeypatch, llm: MockLlmClient, op: str, exc: Exception) -> None:
    original = getattr(llm, op)
    calls: list[int] = []

    def flaky(**kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise exc
        return original(**kwargs)

    monkeypatch.setattr(llm, op, flaky)


def _failed_map_run(db_session, mock_llm, monkeypatch, op: str, exc: Exception):
    """Import, fail the first `op` call of a map run, return (url, run_id, latest run)."""
    project = _imported_project(mock_llm, monkeypatch, "INT. BAR - NIGHT\nDan pours a drink.")
    url = f"/api/v1/projects/{project['id']}/narrative-map"
    _fail_first_call(monkeypatch, mock_llm, op, exc)
    run_id = client.post(url).json()["id"]
    execute_run(run_id, mock_llm)
    db_session.expire_all()
    return project["id"], url, run_id, client.get(f"{url}/runs/latest").json()


@pytest.mark.parametrize(
    "exc",
    [
        _status_error(anthropic.RateLimitError, 429),
        _status_error(anthropic.OverloadedError, 529),
        _status_error(anthropic.InternalServerError, 500),
        anthropic.APIConnectionError(request=_PROVIDER_REQUEST),
    ],
    ids=["429", "529", "500", "connection"],
)
def test_a_provider_outage_resumes_from_checkpoints_on_the_writers_click(
    db_session, mock_llm, monkeypatch, exc
):
    project_id, url, run_id, latest = _failed_map_run(
        db_session, mock_llm, monkeypatch, "infer_narrative_map_synthesis", exc
    )

    assert (latest["status"], latest["errorCode"]) == ("failed", "LLM_UNAVAILABLE")
    assert latest["retryAllowed"] is True, "the provider refused the call; nothing ran to wait out"
    resumed = client.post(url).json()
    assert (resumed["id"], resumed["status"]) == (run_id, "queued")
    execute_run(run_id, mock_llm)
    db_session.expire_all()
    assert db_session.get(NarrativeMapRunRow, run_id).status == "completed"
    assert mock_llm.invocation_count("infer_narrative_scene_analysis") == 1, "checkpoint reused"

    snapshots.purge_project(db_session, project_id)


@pytest.mark.parametrize(
    "exc",
    [
        anthropic.APITimeoutError(request=_PROVIDER_REQUEST),
        # A gateway timeout may have run and been billed, like any other timeout.
        _status_error(anthropic.InternalServerError, 504),
    ],
    ids=["sdk-timeout", "504"],
)
def test_a_provider_timeout_keeps_the_retry_grace_period(db_session, mock_llm, monkeypatch, exc):
    project_id, url, run_id, latest = _failed_map_run(
        db_session, mock_llm, monkeypatch, "infer_narrative_map_synthesis", exc
    )

    assert (latest["errorCode"], latest["retryAllowed"]) == ("LLM_TIMEOUT", False)
    assert client.post(url).json()["status"] == "failed", "not requeued inside the grace period"
    run = db_session.get(NarrativeMapRunRow, run_id)
    run.updated_at -= timedelta(minutes=11)
    db_session.commit()
    assert client.get(f"{url}/runs/latest").json()["retryAllowed"] is True

    snapshots.purge_project(db_session, project_id)


@pytest.mark.parametrize(
    ("exc", "code", "said"),
    [
        (_status_error(anthropic.BadRequestError, 400), "LLM_REQUEST_REFUSED", "HTTP 400"),
        (_status_error(anthropic.AuthenticationError, 401), "LLM_REQUEST_REFUSED", "HTTP 401"),
        (RuntimeError("a bug"), "INTERNAL_ERROR", "internal error"),
    ],
    ids=["400", "401", "bug"],
)
def test_a_refused_request_or_a_bug_is_terminal_with_a_clear_message(
    db_session, mock_llm, monkeypatch, exc, code, said
):
    """A credit-exhausted 400 would refuse a resume the same way, so none is offered."""
    project_id, url, run_id, latest = _failed_map_run(
        db_session, mock_llm, monkeypatch, "infer_narrative_map_synthesis", exc
    )

    assert (latest["errorCode"], latest["retryAllowed"]) == (code, False)
    assert said in latest["errorMessage"]
    repeated = client.post(url).json()
    assert (repeated["status"], repeated["attemptCount"]) == ("failed", latest["attemptCount"])

    snapshots.purge_project(db_session, project_id)


def test_a_synthesis_schema_failure_resumes_by_re_running_only_synthesis(
    db_session, mock_llm, monkeypatch
):
    monkeypatch.setattr(render, "new_nonce", lambda: "fixed-nonce")
    project = _imported_project(mock_llm, monkeypatch, "INT. BAR - NIGHT\nDan pours a drink.")
    url = f"/api/v1/projects/{project['id']}/narrative-map"
    op = "infer_narrative_map_synthesis"
    _fail_first_call(monkeypatch, mock_llm, op, SchemaInvalidLlmError(op))
    prompts = _spy(monkeypatch, mock_llm, op)
    run_id = client.post(url).json()["id"]
    execute_run(run_id, mock_llm)

    latest = client.get(f"{url}/runs/latest").json()
    assert (latest["errorCode"], latest["retryAllowed"]) == ("SCHEMA_INVALID_LLM", True)
    assert "re-runs only the synthesis" in latest["errorMessage"]
    resumed = client.post(url).json()
    assert (resumed["id"], resumed["status"]) == (run_id, "queued")
    execute_run(run_id, mock_llm)
    db_session.expire_all()

    assert db_session.get(NarrativeMapRunRow, run_id).status == "completed"
    assert mock_llm.invocation_count("infer_narrative_scene_analysis") == 1
    assert len(prompts) == 2 and prompts[0] == prompts[1], "same prompt, re-rolled"
    assert mock_llm.invocation_count("verify_narrative_map") == 1

    snapshots.purge_project(db_session, project["id"])


def test_a_scene_phase_schema_failure_is_not_offered_the_synthesis_resume(
    db_session, mock_llm, monkeypatch
):
    op = "infer_narrative_scene_analysis"
    project_id, url, _run_id, latest = _failed_map_run(
        db_session, mock_llm, monkeypatch, op, SchemaInvalidLlmError(op)
    )

    assert (latest["errorCode"], latest["retryAllowed"]) == ("SCHEMA_INVALID_LLM", False)
    assert client.post(url).json()["status"] == "failed"

    snapshots.purge_project(db_session, project_id)


def test_narrative_map_verifier_rejection_never_writes_a_snapshot(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    mock_llm.set_response(
        "verify_narrative_map",
        NarrativeMapVerification(
            approved=False,
            unsupportedClaims=[{"path": 'themes[0].statement', "reason": "",
                "excerptCarriesClaim": False}],
            missingSceneIds=[],
            # Not also filed as an advisory: since T9.13 that makes it advisory.
            advisories=[],
        ),
    )
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]

    response = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    )
    execute_run(response.json()["id"], mock_llm)
    db_session.expire_all()

    run = db_session.get(NarrativeMapRunRow, response.json()["id"])
    persisted = db_session.get(ProjectRow, project_id)
    assert run.status == "rejected"
    assert run.error_code == "EVIDENCE_REJECTED"
    assert mock_llm.invocation_count("infer_narrative_map_synthesis") == 1
    assert mock_llm.invocation_count("verify_narrative_map") == 1
    assert persisted.doc["seasons"][0]["episodes"][0]["narrativeMap"] is None
    assert db_session.query(SnapshotRow).filter_by(project_id=project_id).count() == 1

    snapshots.purge_project(db_session, project_id)


def test_narrative_map_publishes_when_the_verifier_withdrew_every_blocking_claim(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    mock_llm.set_response(
        "verify_narrative_map",
        NarrativeMapVerification(
            approved=False,
            # A path local repair cannot prune: only the withdrawal lets it pass.
            unsupportedClaims=[{"path": "sceneTurns[0].turnBeatId", "reason": "Supported.",
                "excerptCarriesClaim": True}],
            missingSceneIds=[],
            advisories=[],
        ),
    )
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]

    response = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    )
    execute_run(response.json()["id"], mock_llm)
    db_session.expire_all()

    run = db_session.get(NarrativeMapRunRow, response.json()["id"])
    persisted = db_session.get(ProjectRow, project_id)
    assert (run.status, run.error_code) == ("completed", None)
    assert [c["path"] for c in run.checkpoint["selfRetractedClaims"]] == [
        "sceneTurns[0].turnBeatId"
    ]
    assert mock_llm.invocation_count("verify_narrative_map") == 1
    assert persisted.doc["seasons"][0]["episodes"][0]["narrativeMap"] is not None
    assert persisted.head_snapshot_id != project["headSnapshotId"]

    snapshots.purge_project(db_session, project_id)


def test_saved_scene_packet_repair_requeues_only_compact_verification(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    source = prepare_narrative_map_source(project)
    prior = NarrativeMapRunRow(
        id="nmap-scene-packet-repair",
        project_id=project["id"],
        run_key=f"{project['id']}:{NARRATIVE_MAP_ANALYSIS_VERSION}:{source.source_hash}",
        source_snapshot_id=project["headSnapshotId"],
        source_hash=source.source_hash,
        analysis_version=NARRATIVE_MAP_ANALYSIS_VERSION,
        status="rejected",
        phase="failed",
        scene_count=1,
        completed_scene_count=1,
        attempt_count=1,
        error_code="EVIDENCE_REJECTED",
        checkpoint={
            "scenePackets": [],
            "synthesis": {"threadMovements": []},
            "verification": {
                "approved": False,
                "unsupportedClaims": [
                    {
                        "path": 'sceneTurns[0].conflict contains placeholder filler',
                        "reason": "", "excerptCarriesClaim": False
                    }
                ],
                "missingSceneIds": [],
                "advisories": [
                    {"path": "characterArcs[0]", "reason": "Non-blocking editorial note."}
                ],
            },
            "rejectionDiagnostics": [
                {
                    "code": "verifier_rejected",
                    "path": "sceneTurns[0].conflict contains placeholder filler",
                },
                {"code": "verifier_issue", "path": "characterArcs[0]"},
            ],
        },
    )
    db_session.add(prior)
    db_session.commit()

    latest = client.get(f"/api/v1/projects/{project['id']}/narrative-map/runs/latest").json()
    resumed = client.post(
        f"/api/v1/projects/{project['id']}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    db_session.expire_all()
    stored = db_session.get(NarrativeMapRunRow, prior.id)

    assert latest["retryAllowed"] is True
    assert "saved scene-packet repair" in latest["errorMessage"].lower()
    assert resumed["id"] == prior.id
    assert stored.status == "queued"
    assert stored.checkpoint["scenePacketRepairVersion"] == 1
    assert "verification" not in stored.checkpoint
    assert "rejectionDiagnostics" not in stored.checkpoint

    snapshots.purge_project(db_session, project["id"])


def test_verifier_coverage_rejection_finishes_from_cache_without_more_model_calls(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    mock_llm.set_response(
        "verify_narrative_map",
        NarrativeMapVerification(
            approved=False,
            unsupportedClaims=[
                {
                    "path": 'characterArcs (empty despite a possible arc)',
                    "reason": "", "excerptCarriesClaim": False
                }
            ],
            missingSceneIds=[],
            advisories=[
                {
                    "path": "sceneTurns",
                    "reason": "The required scene is represented.",
                }
            ],
        ),
    )
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    project_id = project["id"]
    original_head = project["headSnapshotId"]

    first = client.post(
        f"/api/v1/projects/{project_id}/narrative-map",
        headers={"If-Match": original_head},
    ).json()
    execute_run(first["id"], mock_llm)
    db_session.expire_all()

    stored = db_session.get(NarrativeMapRunRow, first["id"])
    persisted = db_session.get(ProjectRow, project_id)
    # Repaired on the first pass, not on a resume. This used to reject here and
    # only publish if the writer clicked again — while the panel told them a
    # retry was blocked to prevent another charge, for a repair that costs none.
    assert stored.status == "completed"
    assert stored.checkpoint["verificationAdjudication"]["providerCalls"] == 0
    assert mock_llm.invocation_count("infer_narrative_map_synthesis") == 1
    assert mock_llm.invocation_count("verify_narrative_map") == 1
    assert persisted.doc["seasons"][0]["episodes"][0]["narrativeMap"] is not None
    assert persisted.head_snapshot_id != original_head

    snapshots.purge_project(db_session, project_id)


def test_rejected_character_arc_is_offered_as_a_no_cost_saved_repair(
    db_session, mock_llm, monkeypatch
):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    _configure_success(mock_llm, src, fact=True)
    monkeypatch.setattr(routes, "enqueue_run", lambda *args: None)
    project = _parse_sse(client.post(URL, json=_body(src), headers=_headers()).text)[-1][1][
        "result"
    ]["project"]
    source = prepare_narrative_map_source(project)
    prior = NarrativeMapRunRow(
        id="nmap-character-arc-repair",
        project_id=project["id"],
        run_key=f"{project['id']}:{NARRATIVE_MAP_ANALYSIS_VERSION}:{source.source_hash}",
        source_snapshot_id=project["headSnapshotId"],
        source_hash=source.source_hash,
        analysis_version=NARRATIVE_MAP_ANALYSIS_VERSION,
        status="rejected",
        phase="failed",
        scene_count=1,
        completed_scene_count=1,
        attempt_count=2,
        error_code="EVIDENCE_REJECTED",
        checkpoint={
            "scenePackets": [],
            "synthesis": {"threadMovements": []},
            "verification": {
                "approved": False,
                "unsupportedClaims": [
                    {
                        "path": 'characterArcs[0].arcSummary is unsupported by its cited beat',
                        "reason": "", "excerptCarriesClaim": False
                    }
                ],
                "missingSceneIds": [],
                "advisories": [],
            },
            "rejectionDiagnostics": [
                {
                    "code": "verification_repair_path_unsupported",
                    "path": "characterArcs[0].arcSummary is unsupported by its cited beat",
                }
            ],
        },
    )
    db_session.add(prior)
    db_session.commit()

    latest = client.get(f"/api/v1/projects/{project['id']}/narrative-map/runs/latest").json()
    resumed = client.post(
        f"/api/v1/projects/{project['id']}/narrative-map",
        headers={"If-Match": project["headSnapshotId"]},
    ).json()
    db_session.expire_all()
    stored = db_session.get(NarrativeMapRunRow, prior.id)

    assert latest["retryAllowed"] is True
    assert "no model call" in latest["errorMessage"].lower()
    assert resumed["id"] == prior.id
    assert stored.status == "queued"
    assert stored.checkpoint["verificationPolicyVersion"] == 2
    assert "rejectionDiagnostics" not in stored.checkpoint

    snapshots.purge_project(db_session, project["id"])


def test_narrative_map_spine_omits_duplicate_script_text():
    scenes = [
        {
            "id": "scene-1",
            "act": 1,
            "location": "INT. BAR - NIGHT",
            "beats": [
                {
                    "id": "beat-1-1",
                    "whatHappens": "Marta confronts Dan.",
                    "audienceLearns": "Dan is hiding something.",
                    "audienceFeels": "Tension.",
                    "scriptText": "MARTA\nTell me the truth.",
                }
            ],
        }
    ]

    compact = pipeline._narrative_map_scene_spine(scenes, include_script_text=False)

    assert compact[0]["beats"][0] == {
        "beatId": "beat-1-1",
        "whatHappens": "Marta confronts Dan.",
        "audienceLearns": "Dan is hiding something.",
        "audienceFeels": "Tension.",
    }


def test_promises_spine_is_beats_only_with_no_raw_screenplay():
    lines = [f"LINE {index}" for index in range(20)]
    scenes = [
        {
            "id": "scene-1",
            "act": 1,
            "location": "INT. BAR - NIGHT",
            "beats": [
                {
                    "id": "beat-1-1",
                    "whatHappens": "Marta hides the letter.",
                    "audienceLearns": "The letter matters.",
                    "audienceFeels": "Suspicion.",
                    "scriptText": "\n".join(lines),
                }
            ],
        }
    ]

    compact = pipeline._promises_prompt_spine(scenes)

    assert compact[0]["beats"] == [
        {
            "beatId": "beat-1-1",
            "whatHappens": "Marta hides the letter.",
            "audienceLearns": "The letter matters.",
            "audienceFeels": "Suspicion.",
        }
    ]
    # No raw screenplay payload: the model cites a beatId and the server
    # derives the line from that beat's full text, so the six sampled lines
    # this used to carry are dead weight.
    assert "evidenceExcerpt" not in compact[0]
    assert "scriptText" not in compact[0]["beats"][0]


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
    assert all(f.status == "active" for f in facts)
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
    # A whole-script stage: a failing scene unit no longer aborts (T9.11).
    class _Raising(MockLlmClient):
        def infer_act_breaks(self, **kwargs):
            raise SchemaInvalidLlmError("infer_act_breaks")

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
                "message": "infer_act_breaks: LLM output failed schema validation twice",
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
    assert events[-1][1]["error"]["code"] == "LLM_UNAVAILABLE"
    segment_progress = [
        data
        for name, data in events
        if name == "progress" and data["stage"] == "segmenting_beats"
    ]
    # Alpha and Beta start together (a prewarm, not a lone first scene, warms
    # the cache); Beta fails while Alpha is still running. Progress stops at
    # the failure and never reports work the run did not complete.
    assert segment_progress == [_progress("segmenting_beats", 0, 3)]
    _assert_no_new_rows(db_session, baseline)


def test_llm_transport_error_maps_to_failed_zero_rows(db_session, mock_llm, caplog):
    exc = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))

    class _Raising(MockLlmClient):
        def segment_scene(self, **kwargs):
            raise exc

    app.dependency_overrides[get_llm_client] = lambda: _Raising()
    try:
        before = db_session.query(ProjectRow).count()
        with caplog.at_level(logging.WARNING, logger="fountain.create_import"):
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
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "llm_unavailable" in joined
    assert "APIConnectionError" in joined
    assert "create_and_import" in joined


def test_import_timeout_logs_run_stage_and_budget_without_source_text(db_session, mock_llm, caplog):
    secret_source = "INT. SECRET OFFICE - NIGHT\nThe confidential page must stay private."

    class _Raising(MockLlmClient):
        def segment_scene(self, **kwargs):
            raise LlmTimeoutError("segment_scene", timeout_seconds=12.5)

    app.dependency_overrides[get_llm_client] = lambda: _Raising()
    try:
        with caplog.at_level(logging.INFO, logger="fountain.create_import"):
            response = client.post(
                URL,
                json=_body(secret_source),
                headers=_headers("00000000-0000-4000-8000-000000000111"),
            )
    finally:
        app.dependency_overrides[get_llm_client] = lambda: mock_llm

    assert _parse_sse(response.text)[-1][1]["error"]["code"] == "LLM_UNAVAILABLE"
    assert response.headers["X-Table-Read-Import-Run-Id"].startswith("import-")
    joined = " ".join(record.getMessage() for record in caplog.records)
    assert "import_started run_id=import-" in joined
    assert "import_stage_started" in joined
    assert "stage=segmenting_beats" in joined
    assert "import_failed run_id=import-" in joined
    assert "op=segment_scene" in joined
    assert "timeout_seconds=12.5" in joined
    assert secret_source not in joined
    assert "confidential page" not in joined


def test_retry_resumes_saved_scene_and_act_checkpoints_without_rebilling(
    db_session, mock_llm, monkeypatch
):
    src = "\n".join(
        [
            "INT. BAR - NIGHT",
            "Dan pours a drink.",
            "INT. OFFICE - DAY",
            "Marta opens the file.",
        ]
    )
    key = "00000000-0000-4000-8000-000000000112"
    headers = _headers(key)
    _configure_success(mock_llm, src)
    original_entities = mock_llm.infer_story_entities

    def timeout_entities(**kwargs):
        del kwargs
        raise LlmTimeoutError("infer_story_entities", timeout_seconds=180.0)

    monkeypatch.setattr(mock_llm, "infer_story_entities", timeout_entities)
    failed = _parse_sse(client.post(URL, json=_body(src), headers=headers).text)

    assert failed[-1][1]["error"]["code"] == "LLM_UNAVAILABLE"
    run = db_session.query(ImportRunRow).filter_by(idempotency_key=key).one()
    assert run.status == "failed"
    assert run.scene_count == 2
    assert run.completed_scene_count == 2
    assert (
        db_session.query(ImportRunUnitRow)
        .filter_by(run_id=run.id, stage="segmenting_beats")
        .count()
        == 2
    )
    assert mock_llm.invocation_count("segment_scene") == 2
    assert mock_llm.invocation_count("infer_act_breaks") == 1

    monkeypatch.setattr(mock_llm, "infer_story_entities", original_entities)
    paused = _parse_sse(client.post(URL, json=_body(src), headers=headers).text)
    assert paused[-1][1]["error"]["code"] == "RETRY_PAUSED"
    assert mock_llm.invocation_count("segment_scene") == 2

    run.updated_at = run.updated_at - timedelta(minutes=11)
    db_session.commit()
    resumed = _parse_sse(client.post(URL, json=_body(src), headers=headers).text)

    assert resumed[-1][0] == "complete"
    assert mock_llm.invocation_count("segment_scene") == 2
    assert mock_llm.invocation_count("infer_act_breaks") == 1
    resumed_segment_progress = [
        data
        for name, data in resumed
        if name == "progress" and data["stage"] == "segmenting_beats"
    ]
    assert resumed_segment_progress[0]["done"] == 2
    db_session.refresh(run)
    assert run.status == "completed"
    assert run.checkpoint == {}
    assert db_session.query(ImportRunUnitRow).filter_by(run_id=run.id).count() == 0


# ── T9.5: saved units must match the scene text, prompt and models ──────────

_TWO_SCENES = "\n".join(
    ["INT. BAR - NIGHT", "Dan pours a drink.", "INT. OFFICE - DAY", "Marta opens the file."]
)


def _failing(monkeypatch, llm: MockLlmClient, op: str):
    """Make `op` fail validation; call the returned function to restore it."""
    original = getattr(llm, op)

    def fail(**kwargs):
        del kwargs
        raise SchemaInvalidLlmError(op)

    monkeypatch.setattr(llm, op, fail)
    return lambda: monkeypatch.setattr(llm, op, original)


def _whole_source_as_one_scene(source: str) -> list[SceneSpan]:
    """Another parser's split of the same source, as a re-split would give."""
    return [SceneSpan(location="", lines=source.split("\n"), start_line=0)]


def _post_import(key: str, src: str = _TWO_SCENES) -> list[tuple[str, dict]]:
    return _parse_sse(client.post(URL, json=_body(src), headers=_headers(key)).text)


def _run_for(db_session, key: str) -> ImportRunRow | None:
    db_session.expire_all()
    return db_session.query(ImportRunRow).filter_by(idempotency_key=key).one_or_none()


def _unit_count(db_session, run_id: str) -> int:
    return db_session.query(ImportRunUnitRow).filter_by(run_id=run_id).count()


def test_resume_resegments_a_scene_whose_saved_beats_are_other_text(
    db_session, mock_llm, monkeypatch
):
    _configure_success(mock_llm, _TWO_SCENES)
    monkeypatch.setattr(pipeline, "split_into_scenes", _whole_source_as_one_scene)
    restore = _failing(monkeypatch, mock_llm, "infer_story_entities")
    failed = _post_import("t95-resplit-segment")
    assert failed[-1][1]["error"]["code"] == "SCHEMA_INVALID_LLM"
    assert mock_llm.invocation_count("segment_scene") == 1

    monkeypatch.setattr(pipeline, "split_into_scenes", split_into_scenes)
    restore()
    resumed = _post_import("t95-resplit-segment")

    assert resumed[-1][0] == "complete"
    assert mock_llm.invocation_count("segment_scene") == 3
    scenes = resumed[-1][1]["result"]["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert ["\n".join(b["scriptText"] for b in s["beats"]) for s in scenes] == [
        "\n".join(span.lines) for span in split_into_scenes(_TWO_SCENES)
    ]


def test_resume_reextracts_a_scene_whose_saved_facts_came_from_other_text(
    db_session, mock_llm, monkeypatch
):
    _configure_success(mock_llm, _TWO_SCENES)
    monkeypatch.setattr(pipeline, "split_into_scenes", _whole_source_as_one_scene)
    restore = _failing(monkeypatch, mock_llm, "scan_consistency")
    failed = _post_import("t95-resplit-extract")
    assert failed[-1][1]["error"]["code"] == "SCHEMA_INVALID_LLM"
    assert mock_llm.invocation_count("extract_ledger_facts") == 1

    monkeypatch.setattr(pipeline, "split_into_scenes", split_into_scenes)
    restore()
    resumed = _post_import("t95-resplit-extract")

    assert resumed[-1][0] == "complete"
    assert mock_llm.invocation_count("extract_ledger_facts") == 3


def test_resume_reuses_saved_extractions_for_unchanged_scenes(
    db_session, mock_llm, monkeypatch
):
    _configure_success(mock_llm, _TWO_SCENES)
    restore = _failing(monkeypatch, mock_llm, "scan_consistency")
    assert _post_import("t95-unchanged")[-1][0] == "failed"
    assert mock_llm.invocation_count("extract_ledger_facts") == 2

    restore()
    resumed = _post_import("t95-unchanged")

    assert resumed[-1][0] == "complete"
    assert mock_llm.invocation_count("segment_scene") == 2
    assert mock_llm.invocation_count("extract_ledger_facts") == 2


@pytest.mark.parametrize("change", ["prompt", "models"])
def test_resume_reuses_no_unit_after_a_prompt_or_model_change(
    db_session, mock_llm, monkeypatch, tmp_path, change
):
    key = f"t95-version-{change}"
    _configure_success(mock_llm, _TWO_SCENES)
    restore = _failing(monkeypatch, mock_llm, "infer_story_entities")
    assert _post_import(key)[-1][0] == "failed"
    assert mock_llm.invocation_count("segment_scene") == 2

    if change == "prompt":
        monkeypatch.setattr(render, "PROMPT_VERSION", f"{render.PROMPT_VERSION}-next")
    else:
        models = tmp_path / "models.toml"
        models.write_text(import_runs._MODELS_CONFIG.read_text() + "\n# repinned\n")
        monkeypatch.setattr(import_runs, "_MODELS_CONFIG", models)
    restore()
    resumed = _post_import(key)

    assert resumed[-1][0] == "complete"
    assert mock_llm.invocation_count("segment_scene") == 4
    assert mock_llm.invocation_count("infer_act_breaks") == 2


def test_resume_reuses_no_unit_saved_before_numbered_headings_split(
    db_session, mock_llm, monkeypatch
):
    """Entity, promise and overview units carry scene ids from the split that
    made them and are not content-checked, so T9.6's re-split must not reuse
    any unit a pre-T9.6 run saved."""
    src = "\n".join(
        ["INT. BAR - NIGHT", "Dan pours a drink.", "17 INT. OFFICE - DAY 17", "Marta waits."]
    )
    _configure_success(mock_llm, src)
    current_version = import_runs.IMPORT_ANALYSIS_VERSION
    monkeypatch.setattr(import_runs, "IMPORT_ANALYSIS_VERSION", "2026-10-04.1")  # pre-T9.6
    monkeypatch.setattr(pipeline, "split_into_scenes", _whole_source_as_one_scene)
    restore = _failing(monkeypatch, mock_llm, "infer_narrative_promises")
    assert _post_import("t96-resplit", src)[-1][0] == "failed"
    assert mock_llm.invocation_count("infer_story_entities") == 1

    monkeypatch.setattr(import_runs, "IMPORT_ANALYSIS_VERSION", current_version)
    monkeypatch.setattr(pipeline, "split_into_scenes", split_into_scenes)
    restore()
    resumed = _post_import("t96-resplit", src)

    assert resumed[-1][0] == "complete"
    assert len(resumed[-1][1]["result"]["project"]["seasons"][0]["episodes"][0]["scenes"]) == 2
    assert mock_llm.invocation_count("infer_story_entities") == 2
    assert mock_llm.invocation_count("infer_act_breaks") == 2


def test_resume_reuses_no_act_guess_saved_before_printed_markers_counted(
    db_session, mock_llm, monkeypatch
):
    src = "\n".join(
        [
            "ACT ONE",
            "INT. BAR - NIGHT",
            "Dan pours a drink.",
            "ACT TWO",
            "INT. OFFICE - DAY",
            "Marta waits.",
            "ACT THREE",
            "INT. DOCK - NIGHT",
            "They leave.",
        ]
    )
    _configure_success(mock_llm, src)
    current_version = import_runs.IMPORT_ANALYSIS_VERSION
    monkeypatch.setattr(import_runs, "IMPORT_ANALYSIS_VERSION", "2026-10-04.2")  # pre-T9.7
    from_markers = pipeline.acts.acts_from_markers
    monkeypatch.setattr(pipeline.acts, "acts_from_markers", lambda *args: None)
    restore = _failing(monkeypatch, mock_llm, "infer_story_entities")
    assert _post_import("t97-markers", src)[-1][0] == "failed"
    assert mock_llm.invocation_count("infer_act_breaks") == 1

    monkeypatch.setattr(import_runs, "IMPORT_ANALYSIS_VERSION", current_version)
    monkeypatch.setattr(pipeline.acts, "acts_from_markers", from_markers)
    restore()
    resumed = _post_import("t97-markers", src)

    assert resumed[-1][0] == "complete"
    scenes = resumed[-1][1]["result"]["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert [scene["act"] for scene in scenes] == [0, 0, 1, 2]
    assert mock_llm.invocation_count("infer_act_breaks") == 1


def test_unfinished_runs_past_retention_are_purged_with_their_units(
    db_session, mock_llm, monkeypatch
):
    _configure_success(mock_llm, _TWO_SCENES)
    restore = _failing(monkeypatch, mock_llm, "infer_story_entities")
    assert _post_import("t95-expired")[-1][0] == "failed"
    assert _post_import("t95-retained")[-1][0] == "failed"
    expired = _run_for(db_session, "t95-expired")
    retained = _run_for(db_session, "t95-retained")
    expired_id = expired.id
    expired.updated_at -= import_runs.UNFINISHED_RUN_RETENTION + timedelta(hours=1)
    retained.updated_at -= import_runs.UNFINISHED_RUN_RETENTION - timedelta(hours=1)
    db_session.commit()
    assert _unit_count(db_session, expired_id) == 2

    restore()
    resumed = _post_import("t95-expired")

    assert resumed[-1][0] == "complete"
    assert mock_llm.invocation_count("segment_scene") == 6
    assert _unit_count(db_session, expired_id) == 0
    assert _run_for(db_session, "t95-expired").id != expired_id
    assert _unit_count(db_session, _run_for(db_session, "t95-retained").id) == 2


def test_deleting_an_imported_project_purges_runs_that_hold_its_script(
    db_session, mock_llm, monkeypatch
):
    other_src = "INT. DOCK - DAY\nSal ties a rope."
    _configure_success(mock_llm, _TWO_SCENES)
    restore = _failing(monkeypatch, mock_llm, "infer_story_entities")
    assert _post_import("t95-delete-failed")[-1][0] == "failed"
    assert _post_import("t95-delete-other", other_src)[-1][0] == "failed"
    failed_id = _run_for(db_session, "t95-delete-failed").id
    other_id = _run_for(db_session, "t95-delete-other").id

    restore()
    done = _post_import("t95-delete-done")
    pid = done[-1][1]["result"]["project"]["id"]
    assert client.delete(f"/api/v1/projects/{pid}").status_code == 204

    assert _run_for(db_session, "t95-delete-failed") is None
    assert _run_for(db_session, "t95-delete-done") is None
    assert _unit_count(db_session, failed_id) == 0
    assert _run_for(db_session, "t95-delete-other") is not None
    assert _unit_count(db_session, other_id) > 0


def test_deleting_a_project_spares_a_live_import_of_the_same_script(
    db_session, mock_llm, monkeypatch
):
    _configure_success(mock_llm, _TWO_SCENES)
    restore = _failing(monkeypatch, mock_llm, "infer_story_entities")
    assert _post_import("t95-live")[-1][0] == "failed"
    assert _post_import("t95-stalled")[-1][0] == "failed"
    live = _run_for(db_session, "t95-live")
    stalled = _run_for(db_session, "t95-stalled")
    live_id, stalled_id = live.id, stalled.id
    live.status = stalled.status = "running"
    stalled.updated_at -= import_runs.RUN_RECOVERY_AGE + timedelta(minutes=1)
    db_session.commit()

    restore()
    pid = _post_import("t95-live-done")[-1][1]["result"]["project"]["id"]
    assert client.delete(f"/api/v1/projects/{pid}").status_code == 204

    assert _run_for(db_session, "t95-live") is not None
    assert _unit_count(db_session, live_id) == 2
    assert _run_for(db_session, "t95-stalled") is None
    assert _unit_count(db_session, stalled_id) == 0


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


def test_fault_inferring_entities_zero_rows(db_session):
    baseline = _table_counts(db_session)

    class _Raising(MockLlmClient):
        def infer_story_entities(self, **kwargs):
            raise SchemaInvalidLlmError("infer_story_entities")

    gen = create_import.create_and_import_events(
        db_session,
        title="Fault Show",
        format_dict=BASICS["format"],
        premise="",
        source_format="fountain",
        content="INT. BAR\nx",
        llm=_Raising(),
        creation_idempotency_key="fault-entities",
        creation_request_hash="fault-entities",
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


# ── T9.11: a scene that fails after its rule-9 retry does not block the import ─

_THREE_SCENES = "\n".join(
    [
        "INT. ALPHA - DAY",
        "Alpha waits.",
        "INT. BETA - DAY",
        "Beta waits.",
        "INT. GAMMA - DAY",
        "Gamma waits.",
    ]
)


class _SceneFailsValidation(MockLlmClient):
    """The client raises SchemaInvalidLlmError only after its own rule-9 retry,
    so one raise here is a scene unit that failed twice."""

    def __init__(self, *, segment: str = "", extract: str = "") -> None:
        super().__init__()
        self.segment_fails_on = segment
        self.extract_fails_on = extract
        self.set_response("segment_scene", seg([(1, 2)]))
        self.set_response("scan_consistency", scan())

    def segment_scene(self, *, user_message: str, **kwargs):
        if self.segment_fails_on and self.segment_fails_on in user_message:
            raise SchemaInvalidLlmError("segment_scene")
        return super().segment_scene(user_message=user_message, **kwargs)

    def extract_ledger_facts(self, *, user_message: str, **kwargs):
        if self.extract_fails_on and self.extract_fails_on in user_message:
            raise SchemaInvalidLlmError("extract_ledger_facts")
        super().extract_ledger_facts(user_message=user_message, **kwargs)
        return extraction([one_fact()] if "Alpha waits." in user_message else None)


def _post_with(llm: MockLlmClient, key: str) -> list[tuple[str, dict]]:
    app.dependency_overrides[get_llm_client] = lambda: llm
    try:
        return _post_import(key, _THREE_SCENES)
    finally:
        app.dependency_overrides.pop(get_llm_client, None)


def _failure_flags(result: dict) -> set[tuple[str, str, str, str]]:
    return {
        (f["objectType"], f["objectId"], f["explanation"].split("]")[0] + "]", f["status"])
        for f in result["consistencyFlags"]
    }


def test_a_scene_that_fails_twice_keeps_only_its_text_and_the_import_completes(
    db_session,
):
    llm = _SceneFailsValidation(segment="Beta waits.", extract="Gamma waits.")

    events = _post_with(llm, "t911-continue")

    assert events[-1][0] == "complete", events[-1]
    result = events[-1][1]["result"]
    alpha, beta, gamma = result["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert [b["scriptText"] for b in beta["beats"]] == ["INT. BETA - DAY\nBeta waits."]
    # Rule 9: nothing is written for the scene the model could not break down.
    assert {
        beat[field]
        for beat in beta["beats"]
        for field in ("whatHappens", "audienceLearns", "audienceFeels")
    } | {
        beta[field]
        for field in ("whatHappens", "audienceLearns", "audienceFeels", "socialSituation")
    } == {""}
    assert [b["whatHappens"] for s in (alpha, gamma) for b in s["beats"]] == ["w", "w"]
    assert [f["sourceSpan"]["sceneId"] for f in result["newFacts"]] == ["scene-1"]
    assert _failure_flags(result) == {
        ("scene", "scene-2", "[segmentation_failed]", "open"),
        ("scene", "scene-3", "[extraction_failed]", "open"),
    }


def test_a_failed_scene_is_not_saved_so_a_resume_tries_it_again(
    db_session, monkeypatch
):
    llm = _SceneFailsValidation(segment="Beta waits.", extract="Gamma waits.")
    restore = _failing(monkeypatch, llm, "scan_consistency")

    assert _post_with(llm, "t911-resume")[-1][1]["error"]["code"] == "SCHEMA_INVALID_LLM"
    run = _run_for(db_session, "t911-resume")
    saved = {
        stage: {
            unit.unit_index
            for unit in db_session.query(ImportRunUnitRow).filter_by(
                run_id=run.id, stage=stage
            )
        }
        for stage in ("segmenting_beats", "extracting_facts")
    }
    assert saved == {"segmenting_beats": {0, 2}, "extracting_facts": {0, 1}}

    restore()
    llm.segment_fails_on = llm.extract_fails_on = ""
    resumed = _post_with(llm, "t911-resume")

    assert resumed[-1][0] == "complete", resumed[-1]
    assert _failure_flags(resumed[-1][1]["result"]) == set()
    assert llm.invocation_count("segment_scene") == 3
    # Everything after segmentation was saved from a run where Beta had no
    # breakdown, so none of it may be reused once Beta has one.
    for op in (
        "infer_act_breaks",
        "infer_story_entities",
        "infer_narrative_promises",
        "infer_story_overview",
    ):
        assert llm.invocation_count(op) == 2, op
    assert llm.invocation_count("extract_ledger_facts") == 2 + 3


def test_a_resume_rescans_after_a_scene_whose_extraction_failed(
    db_session, monkeypatch
):
    llm = _SceneFailsValidation(extract="Gamma waits.")
    rewrite_flags = snapshots._rewrite_flags

    def fail_once(*args, **kwargs):
        monkeypatch.setattr(snapshots, "_rewrite_flags", rewrite_flags)
        raise RuntimeError("injected saving failure")

    monkeypatch.setattr(snapshots, "_rewrite_flags", fail_once)
    with pytest.raises(RuntimeError, match="injected"):
        _post_with(llm, "t911-rescan")

    llm.extract_fails_on = ""
    resumed = _post_with(llm, "t911-rescan")

    assert resumed[-1][0] == "complete", resumed[-1]
    assert _failure_flags(resumed[-1][1]["result"]) == set()
    assert llm.invocation_count("extract_ledger_facts") == 2 + 1
    # The first scan never saw Gamma's facts.
    assert llm.invocation_count("scan_consistency") == 2
    assert llm.invocation_count("infer_story_overview") == 1


def test_an_acts_failure_still_aborts_with_zero_rows_after_a_scene_fails(
    db_session, monkeypatch
):
    baseline = _table_counts(db_session)
    llm = _SceneFailsValidation(segment="Beta waits.")
    _failing(monkeypatch, llm, "infer_act_breaks")

    events = _post_with(llm, "t911-acts")

    assert events[-1] == (
        "failed",
        {
            "type": "failed",
            "error": {
                "code": "SCHEMA_INVALID_LLM",
                "message": "infer_act_breaks: LLM output failed schema validation twice",
            },
        },
    )
    _assert_no_new_rows(db_session, baseline)


# ── format worked out from the script (owner decision 2026-10-11) ─────────────

_FEATURE = {
    "genre": "drama",
    "runtimeMinutes": 107,
    "actCount": 3,
    "coldOpen": False,
    "tag": False,
    "serialization": 0.0,
}


def _imported_doc(events: list[tuple[str, dict]]) -> dict:
    complete = [d for n, d in events if n == "complete"]
    assert complete, events
    return complete[0]["result"]["project"]


def _scene_acts(project: dict) -> list[int]:
    return [s["act"] for s in project["seasons"][0]["episodes"][0]["scenes"]]


def test_an_import_without_a_format_uses_the_format_the_model_reads(db_session, mock_llm):
    """A feature that prints no act breaks: the model decides the whole format
    and the act starts for it (Field of Dreams: 107 minutes, three acts)."""
    src = (
        "INT. KITCHEN - DAY\nRay listens.\n\nEXT. CORN FIELD - DAY\nA voice."
        "\n\nEXT. BALLFIELD - NIGHT\nThey play."
    )
    _configure_success(mock_llm, src)
    mock_llm.set_response(
        "infer_act_breaks",
        InferredActBreaks(
            starts=[
                {"act": 0, "startSceneIndex": 0},
                {"act": 1, "startSceneIndex": 1},
                {"act": 2, "startSceneIndex": 2},
            ],
            format=_FEATURE,
        ),
    )

    events = _parse_sse(
        client.post(
            URL,
            json=_body(src, format=None),
            headers=_headers("00000000-0000-4000-8000-000000000201"),
        ).text
    )

    project = _imported_doc(events)
    assert project["format"] == _FEATURE
    assert _scene_acts(project) == [0, 1, 2]


def test_printed_act_breaks_set_the_structure_and_the_model_the_rest(db_session, mock_llm):
    """The model's act count and cold open give way to what the script prints;
    its genre, runtime and serialization are kept."""
    src = (
        "INT. SCHOOL - DAY\nLisa reads.\nACT ONE\n\nINT. HOUSE - NIGHT\nHomer eats.\nACT TWO"
        "\n\nEXT. STREET - DAY\nBart runs.\nACT THREE\n\nINT. KITCHEN - NIGHT\nMarge sighs."
    )
    _configure_success(mock_llm, src)
    mock_llm.set_response(
        "infer_act_breaks",
        InferredActBreaks(
            starts=[{"act": 0, "startSceneIndex": 0}],
            format={**_FEATURE, "genre": "comedy", "runtimeMinutes": 22, "actCount": 5},
        ),
    )

    events = _parse_sse(
        client.post(
            URL,
            json=_body(src, format=None),
            headers=_headers("00000000-0000-4000-8000-000000000202"),
        ).text
    )

    project = _imported_doc(events)
    assert project["format"] == {
        **_FEATURE,
        "genre": "comedy",
        "runtimeMinutes": 22,
        "actCount": 3,
        "coldOpen": True,
    }
    assert _scene_acts(project) == [0, 1, 2, 3]


def test_acts_printed_above_fade_in_still_set_the_structure(
    db_session, mock_llm, monkeypatch
):
    """Each act opens on its own FADE IN, so ACT ONE is stripped with the front
    matter and the markers state no full partition. The printed count and cold
    open still reach the prompt and override the model's; the model's starts
    are expanded against them."""
    src = "\n".join(
        [
            "ACT ONE", "FADE IN:",
            "INT. BAR - NIGHT", "Marta pours.",
            "INT. HALL - NIGHT", "She leaves.", "END OF ACT ONE",
            "ACT TWO", "FADE IN:",
            "INT. KITCHEN - DAY", "Dan waits.", "END OF ACT TWO",
            "ACT THREE", "FADE IN:",
            "INT. CELLAR - NIGHT", "The key.", "END OF ACT THREE",
            "ACT FOUR", "FADE IN:",
            "EXT. STREET - NIGHT", "They part.", "END OF ACT FOUR",
        ]
    )
    _configure_success(mock_llm, strip_screenplay_front_matter(src).content)
    mock_llm.set_response(
        "infer_act_breaks",
        InferredActBreaks(
            starts=[
                {"act": 0, "startSceneIndex": 0},
                {"act": 1, "startSceneIndex": 2},
                {"act": 2, "startSceneIndex": 3},
                {"act": 3, "startSceneIndex": 4},
            ],
            format={**_FEATURE, "actCount": 3, "coldOpen": True},
        ),
    )
    prompts = _spy(monkeypatch, mock_llm, "infer_act_breaks")

    events = _parse_sse(
        client.post(
            URL,
            json=_body(src, format=None),
            headers=_headers("00000000-0000-4000-8000-000000000205"),
        ).text
    )

    assert "use actCount 4, coldOpen false and tag false exactly" in prompts[0]
    project = _imported_doc(events)
    assert project["format"] == {**_FEATURE, "actCount": 4, "coldOpen": False}
    assert _scene_acts(project) == [0, 0, 1, 2, 3]


def test_a_missing_format_gets_one_retry_then_fails_the_import(db_session, mock_llm):
    src = "INT. KITCHEN - DAY\nRay listens."
    _configure_success(mock_llm, src)
    no_format = InferredActBreaks(starts=[{"act": 0, "startSceneIndex": 0}])
    mock_llm.set_responses("infer_act_breaks", [no_format, no_format])

    events = _parse_sse(
        client.post(
            URL,
            json=_body(src, format=None),
            headers=_headers("00000000-0000-4000-8000-000000000203"),
        ).text
    )

    assert mock_llm._invocations["infer_act_breaks"] == 2  # exactly one retry (rule 9)
    failed = [d for n, d in events if n == "failed"]
    assert failed and failed[0]["error"]["code"] == "SCHEMA_INVALID_LLM"


def test_a_given_format_is_kept_whatever_the_model_returns(db_session, mock_llm):
    src = "INT. KITCHEN - DAY\nRay listens."
    _configure_success(mock_llm, src)
    mock_llm.set_response(
        "infer_act_breaks",
        InferredActBreaks(starts=[{"act": 0, "startSceneIndex": 0}], format=_FEATURE),
    )

    events = _parse_sse(
        client.post(
            URL, json=_body(src), headers=_headers("00000000-0000-4000-8000-000000000204")
        ).text
    )

    assert _imported_doc(events)["format"] == BASICS["format"]
