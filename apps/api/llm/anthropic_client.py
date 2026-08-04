"""`AnthropicClient` -- the real, Anthropic-backed `LlmClient` implementation.

Strict tool JSON per docs/tableread-prompt-spec.md header + §8: every op call
sends exactly one `strict: true` tool. Scene analysis uses auto tool selection
with adaptive thinking; Narrative Map synthesis and verification disable
thinking and force their strict tools so a required structured response is not
consumed by hidden reasoning.
On a schema-invalid (or missing) tool_use response, retries **exactly once**
with the validation error appended as an `is_error` tool_result, then raises
`SchemaInvalidLlmError` -- never a fabricated fallback (CLAUDE.md hard rule
9). Logs only op name, PROMPT_VERSION, model id, retry/failure flags,
token counts, and a short sha256 hash of the user message
(`input_hash=`) -- never prompt or response content (hard rule 5).

This class takes its Anthropic SDK client via constructor injection and is
never constructed here: the only sanctioned construction point is
`llm/factory.py`'s `build_anthropic_client()`, called from app startup or
`make evals` (hard rule 1). Tests construct `AnthropicClient` directly with a
fake/stub `sdk_client` (any object exposing `.messages.create(...)`) and
never call the factory, so no test path can open a real socket.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from llm.errors import (
    LlmTimeoutError,
    SchemaInvalidLlmError,
    log_llm_unavailable,
    validation_error_paths,
)
from llm.ops import OP_REGISTRY, LlmOp
from schemas import (
    BeatCandidate,
    BlastRadius,
    ConsistencyScan,
    InferredActBreaks,
    InferredNarrativeMap,
    InferredNarrativeMapSynthesis,
    InferredNarrativeSceneAnalysisBatch,
    InferredStoryOverview,
    InitialSceneSkeleton,
    InstructionSuggestions,
    LedgerExtraction,
    NarrativeMapVerification,
    NarrativePromises,
    RegeneratedElements,
    SegmentedScene,
    StoryEntities,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_TOOL_SCHEMAS_DIR = _REPO_ROOT / "config" / "tool_schemas"

DEFAULT_MAX_TOKENS = 4096

# Wall-clock ceiling on a single `messages.create` call (task 3). Guards
# against a hung request stalling an eval run indefinitely; deliberately
# separate from rule-9's retry-once, which only fires on a *completed*
# schema-invalid response, never on a timeout (see `LlmTimeoutError`).
DEFAULT_LLM_CALL_TIMEOUT_SECONDS = 120

_logger = logging.getLogger("llm.anthropic_client")


def _create_with_timeout(sdk_client: Any, timeout: float, op: str, **kwargs: Any) -> Any:
    """Run `sdk_client.messages.create(**kwargs)` on a worker thread and wait
    at most `timeout` seconds. On timeout, best-effort cancel (a no-op once
    the SDK call has actually started -- the underlying HTTP request has no
    cooperative cancellation hook here) and raise `LlmTimeoutError(op)`. Does
    not wait for the executor to shut down: a genuinely hung call must not
    also hang the caller during teardown.

    Anthropic SDK transport/status failures are logged here (class, status,
    op — never message/body text) before re-raise so SSE/route mapping to
    `LLM_UNAVAILABLE` is diagnosable in prod/dev logs."""
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(sdk_client.messages.create, **kwargs)
    try:
        try:
            return future.result(timeout=timeout)
        except FuturesTimeoutError:
            future.cancel()
            timeout_exc = LlmTimeoutError(op, timeout)
            log_llm_unavailable(
                _logger,
                timeout_exc,
                where="anthropic_client",
                op=op,
                model=kwargs.get("model"),
            )
            raise timeout_exc from None
        except Exception as exc:
            mod = getattr(type(exc), "__module__", "") or ""
            if mod.startswith("anthropic"):
                log_llm_unavailable(
                    _logger,
                    exc,
                    where="anthropic_client",
                    op=op,
                    model=kwargs.get("model"),
                )
            raise
    finally:
        executor.shutdown(wait=False)


def _stream_final_with_timeout(sdk_client: Any, timeout: float, op: str, **kwargs: Any) -> Any:
    """Consume an SDK Messages stream and return its accumulated final Message.

    Long, high-effort responses can legitimately exceed the safe idle period
    for a non-streaming request. Anthropic's stream emits SSE ping events while
    the model works, and ``get_final_message`` preserves the same Message shape
    used by the existing strict-tool validator.
    """

    active_stream: dict[str, Any] = {}

    def consume() -> Any:
        with sdk_client.messages.stream(**kwargs) as stream:
            active_stream["value"] = stream
            try:
                return stream.get_final_message()
            finally:
                active_stream.pop("value", None)

    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(consume)
    try:
        try:
            return future.result(timeout=timeout)
        except FuturesTimeoutError:
            future.cancel()
            stream = active_stream.get("value")
            close = getattr(stream, "close", None)
            if close is not None:
                try:
                    close()
                except Exception:
                    pass
            timeout_exc = LlmTimeoutError(op, timeout)
            log_llm_unavailable(
                _logger,
                timeout_exc,
                where="anthropic_client_stream",
                op=op,
                model=kwargs.get("model"),
            )
            raise timeout_exc from None
        except Exception as exc:
            mod = getattr(type(exc), "__module__", "") or ""
            if mod.startswith("anthropic"):
                log_llm_unavailable(
                    _logger,
                    exc,
                    where="anthropic_client_stream",
                    op=op,
                    model=kwargs.get("model"),
                )
            raise
    finally:
        executor.shutdown(wait=False)


def _response_with_timeout(
    sdk_client: Any,
    timeout: float,
    op: LlmOp,
    **kwargs: Any,
) -> Any:
    if op.stream_response:
        return _stream_final_with_timeout(sdk_client, timeout, op.name, **kwargs)
    return _create_with_timeout(sdk_client, timeout, op.name, **kwargs)


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
    stop_reason = getattr(response, "stop_reason", None)
    tool_use = _find_tool_use(response, op.name)
    if tool_use is None:
        _logger.warning(
            "llm_schema_invalid op=%s stop_reason=%s errors=no_tool_use",
            op.name,
            stop_reason,
        )
        raise _RecoverableLlmError(
            f"no {op.name!r} tool_use block in response (stop_reason={stop_reason!r})",
            tool_use_id=None,
        )
    try:
        return op.model.model_validate(tool_use.input)
    except ValidationError as exc:
        paths = validation_error_paths(exc)
        _logger.warning(
            "llm_schema_invalid op=%s stop_reason=%s errors=%s",
            op.name,
            stop_reason,
            ",".join(paths[:20]),
        )
        # Privacy-safe retry hint (paths + types only — never input values).
        raise _RecoverableLlmError(
            "schema validation failed: " + "; ".join(paths[:10]),
            tool_use_id=tool_use.id,
        ) from None


class AnthropicClient:
    def __init__(
        self,
        sdk_client: Any,
        models: dict[str, str],
        default_max_tokens: int = DEFAULT_MAX_TOKENS,
        call_timeout_seconds: float = DEFAULT_LLM_CALL_TIMEOUT_SECONDS,
    ) -> None:
        self._sdk = sdk_client
        self._models = models
        self._max_tokens = default_max_tokens
        self._call_timeout_seconds = call_timeout_seconds
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
        input_hash: str | None = None,
    ) -> None:
        usage = getattr(response, "usage", None)
        content = getattr(response, "content", []) or []
        content_types = ",".join(str(getattr(block, "type", "unknown")) for block in content)
        _logger.info(
            "llm_call op=%s prompt_version=%s model=%s retried=%s failed=%s "
            "input_tokens=%s output_tokens=%s cache_write=%s cache_read=%s "
            "stop_reason=%s response_id=%s "
            "request_id=%s content_types=%s input_hash=%s",
            op.name,
            prompt_version,
            model,
            retried,
            failed,
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
            # A cached-prefix op whose cache_read stays 0 across a run has a
            # silent invalidator (a per-call nonce, a changed tool list, a
            # changed effort). These counters are the only symptom.
            getattr(usage, "cache_creation_input_tokens", None),
            getattr(usage, "cache_read_input_tokens", None),
            getattr(response, "stop_reason", None),
            getattr(response, "id", None),
            getattr(response, "_request_id", None),
            content_types or "none",
            input_hash,
        )

    @staticmethod
    def _input_hash(user_message: str) -> str:
        """Short content hash for logs — never the message itself (hard rule 5)."""
        return hashlib.sha256(user_message.encode()).hexdigest()[:16]

    @staticmethod
    def _system_param(system: str, cache_prefix: str | None) -> Any:
        """Plain string, or a cached two-block system when `cache_prefix` is set.

        Render order is tools -> system -> messages, and caching is a byte-exact
        prefix match, so the breakpoint goes on the LAST system block: the
        stable per-run source payload. Everything that varies per call stays in
        the user turn, after the breakpoint.

        1h TTL rather than the 5-minute default: an import runs several minutes
        across bounded workers and may be resumed from a checkpoint, and a
        prefix that expires mid-run silently costs a second full write.

        Note the caller must keep `tools` and the resolved `effort` identical
        across calls that share this prefix — a change to either invalidates it
        (tools render first; effort is rendered into the prompt).

        **A prefix below the model's minimum cacheable size silently does not
        cache** — no error, just `cache_creation_input_tokens: 0` forever. The
        minimum is model-specific and NOT monotonic across generations: it is
        4096 tokens on Haiku 4.5 (which serves every classifier-role op here,
        including `extract_ledger_facts`) but only 512 on Opus 5. A short
        episode can therefore pay full input rate for its prefix on every call
        while a longer one caches. That is not harmful — the context is still
        delivered — but it explains a `cache_read=0` run, and it is the reason
        the log line carries both counters."""
        if not cache_prefix:
            return system
        return [
            {"type": "text", "text": system},
            {
                "type": "text",
                "text": cache_prefix,
                "cache_control": {"type": "ephemeral", "ttl": "1h"},
            },
        ]

    def _call(
        self,
        op_name: str,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> BaseModel:
        op = OP_REGISTRY[op_name]
        model = self._models[op.role]
        tool = self._tool_for(op)
        input_hash = self._input_hash(user_message)
        messages: list[dict[str, Any]] = [{"role": "user", "content": user_message}]
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": op.max_tokens if op.max_tokens is not None else self._max_tokens,
            "system": self._system_param(system, cache_prefix),
            "tools": [tool],
            "tool_choice": (
                {"type": "tool", "name": op.name}
                if op.tool_choice_mode == "forced"
                else {"type": "auto"}
            ),
            "messages": messages,
        }
        if op.adaptive_thinking:
            kwargs["thinking"] = {"type": "adaptive"}
        elif op.thinking_disabled:
            kwargs["thinking"] = {"type": "disabled"}
        if op.effort is not None:
            kwargs["output_config"] = {"effort": op.effort}
        # Prompt spec §3/§5/§6/§8c: classifier-role ops run at temperature 0.
        # Writer, import_worker, and import_analyst ops omit `temperature` —
        # Sonnet 5 / Opus 5 reject non-default sampling. Classifier stays on
        # Haiku, which accepts temperature=0.
        if op.role == "classifier":
            kwargs["temperature"] = 0

        timeout = (
            op.call_timeout_seconds
            if op.call_timeout_seconds is not None
            else self._call_timeout_seconds
        )
        response = _response_with_timeout(self._sdk, timeout, op, **kwargs)
        try:
            result = _validate_tool_response(response, op)
        except _RecoverableLlmError as first_error:
            if not op.retry_schema_once:
                self._log(
                    op,
                    prompt_version,
                    model,
                    response,
                    retried=False,
                    failed=True,
                    input_hash=input_hash,
                )
                raise SchemaInvalidLlmError(op.name) from None
            result = self._retry_once(
                op, kwargs, response, first_error, prompt_version, model, input_hash
            )
            return result

        self._log(op, prompt_version, model, response, retried=False, input_hash=input_hash)
        return result

    def _retry_once(
        self,
        op: LlmOp,
        kwargs: dict[str, Any],
        first_response: Any,
        first_error: _RecoverableLlmError,
        prompt_version: str,
        model: str,
        input_hash: str,
    ) -> BaseModel:
        retry_messages = [
            *kwargs["messages"],
            {"role": "assistant", "content": first_response.content},
        ]
        tool_use_ids = [
            block.id
            for block in getattr(first_response, "content", []) or []
            if getattr(block, "type", None) == "tool_use"
        ]
        if tool_use_ids:
            # Wire contract: an assistant turn containing tool_use block(s)
            # must be followed by a user turn whose content STARTS with one
            # tool_result per tool_use id, or the API 400s ("tool_use ids
            # were found without tool_result blocks immediately after").
            # Tool-forcing normally yields exactly one tool_use, but parallel
            # tool use isn't disabled here, so every id replayed in the
            # assistant turn needs its own matching reply -- the one that
            # failed validation carries the rule-9 error text, any other
            # (duplicate/parallel) tool_use is answered as an ignored extra.
            retry_messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": (
                                str(first_error)
                                if tool_use_id == first_error.tool_use_id
                                else "Extra tool_use ignored; exactly one call was expected."
                            ),
                            "is_error": True,
                        }
                        for tool_use_id in tool_use_ids
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
        retry_timeout = (
            op.call_timeout_seconds
            if op.call_timeout_seconds is not None
            else self._call_timeout_seconds
        )
        response2 = _response_with_timeout(self._sdk, retry_timeout, op, **retry_kwargs)
        try:
            result = _validate_tool_response(response2, op)
        except _RecoverableLlmError:
            self._log(
                op,
                prompt_version,
                model,
                response2,
                retried=True,
                failed=True,
                input_hash=input_hash,
            )
            raise SchemaInvalidLlmError(op.name) from None

        self._log(op, prompt_version, model, response2, retried=True, input_hash=input_hash)
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

    def stream_beat_candidate(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> Iterator[str]:
        """Stream `generate_beat_candidates` tool input as raw JSON fragments
        (prompt spec §8a). See `_stream_tool` for the mechanics."""
        return self._stream_tool(
            "generate_beat_candidates",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def _stream_tool(
        self, op_name: str, *, system: str, user_message: str, prompt_version: str
    ) -> Iterator[str]:
        """Stream a tool-forced op's input as raw JSON fragments (prompt spec
        §8a; shared by the two streaming ops, `generate_beat_candidates` and
        `tune_beat`). Fine-grained tool streaming is enabled with
        `eager_input_streaming` on the tool (the successor to the
        `fine-grained-tool-streaming-2025-05-14` beta, GA on the writer tier),
        so `input_json_delta` chunks arrive as generated. Callers own parsing,
        validation, and delta extraction; this method only forwards fragments.

        Never validates and never fabricates a fallback; a schema-invalid
        stream surfaces when the caller validates the complete tool input (the
        rule-9 retry for the streaming path lives in the stream orchestrator,
        drama_manager/candidates.py, which re-calls this method with the error
        appended). Logs metadata only once the stream ends (op, PROMPT_VERSION,
        model, token counts) — never content (hard rule 5). Transport/
        availability errors propagate unwrapped for the stream orchestrator to
        map to LLM_UNAVAILABLE (errors.py deferral)."""
        op = OP_REGISTRY[op_name]
        model = self._models[op.role]
        tool = {**self._tool_for(op), "eager_input_streaming": True}
        input_hash = self._input_hash(user_message)
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": op.max_tokens if op.max_tokens is not None else self._max_tokens,
            "system": system,
            "tools": [tool],
            "tool_choice": {"type": "tool", "name": op.name},
            "messages": [{"role": "user", "content": user_message}],
            "stream": True,
        }
        usage: Any = None
        # Writer-tier models (observed with claude-sonnet-5) sometimes emit a
        # *second* tool_use block for the same forced tool in one message.
        # Concatenating every input_json_delta then makes json.loads fail with
        # "Extra data", which the orchestrator surfaces as SCHEMA_INVALID_LLM.
        # Keep only the first matching tool_use block's deltas (index pinned
        # on content_block_start); ignore later siblings. Non-streaming
        # `_find_tool_use` already takes the first matching block.
        active_tool_index: int | None = None
        ignored_extra_tool_blocks = 0
        # Only the call that opens the stream is timed: once events start
        # arriving, iterating them is a caller-visible incremental process,
        # not a single blocking `create()` this helper wraps.
        stream_timeout = (
            op.call_timeout_seconds
            if op.call_timeout_seconds is not None
            else self._call_timeout_seconds
        )
        stream = _create_with_timeout(self._sdk, stream_timeout, op.name, **kwargs)
        try:
            for event in stream:
                etype = getattr(event, "type", None)
                if etype == "content_block_start":
                    block = getattr(event, "content_block", None)
                    if (
                        getattr(block, "type", None) == "tool_use"
                        and getattr(block, "name", None) == op.name
                    ):
                        index = getattr(event, "index", None)
                        if active_tool_index is None:
                            active_tool_index = index
                        elif index != active_tool_index:
                            ignored_extra_tool_blocks += 1
                elif etype == "content_block_delta":
                    # When content_block_start pinned a tool index, ignore
                    # deltas from other blocks. When it didn't (legacy unit
                    # fakes), forward every input_json_delta as before.
                    if (
                        active_tool_index is not None
                        and getattr(event, "index", None) != active_tool_index
                    ):
                        continue
                    delta = getattr(event, "delta", None)
                    if getattr(delta, "type", None) == "input_json_delta":
                        yield getattr(delta, "partial_json", "")
                elif etype == "message_start":
                    usage = getattr(getattr(event, "message", None), "usage", None) or usage
                elif etype == "message_delta":
                    usage = getattr(event, "usage", None) or usage
        finally:
            # §8a "no orphan spend": if the consumer stops early (client
            # disconnect → GeneratorExit through the generator chain), close
            # the SDK stream so the in-flight API request is cancelled rather
            # than left generating. Harmless no-op after full consumption.
            close = getattr(stream, "close", None)
            if close is not None:
                close()
        if ignored_extra_tool_blocks:
            _logger.info(
                "llm_stream_extra_tool_use op=%s ignored_blocks=%s",
                op.name,
                ignored_extra_tool_blocks,
            )
        _logger.info(
            "llm_stream op=%s prompt_version=%s model=%s input_tokens=%s "
            "output_tokens=%s input_hash=%s",
            op.name,
            prompt_version,
            model,
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
            input_hash,
        )

    def tune_beat(self, *, system: str, user_message: str, prompt_version: str) -> BeatCandidate:
        return self._call(
            "tune_beat", system=system, user_message=user_message, prompt_version=prompt_version
        )

    def stream_tune_beat(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> Iterator[str]:
        """Stream `tune_beat` tool input as raw JSON fragments (prompt spec §8a:
        tune streams like candidates). See `_stream_tool` for the mechanics."""
        return self._stream_tool(
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
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> LedgerExtraction:
        return self._call(
            "extract_ledger_facts",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
            cache_prefix=cache_prefix,
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

    def infer_act_breaks(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredActBreaks:
        return self._call(
            "infer_act_breaks",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_story_entities(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> StoryEntities:
        return self._call(
            "infer_story_entities",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_narrative_promises(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> NarrativePromises:
        return self._call(
            "infer_narrative_promises",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_story_overview(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredStoryOverview:
        return self._call(
            "infer_story_overview",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_narrative_map(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredNarrativeMap:
        return self._call(
            "infer_narrative_map",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_narrative_scene_analysis(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredNarrativeSceneAnalysisBatch:
        return self._call(
            "infer_narrative_scene_analysis",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_narrative_map_synthesis(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredNarrativeMapSynthesis:
        return self._call(
            "infer_narrative_map_synthesis",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def verify_narrative_map(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> NarrativeMapVerification:
        return self._call(
            "verify_narrative_map",
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

    def generate_scene_skeleton(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InitialSceneSkeleton:
        return self._call(
            "generate_scene_skeleton",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )
