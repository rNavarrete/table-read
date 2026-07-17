"""LLM-layer exceptions. This package has no HTTP knowledge -- a future route
layer catches `SchemaInvalidLlmError` and raises `errors.ApiError(..., code,
...)` using the `.code` attribute below (data contract §4 error codes).

Transport/availability failures (raw `anthropic` SDK exceptions: connection
errors, rate limits, 5xx/529 overload) deliberately propagate out of
`AnthropicClient` unwrapped; mapping them to the contract's `LLM_UNAVAILABLE`
error code (data contract §4) is the route layer's responsibility, deferred
until T2.1 (the first LLM-backed endpoint)."""

from __future__ import annotations

import logging
import re
from typing import Any

# Boilerplate substrings safe to echo (truncated). Never used as a gateway for
# free-form Anthropic messages that may echo request/prompt fragments.
_SAFE_REASON_EXCERPT_RE = re.compile(
    r"(?:prompt\s+is\s+too\s+long[^.!?\n]{0,80}"
    r"|rate\s*limit[^.!?\n]{0,80}"
    r"|overloaded[^.!?\n]{0,40}"
    r"|(?:maximum\s+)?(?:context|input)\s+length[^.!?\n]{0,80}"
    r"|\d[\d,]*\s*(?:input\s+)?tokens?[^.!?\n]{0,60}"
    r"|temperature[^.!?\n]{0,60})",
    re.IGNORECASE,
)

_PROMPT_TOO_LONG_RE = re.compile(
    r"prompt\s+is\s+too\s+long|context\s+length|too\s+many\s+tokens",
    re.I,
)
_RATE_LIMIT_RE = re.compile(r"rate\s*limit", re.I)
_OVERLOADED_RE = re.compile(r"overloaded", re.I)
_TEMPERATURE_RE = re.compile(r"temperature", re.I)


class LlmTimeoutError(Exception):
    """Raised when `messages.create` exceeds its wall-clock timeout (task 3's
    per-call default of 120s). Deliberately NOT a `SchemaInvalidLlmError`
    subclass: a hang is a transport-level failure, not a schema-invalid tool
    response, so it must never trigger the rule-9 retry-once path -- callers
    that raced a create() against the timeout raise this immediately and skip
    straight to surfacing the failure."""

    def __init__(self, op: str) -> None:
        self.op = op
        super().__init__(f"{op}: LLM call timed out")


class SchemaInvalidLlmError(Exception):
    """Raised when a tool-forced LLM call fails schema validation twice in a
    row (CLAUDE.md hard rule 9: exactly one retry with the error appended,
    then surface -- never fabricate a fallback response)."""

    code = "SCHEMA_INVALID_LLM"

    def __init__(self, op: str) -> None:
        self.op = op
        super().__init__(f"{op}: LLM output failed schema validation twice")
        # CLAUDE.md hard rule 5: this exception's message never carries
        # prompt/response content (see the assertion above). Its Pydantic
        # ValidationError cause -- raised `from None` in anthropic_client.py
        # to suppress the default traceback chain, but still reachable via
        # `.__context__` -- can, in principle, echo a fragment of a
        # model-produced field value (e.g. a wrong-typed string). Whoever
        # eventually logs this exception at the route layer must log only
        # `.op` / `.code`, never `.__context__` or `.__cause__`.


def _anthropic_error_type(exc: BaseException) -> Any:
    """Pull `error.type` from an Anthropic SDK body when present — never the
    human `message` field (hard rule 5: may theoretically echo fragments)."""
    body = getattr(exc, "body", None)
    if not isinstance(body, dict):
        return None
    inner = body.get("error")
    if isinstance(inner, dict):
        return inner.get("type")
    return body.get("type")


def _anthropic_error_message(exc: BaseException) -> str | None:
    """Pull `error.message` from an Anthropic body for classification only.
    Callers must not log this string unless `_safe_reason_excerpt` accepts it."""
    body = getattr(exc, "body", None)
    if not isinstance(body, dict):
        return None
    inner = body.get("error")
    if isinstance(inner, dict):
        message = inner.get("message")
        return message if isinstance(message, str) else None
    return None


def _safe_reason_excerpt(message: str | None) -> str | None:
    """Return a short boilerplate excerpt, or None if nothing is safe to echo."""
    if not message:
        return None
    match = _SAFE_REASON_EXCERPT_RE.search(message)
    if not match:
        return None
    return match.group(0)[:120]


def classify_llm_unavailable_reason(exc: BaseException) -> tuple[str, str | None]:
    """Map an LLM transport failure to `(reason_class, safe_reason_excerpt)`.

    `reason_class` is always a stable enum-like token. `safe_reason_excerpt` is
    only set when a known Anthropic boilerplate pattern matches — never the
    raw exception message (hard rule 5).
    """
    if isinstance(exc, LlmTimeoutError):
        return "timeout", None

    error_type = _anthropic_error_type(exc)
    message = _anthropic_error_message(exc)
    excerpt = _safe_reason_excerpt(message)

    if error_type == "rate_limit_error" or (message and _RATE_LIMIT_RE.search(message)):
        return "rate_limit", excerpt
    if error_type == "overloaded_error" or (message and _OVERLOADED_RE.search(message)):
        return "overloaded", excerpt
    if message and _PROMPT_TOO_LONG_RE.search(message):
        return "prompt_too_long", excerpt
    if message and _TEMPERATURE_RE.search(message):
        return "invalid_temperature", excerpt
    if error_type == "invalid_request_error":
        return "other_invalid_request", excerpt
    if error_type:
        return str(error_type), excerpt
    return "other", excerpt


def log_llm_unavailable(
    logger: logging.Logger,
    exc: BaseException,
    *,
    where: str,
    op: str | None = None,
) -> None:
    """Log structured metadata when mapping a transport/timeout failure to
    `LLM_UNAVAILABLE`. Logs class name, HTTP status, Anthropic error type,
    request id, op, and a privacy-safe reason classification — never raw
    exception messages, body dumps, or prompts."""
    resolved_op = op if op is not None else getattr(exc, "op", None)
    reason_class, reason = classify_llm_unavailable_reason(exc)
    logger.warning(
        "llm_unavailable where=%s cause=%s op=%s status=%s error_type=%s "
        "request_id=%s reason_class=%s reason=%s",
        where,
        type(exc).__name__,
        resolved_op,
        getattr(exc, "status_code", None),
        _anthropic_error_type(exc),
        getattr(exc, "request_id", None),
        reason_class,
        reason,
    )
