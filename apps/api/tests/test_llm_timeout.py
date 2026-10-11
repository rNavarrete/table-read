"""Wall-clock timeout on `messages.create` (task 3): a hung SDK call must
surface `LlmTimeoutError` promptly rather than blocking forever, and must
never be treated as a rule-9 schema-invalid retry target -- the eval loops
(checks.py/adoption.py) catch it as a distinct attempt failure alongside
`SchemaInvalidLlmError`, never fabricating a fallback response.
"""

from __future__ import annotations

import contextlib
import logging
import time
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest

from llm.anthropic_client import (
    DEFAULT_LLM_CALL_TIMEOUT_SECONDS,
    AnthropicClient,
    _create_with_timeout,
    _stream_final_with_timeout,
)
from llm.errors import LlmTimeoutError, SchemaInvalidLlmError, log_llm_unavailable
from llm.ops import OP_REGISTRY

_MODELS = {
    "writer": "m",
    "classifier": "m",
    "import_worker": "m",
    "import_analyst": "m",
}


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


def test_anthropic_client_times_out_hung_create(caplog):
    client = AnthropicClient(
        _HangSdk(),
        _MODELS,
        call_timeout_seconds=0.2,
    )
    t0 = time.monotonic()
    with caplog.at_level(logging.WARNING, logger="llm.anthropic_client"):
        with pytest.raises(LlmTimeoutError) as exc_info:
            client.generate_beat_candidates(
                system="s", user_message="u", prompt_version="0.0.0-test"
            )

    assert exc_info.value.op == "generate_beat_candidates"
    assert time.monotonic() - t0 < 2.0
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "llm_unavailable" in joined
    assert "LlmTimeoutError" in joined
    assert "generate_beat_candidates" in joined
    assert "timeout_seconds=0.2" in joined


def test_log_llm_unavailable_rate_limit_metadata_not_message(caplog):
    """429 body `error.type` is logged; human message text is not."""
    resp = httpx.Response(
        429,
        request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"),
        json={
            "type": "error",
            "error": {
                "type": "rate_limit_error",
                "message": "SECRET_SCRIPT_FRAGMENT should not leak",
            },
        },
    )
    exc = anthropic.RateLimitError(
        message="rate limited", response=resp, body=resp.json()
    )
    logger = logging.getLogger("llm.errors.test")
    with caplog.at_level(logging.WARNING, logger="llm.errors.test"):
        log_llm_unavailable(logger, exc, where="unit", op="infer_story_entities")
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "RateLimitError" in joined
    assert "status=429" in joined
    assert "error_type=rate_limit_error" in joined
    assert "reason_class=rate_limit" in joined
    assert "infer_story_entities" in joined
    assert "SECRET_SCRIPT_FRAGMENT" not in joined


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


# ---------------------------------------------------------------------------
# T9.4: the SDK never retries on its own (`max_retries=0`), so a timed-out call
# is never silently re-sent and billed twice. The helpers retry exactly once,
# after a backoff, and only on 429/529/5xx: those requests were rejected
# unbilled. Each attempt carries the op's own timeout to the SDK.
# ---------------------------------------------------------------------------

_REQUEST = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
_HANG = object()


def _status_error(cls: type, status: int) -> Exception:
    return cls(message="x", response=httpx.Response(status, request=_REQUEST), body=None)


class _ScriptedSdk:
    """Each `create`/`stream` call takes the next outcome: an exception is
    raised, `_HANG` outlives any test deadline, anything else is the reply."""

    def __init__(self, *outcomes: Any) -> None:
        self.messages = self
        self._outcomes = list(outcomes)
        self.calls: list[dict[str, Any]] = []

    def _next(self, kwargs: dict[str, Any]) -> Any:
        self.calls.append(kwargs)
        outcome = self._outcomes.pop(0)
        if outcome is _HANG:
            time.sleep(1)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    def create(self, **kwargs: Any) -> Any:
        return self._next(kwargs)

    def stream(self, **kwargs: Any) -> Any:
        reply = self._next(kwargs)
        return contextlib.nullcontext(SimpleNamespace(get_final_message=lambda: reply))


