"""Import + export endpoints (data contract §4). The T1.3 acceptance criteria
are exercised end-to-end here with a `MockLlmClient` injected via the FastAPI
dependency override (never the real client — hard rule 1). The deterministic
parse core is unit-tested in test_fountain_parse.py; this suite proves the
transaction, the response shape, and the zero-persistence guarantees.
"""

from __future__ import annotations

import json
import re
import threading
import time

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from fountain import pipeline
from fountain.parse import split_into_scenes
from llm.dependency import get_llm_client
from llm.errors import LlmTimeoutError, SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import (
    ConsistencyScan,
    InferredActBreaks,
    LedgerExtraction,
    NarrativePromises,
    SegmentedScene,
    StoryEntities,
)
from storage import snapshots
from storage.models import LedgerFactRow, ProjectRow, SnapshotRow

PROJECT_ID = "proj-longpour"

NEW_PROJECT_BODY = {
    "title": "Fresh Show",
    "format": {
        "genre": "drama",
        "runtimeMinutes": 30,
        "actCount": 3,
        "coldOpen": False,
        "tag": False,
        "serialization": 0.5,
    },
    "premise": "A premise.",
}


# ── response builders ────────────────────────────────────────────────────────


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
    """A valid single-beat segmentation for each scene of `source`."""
    return [seg([(1, len(scene.lines))]) for scene in split_into_scenes(source)]


def act_breaks(*starts) -> InferredActBreaks:
    return InferredActBreaks(starts=list(starts))


def extraction(facts: list[dict] | None = None) -> LedgerExtraction:
    return LedgerExtraction.model_validate({"newFacts": facts or [], "contradictions": []})


