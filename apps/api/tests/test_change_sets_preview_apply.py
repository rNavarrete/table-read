"""POST /change-sets/{cid}/preview + apply + discard + flag (T4.2).

Preview runs `regenerate_elements` and stores a typed `ChangeSetPreview`
without mutating the project. Apply writes the stored payload verbatim
(zero LLM calls), approved-only, then extract + scan. MockLlmClient only.
"""

from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from schemas import ConsistencyScan, RegeneratedElements
from storage.models import ChangeSetRow, ConsistencyFlagRow, ProjectRow, SnapshotRow

client = TestClient(app)

PROJECT_ID = "proj-longpour"
MARINA_INSTRUCTION = "Dan hides the money at the marina instead of the bar"


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _create(target="scene-2", instruction=MARINA_INSTRUCTION):
    return client.post(
        f"/api/v1/projects/{PROJECT_ID}/change-sets",
        json={"targetObjectId": target, "instruction": instruction},
    )


def _by_id(impacted: list[dict]) -> dict[str, dict]:
    return {row["objectId"]: row for row in impacted}


def _regen(*object_ids: str) -> RegeneratedElements:
    """Build a RegeneratedElements covering the given scene/beat ids."""
    beats = []
    scenes = []
    for oid in object_ids:
        if oid.startswith("beat-"):
            beats.append(
                {
                    "beatId": oid,
                    "beatPlan": {
                        "whatHappens": f"AFTER plan for {oid}",
                        "audienceLearns": "learns",
                        "audienceFeels": "feels",
                    },
                    "scriptText": f"AFTER script for {oid}",
                }
            )
        elif oid.startswith("scene-"):
            scenes.append(
                {
                    "sceneId": oid,
                    "fields": {
                        "whatHappens": f"AFTER scene {oid}",
                        "audienceLearns": None,
                        "audienceFeels": None,
                        "location": "MARINA - NIGHT",
                        "time": None,
                        "socialSituation": None,
                    },
                }
            )
    return RegeneratedElements.model_validate(
        {"beats": beats, "scenes": scenes, "continuityConflicts": []}
    )


def _preview(cid: str, approved: list[str]):
    return client.post(
        f"/api/v1/change-sets/{cid}/preview",
        json={"approvedObjectIds": approved},
    )


def _apply(cid: str, approved: list[str]):
    return client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": approved},
    )


# ── preview ───────────────────────────────────────────────────────────────────


