"""T10.13 craft notes: the dialogue spine, the prompt, and the check that
files verified notes as dismissable craft flags (drama_manager/craft.py)."""

from __future__ import annotations

from drama_manager import craft, render

NONCE = "n0nce"


def test_dialogue_lines_keeps_cue_and_speech_drops_action():
    text = "INT. BAR - DAY\nMarta wipes the bar.\n\nMARTA\n(quiet)\nI know what you did."
    assert craft.dialogue_lines(text) == ["MARTA", "I know what you did."]


def test_dialogue_lines_skips_a_caps_line_with_no_speech_under_it():
    text = "WIDE ANGLE ON THE BAR\n\nDAN\nTwo coffees.\n\nThe door swings shut."
    assert craft.dialogue_lines(text) == ["DAN", "Two coffees."]


def _episode() -> dict:
    def beat(bid: str, index: int, text: str) -> dict:
        return {"id": bid, "index": index, "scriptText": text}

    return {
        "scenes": [
            {
                "id": "scene-2",
                "act": 1,
                "index": 1,
                "beats": [beat("beat-2-1", 0, "DAN\nWe're family. Family protects family.")],
            },
            {
                "id": "scene-1",
                "act": 1,
                "index": 0,
                "beats": [
                    beat("beat-1-1", 0, "Marta walks in. Nobody speaks."),
                    beat("beat-1-2", 1, "MARTA\nI'm angry with you."),
                ],
            },
        ]
    }


def test_craft_spine_is_board_ordered_dialogue_only():
    assert craft.craft_spine(_episode()) == [
        {
            "sceneId": "scene-1",
            "beats": [{"beatId": "beat-1-2", "dialogue": ["MARTA", "I'm angry with you."]}],
        },
        {
            "sceneId": "scene-2",
            "beats": [
                {
                    "beatId": "beat-2-1",
                    "dialogue": ["DAN", "We're family. Family protects family."],
                }
            ],
        },
    ]


def test_craft_prompt_carries_overview_cast_and_spine():
    overview = {"logline": "A bar, a debt.", "centralArgument": "Loyalty costs more than it pays."}
    spine = craft.craft_spine(_episode())
    _system, user = render.build_craft_prompt(
        {"title": "T", "format": {}}, overview, ["Marta", "Dan"], spine, NONCE
    )
    for kind in ("story_overview", "known_cast", "craft_spine"):
        assert f'kind="{kind}"' in user
    assert "Loyalty costs more than it pays." in user
    for words in ("theme_stated", "on_the_nose", "at most 12"):
        assert words in user


def test_craft_prompt_without_overview_omits_it():
    _system, user = render.build_craft_prompt(
        {"title": "T", "format": {}}, {}, ["Marta"], craft.craft_spine(_episode()), NONCE
    )
    assert 'kind="story_overview"' not in user
    assert 'kind="craft_spine"' in user
