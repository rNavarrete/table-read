"""Import + export endpoints (data contract §4). The T1.3 acceptance criteria
are exercised end-to-end here with a `MockLlmClient` injected via the FastAPI
dependency override (never the real client — hard rule 1). The deterministic
parse core is unit-tested in test_fountain_parse.py; this suite proves the
transaction, the response shape, and the zero-persistence guarantees.
"""

from __future__ import annotations

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from fountain.parse import split_into_scenes
from llm.dependency import get_llm_client
from llm.errors import LlmTimeoutError, SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import ConsistencyScan, LedgerExtraction, SegmentedScene
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
            "beats": [
                {"startLine": s, "endLine": e, "whatHappens": "w", "audienceLearns": "l",
                 "audienceFeels": "f"}
                for s, e in beats
            ],
            "unassigned": [
                {"startLine": s, "endLine": e, "reason": "orphan"} for s, e in (unassigned or [])
            ],
        }
    )


def one_beat_per_scene(source: str) -> list[SegmentedScene]:
    """A valid single-beat segmentation for each scene of `source`."""
    return [seg([(1, len(scene.lines))]) for scene in split_into_scenes(source)]


def extraction(facts: list[dict] | None = None) -> LedgerExtraction:
    return LedgerExtraction.model_validate({"newFacts": facts or [], "contradictions": []})


def one_fact(beat_id: str = "beat-1-1", confidence: float = 0.95) -> dict:
    return {
        "fact": "Something is established.",
        "factType": "event",
        "sourceSpan": {"episodeId": "ep-1", "sceneId": "scene-1", "beatId": beat_id,
                       "startLine": 1, "endLine": 1},
        "sourceText": "",
        "knownBy": ["char-marta"],
        "audienceKnows": True,
        "confidence": confidence,
    }


def scan(flags: list[dict] | None = None) -> ConsistencyScan:
    return ConsistencyScan.model_validate({"flags": flags or []})


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


# ── round-trip: reproduces scene/beat count + response shape ──────────────────


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


def test_all_import_facts_are_pending_review(unlocked_project, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    # high confidence (0.95) must STILL land pending_review on import
    mock_llm.set_response("extract_ledger_facts", extraction([one_fact(confidence=0.95)]))
    mock_llm.set_response("scan_consistency", scan())

    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()
    assert body["newFacts"], "expected at least one extracted fact"
    for fact in body["newFacts"]:
        assert fact["status"] == "pending_review"
        assert fact["provenance"] == "inferred"

    # and the persisted ledger agrees
    ledger = client.get(
        f"/api/v1/projects/{PROJECT_ID}/ledger", params={"status": "pending_review"}
    ).json()
    assert len(ledger) == len(body["newFacts"])


def test_import_scan_flags_persisted_open(unlocked_project, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours a drink."
    mock_llm.set_responses("segment_scene", one_beat_per_scene(src))
    mock_llm.set_response("extract_ledger_facts", extraction())
    mock_llm.set_response(
        "scan_consistency",
        scan([{"objectType": "scene", "objectId": "scene-1", "factId": None,
               "explanation": "internal contradiction", "severity": "contradiction"}]),
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
        scan([{"objectType": "scene", "objectId": "scene-999", "factId": None,
               "explanation": "phantom", "severity": "tension"}]),
    )
    body = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    ).json()
    assert all(f["objectId"] != "scene-999" for f in body["consistencyFlags"])


# ── overlapping ranges → VALIDATION, nothing persisted ───────────────────────


def _assert_unchanged(db_session, original_doc, original_head, original_snaps, original_facts):
    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.doc == original_doc
    assert project.head_snapshot_id == original_head
    snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()
    assert snaps == original_snaps
    assert facts == original_facts


@pytest.mark.parametrize(
    "bad_seg",
    [
        seg([(1, 2), (2, 3)]),  # overlap at line 2
    ],
    ids=["overlap"],
)
def test_bad_ranges_reject_with_validation_and_persist_nothing(
    unlocked_project, db_session, mock_llm, bad_seg
):
    project = db_session.get(ProjectRow, PROJECT_ID)
    original_doc = dict(project.doc)
    original_head = project.head_snapshot_id
    original_snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    original_facts = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()

    src = "INT. BAR - NIGHT\nDan pours.\nMarta enters."  # 3 lines
    mock_llm.set_responses("segment_scene", [bad_seg])

    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/import", json={"format": "fountain", "content": src}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION"
    _assert_unchanged(db_session, original_doc, original_head, original_snaps, original_facts)


def test_gapped_ranges_heal_persist_and_flag_review(unlocked_project, db_session, mock_llm):
    src = "INT. BAR - NIGHT\nDan pours.\nMarta enters."  # 3 lines; line 2 is a gap
    mock_llm.set_responses("segment_scene", [seg([(1, 1), (3, 3)])])
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
    assert "Dan pours." in all_beats[0]["scriptText"]

    review_flags = [
        f for f in body["consistencyFlags"]
        if f["objectType"] == "beat" and f["severity"] == "tension"
    ]
    assert len(review_flags) == 1
    assert review_flags[0]["objectId"] == all_beats[0]["id"]
    assert review_flags[0]["status"] == "open"
    assert "lines 2-2" in review_flags[0]["explanation"]

    db_session.expire_all()
    persisted = db_session.get(ProjectRow, PROJECT_ID)
    persisted_beats = [
        b
        for s in persisted.doc["seasons"][0]["episodes"][0]["scenes"]
        for b in s["beats"]
    ]
    assert "\n".join(b["scriptText"] for b in persisted_beats) == src
    assert persisted.head_snapshot_id == body["project"]["headSnapshotId"]


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
        f for f in body["consistencyFlags"]
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
        scan([{"objectType": "scene", "objectId": "scene-1", "factId": None,
               "explanation": "x", "severity": "tension"}]),
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
    app.dependency_overrides[get_llm_client] = lambda: _RaisingLlm(
        LlmTimeoutError("segment_scene")
    )
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
    exc = SchemaInvalidLlmError("segment_scene")
    app.dependency_overrides[get_llm_client] = lambda: _RaisingLlm(exc)
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
