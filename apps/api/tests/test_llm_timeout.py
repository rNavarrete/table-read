"""Wall-clock timeout on `messages.create` (task 3): a hung SDK call must
surface `LlmTimeoutError` promptly rather than blocking forever, and must
never be treated as a rule-9 schema-invalid retry target -- the eval loops
(checks.py/adoption.py) catch it as a distinct attempt failure alongside
`SchemaInvalidLlmError`, never fabricating a fallback response.
"""

from __future__ import annotations

import contextlib
import functools
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


class _RawResponses:
    """`messages.with_raw_response` over a fake whose `create` returns the
    reply: the SDK's raw-response shape (`.headers`, `.parse()`)."""

    def __init__(self, messages: Any) -> None:
        self._messages = messages

    def create(self, **kwargs: Any) -> Any:
        reply = self._messages.create(**kwargs)
        return SimpleNamespace(headers={}, parse=lambda: reply)


class _HangSdk:
    def __init__(self) -> None:
        self.messages = self
        self.with_raw_response = _RawResponses(self)
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
            self.with_raw_response = _RawResponses(self)
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
# is never silently re-sent and billed twice. The helpers retry only on
# 429/529/5xx-but-504 (those requests were rejected unbilled): up to 4
# attempts, honoring `retry-after` or backing off 2/4/8 s with jitter, never
# waiting more than 60 s in total. Each attempt carries the op's own timeout.
# ---------------------------------------------------------------------------

_REQUEST = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
_HANG = object()


def _status_error(
    cls: type, status: int, retry_after: str | None = None, body: dict | None = None
) -> Exception:
    headers = {"retry-after": retry_after} if retry_after is not None else None
    response = httpx.Response(status, request=_REQUEST, headers=headers)
    return cls(message="x", response=response, body=body)


def _error_body(error_type: str, **error: Any) -> dict:
    """The API's error shape (platform.claude.com/docs/en/api/errors)."""
    return {"type": "error", "error": {"type": error_type, "message": "x", **error}}


class _ScriptedSdk:
    """Each `create`/`stream` call takes the next outcome: an exception is
    raised, `_HANG` outlives any test deadline, anything else is the reply."""

    def __init__(self, *outcomes: Any) -> None:
        self.messages = self
        self.with_raw_response = _RawResponses(self)
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
        return contextlib.nullcontext(_FakeStream(reply))


class _FakeStream:
    """An SDK message stream with no events: TTFT stays unknown."""

    def __init__(self, reply: Any) -> None:
        self.get_final_message = lambda: reply

    def __next__(self) -> Any:
        raise StopIteration


# `meta` sends a plain call through `messages.with_raw_response`, as every
# non-streamed op call does.
_EACH_HELPER = pytest.mark.parametrize(
    "helper",
    [
        _create_with_timeout,
        functools.partial(_create_with_timeout, meta={}),
        _stream_final_with_timeout,
    ],
    ids=["create", "create-raw", "stream"],
)


@pytest.fixture()
def sleeps(monkeypatch) -> list[float]:
    """Swap the backoff clock for a recorder, so no test really waits."""
    recorded: list[float] = []
    monkeypatch.setattr("llm.anthropic_client._sleep", recorded.append)
    return recorded


@pytest.fixture()
def no_backoff(sleeps):
    return sleeps


_OVERLOADED = _status_error(anthropic.OverloadedError, 529)


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
def test_an_overload_is_retried_after_a_backoff(helper, error, sleeps):
    sdk = _ScriptedSdk(_status_error(*error), "reply")

    assert helper(sdk, 180.0, "segment_scene", model="m") == "reply"

    assert len(sdk.calls) == 2
    assert len(sleeps) == 1
    assert 2.0 * 0.8 <= sleeps[0] <= 2.0 * 1.2, "first backoff is 2 s, plus or minus 20%"


@_EACH_HELPER
def test_success_on_the_third_attempt_backs_off_exponentially(helper, sleeps):
    sdk = _ScriptedSdk(_OVERLOADED, _OVERLOADED, "reply")

    assert helper(sdk, 180.0, "segment_scene", model="m") == "reply"

    assert len(sdk.calls) == 3
    assert len(sleeps) == 2
    assert 1.6 <= sleeps[0] <= 2.4
    assert 3.2 <= sleeps[1] <= 4.8


@_EACH_HELPER
def test_retry_after_is_honored_over_the_backoff(helper, sleeps):
    sdk = _ScriptedSdk(_status_error(anthropic.RateLimitError, 429, retry_after="7"), "reply")

    assert helper(sdk, 180.0, "segment_scene", model="m") == "reply"

    assert sleeps == [7.0]