def test_extract_retries_one_provider_invalid_request_without_logging_script(caplog):
    class _TransientInvalidRequest:
        calls = 0

        def extract_ledger_facts(self, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                response = httpx.Response(
                    400,
                    request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"),
                    json={
                        "type": "error",
                        "error": {
                            "type": "invalid_request_error",
                            "message": "temporary provider request rejection",
                        },
                    },
                )
                raise anthropic.BadRequestError(
                    message="bad request", response=response, body=response.json()
                )
            return extraction()

    scene = {
        "id": "scene-7",
        "beats": [
            {
                "id": "beat-7-1",
                "scriptText": "PRIVATE_SCRIPT_TEXT must not reach logs.",
            }
        ],
    }
    llm = _TransientInvalidRequest()

    with caplog.at_level("WARNING", logger="fountain.pipeline"):
        result = pipeline._extract_one(
            7,
            scene,
            {"title": "T", "format": NEW_PROJECT_BODY["format"]},
            "ep-1",
            [],
            llm,
            "runnonce",
        )

    assert result == extraction()
    assert llm.calls == 2
    joined = " ".join(record.getMessage() for record in caplog.records)
    assert "import_extract_retry scene_index=7" in joined
    assert "PRIVATE_SCRIPT_TEXT" not in joined


def test_parallel_failure_checkpoints_completed_in_flight_results():
    second_worker_started = threading.Event()
    saved: list[tuple[int, str]] = []

    def worker(index: int, _value: int) -> str:
        if index == 0:
            assert second_worker_started.wait(timeout=1)
            raise RuntimeError("first request failed")
        second_worker_started.set()
        time.sleep(0.05)
        return "saved-result"

    generator = pipeline._run_ordered_parallel(
        [0, 1],
        worker,
        stage="extracting_facts",
        on_result=lambda index, result: saved.append((index, result)),
    )

    assert next(generator).done == 0
    with pytest.raises(RuntimeError, match="first request failed"):
        list(generator)
    assert saved == [(1, "saved-result")]


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


def _drain_analysis(gen):
    events = []
    while True:
        try:
            events.append(next(gen))
        except StopIteration as stop:
            return events, stop.value


class _OutOfOrderImportLlm(MockLlmClient):
    """Coordinates the CONCURRENT scene workers to finish out of source order.

    Scene 1 is the cache-warming call and runs alone before the fan-out, so
    the race that matters is between the scenes that follow it: scene 3 is
    made to complete before scene 2.
    """

    def __init__(self) -> None:
        super().__init__()
        self.segment_completed: list[str] = []
        self.extract_completed: list[str] = []
        self._scene_three_started = threading.Event()
        self._release_scene_two = threading.Event()
        self._lock = threading.Lock()

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
            scene = "one"  # the warm call — runs alone, always first
        elif "Beta waits." in user_message:
            scene = "two"
            self._scene_three_started.wait(0.5)
            self._release_scene_two.wait(0.5)
        elif "Gamma waits." in user_message:
            scene = "three"
            self._scene_three_started.set()
            self._release_scene_two.set()
        else:
            raise AssertionError("unexpected scene prompt")

        with self._lock:
            self.segment_completed.append(scene)
        return seg([(1, 2)])

    def extract_ledger_facts(
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ):
        del system, prompt_version, cache_prefix
        if '"sceneId": "scene-1"' in user_message:
            scene_id, beat_id, label = "scene-1", "beat-1-1", "alpha"
        elif '"sceneId": "scene-2"' in user_message:
            scene_id, beat_id, label = "scene-2", "beat-2-1", "beta"
        elif '"sceneId": "scene-3"' in user_message:
            scene_id, beat_id, label = "scene-3", "beat-3-1", "gamma"
        else:
            raise AssertionError("unexpected extract prompt")

        with self._lock:
            self.extract_completed.append(scene_id)
        return extraction(
            [
                {
                    **one_fact(beat_id=beat_id),
                    "fact": f"{label} fact",
                    "sourceSpan": {
                        "episodeId": "ep-1",
                        "sceneId": scene_id,
                        "beatId": beat_id,
                        "startLine": 1,
                        "endLine": 1,
                    },
                }
            ]
        )


@pytest.fixture()
def mock_llm():
    """Inject a MockLlmClient for the import route; tests configure it."""
    client = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: client
    yield client
    app.dependency_overrides.pop(get_llm_client, None)


client = TestClient(app)


# ── export ───────────────────────────────────────────────────────────────────


def test_export_returns_fountain_text(seeded_project):
    resp = client.get(f"/api/v1/projects/{PROJECT_ID}/export.fountain")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert resp.text.startswith("INT. THE LONG POUR - NIGHT")
    assert resp.text.count("INT.") + resp.text.count("EXT.") == 6  # six scripted sluglines


def test_export_missing_project_404():
    resp = client.get("/api/v1/projects/nope/export.fountain")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


# ── import lock guard (T3.2, rule 2 — lands with the PATCH guard) ─────────────
# Import-as-replace wipes the episode's scenes and the whole ledger, so a target
# holding locked content or vouched facts must be refused (test plan, this
# section). The committed fixture (`seeded_project`) has both: beat-1-2 is
# locked, and 7 of its 8 facts are `active`.


def test_import_into_project_with_locked_content_is_rejected_zero_rows(
    seeded_project, db_session, mock_llm
):
    before_doc = db_session.get(ProjectRow, PROJECT_ID).doc
    before_snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    before_facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()

    src = "INT. NEW SCENE - DAY\nReplaces everything."
    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    # zero rows changed: doc identical, no new snapshot, ledger untouched. The
    # guard runs before stage 1, so the mock LLM is never called either.
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before_doc
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() == before_snaps
    assert db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count() == before_facts
    assert mock_llm.invocation_count("segment_scene") == 0


# ── round-trip: reproduces scene/beat count + response shape ──────────────────


def test_import_assigns_inferred_acts_and_allows_empty_sections(
    unlocked_project, db_session, mock_llm
):
    source = "\n".join(
        f"INT. ROOM {i} - DAY\nScene {i}." for i in range(1, 7)
    )
    mock_llm.set_responses("segment_scene", one_beat_per_scene(source))
    mock_llm.set_response(
        "infer_act_breaks",
        act_breaks(
            {"act": 1, "startSceneIndex": 0},
            {"act": 3, "startSceneIndex": 2},
            {"act": 5, "startSceneIndex": 4},
        ),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    from fountain.pipeline import run_import

    project = db_session.get(ProjectRow, PROJECT_ID)
    project.doc = {
        **project.doc,
        "format": {**project.doc["format"], "actCount": 5},
    }
    result = run_import(
        db_session, project, source, mock_llm, instruction="Import test"
    )
    scenes = result["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert [scene["act"] for scene in scenes] == [1, 1, 3, 3, 5, 5]


MARKED_SCRIPT = "\n".join(
    [
        "INT. BAR - NIGHT\nMarta pours.\nEND OF TEASER\nACT ONE",
        "INT. KITCHEN - DAY\nDan waits.\nEND OF ACT ONE",
        "INT. CELLAR - NIGHT\nThe key.\nACT THREE",
        "INT. OFFICE - DAY\nDan reads.\nEND OF ACT THREE\nACT FOUR",
        "EXT. STREET - NIGHT\nThey part.",
    ]
)


def test_import_uses_printed_act_markers_without_asking_the_model(
    unlocked_project, db_session, mock_llm
):
    mock_llm.set_responses("segment_scene", one_beat_per_scene(MARKED_SCRIPT))
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    from fountain.pipeline import run_import

    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.doc["format"]["actCount"] == 4
    assert project.doc["format"]["coldOpen"] is True
    result = run_import(
        db_session, project, MARKED_SCRIPT, mock_llm, instruction="Import test"
    )
    scenes = result["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert [scene["act"] for scene in scenes] == [0, 1, 2, 3, 4]
    assert mock_llm.invocation_count("infer_act_breaks") == 0


def test_import_asks_the_model_when_printed_markers_are_partial(
    unlocked_project, db_session, mock_llm
):
    source = MARKED_SCRIPT.replace("END OF ACT ONE", "")
    mock_llm.set_responses("segment_scene", one_beat_per_scene(source))
    mock_llm.set_response(
        "infer_act_breaks",
        act_breaks(
            {"act": 0, "startSceneIndex": 0},
            {"act": 2, "startSceneIndex": 3},
        ),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    from fountain.pipeline import run_import

    project = db_session.get(ProjectRow, PROJECT_ID)
    result = run_import(
        db_session, project, source, mock_llm, instruction="Import test"
    )
    scenes = result["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert [scene["act"] for scene in scenes] == [0, 0, 0, 2, 2]
    assert mock_llm.invocation_count("infer_act_breaks") == 1


def test_import_retries_semantically_invalid_act_inference_once(
    unlocked_project, db_session, mock_llm
):
    source = "\n".join(
        f"INT. ROOM {i} - DAY\nScene {i}." for i in range(1, 4)
    )
    mock_llm.set_responses("segment_scene", one_beat_per_scene(source))
    mock_llm.set_responses(
        "infer_act_breaks",
        [
            act_breaks({"act": 1, "startSceneIndex": 1}),
            act_breaks({"act": 1, "startSceneIndex": 0}),
        ],
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    from fountain.pipeline import run_import

    project = db_session.get(ProjectRow, PROJECT_ID)
    result = run_import(
        db_session, project, source, mock_llm, instruction="Import test"
    )
    scenes = result["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert [scene["act"] for scene in scenes] == [1, 1, 1]
    assert mock_llm.invocation_count("infer_act_breaks") == 2


def test_infer_act_pipeline_logs_only_safe_metadata(
    unlocked_project, db_session, mock_llm, caplog
):
    source = (
        "INT. PRIVATE LOCATION - NIGHT\nWRITER SECRET DIALOGUE.\n"
        "INT. SECOND PRIVATE LOCATION - DAY\nMORE WRITER SECRET TEXT."
    )
    segmented = SegmentedScene.model_validate(
        {
            "segments": [
                {
                    "kind": "beat",
                    "startLine": 1,
                    "whatHappens": "SECRET SCENE SUMMARY",
                    "audienceLearns": "SECRET REVELATION",
                    "audienceFeels": "SECRET EMOTION",
                }
            ]
        }
    )
    mock_llm.set_responses("segment_scene", [segmented, segmented])
    mock_llm.set_response(
        "infer_act_breaks",
        act_breaks(
            {"act": 0, "startSceneIndex": 0},
            {"act": 1, "startSceneIndex": 1},
        ),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    from fountain.pipeline import run_import

    project = db_session.get(ProjectRow, PROJECT_ID)
    with caplog.at_level("INFO", logger="fountain.pipeline"):
        run_import(db_session, project, source, mock_llm, instruction="Import test")

    records = [
        record
        for record in caplog.records
        if record.name == "fountain.pipeline"
        and record.msg.startswith("import_infer_acts")
    ]
    assert len(records) == 1
    assert records[0].msg == (
        "import_infer_acts scenes=%d boundaries=%d retried=%s from_markers=%s "
        "prompt_version=%s"
    )
    assert records[0].args[:4] == (2, 2, False, False)
    assert isinstance(records[0].args[4], str)
    logged = records[0].getMessage()
    for private_text in (
        "PRIVATE LOCATION",
        "WRITER SECRET",
        "SECRET SCENE SUMMARY",
        "SECRET REVELATION",
        "SECRET EMOTION",
    ):
        assert private_text not in logged


def test_second_semantically_invalid_act_inference_persists_nothing(
    unlocked_project, db_session, mock_llm
):
    project = db_session.get(ProjectRow, PROJECT_ID)
    original_doc = project.doc
    original_head = project.head_snapshot_id
    original_snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    original_facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()
    source = "INT. BAR - DAY\nScene."
    mock_llm.set_responses("segment_scene", one_beat_per_scene(source))
    mock_llm.set_responses(
        "infer_act_breaks",
        [
            act_breaks({"act": 1, "startSceneIndex": 1}),
            act_breaks({"act": 1, "startSceneIndex": 1}),
        ],
    )

    from fountain.pipeline import run_import

    with pytest.raises(SchemaInvalidLlmError, match="infer_act_breaks"):
        run_import(
            db_session, project, source, mock_llm, instruction="Import test"
        )

    assert mock_llm.invocation_count("infer_act_breaks") == 2
    _assert_unchanged(
        db_session, original_doc, original_head, original_snaps, original_facts
    )


def test_roundtrip_reproduces_scene_and_beat_count(unlocked_project, db_session, mock_llm):
    fountain = client.get(f"/api/v1/projects/{PROJECT_ID}/export.fountain").text
    mock_llm.set_responses("segment_scene", one_beat_per_scene(fountain))
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": fountain}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"project", "newFacts", "consistencyFlags"}

    scenes = body["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert len(scenes) == 6  # six sluglines in the export → six scenes
    assert sum(len(s["beats"]) for s in scenes) == 6  # one beat per scene here

    # end-to-end byte-identity: concatenating the imported beats reproduces the
    # exported source exactly (no text lost or altered through the round-trip).
    all_beats = [b for s in scenes for b in s["beats"]]
    assert "\n".join(b["scriptText"] for b in all_beats) == fountain

    # exactly one new snapshot (root + import), head bumped
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() == 2


def test_analyze_import_reports_per_scene_segment_progress(unlocked_project):
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
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    events, _analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )

    segment = [
        e
        for e in events
        if isinstance(e, pipeline.ImportStageProgress)
        and e.stage == pipeline.STAGE_SEGMENTING_BEATS
    ]
    assert [(e.done, e.total) for e in segment] == [
        (0, 3),
        (1, 3),
        (2, 3),
        (3, 3),
    ]


def test_out_of_order_scene_workers_preserve_source_order(unlocked_project, monkeypatch):
    monkeypatch.setattr(pipeline, "IMPORT_LLM_CONCURRENCY", 2, raising=False)
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
    llm = _OutOfOrderImportLlm()
    llm.set_response("scan_consistency", scan())

    _events, analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )

    # Scene 1 warms the cache alone; 3 then completes before 2.
    assert llm.segment_completed == ["one", "three", "two"]
    scenes = analysis.new_doc["seasons"][0]["episodes"][0]["scenes"]
    assert [(scene["id"], scene["location"]) for scene in scenes] == [
        ("scene-1", "INT. ALPHA - DAY"),
        ("scene-2", "INT. BETA - DAY"),
        ("scene-3", "INT. GAMMA - DAY"),
    ]
    assert [(scene["beats"][0]["id"], scene["beats"][0]["scriptText"]) for scene in scenes] == [
        ("beat-1-1", "INT. ALPHA - DAY\nAlpha waits."),
        ("beat-2-1", "INT. BETA - DAY\nBeta waits."),
        ("beat-3-1", "INT. GAMMA - DAY\nGamma waits."),
    ]
    assert [fact["sourceSpan"]["beatId"] for fact in analysis.new_facts] == [
        "beat-1-1",
        "beat-2-1",
        "beat-3-1",
    ]
    assert [fact["fact"] for fact in analysis.new_facts] == [
        "alpha fact",
        "beta fact",
        "gamma fact",
    ]


def test_import_replaces_target_episode_scenes(unlocked_project, mock_llm):
    src = "INT. NEW SCENE - DAY\nA brand new scene."
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()
    scenes = body["project"]["seasons"][0]["episodes"][0]["scenes"]
    assert len(scenes) == 1
    assert scenes[0]["location"] == "INT. NEW SCENE - DAY"


# ── all import-derived facts pending_review (§4 step 2) ───────────────────────


def test_import_facts_get_the_status_facts_found_while_writing_get(unlocked_project, mock_llm):
    """Owner decision 2026-10-11: nobody reviews hundreds of imported facts,
    and only active facts are ever used, so an import applies ledger_policy's
    rule instead of holding every fact for review."""
    src = "INT. BAR - NIGHT\nDan pours a drink."
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "extract_ledger_facts",
        extraction(
            [
                {**one_fact(confidence=0.95), "sourceText": "Dan pours a drink."},
                one_fact(confidence=0.95),  # no quote: nothing to verify
                {**one_fact(confidence=0.5), "sourceText": "Dan pours a drink."},
                {**one_fact(confidence=0.95), "sourceText": "Marta smashes the till."},
            ]
        ),
    )
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()

    assert [fact["status"] for fact in body["newFacts"]] == [
        "active",
        "active",
        "pending_review",  # below the confidence floor
        "pending_review",  # its quote is not on the page
    ]
    assert all(fact["provenance"] == "inferred" for fact in body["newFacts"])
    ledger = client.get(
        f"/api/v1/projects/{PROJECT_ID}/ledger", params={"status": "pending_review"}
    ).json()
    assert len(ledger) == 2


def test_import_fact_offsets_located_off_window_and_through_typography(
    unlocked_project, mock_llm
):
    src = "INT. BAR - NIGHT\nDan’s pouring\na drink."
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    # Straight apostrophe, one line, window pointing at the slugline.
    fact = {**one_fact(), "sourceText": "Dan's pouring a drink."}
    mock_llm.set_response("extract_ledger_facts", extraction([fact]))
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()
    stored = body["newFacts"][0]
    span = stored["sourceSpan"]
    beat = body["project"]["seasons"][0]["episodes"][0]["scenes"][0]["beats"][0]
    assert beat["scriptText"][span["charStart"]:span["charEnd"]] == "Dan’s pouring\na drink."
    # Found on the page through typography and line wrapping, so accepted.
    assert stored["status"] == "active"


def test_import_scan_flags_persisted_open(unlocked_project, mock_llm):
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
    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()
    flags = [f for f in body["consistencyFlags"] if f["objectId"] == "scene-1"]
    assert len(flags) == 1
    assert flags[0]["status"] == "open"
    assert flags[0]["sourceChange"].startswith("snap-")  # the import snapshot


def test_scan_flags_for_unknown_ids_are_dropped(unlocked_project, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours."
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response(
        "scan_consistency",
        scan(
            [
                {
                    "objectType": "scene",
                    "objectId": "scene-999",
                    "factId": None,
                    "explanation": "phantom",
                    "severity": "tension",
                }
            ]
        ),
    )
    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()
    assert all(f["objectId"] != "scene-999" for f in body["consistencyFlags"])


# ── semantic segment repairs → scoped retry + flagged success ────────────────


def _assert_unchanged(db_session, original_doc, original_head, original_snaps, original_facts):
    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.doc == original_doc
    assert project.head_snapshot_id == original_head
    snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()
    assert snaps == original_snaps
    assert facts == original_facts


def test_duplicate_starts_retry_same_scene_then_persist_better_attempt_with_no_repair_flag(
    unlocked_project, mock_llm
):
    src = "INT. BAR - NIGHT\nDan pours.\nMarta enters."  # 3 lines
    mock_llm.set_responses(
        "segment_scene",
        [seg([(1, 1), (2, 2), (2, 3)]), seg([(1, 1), (3, 3)])],
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    )
    assert resp.status_code == 200
    assert mock_llm.invocation_count("segment_scene") == 2
    body = resp.json()
    beats = body["project"]["seasons"][0]["episodes"][0]["scenes"][0]["beats"]
    assert "\n".join(beat["scriptText"] for beat in beats) == src
    assert not any("[duplicate_start]" in flag["explanation"] for flag in body["consistencyFlags"])


def test_semantic_retry_keeps_first_attempt_when_retry_needs_more_repair(
    unlocked_project, mock_llm
):
    src = "INT. BAR - NIGHT\nDan pours.\nMarta enters."
    first = seg([(2, 3)])  # one affected line
    worse_retry = SegmentedScene.model_validate({"segments": []})  # all three affected
    mock_llm.set_responses("segment_scene", [first, worse_retry])
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()

    assert mock_llm.invocation_count("segment_scene") == 2
    explanations = [flag["explanation"] for flag in body["consistencyFlags"]]
    assert any("[missing_initial_start]" in explanation for explanation in explanations)
    assert not any("[empty_output]" in explanation for explanation in explanations)


def test_missing_initial_start_retries_then_persists_selected_repair_flag(
    unlocked_project, db_session, mock_llm
):
    src = "INT. BAR - NIGHT\nDan pours.\nMarta enters."
    repaired = seg([(2, 3)])
    mock_llm.set_responses("segment_scene", [repaired, repaired])
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    )

    assert resp.status_code == 200
    body = resp.json()
    scenes = body["project"]["seasons"][0]["episodes"][0]["scenes"]
    all_beats = [b for s in scenes for b in s["beats"]]
    assert "\n".join(b["scriptText"] for b in all_beats) == src
    assert "\n".join(b["scriptText"] for b in all_beats) == src
    assert mock_llm.invocation_count("segment_scene") == 2

    review_flags = [
        f
        for f in body["consistencyFlags"]
        if f["objectType"] == "beat" and f["severity"] == "tension"
    ]
    assert len(review_flags) == 1
    assert review_flags[0]["objectId"] == all_beats[0]["id"]
    assert review_flags[0]["status"] == "open"
    assert "[missing_initial_start]" in review_flags[0]["explanation"]
    assert "lines 1-1" in review_flags[0]["explanation"]

    db_session.expire_all()
    persisted = db_session.get(ProjectRow, PROJECT_ID)
    persisted_beats = [
        b for s in persisted.doc["seasons"][0]["episodes"][0]["scenes"] for b in s["beats"]
    ]
    assert "\n".join(b["scriptText"] for b in persisted_beats) == src
    assert persisted.head_snapshot_id == body["project"]["headSnapshotId"]


class _RecordingSegmentLlm(MockLlmClient):
    def __init__(self):
        super().__init__()
        self.segment_messages: list[str] = []

    def segment_scene(self, *, user_message, **kwargs):
        self.segment_messages.append(user_message)
        return super().segment_scene(user_message=user_message, **kwargs)


def test_retry_with_beats_replaces_an_all_unassigned_first_attempt():
    span = split_into_scenes("INT. BAR - NIGHT\nDan pours.\nMarta enters.\nReyes waits.")[0]
    llm = _RecordingSegmentLlm()
    llm.set_responses("segment_scene", [seg([], unassigned=[(1, 4)]), seg([(1, 4)])])

    beats, _reading = pipeline._segment_one(0, span, {"title": "T", "format": {}}, llm, "n0nce")

    assert len(llm.segment_messages) == 2
    # The retry is told what went wrong, as data rather than new prompt text.
    assert '"code": "no_beats_returned"' in llm.segment_messages[1]
    assert [beat.what_happens for beat in beats] == ["w"]
    assert not any(issue.code == "no_beats_returned" for issue in beats[0].review_issues)


def test_leaked_tool_markup_is_never_stored(unlocked_project, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours."
    leaked = "\x3c/antml.parameter>\n\x3cparameter name=\"sceneAudienceFeels\">Calm"
    marked = seg([(1, 2)]).model_copy(
        update={"scene_audience_learns": leaked, "scene_audience_feels": "Calm"}
    )
    mock_llm.set_responses("segment_scene", [marked, marked])
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()

    assert mock_llm.invocation_count("segment_scene") == 2
    scene = body["project"]["seasons"][0]["episodes"][0]["scenes"][0]
    assert scene["audienceLearns"] == ""
    assert scene["audienceFeels"] == "Calm"
    assert "parameter" not in json.dumps(scene)
    assert any("[tool_markup]" in f["explanation"] for f in body["consistencyFlags"])


def test_empty_content_rejected(seeded_project, mock_llm):
    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": ""}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION"


# ── unassigned ranges: preserved in scriptText, flagged, byte-identical ──────


def test_unassigned_preserved_flagged_and_byte_identical(unlocked_project, mock_llm):
    # line 3 ("ORPHAN LINE") is unassigned; it must survive in scriptText and be flagged.
    src = "INT. BAR - NIGHT\nDan pours.\nORPHAN LINE"
    mock_llm.set_responses("segment_scene", [seg([(1, 2)], unassigned=[(3, 3)])])
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()

    scenes = body["project"]["seasons"][0]["episodes"][0]["scenes"]
    all_beats = [b for s in scenes for b in s["beats"]]
    # no source text dropped: the orphan line is inside a beat's scriptText
    assert "ORPHAN LINE" in "\n".join(b["scriptText"] for b in all_beats)
    # byte-identical reconstruction from the stored beats
    assert "\n".join(b["scriptText"] for b in all_beats) == src
    # an unassigned flag was raised on the beat (tension, contract flag shape)
    unassigned_flags = [
        f
        for f in body["consistencyFlags"]
        if f["objectType"] == "beat" and f["severity"] == "tension"
    ]
    assert len(unassigned_flags) == 1
    assert unassigned_flags[0]["objectId"] == all_beats[0]["id"]
    assert unassigned_flags[0]["status"] == "open"


# ── mid-transaction fault injection → zero rows changed ──────────────────────


def test_mid_transaction_fault_leaves_zero_rows(unlocked_project, db_session, monkeypatch):
    project = db_session.get(ProjectRow, PROJECT_ID)
    original_doc = dict(project.doc)
    original_head = project.head_snapshot_id
    original_snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    original_facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()

    src = "INT. BAR - NIGHT\nDan pours."
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction([one_fact()]))
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
        raise RuntimeError("injected mid-transaction failure")

    # _rewrite_flags runs LAST inside mutate() — after the snapshot row, doc,
    # head bump and ledger rewrite are all staged. Atomicity must roll it all back.
    monkeypatch.setattr(snapshots, "_rewrite_flags", boom)

    from fountain.pipeline import run_import

    with pytest.raises(RuntimeError, match="injected"):
        run_import(db_session, project, src, llm, instruction="Imported fountain script")

    _assert_unchanged(db_session, original_doc, original_head, original_snaps, original_facts)


# ── LLM error mapping (route layer's job) ────────────────────────────────────


class _RaisingLlm(MockLlmClient):
    def __init__(self, exc: Exception) -> None:
        super().__init__()
        self._exc = exc

    def segment_scene(self, **kwargs):
        raise self._exc


def test_transport_error_maps_to_llm_unavailable(unlocked_project):
    exc = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))
    app.dependency_overrides[get_llm_client] = lambda: _RaisingLlm(exc)
    try:
        resp = client.post(
            f"/api/v1/projects/{PROJECT_ID}/import",
            json={"format": "fountain", "content": "INT. BAR\nx"},
        )
    finally:
        app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "LLM_UNAVAILABLE"


def test_llm_timeout_maps_to_llm_unavailable(unlocked_project):
    app.dependency_overrides[get_llm_client] = lambda: _RaisingLlm(LlmTimeoutError("segment_scene"))
    try:
        resp = client.post(
            f"/api/v1/projects/{PROJECT_ID}/import",
            json={"format": "fountain", "content": "INT. BAR\nx"},
        )
    finally:
        app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "LLM_UNAVAILABLE"


def test_schema_invalid_llm_maps(unlocked_project):
    # A whole-script stage: a failing scene unit no longer aborts (T9.11).
    app.dependency_overrides[get_llm_client] = lambda: _RaisingEntitiesLlm()
    try:
        resp = client.post(
            f"/api/v1/projects/{PROJECT_ID}/import",
            json={"format": "fountain", "content": "INT. BAR\nx"},
        )
    finally:
        app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "SCHEMA_INVALID_LLM"


# ── misc route guards ────────────────────────────────────────────────────────


def test_import_missing_project_404(mock_llm):
    resp = client.post(
        "/api/v1/projects/nope/import", json={"format": "fountain", "content": "INT. BAR\nx"}
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_import_invalid_format_400(seeded_project, mock_llm):
    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "pdf", "content": "x"}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION"


def test_import_scaffolds_fresh_project(db_session, mock_llm):
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000021"},
    ).json()
    pid = created["id"]
    assert created["seasons"] == []  # nothing to import into yet

    src = "INT. BAR - NIGHT\nDan pours."
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()
    seasons = body["project"]["seasons"]
    assert len(seasons) == 1
    assert len(seasons[0]["episodes"][0]["scenes"]) == 1


def test_import_mints_characters_and_normalizes_known_by(db_session, mock_llm):
    """T7.14: every import seeds seriesBible.characters from cues and stores
    knownBy as character ids so Ledger PEOPLE / Knowledge Web work platform-wide.
    """
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000031"},
    ).json()
    pid = created["id"]

    src = "INT. LAB - NIGHT\n\nDOC\nGreat Scott!\n\nMARTY\nWhat is it?\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "extract_ledger_facts",
        extraction(
            [
                {
                    **one_fact(),
                    "knownBy": ["Doc Brown", "Marty", "audience"],
                }
            ]
        ),
    )
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()
    characters = body["project"]["seriesBible"]["characters"]
    by_name = {c["name"]: c["id"] for c in characters}
    assert "Doc" in by_name
    assert "Marty" in by_name

    assert body["newFacts"], "expected extracted facts"
    known = body["newFacts"][0]["knownBy"]
    assert set(known) == {by_name["Doc"], by_name["Marty"]}
    assert "audience" not in known
    assert all(k.startswith("char-") for k in known)


# ── entity inference merge (T7.15) ────────────────────────────────────────


def entities(
    characters: list[dict] | None = None,
    relationships: list[dict] | None = None,
    world_elements: list[dict] | None = None,
) -> StoryEntities:
    return StoryEntities.model_validate(
        {
            "characters": characters or [],
            "relationships": relationships or [],
            "worldElements": world_elements or [],
        }
    )


def overview(
    logline: str | None = None,
    outline: list[dict] | None = None,
    beat_sheet: list[dict] | None = None,
    summary: str | None = None,
):
    from schemas import InferredStoryOverview

    return InferredStoryOverview.model_validate(
        {
            "logline": logline
            or (
                "When Marty finds an empty lab, he must locate Doc before the "
                "plan collapses."
            ),
            "outline": outline
            or [{"sceneId": "scene-1", "summary": "Marty calls for Doc."}],
            "beatSheet": beat_sheet
            or [
                {
                    "beatId": "beat-1-1",
                    "label": "Act One Turn",
                    "summary": "Marty arrives to silence.",
                    "sceneId": "scene-1",
                    "act": 1,
                }
            ],
            "summary": summary
            or (
                "Marty rushes into an empty lab looking for Doc.\n\n"
                "Finding no one, he realizes the plan is already slipping away."
            ),
        }
    )


def promises(
    threads: list[dict] | None = None,
    scene_motivations: list[dict] | None = None,
    world_rules: list[dict] | None = None,
    secrets: list[dict] | None = None,
) -> NarrativePromises:
    return NarrativePromises.model_validate(
        {
            "threads": threads or [],
            "secrets": secrets or [],
            "sceneMotivations": scene_motivations or [],
            "worldRules": world_rules or [],
        }
    )


def test_import_merges_inferred_entities_and_resolves_alias_known_by(db_session, mock_llm):
    """T7.15: a non-speaking character and an alias-bearing character minted
    entirely from `infer_story_entities` (not from a script cue) both land in
    the bible, their relationship is recorded, and a fact's `knownBy` alias
    resolves to the minted character's id."""
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000041"},
    ).json()
    pid = created["id"]

    # Einstein never speaks — he is established in an action line, which is
    # how a real script introduces a non-speaking character, and is what
    # makes him grounded enough to mint (characters.name_is_grounded).
    src = (
        "INT. LAB - NIGHT\n\nEinstein the dog watches from the workbench.\n\n"
        "MARTY\nDoc, are you there?\n"
    )
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "infer_story_entities",
        entities(
            characters=[
                {
                    "name": "Doc Brown",
                    "aliases": ["Doc"],
                    "role": "principal",
                    "traits": "eccentric inventor",
                    "evidence": [{"sceneId": "scene-1", "quote": "Doc, are you there?"}],
                },
                {
                    "name": "Einstein",
                    "aliases": [],
                    "role": "minor",
                    "traits": "Doc's dog",
                    "evidence": [{"sceneId": "scene-1", "quote": "a dog barks off-panel"}],
                },
            ],
            relationships=[
                {
                    "betweenNames": ["Doc Brown", "Marty"],
                    "label": "mentor and protégé",
                    "reallyLike": "",
                    "evidence": [{"sceneId": "scene-1", "quote": "Doc, are you there?"}],
                }
            ],
        ),
    )
    mock_llm.set_response(
        "extract_ledger_facts",
        extraction(
            [
                {
                    **one_fact(),
                    "knownBy": ["Doc", "Marty"],
                }
            ]
        ),
    )
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    bible = body["project"]["seriesBible"]
    by_name = {c["name"]: c for c in bible["characters"]}
    assert "Doc Brown" in by_name
    assert by_name["Doc Brown"]["aliases"] == ["Doc"]
    assert "Einstein" in by_name  # non-speaking character, minted purely from inference
    assert "Marty" in by_name

    relationships = bible["relationships"]
    assert {tuple(r["between"]) for r in relationships} == {
        (by_name["Doc Brown"]["id"], by_name["Marty"]["id"])
    }

    known = body["newFacts"][0]["knownBy"]
    assert set(known) == {by_name["Doc Brown"]["id"], by_name["Marty"]["id"]}


def test_import_resolves_knowledge_event_character_names_to_ids(db_session, mock_llm):
    """T7.23: an ExtractedFact's optional `knowledgeEvents` names a learner
    by name (never an id, same convention as `knownBy`); import resolves it
    against the same running character list and stores `characterIds`."""
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000042"},
    ).json()
    pid = created["id"]

    src = "INT. LAB - NIGHT\n\nMARTY\nDoc, are you there?\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "extract_ledger_facts",
        extraction(
            [
                {
                    **one_fact(),
                    "knownBy": ["Doc Brown"],
                    "knowledgeEvents": [
                        {
                            "sceneId": "scene-1",
                            "characterNames": ["Marty"],
                            "kind": "learns",
                            "quote": "Doc, are you there?",
                        }
                    ],
                }
            ]
        ),
    )
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    bible = body["project"]["seriesBible"]
    by_name = {c["name"]: c for c in bible["characters"]}
    assert "Doc Brown" in by_name
    assert "Marty" in by_name

    fact = body["newFacts"][0]
    assert fact["knownBy"] == [by_name["Doc Brown"]["id"]]
    assert fact["knowledgeEvents"] == [
        {
            "sceneId": "scene-1",
            "characterIds": [by_name["Marty"]["id"]],
            "kind": "learns",
            "quote": "Doc, are you there?",
        }
    ]


