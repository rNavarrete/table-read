"""`AnthropicClient` -- the real, Anthropic-backed `LlmClient` implementation.

Tool-forced JSON per docs/tableread-prompt-spec.md header + §8: every op call
sends exactly one `strict: true` tool and forces it via
`tool_choice: {"type": "tool", "name": op_name}`. On a schema-invalid (or
missing) tool_use response, retries **exactly once** with the validation
error appended as an `is_error` tool_result, then raises
`SchemaInvalidLlmError` -- never a fabricated fallback (CLAUDE.md hard rule
9). Logs only op name, PROMPT_VERSION, model id, retry/failure flags, and
token counts -- never prompt or response content (hard rule 5).

This class takes its Anthropic SDK client via constructor injection and is
never constructed here: the only sanctioned construction point is
`llm/factory.py`'s `build_anthropic_client()`, called from app startup or
`make evals` (hard rule 1). Tests construct `AnthropicClient` directly with a
fake/stub `sdk_client` (any object exposing `.messages.create(...)`) and
never call the factory, so no test path can open a real socket.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from llm.errors import SchemaInvalidLlmError
from llm.ops import OP_REGISTRY, LlmOp
from schemas import (
    BeatCandidate,
    BlastRadius,
    ConsistencyScan,
    InstructionSuggestions,
    LedgerExtraction,
    RegeneratedElements,
    SegmentedScene,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_TOOL_SCHEMAS_DIR = _REPO_ROOT / "config" / "tool_schemas"

DEFAULT_MAX_TOKENS = 4096

_logger = logging.getLogger("llm.anthropic_client")


class _RecoverableLlmError(Exception):
    """Internal: a tool-forced call came back without a valid tool_use.input
    for the forced op -- either no matching tool_use block at all, or one
    whose input fails Pydantic validation. Both are "schema-invalid output"
    for CLAUDE.md hard rule 9's retry-once-then-surface purposes."""

    def __init__(self, message: str, *, tool_use_id: str | None) -> None:
        self.tool_use_id = tool_use_id
        super().__init__(message)


def _load_tool_input_schema(op_name: str) -> dict[str, Any]:
    path = _TOOL_SCHEMAS_DIR / f"{op_name}.json"
    return json.loads(path.read_text())


def _build_tool(op: LlmOp) -> dict[str, Any]:
    return {
        "name": op.name,
        "description": op.description,
        "input_schema": _load_tool_input_schema(op.name),
        "strict": True,
    }


def _find_tool_use(response: Any, op_name: str) -> Any:
    for block in getattr(response, "content", []) or []:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == op_name:
            return block
    return None


def _validate_tool_response(response: Any, op: LlmOp) -> BaseModel:
    tool_use = _find_tool_use(response, op.name)
    if tool_use is None:
        stop_reason = getattr(response, "stop_reason", None)
        raise _RecoverableLlmError(
            f"no {op.name!r} tool_use block in response (stop_reason={stop_reason!r})",
            tool_use_id=None,
        )
    try:
        return op.model.model_validate(tool_use.input)
    except ValidationError as exc:
        raise _RecoverableLlmError(str(exc), tool_use_id=tool_use.id) from exc


