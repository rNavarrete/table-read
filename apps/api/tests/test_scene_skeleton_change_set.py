"""`initial_scene_skeleton` Change Set — create (candidate selection) +
apply, new-project-flow design spec §6/§9.4.

Selecting a candidate persists a ChangeSet already `previewing` (the
candidate IS the preview — CLAUDE.md rule 3: never write the plan directly
from generation). Apply maps `approvedObjectIds` (proposal ids) to
newly-assigned final scene/beat ids and writes exactly one snapshot.
MockLlmClient only (hard rule 1); this suite never calls generation, so it
constructs candidate payloads by hand (mirrors test_change_sets_apply_locks.py's
`_seed_preview` pattern of standing alone from the generation endpoint).
"""

from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from storage.models import ChangeSetRow, ProjectRow, SnapshotRow

client = TestClient(app)

PROJECT_ID = "proj-longpour"
NEW_PROJECT_BODY = {
    "title": "Fresh Idea",
    "format": {
        "genre": "drama",
        "runtimeMinutes": 30,
        "actCount": 3,
        "coldOpen": False,
        "tag": False,
        "serialization": 0.5,
    },
    "premise": "A test premise.",
    "foundation": {
        "characters": [{"name": "Ada", "traits": "sharp"}],
    },
}


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _candidate(head_snapshot_id: str, *, character_id: str = "char-marta") -> dict:
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
                        "characterId": character_id,
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
            },
            {
                "proposalId": "proposal-2",
                "act": 1,
                "storyline": "A",
                "location": "EXT. MARINA - DAY",
                "time": "DAY",
                "socialSituation": "Dan meets Reyes at the marina.",
                "whatHappens": "Dan tries to buy time from Reyes.",
                "audienceLearns": "Reyes is owed the money.",
                "audienceFeels": "Rising dread.",
                "motivations": [],
                "beatPlanSeeds": [
                    {
                        "whatHappens": "Dan offers a partial payment.",
                        "audienceLearns": "Dan is short.",
                        "audienceFeels": "Anxiety.",
                    }
                ],
            },
        ],
    }


def _select(head_snapshot_id: str, **kwargs) -> dict:
    return client.post(
        f"/api/v1/projects/{PROJECT_ID}/scene-skeleton/change-sets",
        json=_candidate(head_snapshot_id, **kwargs),
    )


# ── generation route (POST /projects/{pid}/scene-skeleton/candidates) ───────


def test_generate_candidates_route_returns_exactly_three(seeded_project, mock_llm):
    resp = client.post(f"/api/v1/projects/{PROJECT_ID}/scene-skeleton/candidates")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 3
    for candidate in body:
        assert candidate["basedOnSnapshotId"] == body[0]["basedOnSnapshotId"]
        for scene in candidate["scenes"]:
            assert "proposalId" in scene
            assert "scriptText" not in scene


# ── create (candidate selection) ────────────────────────────────────────────


def test_select_candidate_creates_previewing_change_set_never_writes_doc(
    seeded_project, db_session, mock_llm
):
    before = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)
    head = before["headSnapshotId"]

    resp = _select(head)
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "initial_scene_skeleton"
    assert body["status"] == "previewing"
    assert body["preview"] is not None
    assert body["preview"]["basedOnSnapshotId"] == head
    assert {s["proposalId"] for s in body["preview"]["sceneAdditions"]} == {
        "proposal-1",
        "proposal-2",
    }
    assert {row["objectId"] for row in body["impacted"]} == {"proposal-1", "proposal-2"}
    for row in body["impacted"]:
        assert row["applyMode"] == "add"
        assert row["locked"] is False

    db_session.expire_all()
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before


def test_select_candidate_with_stale_snapshot_returns_409(seeded_project, mock_llm):
    resp = _select("snap-does-not-exist-anymore")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "PREVIEW_STALE"


def test_select_candidate_with_unknown_character_id_returns_409_validation(
    seeded_project, mock_llm
):
    project_head = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["headSnapshotId"]
    resp = _select(project_head, character_id="char-nope")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "VALIDATION"


def test_preview_endpoint_rejects_initial_scene_skeleton_kind(seeded_project, mock_llm):
    head = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["headSnapshotId"]
    cid = _select(head).json()["id"]
    resp = client.post(
        f"/api/v1/change-sets/{cid}/preview", json={"approvedObjectIds": ["proposal-1"]}
    )
    assert resp.status_code == 409


# ── apply ─────────────────────────────────────────────────────────────────


