from __future__ import annotations

from typing import NamedTuple

from fountain.characters import _ACT_MARKER_RE
from schemas import InferredActBreaks

_ACT_NUMBERS = {
    "ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5, "SIX": 6, "SEVEN": 7,
    "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7,
}


class ActInferenceError(ValueError):
    def __init__(self, diagnostics: list[dict]) -> None:
        self.diagnostics = diagnostics
        super().__init__("invalid inferred act starts")


def _max_act(format_dict: dict) -> int:
    count = int(format_dict["actCount"])
    return count if format_dict.get("coldOpen") else count - 1


def _tag_act(format_dict: dict) -> int | None:
    """The tag's act number, `actCount + 1`, or None when the format has no
    tag (T10.7; mirrors the cold open's act 0)."""
    return int(format_dict["actCount"]) + 1 if format_dict.get("tag") else None


def expand_act_starts(
    inferred: InferredActBreaks,
    *,
    scene_count: int,
    format_dict: dict,
) -> list[int]:
    starts = inferred.starts
    diagnostics: list[dict] = []
    if scene_count < 1:
        diagnostics.append({"code": "empty_scene_list"})
    if starts and starts[0].start_scene_index != 0:
        diagnostics.append(
            {
                "code": "first_start_not_zero",
                "startSceneIndex": starts[0].start_scene_index,
            }
        )

    max_act = _max_act(format_dict)
    tag = _tag_act(format_dict)
    previous_act = -1
    previous_scene = -1
    for item in starts:
        if item.act > max_act and item.act != tag:
            diagnostic = {"code": "act_out_of_range", "act": item.act, "maxAct": max_act}
            if tag is not None:
                diagnostic["tagAct"] = tag
            diagnostics.append(diagnostic)
        if item.act <= previous_act:
            diagnostics.append({"code": "acts_not_strictly_increasing", "act": item.act})
        if item.start_scene_index <= previous_scene:
            diagnostics.append(
                {
                    "code": "scene_starts_not_strictly_increasing",
                    "startSceneIndex": item.start_scene_index,
                }
            )
        if item.start_scene_index >= scene_count:
            diagnostics.append(
                {
                    "code": "scene_start_out_of_range",
                    "startSceneIndex": item.start_scene_index,
                    "sceneCount": scene_count,
                }
            )
        previous_act = item.act
        previous_scene = item.start_scene_index

    if diagnostics:
        raise ActInferenceError(diagnostics)

    acts = [0] * scene_count
    for index, item in enumerate(starts):
        end = (
            starts[index + 1].start_scene_index
            if index + 1 < len(starts)
            else scene_count
        )
        acts[item.start_scene_index:end] = [item.act] * (end - item.start_scene_index)
    return acts


# `_printed_marker`'s number for a printed TAG: its act depends on the format.
_TAG = -1


def _printed_marker(line: str) -> tuple[int, bool] | None:
    """`(act it names, is END OF)` for a printed act marker (0 = teaser /
    cold open, `_TAG` = tag), or None."""
    text = " ".join(line.split())
    # Markers are printed in caps; dialogue such as "Act two." is not one.
    if text != text.upper():
        return None
    text = text.strip("<>*_.: ")
    is_end = text.startswith("END OF ")
    body = text.removeprefix("END OF ")
    if body in ("TEASER", "COLD OPEN"):
        return 0, is_end
    if body == "TAG":
        return _TAG, is_end
    if not _ACT_MARKER_RE.match(text):
        return None
    token = body.split()[-1]
    number = int(token) if token.isdigit() else _ACT_NUMBERS.get(token)
    return None if number is None else (number, is_end)


def _printed_act_start(line: str, act_count: int) -> int | None:
    """The printed act number (0 = teaser / cold open, `_TAG` = tag) whose
    start this line marks, or None. `END OF ACT n` marks where act n+1 starts;
    the end of the last act or of the tag starts nothing."""
    marker = _printed_marker(line)
    if marker is None:
        return None
    number, is_end = marker
    if not is_end:
        return number
    return None if number in (act_count, _TAG) else number + 1