class AnthropicClient:
    def __init__(
        self,
        sdk_client: Any,
        models: dict[str, str],
        default_max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> None:
        self._sdk = sdk_client
        self._models = models
        self._max_tokens = default_max_tokens
        self._tool_cache: dict[str, dict[str, Any]] = {}

    def _tool_for(self, op: LlmOp) -> dict[str, Any]:
        if op.name not in self._tool_cache:
            self._tool_cache[op.name] = _build_tool(op)
        return self._tool_cache[op.name]

    def _log(
        self,
        op: LlmOp,
        prompt_version: str,
        model: str,
        response: Any,
        *,
        retried: bool,
        failed: bool = False,
    ) -> None:
        usage = getattr(response, "usage", None)
        _logger.info(
            "llm_call op=%s prompt_version=%s model=%s retried=%s failed=%s "
            "input_tokens=%s output_tokens=%s",
            op.name,
            prompt_version,
            model,
            retried,
            failed,
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
        )

    def _call(
        self, op_name: str, *, system: str, user_message: str, prompt_version: str
    ) -> BaseModel:
        op = OP_REGISTRY[op_name]
        model = self._models[op.role]
        tool = self._tool_for(op)
        messages: list[dict[str, Any]] = [{"role": "user", "content": user_message}]
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": self._max_tokens,
            "system": system,
            "tools": [tool],
            "tool_choice": {"type": "tool", "name": op.name},
            "messages": messages,
        }
        # Prompt spec §3/§5/§6/§8c: classifier-role ops run at temperature 0.
        # `config/models.toml` deliberately pins `classifier` to a model tier
        # that still accepts an explicit `temperature` -- see that file's
        # comment for why current-generation Sonnet/Opus reject it outright.
        # Known exception: §7 mandates temperature 0 for `segment_scene` too,
        # but that op is writer-role and the writer tier rejects sampling
        # params, so it runs at model default -- see the DESIGN-GAP(T6.1)
        # comment at its definition in llm/ops.py.
        if op.role == "classifier":
            kwargs["temperature"] = 0

        response = self._sdk.messages.create(**kwargs)
        try:
            result = _validate_tool_response(response, op)
        except _RecoverableLlmError as first_error:
            result = self._retry_once(op, kwargs, response, first_error, prompt_version, model)
            return result

        self._log(op, prompt_version, model, response, retried=False)
        return result

    def _retry_once(
        self,
        op: LlmOp,
        kwargs: dict[str, Any],
        first_response: Any,
        first_error: _RecoverableLlmError,
        prompt_version: str,
        model: str,
    ) -> BaseModel:
        retry_messages = [
            *kwargs["messages"],
            {"role": "assistant", "content": first_response.content},
        ]
        if first_error.tool_use_id is not None:
            retry_messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": first_error.tool_use_id,
                            "content": str(first_error),
                            "is_error": True,
                        }
                    ],
                }
            )
        else:
            # No tool_use block at all (forced tool_choice makes this rare) --
            # there is no tool_use_id to reply to, so fall back to a plain
            # user-turn restatement of the requirement.
            retry_messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Your previous response did not call the {op.name!r} tool with "
                        f"valid input: {first_error}. Call {op.name!r} with valid input."
                    ),
                }
            )
        retry_kwargs = {**kwargs, "messages": retry_messages}
        response2 = self._sdk.messages.create(**retry_kwargs)
        try:
            result = _validate_tool_response(response2, op)
        except _RecoverableLlmError:
            self._log(op, prompt_version, model, response2, retried=True, failed=True)
            raise SchemaInvalidLlmError(op.name) from None

        self._log(op, prompt_version, model, response2, retried=True)
        return result

    def generate_beat_candidates(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BeatCandidate:
        return self._call(
            "generate_beat_candidates",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def tune_beat(self, *, system: str, user_message: str, prompt_version: str) -> BeatCandidate:
        return self._call(
            "tune_beat", system=system, user_message=user_message, prompt_version=prompt_version
        )

    def classify_blast_radius(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BlastRadius:
        return self._call(
            "classify_blast_radius",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def regenerate_elements(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> RegeneratedElements:
        return self._call(
            "regenerate_elements",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def extract_ledger_facts(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> LedgerExtraction:
        return self._call(
            "extract_ledger_facts",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def suggest_instructions(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InstructionSuggestions:
        return self._call(
            "suggest_instructions",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def segment_scene(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> SegmentedScene:
        return self._call(
            "segment_scene", system=system, user_message=user_message, prompt_version=prompt_version
        )

    def scan_consistency(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> ConsistencyScan:
        return self._call(
            "scan_consistency",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )
