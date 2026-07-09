"""Lock / flag_only enforcement for Change Set apply — CLAUDE.md rule 2.

Authored BEFORE the preview/apply feature tests (rule 2 ordering): apply must
never write a locked or `flag_only` id. Both cases → 409, project doc
byte-identical to the pre-apply state.
"""

from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from storage.models import ChangeSetRow, ProjectRow

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


def _seed_preview(db_session, change_set_id: str, *, beat_ids: list[str], scene_ids: list[str]):
    """Inject a typed preview so apply can be exercised without the preview
    endpoint (lock tests must stand alone — rule 2 ordering)."""
    project = db_session.get(ProjectRow, PROJECT_ID)
    row = db_session.get(ChangeSetRow, change_set_id)
    doc = copy.deepcopy(row.doc)
    doc["preview"] = {
        "beatUpdates": [
            {
                "beatId": bid,
                "beatPlan": {
                    "whatHappens": f"Regenerated plan for {bid}.",
                    "audienceLearns": "x",
                    "audienceFeels": "y",
                },
                "scriptText": f"SCRIPT for {bid}",
            }
            for bid in beat_ids
        ],
        "sceneUpdates": [
            {
                "sceneId": sid,
                "fields": {
                    "whatHappens": f"Regenerated scene {sid}.",
                    "audienceLearns": None,
                    "audienceFeels": None,
                    "location": None,
                    "time": None,
                    "socialSituation": None,
                },
            }
            for sid in scene_ids
        ],
        "continuityConflicts": [],
        "basedOnSnapshotId": project.head_snapshot_id,
        "generatedAt": "2026-01-01T00:00:00Z",
    }
    doc["status"] = "previewing"
    row.doc = doc
    row.status = "previewing"
    db_session.commit()


def _lock_beat(db_session, beat_id: str) -> None:
    project = db_session.get(ProjectRow, PROJECT_ID)
    doc = copy.deepcopy(project.doc)
    for season in doc["seasons"]:
        for episode in season["episodes"]:
            for scene in episode["scenes"]:
                for beat in scene.get("beats", []):
                    if beat["id"] == beat_id:
                        beat["locked"] = True
    project.doc = doc
    db_session.commit()


# ── the non-negotiable: apply never writes locked / flag_only ids ─────────────


def test_apply_with_locked_id_returns_409_and_project_unchanged(
    seeded_project, db_session, mock_llm
):
    """Accept (T4.2): apply with a locked objectId → 409, zero mutations."""
    create = _create()
    assert create.status_code == 200
    cid = create.json()["id"]
    _seed_preview(db_session, cid, beat_ids=["beat-4-2"], scene_ids=["scene-2"])

    before = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)
    _lock_beat(db_session, "beat-4-2")
    # Re-seed basedOnSnapshotId after the lock edit (lock edit isn't snapshotted
    # here — we only mutate the live doc for the lock flag). Refresh head match.
    project = db_session.get(ProjectRow, PROJECT_ID)
    row = db_session.get(ChangeSetRow, cid)
    doc = copy.deepcopy(row.doc)
    doc["preview"]["basedOnSnapshotId"] = project.head_snapshot_id
    # Annotate locked on the impacted row so apply sees the live lock state.
    for hit in doc["impacted"]:
        if hit["objectId"] == "beat-4-2":
            hit["locked"] = True
    row.doc = doc
    db_session.commit()

    resp = client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": ["beat-4-2"]},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"

    db_session.expire_all()
    after = db_session.get(ProjectRow, PROJECT_ID).doc
    # Strip the lock we planted so equality checks the rest of the doc; the
    # lock itself is the only intentional pre-apply mutation.
    after_unlocked = copy.deepcopy(after)
    for season in after_unlocked["seasons"]:
        for episode in season["episodes"]:
            for scene in episode["scenes"]:
                for beat in scene.get("beats", []):
                    if beat["id"] == "beat-4-2":
                        beat["locked"] = False
    before_cmp = copy.deepcopy(before)
    assert after_unlocked == before_cmp


def test_apply_with_flag_only_id_returns_409_and_project_unchanged(
    seeded_project, db_session, mock_llm
):
    """Accept (T4.2): apply request containing a flag_only id → 409, unchanged."""
    create = _create()
    assert create.status_code == 200
    cid = create.json()["id"]
    _seed_preview(db_session, cid, beat_ids=["beat-4-2"], scene_ids=["scene-2"])

    before = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)

    resp = client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": ["fact-02"]},
    )
    assert resp.status_code == 409
    # flag_only is not a lock, but still a hard apply rejection.
    assert resp.json()["error"]["code"] in ("LOCKED_OBJECT", "VALIDATION")

    db_session.expire_all()
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before
