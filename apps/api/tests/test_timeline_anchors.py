"""Unit tests for T7.24 timeline-anchor inference (design doc
`docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-design.md`
"T7.24 — Timeline anchors").

`merge_timeline_anchors` is a pure, deterministic function over scene docs
(no LLM): it reads each scene's slugline (`location`) time-of-day suffix
and flags scenes whose suffix names a time *jump* (relative — "Three days
later" — or absolute — a clock time / weekday), anchored to the *previous*
scene. Bare day-parts ("DAY", "NIGHT", "CONTINUOUS") are common and are not
jumps, so they never produce an anchor.
"""

from __future__ import annotations

from fountain.timeline import merge_timeline_anchors


def _scene(scene_id: str, location: str) -> dict:
    return {"id": scene_id, "location": location}


def test_no_anchors_for_bare_day_part_sluglines():
    scenes = [
        _scene("scene-1", "INT. THE LONG POUR - DAY"),
        _scene("scene-2", "EXT. MARINA - NIGHT"),
        _scene("scene-3", "INT. KITCHEN - CONTINUOUS"),
    ]
    assert merge_timeline_anchors(scenes) == []


def test_first_scene_never_anchors_even_with_a_relative_marker():
    """No preceding scene to anchor "after" — the first scene is skipped
    regardless of its own slugline text."""
    scenes = [_scene("scene-1", "INT. THE LONG POUR - THREE DAYS LATER")]
    assert merge_timeline_anchors(scenes) == []


def test_relative_marker_anchors_to_previous_scene():
    scenes = [
        _scene("scene-1", "INT. THE LONG POUR - BAR - DAY"),
        _scene("scene-2", "INT. THE LONG POUR - BAR - THREE DAYS LATER"),
    ]
    anchors = merge_timeline_anchors(scenes)
    assert anchors == [
        {
            "afterSceneId": "scene-1",
            "label": "Three Days Later",
            "kind": "relative",
            "quote": "INT. THE LONG POUR - BAR - THREE DAYS LATER",
        }
    ]


def test_absolute_clock_time_marker_is_kind_absolute():
    scenes = [
        _scene("scene-1", "INT. THE LONG POUR - DAY"),
        _scene("scene-2", "INT. THE LONG POUR - 6:15 AM"),
    ]
    anchors = merge_timeline_anchors(scenes)
    assert anchors == [
        {
            "afterSceneId": "scene-1",
            "label": "6:15 Am",
            "kind": "absolute",
            "quote": "INT. THE LONG POUR - 6:15 AM",
        }
    ]


def test_weekday_marker_is_kind_absolute():
    scenes = [
        _scene("scene-1", "INT. THE LONG POUR - DAY"),
        _scene("scene-2", "INT. THE LONG POUR - MONDAY MORNING"),
    ]
    anchors = merge_timeline_anchors(scenes)
    assert anchors[0]["kind"] == "absolute"
    assert anchors[0]["afterSceneId"] == "scene-1"


def test_case_insensitive_matching():
    scenes = [
        _scene("scene-1", "int. the long pour - day"),
        _scene("scene-2", "int. the long pour - three days later"),
    ]
    anchors = merge_timeline_anchors(scenes)
    assert anchors[0]["kind"] == "relative"


def test_multiple_dashes_uses_trailing_segment():
    scenes = [
        _scene("scene-1", "INT. THE LONG POUR - BAR - DAY"),
        _scene("scene-2", "INT. THE LONG POUR - BASEMENT - THAT NIGHT"),
    ]
    anchors = merge_timeline_anchors(scenes)
    assert anchors == [
        {
            "afterSceneId": "scene-1",
            "label": "That Night",
            "kind": "relative",
            "quote": "INT. THE LONG POUR - BASEMENT - THAT NIGHT",
        }
    ]


def test_slugline_without_a_dash_produces_no_anchor():
    scenes = [
        _scene("scene-1", "INT. THE LONG POUR - DAY"),
        _scene("scene-2", "INT. KITCHEN"),
    ]
    assert merge_timeline_anchors(scenes) == []


def test_multiple_anchors_ordered_by_scene_order():
    scenes = [
        _scene("scene-1", "INT. THE LONG POUR - DAY"),
        _scene("scene-2", "INT. THE LONG POUR - THREE DAYS LATER"),
        _scene("scene-3", "EXT. MARINA - NIGHT"),
        _scene("scene-4", "INT. THE LONG POUR - THE NEXT MORNING"),
    ]
    anchors = merge_timeline_anchors(scenes)
    assert [a["afterSceneId"] for a in anchors] == ["scene-1", "scene-3"]


def test_empty_scene_list_returns_empty():
    assert merge_timeline_anchors([]) == []