def test_an_unreadable_retry_after_falls_back_to_the_backoff(sleeps):
    sdk = _ScriptedSdk(_status_error(anthropic.RateLimitError, 429, retry_after="soon"), "reply")

    assert _create_with_timeout(sdk, 180.0, "segment_scene", model="m") == "reply"

    assert len(sleeps) == 1
    assert 1.6 <= sleeps[0] <= 2.4


@_EACH_HELPER
def test_attempts_are_capped_at_four(helper, sleeps):
    sdk = _ScriptedSdk(_OVERLOADED, _OVERLOADED, _OVERLOADED, _OVERLOADED, "unused")

    with pytest.raises(anthropic.OverloadedError):
        helper(sdk, 180.0, "segment_scene", model="m")

    assert len(sdk.calls) == 4
    assert len(sleeps) == 3
    assert 6.4 <= sleeps[2] <= 9.6, "the third backoff is 8 s, plus or minus 20%"


@_EACH_HELPER
def test_the_total_wait_never_exceeds_sixty_seconds(helper, sleeps):
    """A retry-after that would push the total past 60 s is not waited out:
    the overload surfaces instead, and no retry ever comes earlier than the
    API asked for."""
    limited = _status_error(anthropic.RateLimitError, 429, retry_after="40")
    sdk = _ScriptedSdk(limited, limited, "unused")

    with pytest.raises(anthropic.RateLimitError):
        helper(sdk, 180.0, "segment_scene", model="m")

    assert sleeps == [40.0]
    assert len(sdk.calls) == 2


def test_a_retry_after_above_the_cap_surfaces_at_once(sleeps):
    sdk = _ScriptedSdk(_status_error(anthropic.RateLimitError, 429, retry_after="61"), "unused")

    with pytest.raises(anthropic.RateLimitError):
        _create_with_timeout(sdk, 180.0, "segment_scene", model="m")

    assert sleeps == []
    assert len(sdk.calls) == 1


def test_each_wait_is_logged_with_numbers_only(sleeps, caplog):
    limited = _status_error(
        anthropic.RateLimitError, 429, retry_after="3", body=_error_body("rate_limit_error")
    )
    sdk = _ScriptedSdk(limited, "reply")

    with caplog.at_level(logging.WARNING, logger="llm.anthropic_client"):
        _create_with_timeout(sdk, 180.0, "segment_scene", model="m")

    [line] = [r.getMessage() for r in caplog.records]
    assert "llm_unavailable" in line
    assert "op=segment_scene" in line
    assert "status=429" in line
    assert "attempt=1" in line
    assert "wait_ms=3000" in line
    assert "retry_after=3.0" in line
    assert "error_type=rate_limit_error" in line


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
    assert no_backoff == []


# Billing and spend-limit refusals keep failing until someone pays or raises
# the limit (platform.claude.com/docs/en/api/errors and /api/rate-limits).
_BILLING = _status_error(anthropic.APIStatusError, 402, body=_error_body("billing_error"))
_SPEND_CAP = _status_error(
    anthropic.RateLimitError,
    429,
    body=_error_body("rate_limit_error", details={"error_code": "enforced_spend_limit_reached"}),
)
_OWN_SPEND_LIMIT = _status_error(
    anthropic.BadRequestError,
    400,
    body=_error_body(
        "invalid_request_error",
        message="You have reached your specified API usage limits. You will regain access "
        "on 2026-11-01 at 00:00 UTC.",
    ),
)


@_EACH_HELPER
@pytest.mark.parametrize(
    "error", [_BILLING, _SPEND_CAP, _OWN_SPEND_LIMIT], ids=["402", "429-spend-cap", "400"]
)
def test_billing_and_spend_limit_errors_fail_fast(helper, error, no_backoff, caplog):
    sdk = _ScriptedSdk(error, "unused")

    with caplog.at_level(logging.WARNING, logger="llm.anthropic_client"):
        with pytest.raises(type(error)):
            helper(sdk, 180.0, "segment_scene", model="m")

    assert len(sdk.calls) == 1
    assert no_backoff == []
    [line] = [r.getMessage() for r in caplog.records]
    assert "reason_class=spend_limit" in line
    assert "attempt=None wait_ms=None" in line, "logged as a failure, not a retry wait"
    assert "regain access" not in line


def test_an_ordinary_rate_limit_is_still_retried(sleeps):
    limited = _status_error(
        anthropic.RateLimitError, 429, retry_after="2", body=_error_body("rate_limit_error")
    )
    sdk = _ScriptedSdk(limited, "reply")

    assert _create_with_timeout(sdk, 180.0, "segment_scene", model="m") == "reply"
    assert sleeps == [2.0]


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
