"""Unit tests for `drama_manager.overview.merge_story_overview` (T7.28)."""

from __future__ import annotations

import logging

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


# ── T10.6 contract: About, lead arcs and story time ─────────────────────────


def test_pre_t10_6_overview_and_episode_load_with_defaults():
    from schemas import Episode, StoryOverview

    ov = StoryOverview.model_validate(
        {
            "logline": "l",
            "outline": [{"sceneId": "scene-1", "summary": "s"}],
            "beatSheet": [],
            "summary": "s",
        }
    )
    assert (ov.dramatic_question, ov.central_argument, ov.anti_theme) == ("", "", "")
    row = ov.outline[0]
    assert (row.story_order, row.story_time, row.anachrony) == (None, "", "none")
    episode = Episode.model_validate(
        {"id": "ep-1", "index": 0, "title": "t", "premise": "", "storylines": [], "scenes": []}
    )
    assert episode.character_arcs == []


def test_t10_6_fields_round_trip_and_reject_bad_values():
    import pytest
    from pydantic import ValidationError

    from schemas import Episode, StoryOverview

    full = {
        "logline": "l",
        "outline": [
            {
                "sceneId": "scene-1",
                "summary": "s",
                "storyOrder": 1,
                "storyTime": "Eight years earlier",
                "anachrony": "flashback",
            }
        ],
        "beatSheet": [],
        "summary": "s",
        "dramaticQuestion": "Will Marta learn the truth?",
        "centralArgument": "Trust requires disclosure.",
        "antiTheme": "Family covers for family.",
    }
    dumped = StoryOverview.model_validate(full).model_dump(by_alias=True, mode="json")
    assert {k: dumped[k] for k in full} == full
    for bad in ({"anachrony": "sideways"}, {"storyOrder": -1}):
        with pytest.raises(ValidationError):
            StoryOverview.model_validate({**full, "outline": [{**full["outline"][0], **bad}]})
    arc = {
        "characterId": "char-marta",
        "want": "w",
        "need": "n",
        "lie": "l",
        "ghost": "g",
        "continuumAxis": "trusting ↔ suspicious",
        "stops": [{"sceneId": "scene-1", "headAt": "trusting"}],
    }
    episode = Episode.model_validate(
        {
            "id": "ep-1",
            "index": 0,
            "title": "t",
            "premise": "",
            "storylines": [],
            "scenes": [],
            "characterArcs": [arc],
        }
    )
    assert episode.model_dump(by_alias=True, mode="json")["characterArcs"] == [arc]


def test_pre_0_55_overview_response_parses_with_defaults():
    parsed = InferredStoryOverview.model_validate(
        {
            "logline": "l",
            "outline": [{"sceneId": "scene-1", "summary": "s"}],
            "beatSheet": [],
            "summary": "s",
        }
    )
    assert (parsed.dramatic_question, parsed.central_argument, parsed.anti_theme) == ("", "", "")
    assert parsed.character_arcs == []
    row = parsed.outline[0]
    assert (row.story_order, row.story_time, row.anachrony) == (None, "", "none")


# ── T10.6 merge: About, lead arcs and story time ────────────────────────────

_CAST = [
    {"id": "char-nora", "name": "Nora Hale", "aliases": ["Nora"]},
    {"id": "char-cass", "name": "Cass", "aliases": []},
    {"id": "char-ike", "name": "Ike", "aliases": []},
    {"id": "char-wren", "name": "Wren", "aliases": []},
]
_THREE_SCENES = [
    {"id": f"scene-{n}", "act": 1, "index": n - 1, "beats": [{"id": f"beat-{n}-1"}]}
    for n in (1, 2, 3)
]


def _cast_doc(**kwargs) -> dict:
    doc = _doc(scenes=[dict(s) for s in _THREE_SCENES], **kwargs)
    doc["seriesBible"] = {"characters": _CAST}
    return doc


def _arc(name: str, stops=(), **fields) -> dict:
    return {
        "characterName": name,
        "want": fields.get("want", "to keep the light"),
        "need": "to let go",
        "lie": "the sea owes her",
        "ghost": "her father drowned",
        "continuumAxis": "holding on ↔ letting go",
        "stops": [{"sceneId": s, "headAt": h} for s, h in stops],
    }


def _outline(*ranks, anachrony=None) -> list[dict]:
    anachrony = anachrony or {}
    return [
        {
            "sceneId": f"scene-{n}",
            "summary": f"Scene {n}.",
            "storyOrder": rank,
            "storyTime": f"Day {n}",
            "anachrony": anachrony.get(n, "none"),
        }
        for n, rank in enumerate(ranks, start=1)
    ]


def _merged(doc: dict, **overrides) -> dict:
    merge_story_overview(doc, "ep-1", overview(beatSheet=[], **overrides))
    return doc["seasons"][0]["episodes"][0]


def test_merge_carries_about_and_story_time():
    ep = _merged(
        _cast_doc(),
        dramaticQuestion="Will Nora deliver the letter?",
        centralArgument="Love requires letting go.",
        antiTheme="Holding on is loyalty.",
        outline=_outline(1, 0, 2, anachrony={2: "flashback"}),
    )
    ov = ep["storyOverview"]
    assert (ov["dramaticQuestion"], ov["centralArgument"], ov["antiTheme"]) == (
        "Will Nora deliver the letter?",
        "Love requires letting go.",
        "Holding on is loyalty.",
    )
    assert [(r["storyOrder"], r["storyTime"], r["anachrony"]) for r in ov["outline"]] == [
        (1, "Day 1", "none"),
        (0, "Day 2", "flashback"),
        (2, "Day 3", "none"),
    ]


