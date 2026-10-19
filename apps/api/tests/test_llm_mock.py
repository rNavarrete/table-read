"""MockLlmClient: deterministic replay, override, and never-network coverage."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from llm.mock import MockLlmClient
from llm.ops import OP_REGISTRY
from schemas import BeatCandidate, InstructionSuggestions

_CALL_KWARGS = {"system": "sys", "user_message": "hi", "prompt_version": "0.1.0"}


def test_every_op_is_callable_and_returns_the_right_type():
    client = MockLlmClient()
    for name, op in OP_REGISTRY.items():
        result = getattr(client, name)(**_CALL_KWARGS)
        assert isinstance(result, op.model)


def test_calls_are_deterministic():
    client = MockLlmClient()
    first = client.generate_beat_candidates(**_CALL_KWARGS)
    second = client.generate_beat_candidates(**_CALL_KWARGS)
    assert first == second


def test_calls_ignore_input_content():
    client = MockLlmClient()
    a = client.suggest_instructions(system="a", user_message="a", prompt_version="0.1.0")
    b = client.suggest_instructions(
        system="totally different", user_message="also different", prompt_version="9.9.9"
    )
    assert a == b


def test_segment_scene_returns_beat_actions_and_the_scene_turn():
    """T10.1: the mock fills every new segment_scene field, deterministically."""
    result = MockLlmClient().segment_scene(**_CALL_KWARGS)
    beat = result.segments[0]
    assert (beat.actor, beat.action_verb, beat.target) == ("Marta", "confronts", "Dan")
    assert beat.reaction
    assert result.scene_value_at_stake == "trust"
    assert (result.scene_charge_in, result.scene_charge_out) == ("positive", "negative")
    assert result.scene_why_now
    assert result == MockLlmClient().segment_scene(**_CALL_KWARGS)


def test_set_response_overrides_the_default_for_that_op_only():
    client = MockLlmClient()
    original_tune = client.tune_beat(**_CALL_KWARGS)

    override = BeatCandidate(
        label="Power shift",
        beatPlan={"whatHappens": "x", "audienceLearns": "y", "audienceFeels": "z"},
        scriptText="MARTA\nEnough.",
        continuityConflicts=[],
    )
    client.set_response("generate_beat_candidates", override)

    assert client.generate_beat_candidates(**_CALL_KWARGS) == override
    assert client.tune_beat(**_CALL_KWARGS) == original_tune  # untouched


def test_infer_act_breaks_can_be_overridden():
    from schemas import InferredActBreaks

    client = MockLlmClient()
    response = InferredActBreaks(
        starts=[
            {"act": 1, "startSceneIndex": 0},
            {"act": 2, "startSceneIndex": 4},
        ]
    )
    client.set_response("infer_act_breaks", response)
    assert client.infer_act_breaks(**_CALL_KWARGS) == response


def test_set_response_rejects_unknown_op():
    client = MockLlmClient()
    with pytest.raises(KeyError):
        client.set_response("not_a_real_op", object())


def test_set_responses_returns_queue_in_order_then_falls_back_to_default():
    client = MockLlmClient()
    default = client.suggest_instructions(**_CALL_KWARGS)
    q1 = InstructionSuggestions(suggestions=["a", "b", "c"])
    q2 = InstructionSuggestions(suggestions=["d", "e", "f"])
    client.set_responses("suggest_instructions", [q1, q2])

    assert client.suggest_instructions(**_CALL_KWARGS) == q1
    assert client.suggest_instructions(**_CALL_KWARGS) == q2
    # queue exhausted → back to the default response
    assert client.suggest_instructions(**_CALL_KWARGS) == default


def test_concurrent_calls_do_not_lose_counts_or_race_queue_pop():
    client = MockLlmClient()
    queued = InstructionSuggestions(suggestions=["queued", "response", "only"])
    fallback = client.suggest_instructions(**_CALL_KWARGS)
    client.reset_invocation_counts()

    class _SlowTruthQueue(list):
        def __bool__(self) -> bool:
            result = len(self) > 0
            if result:
                ready.wait()
                time.sleep(0.001)
            return result

    class _SlowInvocationCounts(dict):
        def get(self, key, default=None):
            value = super().get(key, default)
            ready.wait()
            time.sleep(0.001)
            return value

    ready = threading.Event()
    client._queues["suggest_instructions"] = _SlowTruthQueue([queued])
    client._invocations = _SlowInvocationCounts(client._invocations)

    def call_suggestions() -> InstructionSuggestions:
        ready.wait()
        return client.suggest_instructions(**_CALL_KWARGS)

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(call_suggestions) for _ in range(8)]
        ready.set()
        results = [future.result() for future in futures]

    assert client.invocation_count("suggest_instructions") == 8
    assert sum(result == queued for result in results) == 1
    assert sum(result == fallback for result in results) == 7


def test_set_responses_rejects_unknown_op():
    client = MockLlmClient()
    with pytest.raises(KeyError):
        client.set_responses("not_a_real_op", [])


def test_stream_beat_candidate_default_serializes_generate_response():
    client = MockLlmClient()
    default = client.generate_beat_candidates(**_CALL_KWARGS)
    frags = list(client.stream_beat_candidate(**_CALL_KWARGS))
    assert BeatCandidate.model_validate_json("".join(frags)) == default


def test_stream_beat_candidate_follows_generate_response_queue():
    client = MockLlmClient()
    c1 = BeatCandidate(
        label="First",
        beatPlan={"whatHappens": "a", "audienceLearns": "b", "audienceFeels": "c"},
        scriptText="one",
        continuityConflicts=[],
    )
    c2 = BeatCandidate(
        label="Second",
        beatPlan={"whatHappens": "a", "audienceLearns": "b", "audienceFeels": "c"},
        scriptText="two",
        continuityConflicts=[],
    )
    client.set_responses("generate_beat_candidates", [c1, c2])

    def _streamed() -> BeatCandidate:
        raw = "".join(client.stream_beat_candidate(**_CALL_KWARGS))
        return BeatCandidate.model_validate_json(raw)

    assert _streamed() == c1
    assert _streamed() == c2


def test_set_candidate_streams_yields_exact_fragments_in_order():
    client = MockLlmClient()
    client.set_candidate_streams([["a", "b"], ["c"]])
    assert list(client.stream_beat_candidate(**_CALL_KWARGS)) == ["a", "b"]
    assert list(client.stream_beat_candidate(**_CALL_KWARGS)) == ["c"]
    # exhausted → falls back to serializing the generate default
    fallback = list(client.stream_beat_candidate(**_CALL_KWARGS))
    assert BeatCandidate.model_validate_json("".join(fallback))


def test_mock_client_never_imports_the_anthropic_sdk():
    # If MockLlmClient ever grew a dependency on the `anthropic` package,
    # importing it in a test could trigger network-capable code paths. Guard
    # this stays true structurally: the module source never mentions it.
    import inspect

    import llm.mock as mock_module

    assert "anthropic" not in inspect.getsource(mock_module)


def test_prewarm_cache_is_recorded_and_returns_nothing():
    client = MockLlmClient()

    assert (
        client.prewarm_cache("segment_scene", system="s", user_message="u", cache_prefix="p")
        is None
    )
    client.prewarm_cache("segment_scene", system="s", user_message="u")

    assert client.invocation_count("prewarm_cache:segment_scene") == 2
    assert client._invocations["prewarm_cache:segment_scene"] == 2
    assert client.invocation_count("segment_scene") == 0, "a prewarm is not a generation call"
    assert client.invocation_count("prewarm_cache:extract_ledger_facts") == 0
    assert client.cache_prefixes_by_op == {}


def test_prewarm_cache_rejects_an_unknown_op():
    client = MockLlmClient()

    with pytest.raises(KeyError):
        client.prewarm_cache("segment_scenes", system="s", user_message="u")
    with pytest.raises(KeyError):
        client.invocation_count("prewarm_cache:segment_scenes")