def acts_from_markers(spans, format_dict: dict) -> list[int] | None:
    """The act partition the script's printed markers state, or None when they
    are absent, partial, conflicting, or disagree with the format's acts. A
    printed TAG opens the tag (T10.7); unprinted, the tag stays empty, and
    printed under a format with no tag, the markers disagree with it."""
    act_count = int(format_dict["actCount"])
    offset = 0 if format_dict.get("coldOpen") else 1
    tag = _tag_act(format_dict)
    starts: dict[int, int] = {}
    for index, span in enumerate(spans):
        # A marker sits after its scene's heading, so it opens the next scene;
        # in the pre-heading front matter it opens everything.
        start = index + 1 if span.location else index
        for line in span.lines:
            number = _printed_act_start(line, act_count)
            if number is None:
                continue
            if number == _TAG:
                if tag is None:
                    return None
                act = tag
            else:
                act = number - offset
            if act < 0 or starts.setdefault(act, start) != start:
                return None
    if offset == 0 and 0 not in starts and starts.get(1, 0) > 0:
        # Under a cold-open format, what precedes ACT ONE is the cold open
        # (its TEASER line is often stripped with the front matter); a script
        # that opens on ACT ONE has an empty cold open.
        starts[0] = 0
    first = 1 if offset == 0 and 0 not in starts else 0
    if sorted(set(starts) - {tag}) != list(range(first, _max_act(format_dict) + 1)):
        return None
    breaks = InferredActBreaks(
        starts=[{"act": act, "startSceneIndex": s} for act, s in sorted(starts.items())]
    )
    try:
        return expand_act_starts(breaks, scene_count=len(spans), format_dict=format_dict)
    except ActInferenceError:
        return None


# ShowFormat.actCount's ceiling (packages/contract).
_MAX_PRINTED_ACTS = 6


class PrintedStructure(NamedTuple):
    act_count: int
    cold_open: bool
    # A TAG is printed (T10.7).
    tag: bool
    # The acts the markers state for every scene, or None when they don't
    # state a full partition (a heading stripped with the front matter, an
    # OCR-damaged one, or only END OF ACT lines).
    scene_acts: list[int] | None


def printed_structure(front_matter: list[str], spans) -> PrintedStructure | None:
    """The act structure the script prints, read without being told a format,
    or None when it prints no act. Used when an import works its format out
    from the script (owner decision 2026-10-11): the printed structure decides
    act count, cold open and tag, and the model decides the rest.

    Reads the whole script: `front_matter` is the lines stripped before
    `spans`, where a leading TEASER or ACT ONE usually sits. The act count is
    the highest act printed (END OF ACT n names act n). There is a cold open
    when a TEASER / COLD OPEN is printed, or when a scene comes before the
    first ACT ONE, and a tag when a TAG is printed."""
    # Every line, paired with whether a scene heading precedes it (a span's
    # heading is its first line, so its markers follow it).
    script = [(False, line) for line in front_matter]
    scene_seen = False
    for span in spans:
        scene_seen = scene_seen or bool(span.location)
        script += [(scene_seen, line) for line in span.lines]
    highest = 0
    cold_open = False
    tag = False
    act_one_seen = False
    for after_a_scene, line in script:
        marker = _printed_marker(line)
        if marker is None:
            continue
        number, is_end = marker
        highest = max(highest, number)
        if number == 0:
            cold_open = True
        elif number == _TAG:
            tag = True
        elif number == 1 and not is_end and not act_one_seen:
            act_one_seen = True
            cold_open = cold_open or after_a_scene
    if not 1 <= highest <= _MAX_PRINTED_ACTS:
        return None
    scene_acts = acts_from_markers(
        spans, {"actCount": highest, "coldOpen": cold_open, "tag": tag}
    )
    return PrintedStructure(highest, cold_open, tag, scene_acts)


def scene_summaries(spans, per_scene_beats) -> list[dict]:
    return [
        {
            "sceneIndex": index,
            "location": span.location,
            "beats": [
                {
                    "whatHappens": beat.what_happens,
                    "audienceLearns": beat.audience_learns,
                    "audienceFeels": beat.audience_feels,
                }
                for beat in beats
            ],
        }
        for index, (span, beats) in enumerate(
            zip(spans, per_scene_beats, strict=True)
        )
    ]