def test_import_drops_audience_token_from_knowledge_event_characters(db_session, mock_llm):
    """Same audience-token drop rule as `knownBy` (fountain.characters._is_
    audience_token) applies to knowledgeEvents.characterNames."""
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000043"},
    ).json()
    pid = created["id"]

    src = "INT. LAB - NIGHT\n\nMARTY\nDoc, are you there?\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "extract_ledger_facts",
        extraction(
            [
                {
                    **one_fact(),
                    "knownBy": ["Marty"],
                    "knowledgeEvents": [
                        {
                            "sceneId": "scene-1",
                            "characterNames": ["audience"],
                            "kind": "learns",
                            "quote": "",
                        }
                    ],
                }
            ]
        ),
    )
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    fact = body["newFacts"][0]
    assert fact["knowledgeEvents"] == [
        {"sceneId": "scene-1", "characterIds": [], "kind": "learns", "quote": ""}
    ]


def test_import_infers_timeline_anchors_from_scene_sluglines(db_session, mock_llm):
    """T7.24: a relative-time slugline suffix on scene 2 anchors "after
    scene-1"; deterministic (fountain.timeline), no new LLM call."""
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000044"},
    ).json()
    pid = created["id"]

    src = (
        "INT. THE LONG POUR - DAY\n\nMARTA\nMorning.\n\n"
        "INT. THE LONG POUR - THREE DAYS LATER\n\nMARTA\nLater.\n"
    )
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    episode = body["project"]["seasons"][0]["episodes"][0]
    assert episode["timelineAnchors"] == [
        {
            "afterSceneId": "scene-1",
            "label": "Three Days Later",
            "kind": "relative",
            "quote": "INT. THE LONG POUR - THREE DAYS LATER",
        }
    ]