def test_story_order_is_nulled_unless_a_non_identity_permutation():
    for ranks in (
        (0, 1, 2),  # identity: the episode is told in order
        (1, 0, None),  # partial
        (0, 0, 1),  # duplicate rank
        (1, 2, 3),  # not 0..n-1
    ):
        ep = _merged(_cast_doc(), outline=_outline(*ranks, anachrony={3: "flashforward"}))
        rows = ep["storyOverview"]["outline"]
        assert [r["storyOrder"] for r in rows] == [None, None, None], ranks
        # A flashback or flashforward is kept without a full order.
        assert rows[2]["anachrony"] == "flashforward"


def test_story_order_identity_is_judged_in_script_order_not_row_order():
    # Rows arrive out of script order but rank each scene by its own place:
    # that is still the script order, so nothing reorders.
    rows = list(reversed(_outline(0, 1, 2)))
    ep = _merged(_cast_doc(), outline=rows)
    assert all(r["storyOrder"] is None for r in ep["storyOverview"]["outline"])


def test_arcs_resolve_names_cap_three_and_keep_first_duplicate():
    ep = _merged(
        _cast_doc(),
        characterArcs=[
            _arc("Nora", want="first"),
            _arc("Stranger"),  # unresolved: dropped, does not use a slot
            _arc("Nora Hale", want="second"),  # duplicate: first wins
            _arc("Cass"),
            _arc("Ike"),
            _arc("Wren"),  # a fourth principal: over the cap
        ],
    )
    arcs = ep["characterArcs"]
    assert [a["characterId"] for a in arcs] == ["char-nora", "char-cass", "char-ike"]
    assert arcs[0]["want"] == "first"
    assert arcs[0]["continuumAxis"] == "holding on ↔ letting go"


def test_arc_stops_drop_unknown_scenes_dedupe_and_sort_by_scene_order():
    ep = _merged(
        _cast_doc(),
        characterArcs=[
            _arc(
                "Nora",
                stops=[
                    ("scene-3", "lets go"),
                    ("scene-99", "nowhere"),
                    ("scene-1", "clings"),
                    ("scene-3", "second reading"),
                    ("scene-2", "  "),
                ],
            )
        ],
    )
    assert ep["characterArcs"][0]["stops"] == [
        {"sceneId": "scene-1", "headAt": "clings"},
        {"sceneId": "scene-3", "headAt": "lets go"},
    ]


def test_arcs_follow_the_overview_lock():
    prior = [{"characterId": "char-cass", "stops": []}]
    doc = _cast_doc(story_overview={"locked": True})
    doc["seasons"][0]["episodes"][0]["characterArcs"] = prior
    ep = _merged(doc, characterArcs=[_arc("Nora")])
    assert ep["characterArcs"] == prior


def test_t10_6_merge_logs_counts_only(caplog):
    caplog.set_level(logging.INFO, logger="drama_manager.overview")
    _merged(
        _cast_doc(),
        dramaticQuestion="Will Nora deliver the letter?",
        outline=_outline(1, 0, 2, anachrony={2: "flashback"}),
        characterArcs=[_arc("Nora", stops=[("scene-1", "clings"), ("scene-9", "x")]), _arc("Zed")],
    )
    text = caplog.text
    assert "arcs=1 stops=1 arcs_unresolved=1" in text
    assert "stops_dropped=1 story_order_kept=3 story_order_nulled=0 anachronies=1" in text
    for writer_text in ("Nora", "Zed", "clings", "letter", "Day 1", "holding on"):
        assert writer_text not in text


def test_overview_prompt_asks_for_about_arcs_and_story_time():
    from drama_manager.render import PROMPT_VERSION, build_overview_prompt, new_nonce

    _system, user = build_overview_prompt(
        {"format": {"actCount": 4, "coldOpen": False, "tag": False}},
        [],
        [],
        new_nonce(),
        known_cast=["Nora"],
    )
    for field in (
        "dramaticQuestion",
        "centralArgument",
        "antiTheme",
        "characterArcs",
        "up to three principals",
        "want",
        "need",
        "lie",
        "ghost",
        "continuumAxis",
        "headAt",
        "storyOrder",
        "storyTime",
        "anachrony",
        "flashback",
        "flashforward",
    ):
        assert field in user, field
    assert '"love requires surrender", not "love"' in user
    assert PROMPT_VERSION == "0.55.0"


def test_mock_overview_merges_about_one_arc_and_a_flashback_story_order():
    from llm.mock import MockLlmClient

    result = MockLlmClient().infer_story_overview(
        system="", user_message="", prompt_version="test"
    )
    doc = _cast_doc()
    doc["seriesBible"] = {"characters": [{"id": "char-marta", "name": "Marta Vega"}]}
    merge_story_overview(doc, "ep-1", result)
    ep = doc["seasons"][0]["episodes"][0]
    ov = ep["storyOverview"]
    assert ov["dramaticQuestion"] and ov["centralArgument"] and ov["antiTheme"]
    assert [(r["sceneId"], r["storyOrder"], r["anachrony"]) for r in ov["outline"]] == [
        ("scene-1", 1, "none"),
        ("scene-2", 0, "flashback"),
    ]
    (arc,) = ep["characterArcs"]
    assert arc["characterId"] == "char-marta"
    assert [s["sceneId"] for s in arc["stops"]] == ["scene-1", "scene-3"]
