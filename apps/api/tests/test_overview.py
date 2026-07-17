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
            "audienceLearns": "The briefing is a stall.",
            "audienceFeels": "Unease",
            "scriptExcerpt": "BARTLET\nGet me Meet the Press.",
        }
    ]
    beats = [
        {
            "beatId": "beat-1-1",
            "sceneId": "scene-1",
            "whatHappens": "Bartlet pivots the briefing.",
            "audienceLearns": "The briefing is a stall.",
            "audienceFeels": "Unease",
        }
    ]
    _system, user = build_overview_prompt(
        project, spine, beats, new_nonce(), known_cast=["Bartlet", "Leo"]
    )
    assert "scene_spine" in user
    assert "show_format" in user
    assert "known_cast" in user
    assert "Act One Turn" in user
    assert "HARD BAN" in user
    assert "Inciting Incident" in user
    assert "Climactic Reversal" in user
    assert "Act Two Opening" in user
    assert "never emit" in user or "HARD BAN" in user
    assert "Tag (ONLY when tag is true" in user
    assert "whatHappens" in user
    assert "location-theater" in user or "becomes a space for" in user
    assert "scriptExcerpt" in user
    assert "CONTENT QUALITY" in user


def test_merge_replaces_location_theater_outline_with_beat_what_happens():
    from drama_manager.overview import is_location_theater

    assert is_location_theater(
        "Action shifts to the Oval Office, raising the stakes.",
        "INT. OVAL OFFICE",
    )
    assert not is_location_theater(
        "Bartlet cancels Meet the Press after the bike accident.",
        "INT. OVAL OFFICE",
    )

    doc = _doc(
        scenes=[
            {
                "id": "scene-1",
                "act": 1,
                "index": 0,
                "location": "INT. OVAL OFFICE",
                "beats": [
                    {
                        "id": "beat-1-1",
                        "whatHappens": "Bartlet cancels Meet the Press.",
                    }
                ],
            },
            {
                "id": "scene-2",
                "act": 2,
                "index": 1,
                "location": "EXT. WHITE HOUSE",
                "beats": [
                    {
                        "id": "beat-2-1",
                        "whatHappens": "Josh briefs Leo on the bike accident.",
                    }
                ],
            },
        ]
    )
    merge_story_overview(
        doc,
        "ep-1",
        overview(
            outline=[
                {
                    "sceneId": "scene-1",
                    "summary": "The Oval Office becomes a space for confrontation.",
                },
                {
                    "sceneId": "scene-2",
                    "summary": "Josh briefs Leo on the bike accident.",
                },
            ],
            beatSheet=[
                {
                    "beatId": "beat-1-1",
                    "label": "Cold Open",
                    "summary": "Action shifts to the Oval Office, raising the stakes.",
                    "sceneId": "scene-1",
                    "act": 1,
                },
                {
                    "beatId": "beat-2-1",
                    "label": "Act One Turn",
                    "summary": "Josh briefs Leo on the bike accident.",
                    "sceneId": "scene-2",
                    "act": 2,
                },
            ],
        ),
    )
    ov = doc["seasons"][0]["episodes"][0]["storyOverview"]
    assert ov["outline"][0]["summary"] == "Bartlet cancels Meet the Press."
    assert ov["outline"][1]["summary"] == "Josh briefs Leo on the bike accident."
    assert ov["beatSheet"][0]["summary"] == "Bartlet cancels Meet the Press."
    assert ov["beatSheet"][1]["summary"] == "Josh briefs Leo on the bike accident."


def test_overview_prompt_inputs_include_learns_feels_and_excerpt():
    from fountain.pipeline import _overview_prompt_inputs

    spine, beats = _overview_prompt_inputs(
        [
            {
                "id": "scene-1",
                "act": 0,
                "location": "INT. OVAL OFFICE",
                "whatHappens": "",
                "beats": [
                    {
                        "id": "beat-1-1",
                        "whatHappens": "Bartlet pivots.",
                        "audienceLearns": "The stall is deliberate.",
                        "audienceFeels": "Tension",
                        "scriptText": "BARTLET\nCancel it.\nLEO\nSir.",
                    }
                ],
            }
        ]
    )
    assert spine[0]["whatHappens"] == "Bartlet pivots."
    assert spine[0]["audienceLearns"] == "The stall is deliberate."
    assert spine[0]["audienceFeels"] == "Tension"
    assert "Cancel it." in spine[0]["scriptExcerpt"]
    assert beats[0]["audienceLearns"] == "The stall is deliberate."


