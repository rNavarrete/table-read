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
from typing import Any


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


def log_llm_unavailable(
    logger: logging.Logger,
    exc: BaseException,
    *,
    where: str,
    op: str | None = None,
) -> None:
    """Log structured metadata when mapping a transport/timeout failure to
    `LLM_UNAVAILABLE`. Logs class name, HTTP status, Anthropic error type,
    request id, and op — never exception message, body text, or prompts."""
    resolved_op = op if op is not None else getattr(exc, "op", None)
    logger.warning(
        "llm_unavailable where=%s cause=%s op=%s status=%s error_type=%s request_id=%s",
        where,
        type(exc).__name__,
        resolved_op,
        getattr(exc, "status_code", None),
        _anthropic_error_type(exc),
        getattr(exc, "request_id", None),
    )
