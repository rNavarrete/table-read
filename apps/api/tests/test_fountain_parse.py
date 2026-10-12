"""Deterministic Fountain parse (apps/api/fountain/parse.py): stage-1 split,
server-owned segment-start normalization and byte-identity reconstruction.
Pure logic, no LLM/DB — the byte-identity heart of T1.3."""

from __future__ import annotations

import pytest

from fountain.parse import (
    is_slugline,
    normalize_and_slice,
    reconstruct,
    split_into_scenes,
    strip_screenplay_front_matter,
    validate_and_slice,
)
from schemas import SegmentedScene


def _seg(
    beats: list[tuple[int, str, str, str]],
    unassigned: list[tuple[int, str]] | None = None,
) -> SegmentedScene:
    return SegmentedScene.model_validate(
        {
            "segments": [
                {
                    "kind": "beat",
                    "startLine": s,
                    "whatHappens": wh,
                    "audienceLearns": al,
                    "audienceFeels": af,
                }
                for (s, wh, al, af) in beats
            ]
            + [
                {"kind": "unassigned", "startLine": s, "reason": reason}
                for (s, reason) in (unassigned or [])
            ]
        }
    )


# ── stage 1: split ──────────────────────────────────────────────────────────


def test_split_groups_lines_under_sluglines():
    source = "INT. BAR - NIGHT\nDan pours.\n\nEXT. STREET - DAY\nReyes waits."
    scenes = split_into_scenes(source)
    assert [s.location for s in scenes] == ["INT. BAR - NIGHT", "EXT. STREET - DAY"]
    assert scenes[0].lines == ["INT. BAR - NIGHT", "Dan pours.", ""]
    assert scenes[1].lines == ["EXT. STREET - DAY", "Reyes waits."]


def test_split_captures_front_matter_before_first_slugline():
    source = "Title: The Long Pour\n\nINT. BAR - NIGHT\nDan pours."
    scenes = split_into_scenes(source)
    assert scenes[0].location == ""  # front-matter bucket
    assert scenes[0].lines == ["Title: The Long Pour", ""]
    assert scenes[1].location == "INT. BAR - NIGHT"


def test_split_with_no_sluglines_is_one_bucket():
    source = "just some notes\nno headings here"
    scenes = split_into_scenes(source)
    assert len(scenes) == 1
    assert scenes[0].location == ""
    assert scenes[0].lines == ["just some notes", "no headings here"]


def test_split_recognizes_int_ext_variants():
    for heading in ("INT. X", "EXT. X", "int. x", "EST. X", "INT./EXT. X", "I/E. X"):
        assert split_into_scenes(heading)[0].location == heading


@pytest.mark.parametrize(
    "heading",
    [
        "17 INT. OFFICE - DAY 17",
        "A12 EXT. STREET - NIGHT",
        "12A INT. HALL - DAY 12A",
        ".FLASHBACK",
        "EXT./INT. CAR - DAY",
        "EXT/INT CAR - DAY",
        "Int. Kitchen - Day",
        "4 Ext. Street - Night",
    ],
)
def test_numbered_forced_and_ext_int_headings_start_a_scene(heading):
    scenes = split_into_scenes(f"INT. BAR - NIGHT\nDan pours.\n{heading}\nMarta waits.")
    assert [s.location for s in scenes] == ["INT. BAR - NIGHT", heading]


@pytest.mark.parametrize(
    "line",
    [
        "Ext. is short for exterior.",
        "Int. is where he lives.",
        "...and then he left.",
        ". . . later",
    ],
)
def test_action_prose_and_ellipses_are_not_headings(line):
    assert not is_slugline(line)