_EACH_HELPER = pytest.mark.parametrize(
    "helper", [_create_with_timeout, _stream_final_with_timeout], ids=["create", "stream"]
)


@pytest.fixture()
def no_backoff(monkeypatch):
    monkeypatch.setattr("llm.anthropic_client._OVERLOAD_BACKOFF_SECONDS", 0)


@_EACH_HELPER
@pytest.mark.parametrize(
    "error",
    [
        (anthropic.OverloadedError, 529),
        (anthropic.RateLimitError, 429),
        (anthropic.InternalServerError, 500),
        (anthropic.InternalServerError, 503),
    ],
    ids=["529", "429", "500", "503"],
)
def test_an_overload_is_retried_once_after_a_backoff(helper, error, monkeypatch):
    monkeypatch.setattr("llm.anthropic_client._OVERLOAD_BACKOFF_SECONDS", 0.05)
    sdk = _ScriptedSdk(_status_error(*error), "reply")

    t0 = time.monotonic()
    assert helper(sdk, 180.0, "segment_scene", model="m") == "reply"

    assert len(sdk.calls) == 2
    assert time.monotonic() - t0 >= 0.05, "the retry waits out a backoff first"


@_EACH_HELPER
def test_a_second_overload_surfaces_without_a_third_attempt(helper, no_backoff):
    overloaded = _status_error(anthropic.OverloadedError, 529)
    sdk = _ScriptedSdk(overloaded, overloaded, "unused")

    with pytest.raises(anthropic.OverloadedError):
        helper(sdk, 180.0, "segment_scene", model="m")
    assert len(sdk.calls) == 2


@_EACH_HELPER
@pytest.mark.parametrize(
    "error",
    [
        _status_error(anthropic.BadRequestError, 400),
        # The SDK's own read timeout: the request may have run, and been billed.
        anthropic.APITimeoutError(request=_REQUEST),
        # A gateway timeout is a timeout too (the SDK raises 504 as InternalServerError).
        _status_error(anthropic.InternalServerError, 504),
        anthropic.APIConnectionError(request=_REQUEST),
    ],
    ids=["400", "sdk-timeout", "504", "connection"],
)
def test_other_failures_are_not_retried(helper, error, no_backoff):
    sdk = _ScriptedSdk(error, "unused")

    with pytest.raises(type(error)):
        helper(sdk, 180.0, "segment_scene", model="m")
    assert len(sdk.calls) == 1


@_EACH_HELPER
def test_a_deadline_timeout_is_not_retried(helper, no_backoff):
    sdk = _ScriptedSdk(_HANG, "unused")

    with pytest.raises(LlmTimeoutError):
        helper(sdk, 0.05, "segment_scene", model="m")
    assert len(sdk.calls) == 1


@_EACH_HELPER
def test_each_attempt_carries_the_op_timeout_to_the_sdk(helper, no_backoff):
    sdk = _ScriptedSdk(_status_error(anthropic.OverloadedError, 529), "reply")

    helper(sdk, 180.0, "infer_story_entities", model="m")

    assert [call["timeout"] for call in sdk.calls] == [180.0, 180.0]


def test_the_per_op_budget_replaces_the_sdk_default_read_timeout():
    """`extract_ledger_facts` has a 300s budget; the SDK client is built with
    120s, which used to win because the per-op value never reached it."""
    sdk = _ScriptedSdk(SimpleNamespace(content=[]), SimpleNamespace(content=[]))
    client = AnthropicClient(sdk, _MODELS)

    with pytest.raises(SchemaInvalidLlmError):
        client.extract_ledger_facts(system="s", user_message="u", prompt_version="0.0.0-test")

    assert OP_REGISTRY["extract_ledger_facts"].call_timeout_seconds == 300.0
    assert [call["timeout"] for call in sdk.calls] == [300.0, 300.0]