def test_import_infers_relationship_states_from_entity_evidence(db_session, mock_llm):
    """T7.25: each resolved relationship's own evidence citations become
    scene-anchored relationshipStates on the episode -- no new classifier
    call, reusing infer_story_entities output."""
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000045"},
    ).json()
    pid = created["id"]

    src = "INT. LAB - NIGHT\n\nMARTY\nDoc, are you there?\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "infer_story_entities",
        entities(
            characters=[
                {
                    "name": "Doc Brown",
                    "aliases": [],
                    "role": "principal",
                    "traits": "",
                    "evidence": [{"sceneId": "scene-1", "quote": "Doc, are you there?"}],
                },
            ],
            relationships=[
                {
                    "betweenNames": ["Doc Brown", "Marty"],
                    "label": "mentor and protégé",
                    "reallyLike": "",
                    "evidence": [
                        {"sceneId": "scene-1", "quote": "Doc, are you there?"}
                    ],
                }
            ],
        ),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    bible = body["project"]["seriesBible"]
    by_name = {c["name"]: c for c in bible["characters"]}
    episode = body["project"]["seasons"][0]["episodes"][0]
    assert episode["relationshipStates"] == [
        {
            "between": [by_name["Doc Brown"]["id"], by_name["Marty"]["id"]],
            "label": "mentor and protégé",
            "sceneId": "scene-1",
            "quote": "Doc, are you there?",
        }
    ]


# ── narrative promises merge (T7.20) ─────────────────────────────────────


def test_import_infers_thread_and_scene_motivations_after_entities(db_session, mock_llm):
    """T7.20 acceptance: a planted setup yields an open thread with a
    resolved owner and setup scene, and a planted scene's motivations
    fill in once the cast (from entity inference) resolves."""
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000047"},
    ).json()
    pid = created["id"]

    src = "INT. LAB - NIGHT\n\nMARTY\nDoc, are you there?\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "infer_narrative_promises",
        promises(
            threads=[
                {
                    "label": "The vanished inventor",
                    "summary": "Marty is looking for Doc.",
                    "status": "open",
                    "ownerNames": ["Marty", "Doc Brown"],
                    "setupSceneId": "scene-1",
                    "payoffSceneId": None,
                    "setupBeatId": None,
                    "payoffBeatId": None,
                }
            ],
            scene_motivations=[
                {
                    "sceneId": "scene-1",
                    "motivations": [
                        {
                            "characterName": "Marty",
                            "objective": "Find Doc.",
                            "stakes": "The plan falls apart without him.",
                            "obstacle": "The lab is empty.",
                            "statedObjective": "",
                            "concealed": False,
                        }
                    ],
                }
            ],
        ),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    bible = body["project"]["seriesBible"]
    by_name = {c["name"]: c["id"] for c in bible["characters"]}
    episode = body["project"]["seasons"][0]["episodes"][0]

    assert len(episode["threads"]) == 1
    thread = episode["threads"][0]
    assert thread["id"].startswith("thread-")
    assert thread["status"] == "open"
    assert set(thread["ownerCharacterIds"]) == {by_name["Marty"]}
    assert thread["setupSceneId"] == "scene-1"
    assert thread["payoffSceneId"] is None

    scene = episode["scenes"][0]
    assert scene["motivations"] == [
        {
            "characterId": by_name["Marty"],
            "objective": "Find Doc.",
            "stakes": "The plan falls apart without him.",
            "obstacle": "The lab is empty.",
            "statedObjective": "",
            "concealed": False,
        }
    ]


def test_import_drops_unresolvable_thread_owner_and_keeps_resolved(db_session, mock_llm):
    """Design doc: unresolvable owners/motivations are dropped (never mint a
    stand-in character), unlike `knownBy` normalization."""
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000048"},
    ).json()
    pid = created["id"]

    src = "INT. LAB - NIGHT\n\nMARTY\nDoc, are you there?\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "infer_narrative_promises",
        promises(
            threads=[
                {
                    "label": "The vanished inventor",
                    "summary": "Marty is looking for Doc.",
                    "status": "open",
                    "ownerNames": ["Marty", "Einstein the dog"],
                    "setupSceneId": "scene-1",
                    "payoffSceneId": None,
                    "setupBeatId": None,
                    "payoffBeatId": None,
                }
            ]
        ),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    bible = body["project"]["seriesBible"]
    by_name = {c["name"]: c["id"] for c in bible["characters"]}
    episode = body["project"]["seasons"][0]["episodes"][0]
    assert episode["threads"][0]["ownerCharacterIds"] == [by_name["Marty"]]


def test_import_appends_structured_world_rule_with_evidence(db_session, mock_llm):
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000049"},
    ).json()
    pid = created["id"]

    src = "INT. LAB - NIGHT\n\nMARTY\nDoc, are you there?\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "infer_narrative_promises",
        promises(
            world_rules=[
                {
                    "text": "Time travel requires exactly 1.21 gigawatts.",
                    "limit": "Only the DeLorean can generate it.",
                    "cost": "Burns through the flux capacitor.",
                    "exception": "Lightning strikes can substitute.",
                    "evidenceSceneId": "scene-1",
                    "evidenceBeatId": None,
                }
            ]
        ),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    rules = body["project"]["seriesBible"]["worldRules"]
    assert rules == [
        {
            "text": "Time travel requires exactly 1.21 gigawatts.",
            "locked": False,
            "limit": "Only the DeLorean can generate it.",
            "cost": "Burns through the flux capacitor.",
            "exception": "Lightning strikes can substitute.",
            "evidenceSceneId": "scene-1",
            "evidenceQuote": "",
        }
    ]


def test_reimport_never_duplicates_locked_world_rule_text(
    unlocked_project, db_session, mock_llm
):
    """Locks are sacred (CLAUDE.md rule 2): a re-import inferring a rule
    whose text matches an existing *locked* rule must not append a
    duplicate row underneath it."""
    project = db_session.get(ProjectRow, PROJECT_ID)
    bible = project.doc["seriesBible"]
    locked_rule = {"text": "Debts in Harbor's End are never spoken aloud.", "locked": True}
    project.doc = {
        **project.doc,
        "seriesBible": {**bible, "worldRules": [*bible["worldRules"], locked_rule]},
    }
    db_session.commit()

    src = "INT. LAB - NIGHT\n\nDOC\nGreat Scott!\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "infer_narrative_promises",
        promises(
            world_rules=[
                {
                    "text": "Debts in Harbor's End are never spoken aloud.",
                    "limit": "should not overwrite the locked row",
                    "cost": "",
                    "exception": "",
                    "evidenceSceneId": "scene-1",
                    "evidenceBeatId": None,
                }
            ]
        ),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    from fountain.pipeline import run_import

    project = db_session.get(ProjectRow, PROJECT_ID)
    result = run_import(db_session, project, src, mock_llm, instruction="Import test")

    matching = [
        r
        for r in result["project"]["seriesBible"]["worldRules"]
        if r["text"] == "Debts in Harbor's End are never spoken aloud."
    ]
    assert matching == [locked_rule]


class _RaisingPromisesLlm(MockLlmClient):
    def infer_narrative_promises(self, **kwargs):
        raise SchemaInvalidLlmError("infer_narrative_promises")


def test_schema_invalid_promises_persists_nothing(unlocked_project, db_session):
    """Rule 9: schema-invalid `infer_narrative_promises` output (after the
    client's own retry-once is exhausted) fails the import atomically —
    zero rows changed, same contract as segmentation/act/entity inference."""
    project = db_session.get(ProjectRow, PROJECT_ID)
    original_doc = project.doc
    original_head = project.head_snapshot_id
    original_snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    original_facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()
    src = "INT. BAR - DAY\nScene."

    from fountain.pipeline import run_import

    llm = _RaisingPromisesLlm()
    with pytest.raises(SchemaInvalidLlmError, match="infer_narrative_promises"):
        run_import(db_session, project, src, llm, instruction="Import test")

    _assert_unchanged(db_session, original_doc, original_head, original_snaps, original_facts)


def test_import_infers_object_states_and_flags_location_conflict(
    db_session, mock_llm, monkeypatch
):
    """T7.26: object custody / location continuity ("simpler MVP" path).
    Deterministic text scan over already-extracted state/event facts (no
    new LLM call) fills episode.objectStates; a later scene contradicting
    an earlier object location becomes an open tension flag."""
    # Force sequential scene processing so the mock's per-op FIFO response
    # queue (popped in call order) lines up with scene order deterministically
    # -- see test_out_of_order_scene_workers_preserve_source_order.
    monkeypatch.setattr(pipeline, "IMPORT_LLM_CONCURRENCY", 1, raising=False)
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000046"},
    ).json()
    pid = created["id"]

    src = (
        "INT. THE LONG POUR - DAY\n\nMARTA\nMorning.\n\n"
        "EXT. MARINA - NIGHT\n\nMARTA\nLater.\n"
    )
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_responses(
        "extract_ledger_facts",
        [
            extraction(
                [
                    {
                        **one_fact(beat_id="beat-1-1"),
                        "fact": "The bag is hidden inside the ice machine",
                        "sourceSpan": {
                            **one_fact()["sourceSpan"],
                            "sceneId": "scene-1",
                            "beatId": "beat-1-1",
                        },
                    }
                ]
            ),
            extraction(
                [
                    {
                        **one_fact(beat_id="beat-2-1"),
                        "fact": "The bag is hidden inside the marina locker",
                        "sourceSpan": {
                            **one_fact()["sourceSpan"],
                            "sceneId": "scene-2",
                            "beatId": "beat-2-1",
                        },
                    }
                ]
            ),
        ],
    )
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    episode = body["project"]["seasons"][0]["episodes"][0]
    assert {(s["locationLabel"], s["sceneId"]) for s in episode["objectStates"]} == {
        ("the ice machine", "scene-1"),
        ("the marina locker", "scene-2"),
    }

    flags = body["consistencyFlags"]
    object_flags = [f for f in flags if f["objectId"] == "scene-2" and f["factId"] is None]
    assert len(object_flags) == 1
    assert object_flags[0]["severity"] == "tension"
    assert object_flags[0]["status"] == "open"
    assert "ice machine" in object_flags[0]["explanation"]
    assert "marina locker" in object_flags[0]["explanation"]


