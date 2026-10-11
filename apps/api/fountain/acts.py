from __future__ import annotations

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
    previous_act = -1
    previous_scene = -1
    for item in starts:
        if item.act > max_act:
            diagnostics.append(
                {"code": "act_out_of_range", "act": item.act, "maxAct": max_act}
            )
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


def _printed_act_start(line: str, act_count: int) -> int | None:
    """The printed act number (0 = teaser / cold open) whose start this line
    marks, or None. `END OF ACT n` marks where act n+1 starts."""
    text = " ".join(line.split())
    # Markers are printed in caps; dialogue such as "Act two." is not one.
    if text != text.upper():
        return None
    text = text.strip("<>*_.: ")
    is_end = text.startswith("END OF ")
    body = text.removeprefix("END OF ")
    if body in ("TEASER", "COLD OPEN"):
        number = 0
    elif _ACT_MARKER_RE.match(text):
        token = body.split()[-1]
        number = int(token) if token.isdigit() else _ACT_NUMBERS.get(token)
        if number is None:
            return None
    else:
        return None
    if not is_end:
        return number
    return None if number == act_count else number + 1


def acts_from_markers(spans, format_dict: dict) -> list[int] | None:
    """The act partition the script's printed markers state, or None when they
    are absent, partial, conflicting, or disagree with the format's acts."""
    act_count = int(format_dict["actCount"])
    offset = 0 if format_dict.get("coldOpen") else 1
    starts: dict[int, int] = {}
    for index, span in enumerate(spans):
        # A marker sits after its scene's heading, so it opens the next scene;
        # in the pre-heading front matter it opens everything.
        start = index + 1 if span.location else index
        for line in span.lines:
            number = _printed_act_start(line, act_count)
            if number is None:
                continue
            act = number - offset
            if act < 0 or starts.setdefault(act, start) != start:
                return None
    if offset == 0 and 0 not in starts and starts.get(1, 0) > 0:
        # Under a cold-open format, what precedes ACT ONE is the cold open
        # (its TEASER line is often stripped with the front matter); a script
        # that opens on ACT ONE has an empty cold open.
        starts[0] = 0
    first = 1 if offset == 0 and 0 not in starts else 0
    if sorted(starts) != list(range(first, _max_act(format_dict) + 1)):
        return None
    breaks = InferredActBreaks(
        starts=[{"act": act, "startSceneIndex": s} for act, s in sorted(starts.items())]
    )
    try:
        return expand_act_starts(breaks, scene_count=len(spans), format_dict=format_dict)
    except ActInferenceError:
        return None


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
