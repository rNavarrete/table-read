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
            "act": 1,
            "index": 0,
            "beats": [{"id": "beat-1-1", "whatHappens": "A"}],
        },
        {
            "id": "scene-2",
            "act": 2,
            "index": 1,
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
                "label": "Act One Turn",
                "summary": "The letter surfaces.",
                "sceneId": "scene-1",
                "act": 1,
            },
            {
                "beatId": "beat-2-1",
                "label": "Climax",
                "summary": "Cass yields the compass.",
                "sceneId": "scene-2",
                "act": 2,
            },
        ],
        "summary": (
            "Nora discovers an unsent letter that binds her to Cass.\n\n"
            "She confronts Cass and the debt is paid as the tide turns."
        ),
    }
    base.update(overrides)
    for row in base.get("beatSheet") or []:
        row.setdefault("act", None)
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


def test_merge_resolves_scene_id_from_beat_and_coerces_act():
    """LLM sceneId/act are not authoritative — parent beat's scene wins."""
    doc = _doc(
        scenes=[
            {
                "id": "scene-1",
                "act": 0,
                "index": 0,
                "beats": [{"id": "beat-1-1", "whatHappens": "A"}],
            },
            {
                "id": "scene-2",
                "act": 2,
                "index": 1,
                "beats": [{"id": "beat-2-1", "whatHappens": "B"}],
            },
        ]
    )
    merge_story_overview(
        doc,
        "ep-1",
        overview(
            beatSheet=[
                {
                    "beatId": "beat-2-1",
                    "label": "Act Two Out",
                    "summary": "Cass yields.",
                    "sceneId": "scene-1",  # wrong on purpose
                    "act": 0,  # wrong on purpose
                },
            ],
            outline=[{"sceneId": "scene-2", "summary": "ok"}],
        ),
    )
    row = doc["seasons"][0]["episodes"][0]["storyOverview"]["beatSheet"][0]
    assert row["sceneId"] == "scene-2"
    assert row["act"] == 2


def test_merge_sorts_beat_sheet_by_scene_then_beat_order():
    doc = _doc(
        scenes=[
            {
                "id": "scene-1",
                "act": 1,
                "index": 0,
                "beats": [
                    {"id": "beat-1-1", "whatHappens": "A"},
                    {"id": "beat-1-2", "whatHappens": "A2"},
                ],
            },
            {
                "id": "scene-2",
                "act": 2,
                "index": 1,
                "beats": [{"id": "beat-2-1", "whatHappens": "B"}],
            },
        ]
    )
    merge_story_overview(
        doc,
        "ep-1",
        overview(
            beatSheet=[
                {
                    "beatId": "beat-2-1",
                    "label": "Climax",
                    "summary": "end",
                    "sceneId": "scene-2",
                },
                {
                    "beatId": "beat-1-2",
                    "label": "Turn",
                    "summary": "mid",
                    "sceneId": "scene-1",
                },
                {
                    "beatId": "beat-1-1",
                    "label": "Teaser",
                    "summary": "start",
                    "sceneId": "scene-1",
                },
            ],
            outline=[
                {"sceneId": "scene-1", "summary": "a"},
                {"sceneId": "scene-2", "summary": "b"},
            ],
        ),
    )
    ids = [
        r["beatId"]
        for r in doc["seasons"][0]["episodes"][0]["storyOverview"]["beatSheet"]
    ]
    assert ids == ["beat-1-1", "beat-1-2", "beat-2-1"]


def test_merge_dedupes_duplicate_beat_ids_keeps_first():
    doc = _doc()
    merge_story_overview(
        doc,
        "ep-1",
        overview(
            beatSheet=[
                {
                    "beatId": "beat-1-1",
                    "label": "Teaser",
                    "summary": "first",
                    "sceneId": "scene-1",
                },
                {
                    "beatId": "beat-1-1",
                    "label": "Hook",
                    "summary": "duplicate",
                    "sceneId": "scene-1",
                },
                {
                    "beatId": "beat-2-1",
                    "label": "Climax",
                    "summary": "end",
                    "sceneId": "scene-2",
                },
            ],
        ),
    )
    rows = doc["seasons"][0]["episodes"][0]["storyOverview"]["beatSheet"]
    assert [r["beatId"] for r in rows] == ["beat-1-1", "beat-2-1"]
    assert rows[0]["summary"] == "first"
    assert rows[0]["label"] == "Teaser"


def test_overview_prompt_uses_tv_act_grammar_and_spine():
    from drama_manager.render import build_overview_prompt, new_nonce

    project = {
        "title": "West Wing Sample",
        "format": {
            "genre": "drama",
            "runtimeMinutes": 60,
            "actCount": 5,
            "coldOpen": True,
            "tag": True,
            "serialization": 0.8,
        },
    }
    spine = [
        {
            "sceneId": "scene-1",
            "act": 0,
            "location": "THE OVAL OFFICE",
            "whatHappens": "Bartlet pivots the briefing.",
        }
    ]
    beats = [
        {
            "beatId": "beat-1-1",
            "sceneId": "scene-1",
            "whatHappens": "Bartlet pivots the briefing.",
        }
    ]
    _system, user = build_overview_prompt(project, spine, beats, new_nonce())
    assert "scene_spine" in user
    assert "show_format" in user
    assert "Act N Turn" in user or "Act N Out" in user
    assert "Save-the-Cat" in user or "Save the Cat" in user or "feature-only" in user
    assert "Hook, Inciting" not in user
    assert "whatHappens" in user
