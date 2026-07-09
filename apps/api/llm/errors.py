"""LLM-layer exceptions. This package has no HTTP knowledge -- a future route
layer catches `SchemaInvalidLlmError` and raises `errors.ApiError(..., code,
...)` using the `.code` attribute below (data contract §4 error codes)."""

from __future__ import annotations


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