def test_preview_stores_typed_payload_and_after_snippets_without_mutating_doc(
    seeded_project, db_session, mock_llm
):
    mock_llm.set_response("regenerate_elements", _regen("beat-4-2", "scene-2"))
    cid = _create().json()["id"]
    before_doc = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)
    before_snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()

    resp = _preview(cid, ["beat-4-2", "scene-2"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "previewing"
    assert body["preview"] is not None
    assert body["preview"]["basedOnSnapshotId"] == before_doc["headSnapshotId"]
    assert {u["beatId"] for u in body["preview"]["beatUpdates"]} == {"beat-4-2"}
    assert {u["sceneId"] for u in body["preview"]["sceneUpdates"]} == {"scene-2"}

    by_id = _by_id(body["impacted"])
    assert by_id["beat-4-2"]["after"] == "AFTER plan for beat-4-2"
    assert by_id["scene-2"]["after"] == "AFTER scene scene-2"
    assert by_id["fact-02"]["after"] is None  # flag_only stays null

    db_session.expire_all()
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before_doc
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() == before_snaps


def test_preview_rejects_extra_ids_from_llm_as_schema_invalid(
    seeded_project, mock_llm, caplog
):
    """Response elements not in request → SCHEMA_INVALID_LLM; log IDs only."""
    mock_llm.set_response(
        "regenerate_elements",
        _regen("beat-4-2", "scene-2", "beat-3-1"),  # beat-3-1 not approved
    )
    cid = _create().json()["id"]
    with caplog.at_level("INFO"):
        resp = _preview(cid, ["beat-4-2", "scene-2"])
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "SCHEMA_INVALID_LLM"
    # Hard rule 5: log IDs, never writer/plan/script text.
    joined = " ".join(r.message for r in caplog.records)
    assert "beat-3-1" in joined
    assert "AFTER plan" not in joined
    assert "AFTER script" not in joined


# ── apply: 2 of 3, zero LLM, scan flags ───────────────────────────────────────


def test_apply_two_of_three_from_stored_payload_with_zero_llm_calls(
    seeded_project, db_session, mock_llm
):
    """Accept (T4.2): apply 2 of 3 approved → exactly those 2; zero LLM on apply."""
    mock_llm.set_response(
        "regenerate_elements", _regen("beat-4-2", "scene-2", "scene-5")
    )
    mock_llm.set_response(
        "scan_consistency",
        ConsistencyScan.model_validate(
            {
                "flags": [
                    {
                        "objectType": "scene",
                        "objectId": "scene-5",
                        "factId": None,
                        "explanation": "Argument still staged around the bar.",
                        "severity": "tension",
                    }
                ]
            }
        ),
    )
    # Empty extract so apply doesn't invent facts that obscure the assertion.
    from schemas import LedgerExtraction

    mock_llm.set_response(
        "extract_ledger_facts",
        LedgerExtraction.model_validate({"newFacts": [], "contradictions": []}),
    )

    cid = _create().json()["id"]
    assert _preview(cid, ["beat-4-2", "scene-2", "scene-5"]).status_code == 200

    mock_llm.reset_invocation_counts()
    resp = _apply(cid, ["beat-4-2", "scene-2"])  # leave scene-5 out
    assert resp.status_code == 200
    # Stored-payload invariant: apply never re-runs regenerate (test plan /
    # build plan T4.2). extract + scan are post-write side effects and may run.
    assert mock_llm.invocation_count("regenerate_elements") == 0
    assert mock_llm.invocation_count("classify_blast_radius") == 0

    body = resp.json()
    assert "project" in body and "changeSet" in body and "consistencyFlags" in body
    assert body["changeSet"]["status"] == "applied"

    # Exactly the two approved updates landed.
    doc = body["project"]
    beat = None
    scene2 = None
    scene5 = None
    for season in doc["seasons"]:
        for episode in season["episodes"]:
            for scene in episode["scenes"]:
                if scene["id"] == "scene-2":
                    scene2 = scene
                if scene["id"] == "scene-5":
                    scene5 = scene
                for beat_row in scene.get("beats", []):
                    if beat_row["id"] == "beat-4-2":
                        beat = beat_row
    assert beat["whatHappens"] == "AFTER plan for beat-4-2"
    assert beat["scriptText"] == "AFTER script for beat-4-2"
    assert scene2["whatHappens"] == "AFTER scene scene-2"
    # scene-5 was in the preview but not in the apply list — unchanged.
    fixture_scene5 = seeded_project["project"]["seasons"][0]["episodes"][0]["scenes"]
    original_s5 = next(s for s in fixture_scene5 if s["id"] == "scene-5")
    assert scene5["whatHappens"] == original_s5["whatHappens"]


def test_apply_returns_and_persists_open_scan_flags(
    seeded_project, db_session, mock_llm
):
    """Accept (T4.2): mock scan flags returned and persisted as open."""
    mock_llm.set_response("regenerate_elements", _regen("beat-4-2"))
    mock_llm.set_response(
        "scan_consistency",
        ConsistencyScan.model_validate(
            {
                "flags": [
                    {
                        "objectType": "scene",
                        "objectId": "scene-5",
                        "factId": None,
                        "explanation": "Bar-staged argument is stale.",
                        "severity": "tension",
                    }
                ]
            }
        ),
    )
    from schemas import LedgerExtraction

    mock_llm.set_response(
        "extract_ledger_facts",
        LedgerExtraction.model_validate({"newFacts": [], "contradictions": []}),
    )

    cid = _create().json()["id"]
    assert _preview(cid, ["beat-4-2"]).status_code == 200
    resp = _apply(cid, ["beat-4-2"])
    assert resp.status_code == 200
    flags = resp.json()["consistencyFlags"]
    assert any(f["objectId"] == "scene-5" and f["status"] == "open" for f in flags)

    db_session.expire_all()
    rows = (
        db_session.query(ConsistencyFlagRow)
        .filter_by(project_id=PROJECT_ID, object_id="scene-5", status="open")
        .all()
    )
    assert len(rows) >= 1


def test_apply_null_preview_returns_409(seeded_project, mock_llm):
    cid = _create().json()["id"]
    resp = _apply(cid, ["beat-4-2"])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] in ("VALIDATION", "PREVIEW_STALE")


def test_apply_id_not_in_preview_returns_409_validation(
    seeded_project, db_session, mock_llm
):
    """Apply ids must be ⊆ previewed regenerate ids (Codex P1)."""
    mock_llm.set_response("regenerate_elements", _regen("beat-4-2"))
    from schemas import LedgerExtraction

    mock_llm.set_response(
        "extract_ledger_facts",
        LedgerExtraction.model_validate({"newFacts": [], "contradictions": []}),
    )

    cid = _create().json()["id"]
    assert _preview(cid, ["beat-4-2"]).status_code == 200

    # scene-2 was classified regenerate but was not in this preview call —
    # applying it must fail rather than silently no-op / mark approved.
    before = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)
    resp = _apply(cid, ["beat-4-2", "scene-2"])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "VALIDATION"
    db_session.expire_all()
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before


