"""POST /projects/{pid}/change-sets — Change Set create (T4.1).

Runs `classify_blast_radius`, server-annotates applyMode / locked / before /
after / continuityFlags / approved, and persists a draft ChangeSet (not
snapshot-versioned). MockLlmClient only (hard rule 1).
"""

from __future__ import annotations

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import BlastRadius
from storage.models import ChangeSetRow, ProjectRow, SnapshotRow

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


# ── fixture marina case (prompt spec §3 worked example) ───────────────────────


def test_marina_fixture_yields_beat_4_2_regenerate_and_fact_02_flag_only(
    seeded_project, mock_llm
):
    """Accept (T4.1): scene-2 premise edit → beat-4-2 regenerate + fact-02 flag_only."""
    resp = _create()
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "draft"
    assert body["preview"] is None
    assert body["targetObjectId"] == "scene-2"
    assert body["instruction"] == MARINA_INSTRUCTION
    assert body["projectId"] == PROJECT_ID

    by_id = _by_id(body["impacted"])
    assert "beat-4-2" in by_id
    assert by_id["beat-4-2"]["objectType"] == "beat"
    assert by_id["beat-4-2"]["applyMode"] == "regenerate"
    assert by_id["beat-4-2"]["after"] is None
    assert by_id["beat-4-2"]["approved"] is False

    assert "fact-02" in by_id
    assert by_id["fact-02"]["objectType"] == "ledgerFact"
    assert by_id["fact-02"]["applyMode"] == "flag_only"
    assert by_id["fact-02"]["after"] is None
    assert by_id["fact-02"]["approved"] is False


def test_flag_only_objects_always_carry_after_null(seeded_project, mock_llm):
    resp = _create()
    assert resp.status_code == 200
    for row in resp.json()["impacted"]:
        if row["applyMode"] == "flag_only":
            assert row["after"] is None


def test_locked_objects_annotated_locked_true(seeded_project, db_session, mock_llm):
    """Accept (T4.1): locked objects in the impacted list get locked: true."""
    import copy

    # Lock beat-4-2 in the live doc so the create path must annotate it.
    project = db_session.get(ProjectRow, PROJECT_ID)
    doc = copy.deepcopy(project.doc)
    for season in doc["seasons"]:
        for episode in season["episodes"]:
            for scene in episode["scenes"]:
                for beat in scene.get("beats", []):
                    if beat["id"] == "beat-4-2":
                        beat["locked"] = True
    project.doc = doc
    db_session.commit()

    mock_llm.set_response(
        "classify_blast_radius",
        BlastRadius.model_validate(
            {
                "impacted": [
                    {
                        "objectType": "beat",
                        "objectId": "beat-4-2",
                        "reason": "Marta searches the bar for the money.",
                        "confidence": "high",
                    },
                    {
                        "objectType": "ledgerFact",
                        "objectId": "fact-02",
                        "reason": "Fact states the money is in the ice machine.",
                        "confidence": "high",
                    },
                ]
            }
        ),
    )

    resp = _create()
    assert resp.status_code == 200
    by_id = _by_id(resp.json()["impacted"])
    assert by_id["beat-4-2"]["locked"] is True
    assert by_id["fact-02"]["locked"] is False


def test_create_persists_draft_without_new_snapshot(seeded_project, db_session, mock_llm):
    before_snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    before_cs = db_session.query(ChangeSetRow).filter_by(project_id=PROJECT_ID).count()

    resp = _create()
    assert resp.status_code == 200
    body = resp.json()

    db_session.expire_all()
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() == before_snaps
    rows = db_session.query(ChangeSetRow).filter_by(project_id=PROJECT_ID).all()
    assert len(rows) == before_cs + 1
    stored = next(r for r in rows if r.id == body["id"])
    assert stored.status == "draft"
    assert stored.doc["preview"] is None
    assert stored.doc["status"] == "draft"


def test_before_snippets_rendered_from_current_doc(seeded_project, mock_llm):
    resp = _create()
    assert resp.status_code == 200
    by_id = _by_id(resp.json()["impacted"])
    # scene-2 whatHappens mentions the ice machine; fact-02 text mentions it too.
    assert "ice machine" in by_id["scene-2"]["before"].lower()
    assert "ice machine" in by_id["fact-02"]["before"].lower()
    assert by_id["beat-4-2"]["before"]  # non-empty plan snippet


def test_apply_mode_by_object_type(seeded_project, mock_llm):
    mock_llm.set_response(
        "classify_blast_radius",
        BlastRadius.model_validate(
            {
                "impacted": [
                    {
                        "objectType": "scene",
                        "objectId": "scene-2",
                        "reason": "r",
                        "confidence": "high",
                    },
                    {
                        "objectType": "beat",
                        "objectId": "beat-4-2",
                        "reason": "r",
                        "confidence": "high",
                    },
                    {
                        "objectType": "character",
                        "objectId": "char-dan",
                        "reason": "r",
                        "confidence": "speculative",
                    },
                    {
                        "objectType": "ledgerFact",
                        "objectId": "fact-02",
                        "reason": "r",
                        "confidence": "high",
                    },
                ]
            }
        ),
    )
    by_id = _by_id(_create().json()["impacted"])
    assert by_id["scene-2"]["applyMode"] == "regenerate"
    assert by_id["beat-4-2"]["applyMode"] == "regenerate"
    assert by_id["char-dan"]["applyMode"] == "flag_only"
    assert by_id["fact-02"]["applyMode"] == "flag_only"
    assert by_id["char-dan"]["after"] is None
    assert by_id["fact-02"]["after"] is None


def test_unknown_target_returns_404(seeded_project, mock_llm):
    resp = _create(target="scene-does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_schema_invalid_llm_maps_to_502(seeded_project, mock_llm, monkeypatch):
    def _boom(**_kwargs):
        raise SchemaInvalidLlmError("classify_blast_radius")

    monkeypatch.setattr(mock_llm, "classify_blast_radius", _boom)
    resp = _create()
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "SCHEMA_INVALID_LLM"


def test_classifier_unknown_object_id_maps_to_502(seeded_project, mock_llm):
    """Classifier rows with missing / wrong-type ids → SCHEMA_INVALID_LLM."""
    mock_llm.set_response(
        "classify_blast_radius",
        BlastRadius.model_validate(
            {
                "impacted": [
                    {
                        "objectType": "beat",
                        "objectId": "beat-does-not-exist",
                        "reason": "hallucinated id",
                        "confidence": "high",
                    }
                ]
            }
        ),
    )
    resp = _create()
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "SCHEMA_INVALID_LLM"


def test_classifier_wrong_object_type_maps_to_502(seeded_project, mock_llm):
    """beat-4-2 exists but declaring it as a scene is invalid."""
    mock_llm.set_response(
        "classify_blast_radius",
        BlastRadius.model_validate(
            {
                "impacted": [
                    {
                        "objectType": "scene",
                        "objectId": "beat-4-2",
                        "reason": "type mismatch",
                        "confidence": "high",
                    }
                ]
            }
        ),
    )
    resp = _create()
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "SCHEMA_INVALID_LLM"


def test_llm_unavailable_maps_to_503(seeded_project, mock_llm, monkeypatch):
    def _boom(**_kwargs):
        raise anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.test"))

    monkeypatch.setattr(mock_llm, "classify_blast_radius", _boom)
    resp = _create()
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "LLM_UNAVAILABLE"
