"""MockLlmClient: deterministic replay, override, and never-network coverage."""

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


def test_set_responses_rejects_unknown_op():
    client = MockLlmClient()
    with pytest.raises(KeyError):
        client.set_responses("not_a_real_op", [])


def test_mock_client_never_imports_the_anthropic_sdk():
    # If MockLlmClient ever grew a dependency on the `anthropic` package,
    # importing it in a test could trigger network-capable code paths. Guard
    # this stays true structurally: the module source never mentions it.
    import inspect

    import llm.mock as mock_module

    assert "anthropic" not in inspect.getsource(mock_module)