def test_strip_front_matter_removes_title_sets_and_cast_through_fade_in():
    source = "\n".join(
        [
            "THE WEST WING",
            '"Pilot"',
            "Written by",
            "FINAL DRAFT",
            "INT. GLASS OFFICE BUILDING",
            "Office Corridor",
            "CAST",
            "SAM",
            "LEO",
            "TEASER",
            "FADE IN:",
            "",
            "INT. FOUR SEASONS HOTEL - NIGHT",
            "Sam sits at the bar.",
        ]
    )

    result = strip_screenplay_front_matter(source)

    assert result.content == "INT. FOUR SEASONS HOTEL - NIGHT\nSam sits at the bar."
    assert result.removed_line_count == 12
    assert result.removed_char_count > 0
    assert [scene.location for scene in split_into_scenes(result.content)] == [
        "INT. FOUR SEASONS HOTEL - NIGHT"
    ]


def test_strip_front_matter_removes_recognized_fountain_title_page_without_fade_in():
    source = "\n".join(
        [
            "Title: The Long Pour",
            "Credit: Written by",
            "Author: Example Writer",
            "Draft date: July 24, 2026",
            "",
            "INT. BAR - NIGHT",
            "Dan pours a drink.",
        ]
    )

    result = strip_screenplay_front_matter(source)

    assert result.content == "INT. BAR - NIGHT\nDan pours a drink."
    assert result.removed_line_count == 5


def test_strip_front_matter_leaves_a_script_without_front_matter_byte_identical():
    source = "INT. BAR - NIGHT\nDan pours.\n\nEXT. STREET - DAY\nReyes waits."

    result = strip_screenplay_front_matter(source)

    assert result.content == source
    assert result.removed_line_count == 0
    assert result.removed_char_count == 0


def test_strip_front_matter_does_not_cut_at_a_later_fade_in_inside_the_script():
    source = "\n".join(
        [
            "INT. STAGE - NIGHT",
            "The lights go dark.",
            "FADE IN:",
            "INT. STAGE - MORNING",
            "The room is empty.",
        ]
    )

    assert strip_screenplay_front_matter(source).content == source


def test_strip_front_matter_preserves_unrecognized_pre_slug_story_text():
    source = "A BLACK SCREEN.\nA phone rings.\n\nINT. OFFICE - NIGHT\nNora answers."

    assert strip_screenplay_front_matter(source).content == source


@pytest.mark.parametrize(
    "title_page",
    [
        # Mr. Plow's PDF: no Fountain fields, no indentation, no FADE IN. Left in,
        # it became scene 1 and "written by" became a story fact.
        ['"The Long Pour"', "", "Written by", "Example Writer", "", "ACT ONE", ""],
        # The Americans' PDF: a bare "by", a date and the teaser marker.
        ['"The Long Pour"', "by", "Example Writer", "October 2011", "TEASER"],
        ["THE LONG POUR", "Teleplay by Example Writer", "Story by Other Writer", ""],
    ],
)
def test_strip_front_matter_removes_a_plain_pdf_title_page(title_page):
    source = "\n".join([*title_page, "INT. BAR - NIGHT", "Dan pours a drink."])

    result = strip_screenplay_front_matter(source)

    assert result.content == "INT. BAR - NIGHT\nDan pours a drink."
    assert result.removed_line_count == len(title_page)


def test_a_mid_script_fade_in_under_a_title_page_never_cuts_real_scenes():
    """Mr. Plow: a "Written by" title page, real scenes, then a FADE IN in scene 16.
    The FADE IN rule once cut everything above it; now only the title page goes."""
    scenes = [
        "INT. BAR - NIGHT",
        "Dan pours a drink and slides it down the bar to a stranger in a wet coat.",
        "EXT. STREET - DAY",
        "Reyes waits by the curb while the snowplow grinds past and buries his car.",
        "FADE IN:",
        "INT. CONVENTION CENTER - LATER",
        "The crowd applauds.",
    ]
    source = "\n".join(['"The Long Pour"', "Written by", "Example Writer", "", *scenes])

    result = strip_screenplay_front_matter(source)

    assert result.content == "\n".join(scenes)
    assert result.removed_line_count == 4


