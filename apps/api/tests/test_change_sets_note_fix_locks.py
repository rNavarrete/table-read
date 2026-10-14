"""Draft a fix in Review (T3.9) — lock violation, CLAUDE.md rule 2.

Written BEFORE the feature. "Draft a fix in Review…" on a Plan story note
creates an ordinary Change Set (target = the note's scene, instruction = the
note in words) through the existing create → preview → apply path; it adds no
server code. These tests pin that path for this entry point: whatever the
classifier names, locked content is annotated `locked`, preview and apply
refuse it with 409 LOCKED_OBJECT before any model call, a regenerate that
sneaks a locked id in is 502 SCHEMA_INVALID_LLM, and locked content never
changes. MockLlmClient only (hard rule 1).
"""

from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from schemas import BlastRadius, RegeneratedElements
from storage.models import ProjectRow

client = TestClient(app)

PROJECT_ID = "proj-longpour"
# What Plan's prefill (story.ts fixInstruction) reads for the mock scan's scene-5 note.
NOTE_FIX = (
    "Fix this continuity note in scene 5 (Kitchen): The argument's stakes "
    "reference the bar as the money's hiding place, which is no longer true."
)


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _blast(*rows: tuple[str, str]) -> BlastRadius:
    return BlastRadius.model_validate(
        {
            "impacted": [
                {
                    "objectType": object_type,
                    "objectId": object_id,
                    "reason": "Touched by the fix.",
                    "confidence": "high",
                }
                for object_type, object_id in rows
            ]
        }
    )


def _regen(*object_ids: str) -> RegeneratedElements:
    return RegeneratedElements.model_validate(
        {
            "beats": [
                {
                    "beatId": oid,
                    "beatPlan": {
                        "whatHappens": f"FIXED {oid}",
                        "audienceLearns": "learns",
                        "audienceFeels": "feels",
                    },
                    "scriptText": f"FIXED SCRIPT {oid}",
                }
                for oid in object_ids
                if oid.startswith("beat-")
            ],
            "scenes": [
                {
                    "sceneId": oid,
                    "fields": {
                        "whatHappens": f"FIXED {oid}",
                        "audienceLearns": None,
                        "audienceFeels": None,
                        "location": None,
                        "time": None,
                        "socialSituation": None,
                    },
                }
                for oid in object_ids
                if oid.startswith("scene-")
            ],
            "continuityConflicts": [],
        }
    )


def _create(target: str = "scene-5"):
    return client.post(
        f"/api/v1/projects/{PROJECT_ID}/change-sets",
        json={"targetObjectId": target, "instruction": NOTE_FIX},
    )


def _post(cid: str, step: str, ids: list[str]):
    return client.post(f"/api/v1/change-sets/{cid}/{step}", json={"approvedObjectIds": ids})


def _doc(db_session) -> dict:
    db_session.expire_all()
    return copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)


def _episode(doc: dict) -> dict:
    return doc["seasons"][0]["episodes"][0]


def _scene(doc: dict, scene_id: str) -> dict:
    return next(s for s in _episode(doc)["scenes"] if s["id"] == scene_id)


def _lock(db_session, mutate) -> None:
    """Flip a lock in the live doc (no snapshot), as test_change_sets_apply_locks does."""
    project = db_session.get(ProjectRow, PROJECT_ID)
    doc = copy.deepcopy(project.doc)
    mutate(doc)
    project.doc = doc
    db_session.commit()


def _locked_by_id(created) -> dict[str, bool]:
    return {row["objectId"]: row["locked"] for row in created.json()["impacted"]}


def test_note_fix_never_previews_a_locked_beat(seeded_project, db_session, mock_llm):
    """The note is on unlocked scene-5; the classifier also names locked beat-1-2."""
    mock_llm.set_response(
        "classify_blast_radius", _blast(("scene", "scene-5"), ("beat", "beat-1-2"))
    )
    before = _doc(db_session)

    created = _create()
    assert created.status_code == 200
    cid = created.json()["id"]
    assert _locked_by_id(created) == {"scene-5": False, "beat-1-2": True}

    for ids in (["beat-1-2"], ["scene-5", "beat-1-2"]):
        resp = _post(cid, "preview", ids)
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert mock_llm.invocation_count("regenerate_elements") == 0

    # The model sneaks the locked beat into a preview of the unlocked scene.
    mock_llm.set_response("regenerate_elements", _regen("scene-5", "beat-1-2"))
    resp = _post(cid, "preview", ["scene-5"])
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "SCHEMA_INVALID_LLM"

    assert client.get(f"/api/v1/change-sets/{cid}").json()["preview"] is None
    assert _doc(db_session) == before


def test_note_fix_on_a_locked_scene_never_changes_it(seeded_project, db_session, mock_llm):
    """A client that ignores the hidden verb: the note's own scene is locked."""
    _lock(db_session, lambda doc: _scene(doc, "scene-5").update(locked=True))
    mock_llm.set_response(
        "classify_blast_radius",
        _blast(("scene", "scene-5"), ("beat", "beat-5-1"), ("beat", "beat-4-2")),
    )
    before = _doc(db_session)

    created = _create()
    assert created.status_code == 200  # a draft writes nothing
    cid = created.json()["id"]
    assert _locked_by_id(created) == {"scene-5": True, "beat-5-1": True, "beat-4-2": False}

    for ids in (["scene-5"], ["beat-5-1"]):
        resp = _post(cid, "preview", ids)
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert mock_llm.invocation_count("regenerate_elements") == 0

    mock_llm.set_response("regenerate_elements", _regen("beat-4-2"))
    assert _post(cid, "preview", ["beat-4-2"]).status_code == 200
    resp = _post(cid, "apply", ["beat-4-2", "beat-5-1"])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _doc(db_session) == before

    assert _post(cid, "apply", ["beat-4-2"]).status_code == 200
    after = _doc(db_session)
    assert _scene(after, "scene-5") == _scene(before, "scene-5")
    assert _scene(after, "scene-4") != _scene(before, "scene-4")  # the unlocked fix landed


def test_note_fix_in_a_locked_episode_changes_nothing(seeded_project, db_session, mock_llm):
    """Episode lock cascades: every regenerate row is locked, every preview refused."""
    _lock(db_session, lambda doc: _episode(doc).update(locked=True))
    before = _doc(db_session)

    created = _create()  # default mock blast: scene-2, beat-4-2, fact-02, scene-5
    assert created.status_code == 200
    cid = created.json()["id"]
    regenerate = [r for r in created.json()["impacted"] if r["applyMode"] == "regenerate"]
    assert regenerate and all(r["locked"] for r in regenerate)

    for row in regenerate:
        resp = _post(cid, "preview", [row["objectId"]])
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert mock_llm.invocation_count("regenerate_elements") == 0
    assert _doc(db_session) == before