def test_merge_rewrites_banned_film_labels_and_coerces_tag_act():
    from drama_manager.overview import coerce_beat_label_and_act, is_banned_film_label

    assert is_banned_film_label("Inciting Incident")
    assert is_banned_film_label("Midpoint")
    assert is_banned_film_label("Climactic Reversal")
    assert is_banned_film_label("Act Two Opening")
    assert not is_banned_film_label("Act Two Turn")

    fmt = {
        "genre": "drama",
        "runtimeMinutes": 60,
        "actCount": 4,
        "coldOpen": True,
        "tag": True,
        "serialization": 0.5,
    }
    assert coerce_beat_label_and_act("Inciting Incident", 1, fmt) == (
        "Act One Turn",
        1,
    )
    assert coerce_beat_label_and_act("Midpoint", 2, fmt) == ("Act Two Turn", 2)
    assert coerce_beat_label_and_act("Tag", 4, fmt) == ("Tag", None)
    assert coerce_beat_label_and_act("Cold Open", 2, fmt) == ("Cold Open", 0)

    doc = _doc(
        scenes=[
            {
                "id": "scene-1",
                "act": 1,
                "index": 0,
                "location": "INT. OVAL OFFICE",
                "beats": [{"id": "beat-1-1", "whatHappens": "Bartlet cancels."}],
            },
            {
                "id": "scene-hall",
                "act": 3,
                "index": 1,
                "location": "INT. MAIN HALL",
                "beats": [
                    {
                        "id": "beat-hall-1",
                        "whatHappens": "Staff walk the Main Hall after the vote.",
                    }
                ],
            },
            {
                "id": "scene-2",
                "act": 4,
                "index": 2,
                "location": "INT. MAP ROOM",
                "beats": [
                    {
                        "id": "beat-2-1",
                        "whatHappens": "CJ closes the night in the Map Room.",
                    }
                ],
            },
        ]
    )
    doc["format"] = fmt
    merge_story_overview(
        doc,
        "ep-1",
        overview(
            beatSheet=[
                {
                    "beatId": "beat-1-1",
                    "label": "Inciting Incident",
                    "summary": "Bartlet cancels Meet the Press.",
                    "sceneId": "scene-1",
                    "act": 1,
                },
                {
                    "beatId": "beat-2-1",
                    "label": "Tag",
                    "summary": "Staff walk the Main Hall after the vote.",
                    "sceneId": "scene-2",
                    "act": 4,
                },
            ],
            outline=[
                {"sceneId": "scene-1", "summary": "Bartlet cancels."},
                {"sceneId": "scene-2", "summary": "Map Room close."},
            ],
        ),
    )
    rows = doc["seasons"][0]["episodes"][0]["storyOverview"]["beatSheet"]
    by_id = {r["beatId"]: r for r in rows}
    assert by_id["beat-1-1"]["label"] == "Act One Turn"
    assert by_id["beat-1-1"]["act"] == 1
    assert by_id["beat-2-1"]["label"] == "Tag"
    assert by_id["beat-2-1"]["act"] is None
    # Tag prose drifted to Main Hall; prefer Map Room beat whatHappens.
    assert by_id["beat-2-1"]["summary"] == "CJ closes the night in the Map Room."


def test_merge_normalizes_literal_backslash_n_in_summary():
    doc = _doc()
    merge_story_overview(
        doc,
        "ep-1",
        overview(
            summary=(
                "Nora finds the letter and weighs the cost.\\n\\n"
                "She confronts Cass as the tide turns."
            )
        ),
    )
    summary = doc["seasons"][0]["episodes"][0]["storyOverview"]["summary"]
    assert "\\n" not in summary
    assert "\n\n" in summary
    assert len([p for p in summary.split("\n\n") if p.strip()]) == 2
