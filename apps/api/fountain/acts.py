from __future__ import annotations

from schemas import InferredActBreaks


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
