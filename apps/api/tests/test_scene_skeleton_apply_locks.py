"""Lock enforcement for `initial_scene_skeleton` Change Set apply —
CLAUDE.md rule 2 (zero tolerance), new-project-flow design spec §6/§9.4.

Authored BEFORE the feature tests (test_scene_skeleton.py /
test_scene_skeleton_change_set.py), per rule 2 ordering: a locked episode is
structurally frozen ("no scene added to/removed from a locked episode" —
drama_manager/locks.py), so apply must never insert a proposed scene into
one. 409 LOCKED_OBJECT, project doc byte-identical to the pre-apply state.
"""

from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from storage.models import ProjectRow

client = TestClient(app)

PROJECT_ID = "proj-longpour"


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _candidate(head_snapshot_id: str) -> dict:
    return {
        "candidateId": "skel-test",
        "basedOnSnapshotId": head_snapshot_id,
        "label": "Cold open on the wire transfer",
        "scenes": [
            {
                "proposalId": "proposal-1",
                "act": 1,
                "storyline": "A",
                "location": "INT. THE LONG POUR - MORNING",
                "time": "MORNING",
                "socialSituation": "Marta corners Dan before the bar opens.",
                "whatHappens": "Marta demands Dan explain the wire transfer.",
                "audienceLearns": "Marta has the paperwork.",
                "audienceFeels": "Tense.",
                "motivations": [
                    {
                        "characterId": "char-marta",
                        "objective": "Get Dan to admit the transfer.",
                        "stakes": "The bar's survival.",
                        "obstacle": "Dan's practiced calm.",
                    }
                ],
                "beatPlanSeeds": [
                    {
                        "whatHappens": "Marta slides the printout across the bar.",
                        "audienceLearns": "The transfer amount.",
                        "audienceFeels": "Dread.",
                    }
                ],
            }
        ],
    }


def _lock_episode(db_session) -> None:
    project = db_session.get(ProjectRow, PROJECT_ID)
    doc = copy.deepcopy(project.doc)
    doc["seasons"][0]["episodes"][0]["locked"] = True
    project.doc = doc
    db_session.commit()


def test_apply_scene_skeleton_into_locked_episode_returns_409_and_project_unchanged(
    seeded_project, db_session, mock_llm
):
    project = db_session.get(ProjectRow, PROJECT_ID)
    head = project.head_snapshot_id

    create = client.post(
        f"/api/v1/projects/{PROJECT_ID}/scene-skeleton/change-sets",
        json=_candidate(head),
    )
    assert create.status_code == 200
    cid = create.json()["id"]
    assert create.json()["kind"] == "initial_scene_skeleton"

    _lock_episode(db_session)
    db_session.expire_all()
    before = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)

    resp = client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": ["proposal-1"]},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"

    db_session.expire_all()
    after = db_session.get(ProjectRow, PROJECT_ID).doc
    assert after == before


def test_apply_scene_skeleton_row_locked_flag_returns_409_and_project_unchanged(
    seeded_project, db_session, mock_llm
):
    """Same guarantee even if only the ChangeSet's own annotated `locked`
    flag (set at creation from the episode's lock state) says so — belt and
    suspenders alongside the live-doc check."""
    project = db_session.get(ProjectRow, PROJECT_ID)
    head = project.head_snapshot_id

    _lock_episode(db_session)
    db_session.expire_all()

    create = client.post(
        f"/api/v1/projects/{PROJECT_ID}/scene-skeleton/change-sets",
        json=_candidate(head),
    )
    assert create.status_code == 200
    cid = create.json()["id"]
    assert create.json()["impacted"][0]["locked"] is True

    before = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)
    resp = client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": ["proposal-1"]},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"

    db_session.expire_all()
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before
