import pytest

from fountain.acts import (
    ActInferenceError,
    acts_from_markers,
    expand_act_starts,
    printed_structure,
    scene_summaries,
)
from fountain.parse import (
    ImportedBeat,
    SceneSpan,
    split_into_scenes,
    strip_screenplay_front_matter,
)
from schemas import InferredActBreaks

FORMAT = {
    "genre": "drama",
    "runtimeMinutes": 60,
    "actCount": 5,
    "coldOpen": True,
    "tag": False,
    "serialization": 0.8,
}


def inferred(*starts):
    return InferredActBreaks(starts=list(starts))


def test_expands_starts_to_a_total_partition_and_allows_empty_sections():
    value = inferred(
        {"act": 1, "startSceneIndex": 0},
        {"act": 3, "startSceneIndex": 2},
        {"act": 5, "startSceneIndex": 4},
    )
    assert expand_act_starts(value, scene_count=6, format_dict=FORMAT) == [
        1, 1, 3, 3, 5, 5
    ]


@pytest.mark.parametrize(
    "starts",
    [
        [{"act": 0, "startSceneIndex": 1}],
        [{"act": 0, "startSceneIndex": 0}, {"act": 0, "startSceneIndex": 2}],
        [{"act": 2, "startSceneIndex": 0}, {"act": 1, "startSceneIndex": 2}],
        [{"act": 0, "startSceneIndex": 0}, {"act": 1, "startSceneIndex": 0}],
        [{"act": 0, "startSceneIndex": 0}, {"act": 1, "startSceneIndex": 6}],
        [{"act": 6, "startSceneIndex": 0}],
    ],
)
def test_rejects_semantically_invalid_starts(starts):
    with pytest.raises(ActInferenceError) as exc:
        expand_act_starts(
            inferred(*starts), scene_count=6, format_dict=FORMAT
        )
    assert exc.value.diagnostics


def test_no_cold_open_uses_zero_as_act_one():
    fmt = {**FORMAT, "coldOpen": False, "actCount": 2}
    value = inferred(
        {"act": 0, "startSceneIndex": 0},
        {"act": 1, "startSceneIndex": 3},
    )
    assert expand_act_starts(value, scene_count=5, format_dict=fmt) == [0, 0, 0, 1, 1]


def test_scene_summaries_project_only_compact_post_segmentation_fields():
    spans = [
        SceneSpan(
            location="INT. BAR - NIGHT",
            lines=["INT. BAR - NIGHT", "Marta returns."],
            start_line=4,
        )
    ]
    beats = [[
        ImportedBeat(
            what_happens="Marta returns.",
            audience_learns="She kept the key.",
            audience_feels="Dread.",
            script_text="MARTA\nI came back.",
        )
    ]]

    summaries = scene_summaries(spans, beats)

    assert summaries == [
        {
            "sceneIndex": 0,
            "location": "INT. BAR - NIGHT",
            "beats": [
                {
                    "whatHappens": "Marta returns.",
                    "audienceLearns": "She kept the key.",
                    "audienceFeels": "Dread.",
                }
            ],
        }
    ]
    assert "scriptText" not in str(summaries)
    assert "MARTA\nI came back." not in str(summaries)


FOUR_ACTS = {**FORMAT, "actCount": 4}


def _spans(*scenes: str) -> list:
    return split_into_scenes("\n".join(scenes))


def test_printed_markers_state_the_partition():
    # Shaped like the stored West Wing pilot: the TEASER line went with the
    # front matter, and ACT TWO is never printed, only END OF ACT ONE.
    spans = _spans(
        "INT. BAR - NIGHT\nMarta pours.",
        "INT. HALL - NIGHT\nShe leaves.\nEND OF TEASER\n\nACT ONE",
        "INT. KITCHEN - DAY\nDan waits.\nEND OF ACT ONE",
        "INT. CELLAR - NIGHT\nThe key.\n> ACT THREE <",
        "INT. OFFICE - DAY\nDan reads.\nEND OF ACT THREE\nACT FOUR",
        "EXT. STREET - NIGHT\nThey part.\nEND OF ACT FOUR",
    )
    assert acts_from_markers(spans, FOUR_ACTS) == [0, 0, 1, 2, 3, 4]