def test_strip_front_matter_keeps_an_opening_montage_before_the_first_heading():
    """Field of Dreams opens on narration with no heading; that is story."""
    source = "\n".join(
        [
            "MONTAGE OF PHOTOS",
            "RAY (V.O.)",
            "My father was born in North Dakota and never once mentioned it to anyone.",
            "A faded photo, signed by a man nobody in the family remembers meeting.",
            "INT. KITCHEN - NIGHT",
            "Ray eats.",
        ]
    )

    assert strip_screenplay_front_matter(source).content == source


# ── stage 2: typed-start normalization ─────────────────────────────────────


def _scene(source: str):
    return split_into_scenes(source)[0]


# Long enough that an all-unassigned answer is a failure, not an establishing shot.
_LONG_SCENE = "INT. BAR - NIGHT\nDan pours.\nMarta enters.\nReyes waits.\nThe door closes."


def test_valid_tiling_slices_beats_verbatim():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")  # 3 lines
    seg = _seg([(1, "a", "b", "c"), (3, "d", "e", "f")])
    beats = validate_and_slice(scene, seg)
    assert [b.script_text for b in beats] == ["INT. BAR - NIGHT\nDan pours.", "Marta enters."]


def test_last_segment_owns_through_scene_end_without_repair():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")  # 3 lines
    normalized = normalize_and_slice(scene, _seg([(1, "a", "b", "c")]))
    assert normalized.beats[0].script_text == "INT. BAR - NIGHT\nDan pours.\nMarta enters."
    assert normalized.beats[0].unassigned == []
    assert normalized.score.event_count == 0


def test_segment_starts_make_mid_scene_gaps_unrepresentable():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.\nReyes waits.")  # 4
    seg = _seg([(1, "a", "b", "c"), (3, "d", "e", "f")])
    beats = validate_and_slice(scene, seg)
    assert [b.script_text for b in beats] == [
        "INT. BAR - NIGHT\nDan pours.",
        "Marta enters.\nReyes waits.",
    ]
    assert beats[0].unassigned == []


def test_duplicate_starts_become_unassigned_and_discard_conflicting_metadata():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")  # 3 lines
    normalized = normalize_and_slice(
        scene,
        _seg([(1, "a", "b", "c"), (2, "d", "e", "f"), (2, "g", "h", "i")]),
    )
    assert normalized.should_retry is True
    assert normalized.score.discarded_beat_metadata == 2
    assert normalized.beats[0].script_text == "INT. BAR - NIGHT\nDan pours.\nMarta enters."
    assert normalized.beats[0].unassigned == [(2, 3)]
    assert any(issue.code == "duplicate_start" for issue in normalized.beats[0].review_issues)


def test_out_of_bounds_start_is_discarded_and_flagged_without_losing_text():
    scene = _scene("INT. BAR - NIGHT\nDan pours.")  # 2 lines
    normalized = normalize_and_slice(scene, _seg([(1, "a", "b", "c"), (5, "d", "e", "f")]))
    assert normalized.beats[0].script_text == "INT. BAR - NIGHT\nDan pours."
    assert normalized.score.discarded_beat_metadata == 1
    assert any(issue.code == "out_of_bounds_start" for issue in normalized.beats[0].review_issues)


def test_unordered_segment_objects_are_sorted_with_metadata_attached():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")
    normalized = normalize_and_slice(
        scene, _seg([(3, "later", "l", "f"), (1, "earlier", "l", "f")])
    )
    assert [beat.what_happens for beat in normalized.beats] == ["earlier", "later"]
    assert any(
        issue.code == "unordered_segments"
        for beat in normalized.beats
        for issue in beat.review_issues
    )


def test_missing_initial_start_prepends_flagged_unassigned_prefix():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")
    normalized = normalize_and_slice(scene, _seg([(3, "a", "b", "c")]))
    assert normalized.beats[0].script_text == "INT. BAR - NIGHT\nDan pours.\nMarta enters."
    assert normalized.beats[0].unassigned == [(1, 2)]
    assert normalized.score.affected_lines == 2
    assert normalized.repair_ratio == pytest.approx(2 / 3)


