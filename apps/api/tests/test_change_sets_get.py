"""GET /change-sets/{cid} + GET /projects/{pid}/change-sets?status= (ruling 3).

Persistence reads for Change Sets — sessionStorage is cache only. No LLM.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app

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


def test_get_change_set_by_id(seeded_project, mock_llm):
    created = _create().json()
    cid = created["id"]

    resp = client.get(f"/api/v1/change-sets/{cid}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == cid
    assert body["projectId"] == PROJECT_ID
    assert body["status"] == "draft"
    assert body["instruction"] == MARINA_INSTRUCTION
    assert body["targetObjectId"] == "scene-2"
    assert body["preview"] is None
    assert isinstance(body["impacted"], list)


def test_get_change_set_missing_returns_404(seeded_project):
    resp = client.get("/api/v1/change-sets/cs-does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_list_project_change_sets(seeded_project, mock_llm):
    a = _create().json()
    b = _create(instruction="Alternate marina staging").json()

    resp = client.get(f"/api/v1/projects/{PROJECT_ID}/change-sets")

    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    ids = {cs["id"] for cs in body}
    assert a["id"] in ids and b["id"] in ids
    assert all(cs["projectId"] == PROJECT_ID for cs in body)


def test_list_project_change_sets_filters_by_status(seeded_project, mock_llm):
    draft = _create().json()
    # Discard a second one so status diverges.
    other = _create(instruction="Will discard").json()
    discard = client.post(f"/api/v1/change-sets/{other['id']}/discard")
    assert discard.status_code == 200
    assert discard.json()["status"] == "discarded"

    drafts = client.get(
        f"/api/v1/projects/{PROJECT_ID}/change-sets", params={"status": "draft"}
    )
    discarded = client.get(
        f"/api/v1/projects/{PROJECT_ID}/change-sets", params={"status": "discarded"}
    )

    assert drafts.status_code == 200
    assert discarded.status_code == 200
    draft_ids = {cs["id"] for cs in drafts.json()}
    discarded_ids = {cs["id"] for cs in discarded.json()}
    assert draft["id"] in draft_ids
    assert other["id"] not in draft_ids
    assert other["id"] in discarded_ids
    assert draft["id"] not in discarded_ids


def test_list_open_change_sets_includes_previewing(seeded_project, mock_llm):
    """Review picker filter `draft,previewing` keeps previewed Change Sets visible."""
    from schemas import RegeneratedElements

    draft = _create().json()
    previewing_id = _create(instruction="Will preview").json()["id"]
    mock_llm.set_response(
        "regenerate_elements",
        RegeneratedElements.model_validate(
            {
                "beats": [
                    {
                        "beatId": "beat-4-2",
                        "beatPlan": {
                            "whatHappens": "AFTER",
                            "audienceLearns": "x",
                            "audienceFeels": "y",
                        },
                        "scriptText": "SCRIPT",
                    }
                ],
                "scenes": [],
                "continuityConflicts": [],
            }
        ),
    )
    preview = client.post(
        f"/api/v1/change-sets/{previewing_id}/preview",
        json={"approvedObjectIds": ["beat-4-2"]},
    )
    assert preview.status_code == 200
    assert preview.json()["status"] == "previewing"

    open_list = client.get(
        f"/api/v1/projects/{PROJECT_ID}/change-sets",
        params={"status": "draft,previewing"},
    )
    assert open_list.status_code == 200
    open_ids = {cs["id"] for cs in open_list.json()}
    assert draft["id"] in open_ids
    assert previewing_id in open_ids
    by_id = {cs["id"]: cs for cs in open_list.json()}
    assert by_id[previewing_id]["status"] == "previewing"
    assert by_id[draft["id"]]["status"] == "draft"


def test_list_change_sets_unknown_project_404(seeded_project):
    resp = client.get("/api/v1/projects/proj-missing/change-sets")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"
