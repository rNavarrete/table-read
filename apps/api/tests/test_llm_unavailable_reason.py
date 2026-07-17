"""Privacy-safe Anthropic reason classification for LLM_UNAVAILABLE logs.

Hard rule 5: never log writer/script prompt content — only structured
metadata plus a short excerpt when it matches known Anthropic boilerplate.
"""

from __future__ import annotations

import logging

import anthropic
import httpx

from llm.errors import LlmTimeoutError, classify_llm_unavailable_reason, log_llm_unavailable


def _api_error(
    *,
    status: int,
    error_type: str,
    message: str,
    cls: type = anthropic.APIStatusError,
) -> Exception:
    resp = httpx.Response(
        status,
        request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"),
        json={"type": "error", "error": {"type": error_type, "message": message}},
    )
    if cls is anthropic.RateLimitError:
        return anthropic.RateLimitError(
            message="rate limited", response=resp, body=resp.json()
        )
    if cls is anthropic.BadRequestError:
        return anthropic.BadRequestError(
            message="bad request", response=resp, body=resp.json()
        )
    return anthropic.APIStatusError(
        message="api error", response=resp, body=resp.json()
    )


def test_classify_prompt_too_long():
    exc = _api_error(
        status=400,
        error_type="invalid_request_error",
        message="prompt is too long: 250000 tokens > 200000 maximum",
        cls=anthropic.BadRequestError,
    )
    reason_class, reason = classify_llm_unavailable_reason(exc)
    assert reason_class == "prompt_too_long"
    assert reason is not None
    assert "prompt is too long" in reason.lower()
    assert len(reason) <= 120


def test_classify_rate_limit_from_error_type():
    exc = _api_error(
        status=429,
        error_type="rate_limit_error",
        message="Rate limit exceeded; please try again later",
        cls=anthropic.RateLimitError,
    )
    reason_class, reason = classify_llm_unavailable_reason(exc)
    assert reason_class == "rate_limit"
    assert reason is not None
    assert "rate limit" in reason.lower()


def test_classify_overloaded():
    exc = _api_error(
        status=529,
        error_type="overloaded_error",
        message="Overloaded",
    )
    reason_class, reason = classify_llm_unavailable_reason(exc)
    assert reason_class == "overloaded"


def test_classify_invalid_temperature():
    exc = _api_error(
        status=400,
        error_type="invalid_request_error",
        message="temperature: decimal above maximum of 1.0",
        cls=anthropic.BadRequestError,
    )
    reason_class, _reason = classify_llm_unavailable_reason(exc)
    assert reason_class == "invalid_temperature"


def test_classify_invalid_tool_schema_prefix_items():
    """Live Haiku 400 for StoryEntities tuple field — must classify + excerpt."""
    exc = _api_error(
        status=400,
        error_type="invalid_request_error",
        message="tools.0.custom: For 'array' type, property 'prefixItems' is not supported",
        cls=anthropic.BadRequestError,
    )
    reason_class, reason = classify_llm_unavailable_reason(exc)
    assert reason_class == "invalid_tool_schema"
    assert reason is not None
    assert "prefixItems" in reason
    assert len(reason) <= 120


def test_classify_from_sdk_message_when_body_missing():
    """Fallback: parse Error code: 400 - {...} when body lacks error.message."""
    resp = httpx.Response(
        400,
        request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"),
        json={"type": "error"},
    )
    exc = anthropic.BadRequestError(
        message=(
            "Error code: 400 - "
            '{"type":"error","error":{"type":"invalid_request_error",'
            '"message":"tools.0.custom: For \'array\' type, property \'prefixItems\' is not supported"}}'
        ),
        response=resp,
        body={"type": "error"},
    )
    reason_class, reason = classify_llm_unavailable_reason(exc)
    assert reason_class == "invalid_tool_schema"
    assert reason is not None
    assert "prefixItems" in reason


def test_classify_other_invalid_request():
    exc = _api_error(
        status=400,
        error_type="invalid_request_error",
        message="some unrecognized invalid request",
        cls=anthropic.BadRequestError,
    )
    reason_class, reason = classify_llm_unavailable_reason(exc)
    assert reason_class == "other_invalid_request"
    assert reason is None  # not safe boilerplate — do not echo


def test_classify_timeout():
    reason_class, reason = classify_llm_unavailable_reason(LlmTimeoutError("op"))
    assert reason_class == "timeout"
    assert reason is None


def test_log_never_echoes_script_fragment_even_in_message(caplog):
    """If Anthropic's message somehow carried script text, we must not log it."""
    exc = _api_error(
        status=400,
        error_type="invalid_request_error",
        message="SECRET_SCRIPT_LINE Marta opens the door. also prompt is too long",
        cls=anthropic.BadRequestError,
    )
    logger = logging.getLogger("llm.errors.reason_test")
    with caplog.at_level(logging.WARNING, logger="llm.errors.reason_test"):
        log_llm_unavailable(logger, exc, where="unit", op="infer_story_entities")
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "reason_class=prompt_too_long" in joined
    assert "SECRET_SCRIPT_LINE" not in joined
    assert "Marta opens" not in joined
    # Safe matched boilerplate may appear as reason=
    assert "reason=" in joined
    assert "prompt is too long" in joined


def test_log_includes_reason_class_for_rate_limit(caplog):
    exc = _api_error(
        status=429,
        error_type="rate_limit_error",
        message="SECRET_SCRIPT_FRAGMENT should not leak",
        cls=anthropic.RateLimitError,
    )
    logger = logging.getLogger("llm.errors.reason_test2")
    with caplog.at_level(logging.WARNING, logger="llm.errors.reason_test2"):
        log_llm_unavailable(logger, exc, where="unit", op="infer_story_entities")
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "reason_class=rate_limit" in joined
    assert "SECRET_SCRIPT_FRAGMENT" not in joined