def test_reimport_never_modifies_locked_character_fields(unlocked_project, db_session, mock_llm):
    project = db_session.get(ProjectRow, PROJECT_ID)
    bible = project.doc["seriesBible"]
    locked_char = {
        "id": "char-locked-doc",
        "name": "Doc Brown",
        "locked": True,
        "aliases": [],
        "embodiment": "time travel",
        "presentation": "wild hair",
        "hiding": "",
        "traits": "eccentric genius",
        "seriesArc": "",
    }
    project.doc = {
        **project.doc,
        "seriesBible": {**bible, "characters": [*bible["characters"], locked_char]},
    }
    db_session.commit()

    src = "INT. LAB - NIGHT\n\nDOC\nGreat Scott!\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "infer_story_entities",
        entities(
            characters=[
                {
                    "name": "Doc Brown",
                    "aliases": ["Doc", "The Doc"],
                    "role": "principal",
                    "traits": "should never overwrite the locked traits",
                    "evidence": [{"sceneId": "scene-1", "quote": "Great Scott!"}],
                }
            ]
        ),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    from fountain.pipeline import run_import

    project = db_session.get(ProjectRow, PROJECT_ID)
    result = run_import(db_session, project, src, mock_llm, instruction="Import test")

    characters = result["project"]["seriesBible"]["characters"]
    doc_brown = next(c for c in characters if c["id"] == "char-locked-doc")
    assert doc_brown == locked_char


class _RaisingEntitiesLlm(MockLlmClient):
    def infer_story_entities(self, **kwargs):
        raise SchemaInvalidLlmError("infer_story_entities")



def test_import_entity_inference_chunks_and_merges(db_session, mock_llm, monkeypatch):
    """Large-budget override forces 2 entity chunks; results merge into bible."""
    import fountain.entity_inference as entity_inference
    import fountain.pipeline as pipeline_mod

    monkeypatch.setattr(entity_inference, "ENTITY_INFER_USER_CHAR_BUDGET", 800)
    monkeypatch.setattr(pipeline_mod, "ENTITY_INFER_USER_CHAR_BUDGET", 800)

    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000091"},
    ).json()
    pid = created["id"]

    # Two scenes with enough early scriptText that each exceeds the tiny budget
    # alone when packed with the other (chunker yields 2 chunks of 1 scene).
    pad = "\n".join(f"LINE {i} padding for entity chunk budget." for i in range(40))
    src = (
        "INT. LAB - NIGHT\n\nEinstein the dog watches from the workbench.\n\n"
        "DOC\nGreat Scott!\n"
        + pad
        + "\n\nINT. STREET - DAY\n\nMARTY\nWhoa.\n"
        + pad
    )
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_responses(
        "infer_story_entities",
        [
            entities(
                characters=[
                    {
                        "name": "Doc Brown",
                        "aliases": ["Doc"],
                        "role": "principal",
                        "traits": "inventor",
                        "evidence": [{"sceneId": "scene-1", "quote": "Great Scott!"}],
                    }
                ],
                relationships=[
                    {
                        "betweenNames": ["Doc Brown", "Marty"],
                        "label": "mentor",
                        "reallyLike": "",
                        "evidence": [{"sceneId": "scene-1", "quote": "Great Scott!"}],
                    }
                ],
            ),
            entities(
                characters=[
                    {
                        "name": "DOC",
                        "aliases": ["Emmett"],
                        "role": "principal",
                        "traits": "",
                        "evidence": [{"sceneId": "scene-2", "quote": "Doc left a note"}],
                    },
                    {
                        "name": "Einstein",
                        "aliases": [],
                        "role": "minor",
                        "traits": "dog",
                        "evidence": [{"sceneId": "scene-2", "quote": "barks"}],
                    },
                ],
                relationships=[
                    {
                        "betweenNames": ["Marty", "Doc"],
                        "label": "Mentor",
                        "reallyLike": "father figure",
                        "evidence": [{"sceneId": "scene-2", "quote": "Whoa."}],
                    }
                ],
            ),
        ],
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    assert mock_llm._invocations.get("infer_story_entities") == 2
    bible = body["project"]["seriesBible"]
    by_name = {c["name"]: c for c in bible["characters"]}
    # Cue mint keeps display name "Doc"; chunk combine folds "Doc Brown"/"DOC"
    # into that row via alias match (merge never renames existing characters).
    assert "Doc" in by_name
    assert "Emmett" in by_name["Doc"]["aliases"]
    assert "Einstein" in by_name  # non-speaking, from chunk 2 only
    assert "Marty" in by_name
    labels = [r["label"] for r in bible["relationships"]]
    assert any(label.casefold() == "mentor" for label in labels)
    # Combined evidence should yield a non-empty reallyLike from chunk 2.
    mentor = next(r for r in bible["relationships"] if r["label"].casefold() == "mentor")
    assert mentor["reallyLike"] == "father figure"


class _ConcurrentEntitiesLlm(MockLlmClient):
    """The first cast chunk runs alone to warm the shared cached prefix; every
    later chunk must be in flight together, or the barrier times out and the
    import fails."""

    def __init__(self) -> None:
        super().__init__()
        self._entity_calls = 0
        self._entity_lock = threading.Lock()
        self._rest_together = threading.Barrier(2, timeout=5)

    def infer_story_entities(self, **kwargs):
        with self._entity_lock:
            self._entity_calls += 1
            first = self._entity_calls == 1
        if not first:
            self._rest_together.wait()
        return super().infer_story_entities(**kwargs)


def test_import_runs_entity_chunks_concurrently(monkeypatch):
    """Run one after another, three cast chunks were 4m20s of a 10m30s real
    import. They are independent, so after the cache-warming first chunk the
    rest run at the same time."""
    import fountain.entity_inference as entity_inference

    monkeypatch.setattr(entity_inference, "ENTITY_INFER_USER_CHAR_BUDGET", 800)
    monkeypatch.setattr(pipeline, "ENTITY_INFER_USER_CHAR_BUDGET", 800)
    llm = _ConcurrentEntitiesLlm()
    app.dependency_overrides[get_llm_client] = lambda: llm
    try:
        created = client.post(
            "/api/v1/projects",
            json=NEW_PROJECT_BODY,
            headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000092"},
        ).json()
        pad = "\n".join(f"LINE {i} padding for entity chunk budget." for i in range(40))
        src = (
            "INT. LAB - NIGHT\n\nDOC\nGreat Scott!\n" + pad
            + "\n\nINT. STREET - DAY\n\nMARTY\nWhoa.\n" + pad
            + "\n\nINT. DINER - DAY\n\nGEORGE\nHello.\n" + pad
        )
        llm.set_responses("segment_scene", one_beat_per_scene(src))
        llm.set_response("extract_ledger_facts", extraction())
        llm.set_response("scan_consistency", scan())
        response = client.post(
            f"/api/v1/projects/{created['id']}/import",
            json={"format": "fountain", "content": src},
        )
    finally:
        app.dependency_overrides.pop(get_llm_client, None)

    assert response.status_code == 200, response.text
    assert llm._invocations.get("infer_story_entities") == 3


def test_schema_invalid_entities_persists_nothing(unlocked_project, db_session):
    """Rule 9: schema-invalid `infer_story_entities` output (after the
    client's own retry-once is exhausted) fails the import atomically —
    zero rows changed, same contract as segmentation/act inference."""
    project = db_session.get(ProjectRow, PROJECT_ID)
    original_doc = project.doc
    original_head = project.head_snapshot_id
    original_snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    original_facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()
    src = "INT. BAR - DAY\nScene."

    from fountain.pipeline import run_import

    llm = _RaisingEntitiesLlm()
    with pytest.raises(SchemaInvalidLlmError, match="infer_story_entities"):
        run_import(db_session, project, src, llm, instruction="Import test")

    _assert_unchanged(db_session, original_doc, original_head, original_snaps, original_facts)


# ── story overview (T7.28) ───────────────────────────────────────────────


def test_import_infers_story_overview_after_promises(db_session, mock_llm):
    """T7.28: mock import fills storyOverview and backfills empty premises."""
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000061"},
    ).json()
    pid = created["id"]
    # Create body carries a non-empty project premise by default.

    src = "INT. LAB - NIGHT\n\nMARTY\nDoc, are you there?\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response("infer_story_overview", overview())
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()

    project = body["project"]
    episode = project["seasons"][0]["episodes"][0]
    ov = episode["storyOverview"]
    assert ov is not None
    assert ov["logline"]
    assert ov["outline"][0]["sceneId"] == "scene-1"
    assert ov["beatSheet"][0]["beatId"] == "beat-1-1"
    assert "\n\n" in ov["summary"] or ov["summary"].count("\n") >= 1
    assert project["premise"] == NEW_PROJECT_BODY["premise"]
    assert episode["premise"] == ov["logline"]


def test_import_preserves_locked_story_overview_on_reimport(db_session, mock_llm):
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000062"},
    ).json()
    pid = created["id"]
    src = "INT. LAB - NIGHT\n\nMARTY\nDoc, are you there?\n"
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response("infer_story_overview", overview())
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())
    first = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()
    episode = first["project"]["seasons"][0]["episodes"][0]
    prior_logline = episode["storyOverview"]["logline"]
    # Persist locked overview on the project doc for re-import.
    from sqlalchemy.orm.attributes import flag_modified

    from storage.models import ProjectRow

    row = db_session.get(ProjectRow, pid)
    doc = dict(row.doc)
    ep = doc["seasons"][0]["episodes"][0]
    ep["storyOverview"] = dict(episode["storyOverview"])
    ep["storyOverview"]["locked"] = True
    row.doc = doc
    flag_modified(row, "doc")
    db_session.commit()

    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "infer_story_overview",
        overview(logline="A completely different logline that must not stick."),
    )
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response("scan_consistency", scan())
    second = client.post(
        f"/api/v1/projects/{pid}/import", json={"format": "fountain", "content": src}
    ).json()
    ov = second["project"]["seasons"][0]["episodes"][0]["storyOverview"]
    assert ov["locked"] is True
    assert ov["logline"] == prior_logline


