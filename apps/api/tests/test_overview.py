"""Unit tests for `drama_manager.overview.merge_story_overview` (T7.28)."""

from __future__ import annotations

from drama_manager.overview import merge_story_overview
from schemas import InferredStoryOverview


def _doc(
    *,
    premise: str = "",
    episode_premise: str = "",
    locked: bool = False,
    story_overview=None,
    scenes=None,
) -> dict:
    scenes = scenes or [
        {
            "id": "scene-1",
            "beats": [{"id": "beat-1-1", "whatHappens": "A"}],
        },
        {
            "id": "scene-2",
            "beats": [{"id": "beat-2-1", "whatHappens": "B"}],
        },
    ]
    return {
        "premise": premise,
        "seasons": [
            {
                "id": "season-1",
                "episodes": [
                    {
                        "id": "ep-1",
                        "locked": locked,
                        "premise": episode_premise,
                        "scenes": scenes,
                        "storyOverview": story_overview,
                    }
                ],
            }
        ],
    }


def overview(**overrides) -> InferredStoryOverview:
    base = {
        "logline": (
            "When a lighthouse keeper finds an unsent letter, she must decide "
            "whether to deliver it before the tide turns."
        ),
        "outline": [
            {"sceneId": "scene-1", "summary": "Nora finds the letter."},
            {"sceneId": "scene-2", "summary": "Cass refuses to let go."},
        ],
        "beatSheet": [
            {
                "beatId": "beat-1-1",
                "label": "Inciting Incident",
                "summary": "The letter surfaces.",
                "sceneId": "scene-1",
            },
            {
                "beatId": "beat-2-1",
                "label": "Climax",
                "summary": "Cass yields the compass.",
                "sceneId": "scene-2",
            },
        ],
        "summary": (
            "Nora discovers an unsent letter that binds her to Cass.\n\n"
            "She confronts Cass and the debt is paid as the tide turns."
        ),
    }
    base.update(overrides)
    return InferredStoryOverview.model_validate(base)


def test_merge_attaches_overview_and_backfills_empty_premises():
    doc = _doc()
    result = merge_story_overview(doc, "ep-1", overview())
    ep = result["seasons"][0]["episodes"][0]
    ov = ep["storyOverview"]
    assert ov["logline"].startswith("When a lighthouse")
    assert len(ov["outline"]) == 2
    assert len(ov["beatSheet"]) == 2
    assert ov["provenance"] == "inferred"
    assert ov["locked"] is False
    assert "\n\n" in ov["summary"]
    assert result["premise"] == ov["logline"]
    assert ep["premise"] == ov["logline"]


def test_merge_does_not_overwrite_nonempty_premises():
    doc = _doc(premise="Series premise.", episode_premise="Episode premise.")
    merge_story_overview(doc, "ep-1", overview())
    assert doc["premise"] == "Series premise."
    assert doc["seasons"][0]["episodes"][0]["premise"] == "Episode premise."


def test_merge_drops_unknown_scene_and_beat_ids():
    doc = _doc()
    result = merge_story_overview(
        doc,
        "ep-1",
        overview(
            outline=[
                {"sceneId": "scene-1", "summary": "ok"},
                {"sceneId": "scene-99", "summary": "ghost"},
            ],
            beatSheet=[
                {
                    "beatId": "beat-1-1",
                    "label": "Hook",
                    "summary": "ok",
                    "sceneId": "scene-1",
                },
                {
                    "beatId": "beat-99-1",
                    "label": "Fake",
                    "summary": "ghost",
                    "sceneId": "scene-1",
                },
            ],
        ),
    )
    ov = result["seasons"][0]["episodes"][0]["storyOverview"]
    assert [r["sceneId"] for r in ov["outline"]] == ["scene-1"]
    assert [r["beatId"] for r in ov["beatSheet"]] == ["beat-1-1"]


def test_merge_preserves_locked_overview():
    prior = {
        "logline": "Prior logline.",
        "outline": [],
        "beatSheet": [],
        "summary": "A.\n\nB.",
        "provenance": "writer_authored",
        "locked": True,
    }
    doc = _doc(story_overview=prior)
    merge_story_overview(doc, "ep-1", overview())
    assert doc["seasons"][0]["episodes"][0]["storyOverview"] == prior


def test_merge_preserves_when_episode_locked():
    prior = {
        "logline": "Prior.",
        "outline": [],
        "beatSheet": [],
        "summary": "A.\n\nB.",
        "provenance": "inferred",
        "locked": False,
    }
    doc = _doc(locked=True, story_overview=prior)
    merge_story_overview(doc, "ep-1", overview())
    assert doc["seasons"][0]["episodes"][0]["storyOverview"] == prior
