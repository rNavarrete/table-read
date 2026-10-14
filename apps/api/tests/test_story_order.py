"""Story order is (act, index), never the scenes array's own order.

Plan moves rewrite a scene's `act` / `index` and leave `episode.scenes` alone,
so every consumer that orders, numbers or slices scenes — export, the ledger's
as-of filter, and the scene lists LLM prompts read — must go through
`locks.scenes_in_story_order`. Each test here uses a doc whose array order
differs from its story order, so it fails on an array-ordered consumer.
"""

from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from drama_manager import change_sets, locks, render, scan, scene_skeleton
from drama_manager.narrative_map_analysis import prepare_narrative_map_source
from fountain.export import to_fountain
from llm.dependency import get_llm_client, get_llm_client_provider
from llm.mock import MockLlmClient
from main import app
from schemas import RegeneratedElements
from storage.seed import load_fixture, seed_envelope

# Plan's insert of scene-4 before scene-2 (index renumbered to board
# position, scene-4 takes Act 1); the stored array is still scene-1…6.
STORY = ["scene-1", "scene-4", "scene-2", "scene-3", "scene-5", "scene-6"]


def _moved(doc: dict) -> dict:
    doc = copy.deepcopy(doc)
    scenes = {s["id"]: s for s in doc["seasons"][0]["episodes"][0]["scenes"]}
    scenes["scene-4"].update(act=1, index=1)
    scenes["scene-2"]["index"] = 2
    scenes["scene-3"]["index"] = 3
    return doc


def _project() -> dict:
    return _moved(load_fixture()["project"])


def _episode(doc: dict) -> dict:
    return doc["seasons"][0]["episodes"][0]


def test_scenes_in_story_order_sorts_by_act_then_index_and_keeps_ties_stable():
    episode = _episode(_project())

    assert [s["id"] for s in locks.scenes_in_story_order(episode)] == STORY
    # The stored array is untouched.
    assert [s["id"] for s in episode["scenes"]] == [f"scene-{n}" for n in range(1, 7)]
    tied = {"scenes": [{"id": "b", "act": 1, "index": 0}, {"id": "a", "act": 1, "index": 0}]}
    assert [s["id"] for s in locks.scenes_in_story_order(tied)] == ["b", "a"]


def test_fountain_export_is_in_story_order():
    text = to_fountain(_project())

    # scene-4 opens on Harbor Street; scene-2 is the basement.
    assert text.index("EXT. HARBOR STREET - NIGHT") < text.index(
        "INT. THE LONG POUR - BASEMENT - NIGHT"
    )


def test_ledger_as_of_scene_uses_story_order(db_session):
    envelope = copy.deepcopy(load_fixture())
    envelope["project"] = _moved(envelope["project"])
    seed_envelope(db_session, envelope)

    response = TestClient(app).get(
        "/api/v1/projects/proj-longpour/ledger", params={"asOfScene": "scene-4"}
    )

    assert response.status_code == 200
    # scene-4 now plays second: scene-1's facts and its own, not scene-2's
    # (fact-02) or scene-3's (fact-07/08).
    assert {f["id"] for f in response.json()} == {
        "fact-01",
        "fact-03",
        "fact-04",
        "fact-05",
        "fact-06",
    }


def test_consistency_scan_scene_plans_are_in_story_order():
    doc = _project()

    assert [s["id"] for s in scan.untouched_scene_plans(doc)] == STORY
    assert [s["id"] for s in scan.untouched_scene_plans(doc, {"scene-4"})] == [
        s for s in STORY if s != "scene-4"
    ]


def test_change_set_prompt_scene_lists_are_in_story_order():
    doc = _project()

    plan = change_sets._compact_episode_plan(doc)
    assert [s["id"] for s in plan["episodes"][0]["scenes"]] == STORY
    neighbors = change_sets._neighbor_scene_summaries(doc, {"scene-2"})
    assert [s["id"] for s in neighbors] == [s for s in STORY if s != "scene-2"]