def test_repair_ratio_retries_only_when_strictly_above_five_percent():
    exactly_twenty_lines = _scene("\n".join(["INT. BAR - NIGHT", *["line"] * 19]))
    over_five_percent = _scene("\n".join(["INT. BAR - NIGHT", *["line"] * 18]))
    output = _seg([(2, "a", "b", "c")])
    assert normalize_and_slice(exactly_twenty_lines, output).repair_ratio == pytest.approx(0.05)
    assert normalize_and_slice(exactly_twenty_lines, output).should_retry is False
    assert normalize_and_slice(over_five_percent, output).should_retry is True


# ── unassigned merge (no text ever dropped) ─────────────────────────────────


def test_trailing_unassigned_merges_into_preceding_beat_and_is_flagged():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nORPHAN LINE")  # 3 lines
    seg = _seg([(1, "a", "b", "c")], unassigned=[(3, "leftover")])
    beats = validate_and_slice(scene, seg)
    assert len(beats) == 1
    assert beats[0].script_text == "INT. BAR - NIGHT\nDan pours.\nORPHAN LINE"
    assert beats[0].unassigned == [(3, 3)]  # absolute source line (0-based scene start)


def test_leading_unassigned_merges_into_following_beat():
    scene = _scene("INT. BAR - NIGHT\nstray\nDan pours.")  # 3 lines
    seg = _seg([(3, "a", "b", "c")], unassigned=[(1, "front")])
    beats = validate_and_slice(scene, seg)
    assert len(beats) == 1
    assert beats[0].script_text == "INT. BAR - NIGHT\nstray\nDan pours."
    assert beats[0].unassigned == [(1, 2)]


def test_scene_entirely_unassigned_synthesizes_one_flagged_beat():
    scene = _scene("INT. BAR - NIGHT\nmystery block")  # 2 lines, no beats
    seg = _seg([], unassigned=[(1, "could not segment")])
    beats = validate_and_slice(scene, seg)
    assert len(beats) == 1
    assert beats[0].script_text == "INT. BAR - NIGHT\nmystery block"
    assert beats[0].unassigned == [(1, 2)]


def test_empty_segmentation_synthesizes_flagged_unassigned_scene_and_requests_retry():
    scene = _scene(_LONG_SCENE)
    normalized = normalize_and_slice(scene, _seg([]))
    assert normalized.should_retry is True
    assert normalized.beats[0].script_text == _LONG_SCENE
    assert normalized.beats[0].unassigned == [(1, 5)]
    assert {i.code for i in normalized.beats[0].review_issues} >= {
        "empty_output",
        "no_beats_returned",
    }


def test_scene_with_no_beats_is_flagged_not_silently_synthesized():
    """A scene the model declines to break down keeps its text but loses its
    whole semantic layer. That is a failure of the operation, and it stayed
    invisible through every real import until this flag existed."""
    scene = _scene(_LONG_SCENE)
    normalized = normalize_and_slice(scene, _seg([], unassigned=[(1, "could not segment")]))
    assert len(normalized.beats) == 1
    assert normalized.beats[0].script_text == _LONG_SCENE  # intact
    codes = [i.code for i in normalized.beats[0].review_issues]
    assert "no_beats_returned" in codes
    # One problem, one flag: the synthetic beat is empty by construction, so it
    # must not also raise empty_beat_fields.
    assert "empty_beat_fields" not in codes


def test_beat_with_blank_description_is_flagged():
    """`required` is not `non-empty`: a beat with "" for every field satisfies
    the schema, so the guard is what catches it."""
    scene = _scene("INT. BAR - NIGHT\nDan pours.")
    normalized = normalize_and_slice(scene, _seg([(1, "", "", "")]))
    codes = {i.code for i in normalized.beats[0].review_issues}
    assert codes == {"empty_beat_fields"}  # not no_beats_returned: a beat was returned