def test_markers_in_front_matter_open_the_first_scene():
    spans = _spans(
        "TEASER",
        "INT. BAR - NIGHT\nMarta pours.\nACT ONE",
        "INT. KITCHEN - DAY\nDan waits.\nACT TWO",
        "INT. CELLAR - NIGHT\nThe key.",
    )
    fmt = {**FORMAT, "actCount": 2}
    assert acts_from_markers(spans, fmt) == [0, 0, 1, 2]
    no_cold_open = _spans(
        "ACT ONE",
        "INT. BAR - NIGHT\nMarta pours.\nACT 2",
        "INT. KITCHEN - DAY\nDan waits.",
    )
    assert acts_from_markers(no_cold_open, {**fmt, "coldOpen": False}) == [0, 0, 1]


def test_cold_open_and_roman_numeral_markers():
    # Half-hour comedy: END OF COLD OPEN alone marks act one; ACT II is roman.
    spans = _spans(
        "COLD OPEN",
        "INT. BAR - NIGHT\nMarta pours.\nEND OF COLD OPEN",
        "INT. KITCHEN - DAY\nDan waits.\nACT II",
        "INT. CELLAR - NIGHT\nThe key.",
    )
    assert acts_from_markers(spans, {**FORMAT, "actCount": 2}) == [0, 0, 1, 2]


def test_script_opening_on_act_one_leaves_the_cold_open_empty():
    spans = _spans(
        "ACT ONE",
        "INT. A - DAY\nx\nACT TWO",
        "INT. B - DAY\nx\nACT THREE",
        "INT. C - DAY\nx\nACT FOUR",
        "INT. D - DAY\nx",
    )
    assert acts_from_markers(spans, FOUR_ACTS) == [1, 1, 2, 3, 4]
    # Only the cold open may be empty: a script opening on ACT TWO is not.
    no_act_one = _spans(
        "ACT TWO",
        "INT. A - DAY\nx\nACT THREE",
        "INT. B - DAY\nx",
    )
    assert acts_from_markers(no_act_one, {**FORMAT, "coldOpen": False, "actCount": 3}) is None


@pytest.mark.parametrize(
    ("scenes", "fmt"),
    [
        # no markers at all; mixed-case dialogue is not a printed marker
        (["INT. BAR - NIGHT\nMARTA\nAct two.", "INT. HALL - DAY\nDan."], FOUR_ACTS),
        # a gap: nothing marks where act two starts
        (
            [
                "INT. A - DAY\nx\nACT ONE",
                "INT. B - DAY\nx\nACT THREE",
                "INT. C - DAY\nx\nACT FOUR",
                "INT. D - DAY\nx",
            ],
            FOUR_ACTS,
        ),
        # three printed acts under a four-act format: never padded
        (
            [
                "INT. A - DAY\nx\nACT ONE",
                "INT. B - DAY\nx\nACT TWO",
                "INT. C - DAY\nx\nACT THREE",
                "INT. D - DAY\nx",
            ],
            FOUR_ACTS,
        ),
        # five printed acts under a four-act format
        (
            [
                "INT. A - DAY\nx\nACT ONE",
                "INT. B - DAY\nx\nEND OF ACT ONE",
                "INT. C - DAY\nx\nEND OF ACT TWO",
                "INT. D - DAY\nx\nEND OF ACT THREE",
                "INT. E - DAY\nx\nEND OF ACT FOUR",
                "INT. F - DAY\nx\nEND OF ACT FIVE",
            ],
            FOUR_ACTS,
        ),
        # the same act marked at two different places
        (
            [
                "INT. A - DAY\nx\nACT ONE",
                "INT. B - DAY\nx\nACT TWO",
                "INT. C - DAY\nx\nACT TWO",
                "INT. D - DAY\nx\nACT THREE",
                "INT. E - DAY\nx\nACT FOUR",
                "INT. F - DAY\nx",
            ],
            FOUR_ACTS,
        ),
        # a teaser printed in a format without a cold open
        (
            [
                "TEASER",
                "INT. A - DAY\nx\nACT ONE",
                "INT. B - DAY\nx\nACT TWO",
                "INT. C - DAY\nx",
            ],
            {**FORMAT, "coldOpen": False, "actCount": 2},
        ),
        # the last act is marked in the last scene, so it would hold nothing
        (
            [
                "INT. A - DAY\nx\nACT ONE",
                "INT. B - DAY\nx\nACT TWO",
                "INT. C - DAY\nx\nACT THREE",
                "INT. D - DAY\nx\nACT FOUR",
            ],
            FOUR_ACTS,
        ),
    ],
)
def test_partial_or_inconsistent_markers_give_no_partition(scenes, fmt):
    assert acts_from_markers(_spans(*scenes), fmt) is None