def test_scene_skeleton_existing_scenes_are_in_story_order(monkeypatch):
    seen: list[list[str]] = []
    original = render.build_scene_skeleton_prompt

    def spy(project, **kwargs):
        seen.append([s["id"] for s in kwargs["existing_scenes"]])
        return original(project, **kwargs)

    monkeypatch.setattr(render, "build_scene_skeleton_prompt", spy)
    scene_skeleton.generate_candidates(_project(), MockLlmClient(), count=1)

    assert seen == [STORY]


def test_narrative_map_source_is_in_story_order_and_a_reorder_changes_its_hash():
    source = prepare_narrative_map_source(_project())

    # scene-5 and scene-6 have no script yet, so they are stubs.
    assert [s["sceneId"] for s in source.scene_sources] == STORY[:4]
    # Swapping two scenes inside one act changes nothing but `index`, and the
    # map's scene order with it: the source hash must notice.
    unmoved = load_fixture()["project"]
    swapped = copy.deepcopy(unmoved)
    scenes = {s["id"]: s for s in _episode(swapped)["scenes"]}
    scenes["scene-2"]["index"], scenes["scene-3"]["index"] = 2, 1
    assert (
        prepare_narrative_map_source(swapped).source_hash
        != prepare_narrative_map_source(unmoved).source_hash
    )


_PLAN = {"whatHappens": "x", "audienceLearns": "x", "audienceFeels": "x"}


def _post_accept(c: TestClient, _llm: MockLlmClient):
    candidate = {
        "label": "The arrest",
        "beatPlan": _PLAN,
        "scriptText": "DAN\nThis is a mistake.",
        "continuityConflicts": [],
    }
    return c.post(
        "/api/v1/projects/proj-longpour/scenes/scene-3/beats",
        json={"candidate": candidate, "afterBeatId": "beat-3-1"},
    )


def _patch_structural(c: TestClient, _llm: MockLlmClient):
    path = "/seasons/0/episodes/0/scenes/2/whatHappens"
    return c.patch(
        "/api/v1/projects/proj-longpour", json=[{"op": "replace", "path": path, "value": "x"}]
    )


def _apply_change_set(c: TestClient, llm: MockLlmClient):
    llm.set_response(
        "regenerate_elements",
        RegeneratedElements.model_validate(
            {
                "beats": [{"beatId": "beat-4-2", "beatPlan": _PLAN, "scriptText": "x"}],
                "scenes": [],
                "continuityConflicts": [],
            }
        ),
    )
    cid = c.post(
        "/api/v1/projects/proj-longpour/change-sets",
        json={"targetObjectId": "scene-2", "instruction": "Dan hides the money at the marina"},
    ).json()["id"]
    approved = {"approvedObjectIds": ["beat-4-2"]}
    assert c.post(f"/api/v1/change-sets/{cid}/preview", json=approved).status_code == 200
    return c.post(f"/api/v1/change-sets/{cid}/apply", json=approved)


@pytest.mark.parametrize(
    "run",
    [_post_accept, _patch_structural, _apply_change_set],
    ids=["accept", "direct-edit", "change-set-apply"],
)
def test_consistency_scan_callers_send_scene_plans_in_story_order(db_session, monkeypatch, run):
    envelope = copy.deepcopy(load_fixture())
    envelope["project"] = _moved(envelope["project"])
    seed_envelope(db_session, envelope)
    seen: list[list[str]] = []
    original = render.build_scan_prompt

    def spy(doc, change_summary, untouched, *args):
        seen.append([s["id"] for s in untouched])
        return original(doc, change_summary, untouched, *args)

    monkeypatch.setattr(render, "build_scan_prompt", spy)
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    app.dependency_overrides[get_llm_client_provider] = lambda: (lambda: llm)
    try:
        assert run(TestClient(app), llm).status_code == 200
    finally:
        app.dependency_overrides.pop(get_llm_client, None)
        app.dependency_overrides.pop(get_llm_client_provider, None)

    assert seen == [STORY]