def test_populated_beats_are_not_flagged():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")
    normalized = normalize_and_slice(scene, _seg([(1, "Dan pours", "he waits", "unease")]))
    assert normalized.beats[0].review_issues == []


def test_zero_beat_scene_replaces_boundary_noise_with_one_accurate_flag():
    """A real 27-scene import raised 207 "review the boundary" flags for scenes
    that had no beat breakdown at all. There is no boundary to review when the
    model returned nothing — one flag naming the real failure beats eight
    pointing at the wrong one."""
    scene = _scene(_LONG_SCENE)
    seg = _seg([], unassigned=[(1, "a"), (2, "b"), (3, "c"), (4, "d")])
    normalized = normalize_and_slice(scene, seg)
    codes = [i.code for i in normalized.beats[0].review_issues]
    assert codes == ["no_beats_returned"]


def test_zero_beat_scene_keeps_informative_non_boundary_issues():
    """Suppression is narrow: only the redundant unassigned notices go."""
    scene = _scene(_LONG_SCENE)
    seg = SegmentedScene.model_validate(
        {"segments": [{"kind": "unassigned", "startLine": 99, "reason": "out of range"}]}
    )
    codes = {i.code for i in normalize_and_slice(scene, seg).beats[0].review_issues}
    assert "no_beats_returned" in codes
    assert codes - {"no_beats_returned"}, "an out-of-bounds start should still be reported"


def test_zero_beat_scene_retries_and_tells_the_retry_why():
    scene = _scene(_LONG_SCENE)
    normalized = normalize_and_slice(scene, _seg([], unassigned=[(1, "could not segment")]))
    assert normalized.should_retry is True
    assert {"code": "no_beats_returned"} in normalized.diagnostics


@pytest.mark.parametrize(
    ("source", "short"),
    [
        ("EXT. FARMHOUSE - NIGHT\n\nThe porch light flickers.\n\nA dog barks.\n", True),
        ("EXT. FARMHOUSE - NIGHT\n\nThe porch light flickers.\nA dog barks.\nA door opens.", False),
        # Native Fountain keeps each action paragraph on one line: two lines can
        # hold a whole scene's action.
        (
            "INT. BASEMENT - NIGHT\n\n"
            + "Dan drags the duffel to the furnace, unzips it, and stares at the "
            "bundled cash for a long moment before he feeds the first stack in.\n\n"
            + "Marta watches from the stairs as he burns every last bill, then she "
            "turns off the light and leaves him alone in the orange dark.\n",
            False,
        ),
    ],
)
def test_short_establishing_scene_with_no_beats_is_neither_retried_nor_flagged(source, short):
    """A heading and a line or two of picture has nothing to break down, so an
    all-unassigned answer there is not a failure worth a call or a flag."""
    normalized = normalize_and_slice(_scene(source), _seg([], unassigned=[(1, "establishing")]))
    assert normalized.should_retry is not short
    assert [i.code for i in normalized.beats[0].review_issues] == (
        [] if short else ["no_beats_returned"]
    )
    assert normalized.beats[0].script_text == source


def test_an_attempt_with_no_semantic_beat_ranks_below_any_attempt_with_one():
    """On repair score alone an all-unassigned answer is (0,0,0,0), so no
    retry that returned beats could ever replace it."""
    scene = _scene(_LONG_SCENE)
    no_beats = normalize_and_slice(scene, _seg([], unassigned=[(1, "could not segment")]))
    repaired = normalize_and_slice(scene, _seg([(3, "a", "b", "c")]))  # missing line 1
    assert no_beats.score.ranking_key() < repaired.score.ranking_key()
    assert repaired.ranking_key() < no_beats.ranking_key()


# ── leaked tool-call markup ─────────────────────────────────────────────────


def _markup(separator: str) -> str:
    # A leaked parameter boundary: only the closing tag, namespace separator
    # mangled. Stored imports show it without the next opening tag too, and
    # that tag alone would match whatever the separator handling did.
    return f"Calm\x3c/antml{separator}parameter>"