class _RaisingOverviewLlm(MockLlmClient):
    def infer_story_overview(self, **kwargs):
        raise SchemaInvalidLlmError("infer_story_overview")


def test_schema_invalid_overview_persists_nothing(unlocked_project, db_session):
    project = db_session.get(ProjectRow, PROJECT_ID)
    original_doc = project.doc
    original_head = project.head_snapshot_id
    original_snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    original_facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()
    src = "INT. BAR - DAY\nScene."

    from fountain.pipeline import run_import

    llm = _RaisingOverviewLlm()
    with pytest.raises(SchemaInvalidLlmError, match="infer_story_overview"):
        run_import(db_session, project, src, llm, instruction="Import test")

    _assert_unchanged(db_session, original_doc, original_head, original_snaps, original_facts)


def test_analyze_import_uses_one_source_data_nonce_for_the_whole_run(
    unlocked_project,
):
    """One import run, one `<source_data_{nonce}>` tag (§8b + prompt caching).

    The nonce appears in the system prompt and in every source_data block, so
    a per-call nonce rewrites the prompt prefix on every request. Prompt
    caching is a byte-exact prefix match, so that silently guarantees a 0%
    cache hit rate over a shared source payload — no error, no symptom except
    the bill. The injection boundary is unaffected either way: imported text
    can no more guess a run-scoped nonce than a per-call one.
    """
    src = "\n".join(
        [
            "INT. ALPHA - DAY",
            "Alpha waits.",
            "INT. BETA - DAY",
            "Beta waits.",
        ]
    )

    seen: list[str] = []

    class _RecordingLlm:
        """Forwards to MockLlmClient, capturing every rendered prompt."""

        def __init__(self, inner: MockLlmClient) -> None:
            self._inner = inner

        def __getattr__(self, name: str):
            attr = getattr(self._inner, name)
            if not callable(attr):
                return attr

            def _capture(*args, **kwargs):
                seen.append(kwargs.get("system", ""))
                seen.append(kwargs.get("user_message", ""))
                return attr(*args, **kwargs)

            return _capture

    inner = MockLlmClient()
    inner.set_responses("segment_scene", one_beat_per_scene(src))
    inner.set_response("extract_ledger_facts", extraction())
    inner.set_response("scan_consistency", scan())

    _events, _analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, _RecordingLlm(inner))
    )

    # Guard the guard: "one nonce" is trivially true of a single call, so this
    # assertion only means something if the run actually made several.
    tagged = [text for text in seen if "<source_data_" in text]
    assert len(tagged) >= 4, f"expected a multi-call run, saw {len(tagged)} tagged prompts"

    nonces = set(re.findall(r"<source_data_([0-9a-f]+)", "\n".join(seen)))
    assert len(nonces) == 1, f"expected one run nonce, saw {sorted(nonces)}"

    # And an explicit nonce is honored end to end, so a resumed run can keep
    # the prefix it already paid to cache.
    seen.clear()
    inner2 = MockLlmClient()
    inner2.set_responses("segment_scene", one_beat_per_scene(src))
    inner2.set_response("extract_ledger_facts", extraction())
    inner2.set_response("scan_consistency", scan())
    _drain_analysis(
        pipeline.analyze_import(
            unlocked_project["project"], [], src, _RecordingLlm(inner2), nonce="cafebabe"
        )
    )
    assert set(re.findall(r"<source_data_([0-9a-f]+)", "\n".join(seen))) == {"cafebabe"}


def test_extraction_sends_one_byte_identical_whole_episode_cache_prefix(
    unlocked_project,
):
    """Every scene's extraction call shares one cached whole-episode prefix.

    Two things have to hold for the cache to work at all, and neither has any
    symptom when broken except the bill:
      - every call must actually carry the prefix, and
      - it must be byte-identical across the run (caching is a prefix match).

    It must also genuinely contain the *whole* episode — a prefix rebuilt per
    scene, or scoped to the target scene, would cache nothing and would leave
    extraction exactly as blind to cross-scene facts as it was before.
    """
    src = "\n".join(
        [
            "INT. ALPHA - DAY",
            "Alpha hides the key.",
            "INT. BETA - DAY",
            "Beta searches the room.",
            "INT. GAMMA - DAY",
            "Gamma finds the key.",
        ]
    )
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    _drain_analysis(pipeline.analyze_import(unlocked_project["project"], [], src, llm))

    prefixes = llm.cache_prefixes_by_op["extract_ledger_facts"]
    assert len(prefixes) == 3, f"expected one call per scene, got {len(prefixes)}"
    assert all(p is not None for p in prefixes), "an extraction call sent no cache prefix"
    assert len(set(prefixes)) == 1, "cache prefix drifted between calls — cache would miss"

    # The point of the prefix: the scene being extracted is not the only scene
    # in it. Scene 1's call can see scene 3.
    only = prefixes[0]
    for scene_id in ("scene-1", "scene-2", "scene-3"):
        assert scene_id in only, f"{scene_id} missing from the whole-episode prefix"
    assert "Gamma finds the key." in only

    # And it stays inside the §8b boundary like every other source payload.
    assert "<source_data_" in only and 'kind="episode_script"' in only


def test_import_lands_a_secret_with_both_sides_resolved(db_session, mock_llm):
    """End to end: a planted concealment survives inference -> merge -> doc.

    Proves the whole wiring, not just the merge: the op returns names, the
    server resolves them against the cast entity inference minted, mints the
    secret id, and attaches it to the episode.
    """
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000061"},
    ).json()
    pid = created["id"]

    src = (
        "INT. BAR - NIGHT\n\nDAN\nI'm closing up.\n\n"
        "INT. BAR - LATER\n\nMARTA\nWhere did the money go?\n"
    )
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response(
        "infer_narrative_promises",
        promises(
            secrets=[
                {
                    "summary": "Dan hid the $40,000 in the ice machine.",
                    "holderNames": ["Dan"],
                    "concealedFromNames": ["Marta"],
                    "audienceKnows": True,
                    "establishedSceneId": "scene-1",
                    "revealedSceneId": None,
                    "concealmentSceneIds": ["scene-2"],
                    "establishedBeatId": None,
                    "revealedBeatId": None,
                }
            ]
        ),
    )

    response = client.post(
        f"/api/v1/projects/{pid}/import",
        json={"format": "fountain", "content": src},
    )
    assert response.status_code == 200, response.text

    episode = response.json()["project"]["seasons"][0]["episodes"][0]
    assert len(episode["secrets"]) == 1
    secret = episode["secrets"][0]
    assert secret["id"].startswith("secret-")
    assert secret["summary"] == "Dan hid the $40,000 in the ice machine."
    # Both sides resolved to real minted character ids, not raw names.
    cast = {c["id"] for c in response.json()["project"]["seriesBible"]["characters"]}
    assert set(secret["holderCharacterIds"]) <= cast
    assert set(secret["concealedFromCharacterIds"]) <= cast
    assert secret["holderCharacterIds"] != secret["concealedFromCharacterIds"]
    # Still concealed at end of episode, and its concealment scene survived.
    assert secret["revealedSceneId"] is None
    assert secret["concealmentSceneIds"] == ["scene-2"]


def test_segmentation_sends_one_byte_identical_split_cache_prefix(
    unlocked_project,
):
    """Segmentation gets the whole script too — for MEANING, not boundaries.

    A beat break is local (entrance, exit, topic change) and decidable from
    the scene alone. What a beat *means* — that it plants something scene 3
    pays off — is only visible with the episode in view, and that is what
    whatHappens/audienceLearns/audienceFeels are for.

    Same two invariants as extraction: every call carries the prefix, and it
    is byte-identical across the run. Neither has any symptom when broken
    except the bill.
    """
    src = "\n".join(
        [
            "INT. ALPHA - DAY",
            "Alpha hides the key.",
            "INT. BETA - DAY",
            "Beta searches the room.",
            "INT. GAMMA - DAY",
            "Gamma finds the key.",
        ]
    )
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    _drain_analysis(pipeline.analyze_import(unlocked_project["project"], [], src, llm))

    prefixes = llm.cache_prefixes_by_op["segment_scene"]
    assert len(prefixes) == 3, f"expected one call per scene, got {len(prefixes)}"
    assert all(p is not None for p in prefixes), "a segment call sent no cache prefix"
    assert len(set(prefixes)) == 1, "cache prefix drifted between calls — cache would miss"

    only = prefixes[0]
    # Scene 1's segmentation can see the scene that pays its setup off.
    assert "Gamma finds the key." in only
    assert "Alpha hides the key." in only
    # Not line-numbered: the target scene arrives numbered in the user turn,
    # and a second coordinate space here invites citing the wrong one.
    assert '"lineNumber"' not in only
    assert "<source_data_" in only and 'kind="episode_script"' in only


def test_segmentation_and_extraction_prefixes_are_independent(unlocked_project):
    """They cover the same script but are different payloads.

    Segmentation runs before scenes are assembled, so its prefix is the raw
    split; extraction's carries beat ids. Sharing one would force whichever
    ran second to accept a shape it cannot cite.
    """
    src = "INT. ALPHA - DAY\nAlpha waits.\nINT. BETA - DAY\nBeta waits.\n"
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    _drain_analysis(pipeline.analyze_import(unlocked_project["project"], [], src, llm))

    seg = llm.cache_prefixes_by_op["segment_scene"][0]
    ext = llm.cache_prefixes_by_op["extract_ledger_facts"][0]
    assert seg != ext
    assert '"beatId"' in ext and '"beatId"' not in seg
    assert '"sceneIndex"' in seg


