"""Deterministic Fountain parse (apps/api/fountain/parse.py): stage-1 split,
server-side coverage validation, byte-identity reconstruction, and §5 offset
location. Pure logic, no LLM/DB — the byte-identity heart of T1.3."""

from __future__ import annotations

import pytest

from fountain.parse import (
    CoverageError,
    ImportedBeat,
    locate_source_text,
    reconstruct,
    split_into_scenes,
    validate_and_slice,
)
from schemas import SegmentedScene


def _seg(beats: list[tuple], unassigned: list[tuple] | None = None) -> SegmentedScene:
    return SegmentedScene.model_validate(
        {
            "beats": [
                {
                    "startLine": s,
                    "endLine": e,
                    "whatHappens": wh,
                    "audienceLearns": al,
                    "audienceFeels": af,
                }
                for (s, e, wh, al, af) in beats
            ],
            "unassigned": [
                {"startLine": s, "endLine": e, "reason": r} for (s, e, r) in (unassigned or [])
            ],
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


# ── stage 2: coverage validation ────────────────────────────────────────────


def _scene(source: str):
    return split_into_scenes(source)[0]


def test_valid_tiling_slices_beats_verbatim():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")  # 3 lines
    seg = _seg([(1, 2, "a", "b", "c"), (3, 3, "d", "e", "f")])
    beats = validate_and_slice(scene, seg)
    assert [b.script_text for b in beats] == ["INT. BAR - NIGHT\nDan pours.", "Marta enters."]


def test_gap_rejected():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")  # 3 lines
    seg = _seg([(1, 1, "a", "b", "c"), (3, 3, "d", "e", "f")])  # line 2 uncovered
    with pytest.raises(CoverageError, match="gap"):
        validate_and_slice(scene, seg)


def test_overlap_rejected():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")  # 3 lines
    seg = _seg([(1, 2, "a", "b", "c"), (2, 3, "d", "e", "f")])  # line 2 twice
    with pytest.raises(CoverageError, match="overlap"):
        validate_and_slice(scene, seg)


def test_out_of_bounds_rejected():
    scene = _scene("INT. BAR - NIGHT\nDan pours.")  # 2 lines
    seg = _seg([(1, 5, "a", "b", "c")])
    with pytest.raises(CoverageError, match="out of bounds"):
        validate_and_slice(scene, seg)


def test_trailing_end_gap_rejected():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")  # 3 lines
    seg = _seg([(1, 2, "a", "b", "c")])  # line 3 uncovered
    with pytest.raises(CoverageError, match="gap"):
        validate_and_slice(scene, seg)


# ── unassigned merge (no text ever dropped) ─────────────────────────────────


def test_trailing_unassigned_merges_into_preceding_beat_and_is_flagged():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nORPHAN LINE")  # 3 lines
    seg = _seg([(1, 2, "a", "b", "c")], unassigned=[(3, 3, "leftover")])
    beats = validate_and_slice(scene, seg)
    assert len(beats) == 1
    assert beats[0].script_text == "INT. BAR - NIGHT\nDan pours.\nORPHAN LINE"
    assert beats[0].unassigned == [(3, 3)]  # absolute source line (0-based scene start)


def test_leading_unassigned_merges_into_following_beat():
    scene = _scene("INT. BAR - NIGHT\nstray\nDan pours.")  # 3 lines
    seg = _seg([(3, 3, "a", "b", "c")], unassigned=[(1, 2, "front")])
    beats = validate_and_slice(scene, seg)
    assert len(beats) == 1
    assert beats[0].script_text == "INT. BAR - NIGHT\nstray\nDan pours."
    assert beats[0].unassigned == [(1, 2)]


def test_scene_entirely_unassigned_synthesizes_one_flagged_beat():
    scene = _scene("INT. BAR - NIGHT\nmystery block")  # 2 lines, no beats
    seg = _seg([], unassigned=[(1, 2, "could not segment")])
    beats = validate_and_slice(scene, seg)
    assert len(beats) == 1
    assert beats[0].script_text == "INT. BAR - NIGHT\nmystery block"
    assert beats[0].unassigned == [(1, 2)]


def test_empty_segmentation_rejected():
    scene = _scene("INT. BAR - NIGHT\nDan pours.")
    with pytest.raises(CoverageError):
        validate_and_slice(scene, _seg([]))


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
        k = len(scene.lines)
        # one beat covering the whole scene → tiles it exactly
        seg = _seg([(1, k, "w", "l", "f")])
        scenes_beats.append(validate_and_slice(scene, seg))
    assert reconstruct(scenes_beats) == source


def test_reconstruct_byte_identical_with_unassigned_buckets():
    source = "INT. BAR - NIGHT\nDan pours.\nORPHAN\n\nEXT. STREET - DAY\nReyes."
    scenes = split_into_scenes(source)
    s1, s2 = scenes
    # scene 1 (4 lines): beat 1-2, unassigned 3, beat 4(blank)
    b1 = validate_and_slice(s1, _seg([(1, 2, "a", "b", "c"), (4, 4, "d", "e", "f")], [(3, 3, "x")]))
    b2 = validate_and_slice(s2, _seg([(1, len(s2.lines), "g", "h", "i")]))
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