def test_a_cold_open_and_three_printed_acts_are_kept_with_the_scripts_format():
    """An import with no format reads this structure from the script
    (`printed_structure`). Three acts match no preset; with the format taken
    from the script the printed breaks are kept, where the old five-act
    default discarded them (owner decision 2026-10-11)."""
    spans = _spans(
        "COLD OPEN",
        "INT. SCHOOL - DAY\nLisa reads.\nACT ONE",
        "INT. HOUSE - NIGHT\nHomer eats.\nEND OF ACT ONE\nACT TWO",
        "EXT. STREET - DAY\nBart runs.\nACT THREE",
        "INT. KITCHEN - NIGHT\nMarge sighs.",
    )
    from_script = {**FORMAT, "actCount": 3, "coldOpen": True}
    assert acts_from_markers(spans, from_script) == [0, 0, 1, 2, 3]
    assert acts_from_markers(spans, {**FORMAT, "actCount": 5, "coldOpen": True}) is None


# ── printed_structure: an import given no format (owner decision 2026-10-11) ──


def _read_whole_script(*parts: str):
    """`printed_structure` as the import calls it: the stripped front matter,
    then the scenes."""
    source = "\n".join(parts)
    stripped = strip_screenplay_front_matter(source)
    front_matter = source.split("\n")[: stripped.removed_line_count]
    return printed_structure(front_matter, split_into_scenes(stripped.content))


_SCENE = "INT. BAR - NIGHT\nMarta pours."


def test_printed_structure_reads_the_act_one_stripped_with_fade_in():
    # Each act opens on its own FADE IN, so ACT ONE goes with the front
    # matter; the count and cold open still come from the whole script.
    assert _read_whole_script(
        "ACT ONE", "FADE IN:", _SCENE, _SCENE, "END OF ACT ONE",
        "ACT TWO", "FADE IN:", _SCENE, "END OF ACT TWO",
        "ACT THREE", "FADE IN:", _SCENE, "END OF ACT THREE",
        "ACT FOUR", "FADE IN:", _SCENE, "END OF ACT FOUR",
    ) == (4, False, False, None)


def test_printed_structure_keeps_the_count_past_a_damaged_heading():
    # OCR left one heading mixed case: no full partition, but four acts and
    # the stripped TEASER still stand.
    assert _read_whole_script(
        "TEASER", "FADE IN:", _SCENE, _SCENE, "ACT ONE", _SCENE, "AcT Two",
        _SCENE, "ACT THREE", _SCENE, "ACT FOUR", _SCENE, "END OF ACT FOUR",
    ) == (4, True, False, None)


def test_printed_structure_counts_end_of_act_lines():
    assert _read_whole_script(
        _SCENE, "END OF ACT ONE", _SCENE, "END OF ACT TWO", _SCENE, "END OF ACT THREE"
    ) == (3, False, False, None)


def test_printed_structure_gives_the_partition_when_markers_state_one():
    # Scenes before ACT ONE are a cold open even with no TEASER printed.
    assert _read_whole_script(
        _SCENE, "ACT ONE", _SCENE, "ACT TWO", _SCENE
    ) == (2, True, False, [0, 1, 2])


def test_printed_structure_is_none_when_no_act_is_printed():
    assert _read_whole_script(_SCENE, "MARTA\nAct two.", _SCENE) is None
