"""Deterministic Fountain parse (apps/api/fountain/parse.py): stage-1 split,
server-owned segment-start normalization, byte-identity reconstruction, and §5 offset
location. Pure logic, no LLM/DB — the byte-identity heart of T1.3."""

from __future__ import annotations

import pytest

from fountain.parse import (
    ImportedBeat,
    locate_source_text,
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


# ── stage 2: typed-start normalization ─────────────────────────────────────


def _scene(source: str):
    return split_into_scenes(source)[0]


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
    normalized = normalize_and_slice(
        scene, _seg([(1, "a", "b", "c"), (5, "d", "e", "f")])
    )
    assert normalized.beats[0].script_text == "INT. BAR - NIGHT\nDan pours."
    assert normalized.score.discarded_beat_metadata == 1
    assert any(
        issue.code == "out_of_bounds_start" for issue in normalized.beats[0].review_issues
    )


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
    scene = _scene("INT. BAR - NIGHT\nDan pours.")
    normalized = normalize_and_slice(scene, _seg([]))
    assert normalized.should_retry is True
    assert normalized.beats[0].script_text == "INT. BAR - NIGHT\nDan pours."
    assert normalized.beats[0].unassigned == [(1, 2)]
    assert {i.code for i in normalized.beats[0].review_issues} >= {
        "empty_output",
        "no_beats_returned",
    }


def test_scene_with_no_beats_is_flagged_not_silently_synthesized():
    """A scene the model declines to break down keeps its text but loses its
    whole semantic layer. That is a failure of the operation, and it stayed
    invisible through every real import until this flag existed."""
    scene = _scene("INT. BAR - NIGHT\nmystery block")
    normalized = normalize_and_slice(scene, _seg([], unassigned=[(1, "could not segment")]))
    assert len(normalized.beats) == 1
    assert normalized.beats[0].script_text == "INT. BAR - NIGHT\nmystery block"  # intact
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
    scene = _scene("INT. BAR - NIGHT\nmystery block\nmore mystery")
    seg = _seg([], unassigned=[(1, "a"), (2, "b"), (3, "c")])
    normalized = normalize_and_slice(scene, seg)
    codes = [i.code for i in normalized.beats[0].review_issues]
    assert codes == ["no_beats_returned"]


def test_zero_beat_scene_keeps_informative_non_boundary_issues():
    """Suppression is narrow: only the redundant unassigned notices go."""
    scene = _scene("INT. BAR - NIGHT\nDan pours.")
    seg = SegmentedScene.model_validate(
        {"segments": [{"kind": "unassigned", "startLine": 99, "reason": "out of range"}]}
    )
    codes = {i.code for i in normalize_and_slice(scene, seg).beats[0].review_issues}
    assert "no_beats_returned" in codes
    assert codes - {"no_beats_returned"}, "an out-of-bounds start should still be reported"


def test_zero_beat_scene_does_not_trigger_a_retry():
    """Flag only. The cause is unknown and every scene currently lands here,
    so retrying would double segmentation cost without fixing anything."""
    scene = _scene("INT. BAR - NIGHT\nmystery block")
    normalized = normalize_and_slice(scene, _seg([], unassigned=[(1, "could not segment")]))
    assert normalized.should_retry is False


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


# ── §5 offset location ──────────────────────────────────────────────────────


def test_locate_source_text_finds_offsets():
    beat = ImportedBeat("", "", "", "INT. BAR - NIGHT\nDan pours a drink.")
    start, end = locate_source_text(beat.script_text, "Dan pours", 2, 2)
    assert beat.script_text[start:end] == "Dan pours"


def test_locate_source_text_disambiguates_by_line_window():
    text = "the money\nnothing here\nthe money"  # duplicate quote
    # line 3 window should resolve to the SECOND occurrence
    start, end = locate_source_text(text, "the money", 3, 3)
    assert start == text.rindex("the money")
    assert text[start:end] == "the money"


def test_locate_source_text_absent_returns_none():
    assert locate_source_text("Dan pours.", "not present", 1, 1) == (None, None)


def test_locate_source_text_empty_returns_none():
    assert locate_source_text("Dan pours.", "", 1, 1) == (None, None)
