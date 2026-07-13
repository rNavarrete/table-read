import pytest

from fountain.acts import ActInferenceError, expand_act_starts
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