@pytest.mark.parametrize("separator", ["\x3a", "\uff1a", ".", ". ", "\u0903"])
def test_markup_in_the_scene_reading_is_blanked_flagged_and_retried(separator):
    seg = _seg([(1, "Dan pours", "he waits", "unease")]).model_copy(
        update={"scene_what_happens": "Dan stalls.", "scene_audience_learns": _markup(separator)}
    )
    normalized = normalize_and_slice(_scene("INT. BAR - NIGHT\nDan pours."), seg)
    assert normalized.should_retry is True
    assert {"code": "tool_markup"} in normalized.diagnostics
    assert normalized.reading["audienceLearns"] == ""
    assert normalized.reading["whatHappens"] == "Dan stalls."
    assert [i.code for i in normalized.beats[0].review_issues] == ["tool_markup"]


def test_markup_in_a_beat_field_is_blanked_and_flagged_on_that_beat():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")
    seg = _seg(
        [(1, "Dan pours", _markup("."), "unease"), (3, "Marta enters", "she knows", "dread")]
    )
    normalized = normalize_and_slice(scene, seg)
    assert normalized.should_retry is True
    assert normalized.beats[0].audience_learns == ""
    assert normalized.beats[0].what_happens == "Dan pours"
    assert [i.code for i in normalized.beats[0].review_issues] == ["tool_markup"]
    assert normalized.beats[1].review_issues == []


def test_prose_about_parameters_is_not_markup():
    seg = _seg([(1, "Dan invokes the parameters of the deal", "a < b in power", "x")])
    assert normalize_and_slice(_scene("INT. BAR - NIGHT\nDan pours."), seg).should_retry is False


def test_an_attempt_with_markup_ranks_below_a_clean_one():
    scene = _scene(_LONG_SCENE)
    clean = normalize_and_slice(scene, _seg([(3, "a", "b", "c")]))  # missing line 1
    marked = normalize_and_slice(scene, _seg([(1, "a", _markup("."), "c")]))
    assert clean.ranking_key() < marked.ranking_key()


# ── byte-identity reconstruction ────────────────────────────────────────────


@pytest.mark.parametrize(
    "source",
    [
        "INT. BAR - NIGHT\nDan pours.\n\nEXT. STREET - DAY\nReyes waits.",
        "INT. CAFÉ - DÍA\nMárta bebe café — piensa.\n\nEXT. MUELLE - NOCHE\n☕🌊",  # unicode
        "INT. BAR - NIGHT\nDan pours.   \n\t\nEnd.  ",  # trailing whitespace / tabs
        "INT. BAR - NIGHT\r\nDan pours.\r\n\r\nEXT. STREET - DAY\r\nReyes.",  # CRLF
        "INT. BAR - NIGHT\nDan pours.\n",  # trailing newline
        "notes with no slugline\nline two",  # front-matter-only doc
    ],
)
def test_reconstruct_is_byte_identical(source):
    scenes = split_into_scenes(source)
    scenes_beats = []
    for scene in scenes:
        # one beat covering the whole scene → tiles it exactly
        seg = _seg([(1, "w", "l", "f")])
        scenes_beats.append(validate_and_slice(scene, seg))
    assert reconstruct(scenes_beats) == source


def test_reconstruct_byte_identical_with_unassigned_buckets():
    source = "INT. BAR - NIGHT\nDan pours.\nORPHAN\n\nEXT. STREET - DAY\nReyes."
    scenes = split_into_scenes(source)
    s1, s2 = scenes
    # scene 1 (4 lines): beat 1-2, unassigned 3, beat 4(blank)
    b1 = validate_and_slice(
        s1,
        _seg([(1, "a", "b", "c"), (4, "d", "e", "f")], [(3, "x")]),
    )
    b2 = validate_and_slice(s2, _seg([(1, "g", "h", "i")]))
    assert reconstruct([b1, b2]) == source
    # unassigned surfaced with absolute source line numbers (scene 1 starts at 0)
    assert any(b.unassigned == [(3, 3)] for b in b1)
