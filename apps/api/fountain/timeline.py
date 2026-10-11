"""T7.24 timeline anchors — deterministic, no LLM (design doc
`docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-design.md`
"T7.24 — Timeline anchors").

`merge_timeline_anchors` reads each scene's slugline (`location`, e.g.
``"INT. THE LONG POUR - BAR - THREE DAYS LATER"``) trailing time-of-day
segment and flags the scenes whose segment names a time *jump* rather than
a bare day-part. Anchors are display-only in MVP: `afterSceneId` records
which scene the jump follows, but the as-of filter stays scene-index-based
(`drama_manager/ledger_as_of`) -- anchors never reorder scenes.
"""

from __future__ import annotations

import re

# A jump is either a specific clock time / weekday ("absolute") or a
# relative-elapsed-time phrase ("relative"). Anything else (bare day-parts
# like "DAY", "NIGHT", "CONTINUOUS", "SAME TIME", or an unparseable/missing
# segment) is too common and ambiguous to anchor -- it's just this scene's
# time of day, not evidence that time passed since the previous scene.
_ABSOLUTE_RE = re.compile(
    r"\b(\d{1,2}(:\d{2})?\s*(AM|PM)|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|"
    r"SATURDAY|SUNDAY)\b",
    re.IGNORECASE,
)
_RELATIVE_KEYWORDS = (
    "LATER",
    "NEXT DAY",
    "NEXT MORNING",
    "NEXT NIGHT",
    "FOLLOWING",
    "THAT NIGHT",
    "THAT MORNING",
    "THAT AFTERNOON",
    "THAT EVENING",
    "MEANWHILE",
)
# A bare hyphen needs spaces around it ("SEMI-DETACHED" is one word).
_TIME_SEPARATOR_RE = re.compile(r"\s+-\s+|\s*(?:--|—|–|~)\s*")
# Production scene number trailing the heading ("DAY 17", "NIGHT A12").
_SCENE_NUMBER_SUFFIX_RE = re.compile(r"\s+[A-Za-z]?\d{1,3}[A-Za-z]?\s*$")


def slugline_time(location: str) -> str:
    """The slugline's trailing time-of-day segment, or `""` when it has none.

    `Scene.time` is a real contract field and the Plan inspector shows it, but
    import left it empty on every scene while putting the whole slugline —
    time included — into `location`. A writer opening Plan after an import
    therefore saw a blank TIME on all 27 scenes with "- NIGHT" sitting in the
    location box beside it.

    `location` deliberately keeps the full slugline: it is what reads correctly
    as a scene heading throughout the app, and `merge_timeline_anchors` parses
    it directly.
    """
    segments = _TIME_SEPARATOR_RE.split(location)
    if len(segments) < 2:
        return ""
    return _SCENE_NUMBER_SUFFIX_RE.sub("", segments[-1]).strip()


def _time_segment(location: str) -> str | None:
    return slugline_time(location) or None


def _classify(segment: str) -> str | None:
    """`"relative"` / `"absolute"` / `None` (not a jump) for `segment`."""
    if _ABSOLUTE_RE.search(segment):
        return "absolute"
    upper = segment.upper()
    if any(keyword in upper for keyword in _RELATIVE_KEYWORDS):
        return "relative"
    return None


def _label(segment: str) -> str:
    return " ".join(word.capitalize() for word in segment.split())


def merge_timeline_anchors(scenes: list[dict]) -> list[dict]:
    """`TimelineAnchor[]` (contract §1) for `scenes`, in scene order.

    `scenes` is an episode's ordered scene doc list (`id`/`location`
    fields). The first scene never anchors -- there is no preceding scene
    for it to jump "after".
    """
    anchors: list[dict] = []
    for index, scene in enumerate(scenes):
        if index == 0:
            continue
        location = scene.get("location") or ""
        segment = _time_segment(location)
        if not segment:
            continue
        kind = _classify(segment)
        if kind is None:
            continue
        anchors.append(
            {
                "afterSceneId": scenes[index - 1]["id"],
                "label": _label(segment),
                "kind": kind,
                "quote": location,
            }
        )
    return anchors