def test_edit_between_preview_and_apply_returns_preview_stale(
    seeded_project, db_session, mock_llm
):
    """Accept (T4.2): mutate project between preview and apply → PREVIEW_STALE."""
    from llm.dependency import get_llm_client_provider

    mock_llm.set_response("regenerate_elements", _regen("beat-4-2"))
    # Structural PATCH resolves LLM via the provider; inject the same mock.
    app.dependency_overrides[get_llm_client_provider] = lambda: (lambda: mock_llm)
    try:
        cid = _create().json()["id"]
        assert _preview(cid, ["beat-4-2"]).status_code == 200

        # Mutate the project via a snapshot-creating PATCH so head moves.
        patch_resp = client.patch(
            f"/api/v1/projects/{PROJECT_ID}",
            json=[
                {
                    "op": "replace",
                    "path": "/seasons/0/episodes/0/scenes/2/whatHappens",
                    "value": "Unrelated writer edit that moves the head.",
                }
            ],
        )
        assert patch_resp.status_code == 200

        resp = _apply(cid, ["beat-4-2"])
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "PREVIEW_STALE"
    finally:
        app.dependency_overrides.pop(get_llm_client_provider, None)


# ── discard / flag ────────────────────────────────────────────────────────────


def test_discard_marks_change_set_discarded_without_mutating_project(
    seeded_project, db_session, mock_llm
):
    cid = _create().json()["id"]
    before = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)
    resp = client.post(f"/api/v1/change-sets/{cid}/discard")
    assert resp.status_code == 200
    assert resp.json()["status"] == "discarded"
    db_session.expire_all()
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before
    assert db_session.get(ChangeSetRow, cid).status == "discarded"


def test_flag_marks_change_set_flagged_without_mutating_project(
    seeded_project, db_session, mock_llm
):
    cid = _create().json()["id"]
    before = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)
    resp = client.post(f"/api/v1/change-sets/{cid}/flag")
    assert resp.status_code == 200
    assert resp.json()["status"] == "flagged"
    db_session.expire_all()
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before
    assert db_session.get(ChangeSetRow, cid).status == "flagged"
