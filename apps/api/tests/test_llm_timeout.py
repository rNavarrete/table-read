"""Wall-clock timeout on `messages.create` (task 3): a hung SDK call must
surface `LlmTimeoutError` promptly rather than blocking forever, and must
never be treated as a rule-9 schema-invalid retry target -- the eval loops
(checks.py/adoption.py) catch it as a distinct attempt failure alongside
`SchemaInvalidLlmError`, never fabricating a fallback response.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import pytest

from llm.anthropic_client import DEFAULT_LLM_CALL_TIMEOUT_SECONDS, AnthropicClient
from llm.errors import LlmTimeoutError, SchemaInvalidLlmError

_MODELS = {"writer": "m", "classifier": "m"}


class _HangSdk:
    def __init__(self) -> None:
        self.messages = self
        self.calls = 0

    def create(self, **kwargs: Any) -> Any:
        self.calls += 1
        time.sleep(5)
        raise AssertionError("should not complete")


def test_default_timeout_constant_is_120_seconds():
    assert DEFAULT_LLM_CALL_TIMEOUT_SECONDS == 120


def test_anthropic_client_times_out_hung_create():
    client = AnthropicClient(
        _HangSdk(),
        _MODELS,
        call_timeout_seconds=0.2,
    )
    t0 = time.monotonic()
    with pytest.raises(LlmTimeoutError) as exc_info:
        client.generate_beat_candidates(system="s", user_message="u", prompt_version="0.0.0-test")

    assert exc_info.value.op == "generate_beat_candidates"
    assert time.monotonic() - t0 < 2.0


def test_hung_retry_call_also_times_out_without_a_third_attempt():
    """A first response that fails schema validation enters the rule-9 retry;
    if *that* call hangs, the timeout still surfaces as `LlmTimeoutError` --
    not a second, fabricated `SchemaInvalidLlmError` -- and there is still no
    third attempt."""

    @dataclass
    class _FakeToolUseBlock:
        input: dict[str, Any]
        name: str = "generate_beat_candidates"
        id: str = "toolu_1"
        type: str = "tool_use"

    @dataclass
    class _FakeMessage:
        content: list[Any] = field(default_factory=list)
        stop_reason: str = "tool_use"

    class _FirstInvalidThenHangSdk:
        def __init__(self) -> None:
            self.messages = self
            self.calls = 0

        def create(self, **kwargs: Any) -> Any:
            self.calls += 1
            if self.calls == 1:
                # Missing required fields -> Pydantic ValidationError -> rule-9 retry.
                return _FakeMessage(content=[_FakeToolUseBlock(input={})])
            time.sleep(5)
            raise AssertionError("should not complete")

    sdk = _FirstInvalidThenHangSdk()
    client = AnthropicClient(sdk, _MODELS, call_timeout_seconds=0.2)

    t0 = time.monotonic()
    with pytest.raises(LlmTimeoutError) as exc_info:
        client.generate_beat_candidates(system="s", user_message="u", prompt_version="0.0.0-test")

    assert exc_info.value.op == "generate_beat_candidates"
    assert time.monotonic() - t0 < 2.0
    assert sdk.calls == 2  # retried exactly once, then timed out -- no third attempt


def test_timeout_is_not_a_schema_invalid_llm_error():
    # LlmTimeoutError must never be conflated with rule-9's retry-exhausted error.
    assert not issubclass(LlmTimeoutError, SchemaInvalidLlmError)
    assert not issubclass(SchemaInvalidLlmError, LlmTimeoutError)


def test_default_call_timeout_seconds_is_used_when_not_overridden():
    """Constructing without `call_timeout_seconds` uses the 120s default --
    proven structurally (not by actually waiting 120s)."""
    client = AnthropicClient(_HangSdk(), _MODELS)
    assert client._call_timeout_seconds == DEFAULT_LLM_CALL_TIMEOUT_SECONDS


# ---------------------------------------------------------------------------
# Eval-loop integration: a timeout must count as an attempt failure -- never
# a fabricated valid result -- alongside SchemaInvalidLlmError.
# ---------------------------------------------------------------------------


class _AlwaysTimesOutLlmClient:
    """A fake `LlmClient` whose every op raises `LlmTimeoutError` -- stands in
    for a hung `AnthropicClient` in eval-loop tests without any real sleep."""

    def __getattr__(self, name: str):
        def _op(**kwargs: Any):
            raise LlmTimeoutError(name)

        return _op


def test_schema_validity_eval_counts_timeout_as_invalid_not_valid():
    from evals.checks import schema_validity_eval
    from evals.probes import load_fixture_ctx

    ctx = load_fixture_ctx()
    result = schema_validity_eval(_AlwaysTimesOutLlmClient(), ctx, runs=2)

    assert result.score == 0.0
    for op_detail in result.detail["perOp"].values():
        assert op_detail["valid"] == 0


def test_grader_calibration_timeout_fails_closed_without_fabricating_verdict():
    from evals.graders import calibrate

    class _TimeoutJudge:
        def grade(self, *, script_text: str, facts: list[dict]):
            raise LlmTimeoutError("continuity_judge")

    assert calibrate(_TimeoutJudge(), facts=[]) is False