def test_cache_warming_runs_one_scene_before_fanning_out(unlocked_project):
    """Without warming, every concurrent worker pays a full cache write.

    The first IMPORT_LLM_CONCURRENCY calls all start before any cache entry
    exists, so each writes the shared prefix instead of reading it. On a real
    60-page import that was three redundant 30k-token writes per loop.

    Asserted through progress frames because they are the observable
    signal that one scene completed alone before the rest began.
    """
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
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    events, analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )

    for stage in (pipeline.STAGE_SEGMENTING_BEATS, pipeline.STAGE_EXTRACTING_FACTS):
        frames = [
            (e.done, e.total)
            for e in events
            if isinstance(e, pipeline.ImportStageProgress) and e.stage == stage
        ]
        # 0 -> 1 (the lone warm call) -> the rest.
        assert frames == [(0, 3), (1, 3), (2, 3), (3, 3)], stage

    # Warming must not disturb the ordering guarantee.
    scenes = analysis.new_doc["seasons"][0]["episodes"][0]["scenes"]
    assert [s["location"] for s in scenes] == [
        "INT. ALPHA - DAY",
        "INT. BETA - DAY",
        "INT. GAMMA - DAY",
    ]


def test_a_single_scene_import_does_not_warm(unlocked_project):
    """Warming a one-item loop is pure latency for no saved write."""
    src = "INT. ALPHA - DAY\nAlpha waits.\n"
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    events, _analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )
    frames = [
        (e.done, e.total)
        for e in events
        if isinstance(e, pipeline.ImportStageProgress)
        and e.stage == pipeline.STAGE_SEGMENTING_BEATS
    ]
    assert frames == [(0, 1), (1, 1)]


def test_entity_inference_chunks_share_one_cached_prefix(unlocked_project):
    """Chunking bounds output, not context.

    Three chunks returned 14.6k output tokens on a 27-scene script against an
    8192 ceiling, so a single whole-script call would truncate — chunking has
    to stay. What it should not cost is sight of the rest of the cast, which
    is what made chunk boundaries produce the same person under two
    spellings. Every chunk now carries the same cached script.
    """
    src = "\n".join(
        f"INT. SCENE {i} - DAY\nSomeone waits in scene {i}." for i in range(1, 7)
    )
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    _drain_analysis(pipeline.analyze_import(unlocked_project["project"], [], src, llm))

    prefixes = llm.cache_prefixes_by_op.get("infer_story_entities", [])
    assert prefixes, "entity inference sent no cache prefix"
    assert all(p is not None for p in prefixes)
    assert len(set(prefixes)) == 1, "prefix drifted between chunks — cache would miss"
    # Shares the segmentation prefix rather than building a third payload.
    assert prefixes[0] == llm.cache_prefixes_by_op["segment_scene"][0]


def test_scene_with_no_beats_reaches_the_writer_as_a_flag(unlocked_project):
    """The empty beat layer must not be silent.

    Every real import to date produced exactly one empty synthetic beat per
    scene — no whatHappens, no audienceLearns, no audienceFeels — and raised
    not one flag, so the failure was invisible in the app while the tests
    stayed green on hand-written fixtures. Coverage is not the check that
    catches this: the text is fully preserved either way. This is.
    """
    src = "\n".join(
        [
            "INT. ALPHA - DAY",
            "Alpha hides the key.",
            "Alpha checks the door.",
            "Alpha leaves.",
            "INT. BETA - DAY",
            "Beta searches the room.",
            "Beta finds nothing.",
            "Beta sits.",
        ]
    )
    llm = MockLlmClient()
    # What the real model has actually been returning: unassigned, no beats,
    # on the first attempt and on the retry.
    llm.set_response(
        "segment_scene",
        SegmentedScene.model_validate(
            {"segments": [{"kind": "unassigned", "startLine": 1, "reason": "orphan"}]}
        ),
    )
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    _events, analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )

    flagged = [f for f in analysis.raw_flags if "no_beats_returned" in f["explanation"]]
    assert len(flagged) == 2, "every scene that lost its beats should raise a flag"
    assert {f["objectType"] for f in flagged} == {"beat"}
    assert llm.invocation_count("segment_scene") == 4  # one retry per scene
    # The writer is told which scene and what they can do, without the script
    # text; the app has no way to re-run one scene's breakdown.
    assert "Re-run the breakdown" not in flagged[0]["explanation"]
    assert "Plan inspector" in flagged[0]["explanation"]


def test_import_fills_scene_time_from_the_slugline(unlocked_project):
    """`Scene.time` is a contract field the Plan inspector shows, and import
    left it empty on every scene while putting the whole slugline — time
    included — into `location`."""
    src = "\n".join(
        [
            "INT. BAR - NIGHT",
            "Dan pours a drink.",
            "EXT. STREET - DAWN",
            "Marta waits.",
            "INT. NO TIME IN THIS ONE",
            "A door closes.",
        ]
    )
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    _events, analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )

    scenes = analysis.new_doc["seasons"][0]["episodes"][0]["scenes"]
    assert [s["time"] for s in scenes] == ["NIGHT", "DAWN", ""]
    # `location` keeps the full slugline: it is what reads as a scene heading
    # across the app, and merge_timeline_anchors parses it directly.
    assert scenes[0]["location"] == "INT. BAR - NIGHT"


def test_import_fills_scene_craft_fields_from_the_segmentation_read(unlocked_project):
    """The Plan inspector edits scene-level craft fields, and import used to
    write "" into every one of them — blank boxes on every scene of an
    imported script while the beats underneath were fully described."""
    src = "INT. BAR - NIGHT\nDan pours a drink.\nMarta watches him."
    reading = {
        "sceneWhatHappens": "Marta waits for Dan to admit what he moved.",
        "sceneAudienceLearns": "Dan knows more than he is saying.",
        "sceneAudienceFeels": "Held breath.",
        "sceneSocialSituation": "A last-call standoff between siblings.",
    }
    segmented = SegmentedScene.model_validate(
        {**seg([(1, 3)]).model_dump(by_alias=True), **reading}
    )
    llm = MockLlmClient()
    llm.set_responses("segment_scene", [segmented])
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    _events, analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )

    scene = analysis.new_doc["seasons"][0]["episodes"][0]["scenes"][0]
    assert scene["whatHappens"] == "Marta waits for Dan to admit what he moved."
    assert scene["audienceLearns"] == "Dan knows more than he is saying."
    assert scene["audienceFeels"] == "Held breath."
    assert scene["socialSituation"] == "A last-call standoff between siblings."


def test_import_leaves_a_scene_field_blank_when_the_read_omits_it(unlocked_project):
    """A thin scene degrades to the old blank rather than to invented copy."""
    src = "INT. BAR - NIGHT\nDan pours a drink."
    llm = MockLlmClient()
    llm.set_responses("segment_scene", [seg([(1, 2)])])
    llm.set_response("extract_ledger_facts", extraction())
    llm.set_response("scan_consistency", scan())

    _events, analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )

    scene = analysis.new_doc["seasons"][0]["episodes"][0]["scenes"][0]
    assert scene["whatHappens"] == ""
    assert scene["socialSituation"] == ""


def test_an_ambiguous_inferred_name_reaches_the_writer_as_a_merge_proposal(
    unlocked_project,
):
    """T9.8: the proposal is an open flag on the scene the model cited, and no
    third row is minted for a person the cast already holds twice."""
    src = "\n".join(
        [
            "INT. CLASSROOM - DAY",
            "Kids wait.",
            "INT. HALL - DAY",
            "MALLORY",
            "Hello.",
            "",
            "O'BRIEN",
            "Hi.",
        ]
    )
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response(
        "infer_story_entities",
        entities(
            characters=[
                {
                    "name": "Mallory O'Brien",
                    "aliases": [],
                    "role": "supporting",
                    "traits": "",
                    "evidence": [{"sceneId": "scene-2", "quote": "Hello."}],
                }
            ]
        ),
    )
    llm.set_response(
        "extract_ledger_facts",
        extraction([{**one_fact(), "knownBy": ["Mallory O'Brien"]}]),
    )
    llm.set_response("scan_consistency", scan())

    _events, analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )

    names = [c["name"] for c in analysis.new_doc["seriesBible"]["characters"]]
    assert {"Mallory", "O'Brien"} <= set(names)
    assert "Mallory O'Brien" not in names
    proposals = [f for f in analysis.raw_flags if "[merge_proposal]" in f["explanation"]]
    assert [(f["objectType"], f["objectId"], f["status"]) for f in proposals] == [
        ("scene", "scene-2", "open")
    ]


def test_extraction_cannot_mint_a_knower_the_script_never_names(unlocked_project):
    """T9.8: knownBy gets the entity merge's grounding gate, against the
    imported script."""
    src = "INT. OFFICE - DAY\nMARTA\nWe close at nine.\n"
    llm = MockLlmClient()
    llm.set_responses("segment_scene", one_beat_per_scene(src))
    llm.set_response(
        "extract_ledger_facts",
        extraction([{**one_fact(), "knownBy": ["Zelda Fitzgerald", "Marta"]}]),
    )
    llm.set_response("scan_consistency", scan())

    _events, analysis = _drain_analysis(
        pipeline.analyze_import(unlocked_project["project"], [], src, llm)
    )

    names = [c["name"] for c in analysis.new_doc["seriesBible"]["characters"]]
    assert "Zelda Fitzgerald" not in names
    assert len(analysis.new_facts[0]["knownBy"]) == 1