def test_apply_all_maps_proposal_ids_to_new_final_scene_beat_ids_one_snapshot(
    seeded_project, db_session, mock_llm
):
    project = db_session.get(ProjectRow, PROJECT_ID)
    before_doc = copy.deepcopy(project.doc)
    before_scene_ids = {
        s["id"]
        for season in before_doc["seasons"]
        for episode in season["episodes"]
        for s in episode["scenes"]
    }
    before_snap_count = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()

    cid = _select(project.head_snapshot_id).json()["id"]
    resp = client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": ["proposal-1", "proposal-2"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["changeSet"]["status"] == "applied"
    assert body["consistencyFlags"] == []

    doc = body["project"]
    all_scenes = [s for season in doc["seasons"] for e in season["episodes"] for s in e["scenes"]]
    new_scenes = [s for s in all_scenes if s["id"] not in before_scene_ids]
    assert len(new_scenes) == 2
    for scene in new_scenes:
        # final scene id is server-assigned, never the proposalId
        assert scene["id"] not in ("proposal-1", "proposal-2")
        assert scene["storyline"] == "A"
        assert scene["locked"] is False
        for beat in scene["beats"]:
            assert beat["scriptText"] == ""  # hard rule: no scriptText in skeleton
            assert beat["locked"] is False and beat["scriptLocked"] is False

    db_session.expire_all()
    after_snap_count = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    assert after_snap_count == before_snap_count + 1  # exactly one snapshot


def test_apply_selective_subset_applies_only_the_approved_proposal(
    seeded_project, db_session, mock_llm
):
    project = db_session.get(ProjectRow, PROJECT_ID)
    before_doc = copy.deepcopy(project.doc)
    before_scene_ids = {
        s["id"]
        for season in before_doc["seasons"]
        for episode in season["episodes"]
        for s in episode["scenes"]
    }

    cid = _select(project.head_snapshot_id).json()["id"]
    resp = client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": ["proposal-1"]},
    )
    assert resp.status_code == 200
    doc = resp.json()["project"]
    all_scenes = [s for season in doc["seasons"] for e in season["episodes"] for s in e["scenes"]]
    new_scenes = [s for s in all_scenes if s["id"] not in before_scene_ids]
    assert len(new_scenes) == 1
    assert new_scenes[0]["location"] == "INT. THE LONG POUR - MORNING"


def test_apply_stale_basedonsnapshotid_returns_409(seeded_project, db_session, mock_llm):
    from llm.dependency import get_llm_client_provider

    project = db_session.get(ProjectRow, PROJECT_ID)
    cid = _select(project.head_snapshot_id).json()["id"]

    # Move the head via an unrelated PATCH so the stored preview goes stale.
    # A structural-field PATCH triggers scan_consistency, resolved via the
    # provider (not the plain get_llm_client override) — inject the same mock.
    app.dependency_overrides[get_llm_client_provider] = lambda: (lambda: mock_llm)
    try:
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
    finally:
        app.dependency_overrides.pop(get_llm_client_provider, None)

    db_session.expire_all()
    before = copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)
    resp = client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": ["proposal-1"]},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "PREVIEW_STALE"
    db_session.expire_all()
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before


def test_apply_unknown_proposal_id_returns_409_validation(seeded_project, db_session, mock_llm):
    project = db_session.get(ProjectRow, PROJECT_ID)
    cid = _select(project.head_snapshot_id).json()["id"]
    resp = client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": ["proposal-not-real"]},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "VALIDATION"


def test_discard_marks_scene_skeleton_change_set_discarded_without_mutating_project(
    seeded_project, db_session, mock_llm
):
    project = db_session.get(ProjectRow, PROJECT_ID)
    before = copy.deepcopy(project.doc)
    cid = _select(project.head_snapshot_id).json()["id"]

    resp = client.post(f"/api/v1/change-sets/{cid}/discard")
    assert resp.status_code == 200
    assert resp.json()["status"] == "discarded"

    db_session.expire_all()
    assert db_session.get(ProjectRow, PROJECT_ID).doc == before
    assert db_session.get(ChangeSetRow, cid).status == "discarded"


# ── fresh idea-path project: no seasons/episode yet ─────────────────────────


def test_apply_scaffolds_season_and_episode_when_project_has_none(mock_llm, db_session):
    create = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-0000000skel1"},
    )
    assert create.status_code == 201
    project_doc = create.json()
    project_id = project_doc["id"]
    assert project_doc["seasons"] == []  # idea-path create has no LLM call, no episode
    character_id = project_doc["seriesBible"]["characters"][0]["id"]

    candidate = _candidate(project_doc["headSnapshotId"], character_id=character_id)
    select = client.post(
        f"/api/v1/projects/{project_id}/scene-skeleton/change-sets", json=candidate
    )
    assert select.status_code == 200
    cid = select.json()["id"]

    apply_resp = client.post(
        f"/api/v1/change-sets/{cid}/apply",
        json={"approvedObjectIds": ["proposal-1", "proposal-2"]},
    )
    assert apply_resp.status_code == 200
    doc = apply_resp.json()["project"]
    assert len(doc["seasons"]) == 1
    assert doc["seasons"][0]["id"] == "season-1"
    episode = doc["seasons"][0]["episodes"][0]
    assert episode["id"] == "ep-1"
    assert len(episode["scenes"]) == 2
    assert [s["index"] for s in episode["scenes"]] == [0, 1]

    db_session.query(ProjectRow).filter_by(id=project_id).delete()
    db_session.commit()
