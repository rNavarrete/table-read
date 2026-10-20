"""`AnthropicClient` -- the real, Anthropic-backed `LlmClient` implementation.

Strict tool JSON per docs/tableread-prompt-spec.md header + §8: every op call
offers exactly one `strict: true` tool with `tool_choice: auto` and asks for
the call in the prompt (`_ask_for_tool`) -- Opus 5.5 and Sonnet 5.5 reject a
forced tool choice.
On a schema-invalid (or missing) tool_use response, retries **exactly once**
with the validation error appended as an `is_error` tool_result, then raises
`SchemaInvalidLlmError` -- never a fabricated fallback (CLAUDE.md hard rule
9). Logs only op name, PROMPT_VERSION, model id, retry/failure flags,
token counts, timings, rate-limit header counts, ids, the byte size of the
tool input, and a short sha256 hash of the user message (`input_hash=`) --
never prompt or response content (hard rule 5).

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
import random
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from deadline import DeadlineExceeded, call_within_deadline
from import_diagnostics import current_import_run_id, current_import_unit
from llm.errors import (
    LlmTimeoutError,
    SchemaInvalidLlmError,
    is_spend_limit,
    log_llm_unavailable,
    retry_after_seconds,
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
    InferredStructureCheck,
    InitialSceneSkeleton,
    InstructionSuggestions,
    LedgerExtraction,
    NarrativeMapVerification,
    NarrativePromises,
    RegeneratedElements,
    SceneMotivations,
    SegmentedScene,
    StoryEntities,
    StructureCheckVerification,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_TOOL_SCHEMAS_DIR = _REPO_ROOT / "config" / "tool_schemas"

DEFAULT_MAX_TOKENS = 16_384

# Wall-clock ceiling on a single `messages.create` call (task 3). Guards
# against a hung request stalling an eval run indefinitely; deliberately
# separate from rule-9's retry-once, which only fires on a *completed*
# schema-invalid response, never on a timeout (see `LlmTimeoutError`).
DEFAULT_LLM_CALL_TIMEOUT_SECONDS = 120

_OVERLOAD_MAX_ATTEMPTS = 4
_OVERLOAD_BACKOFF_SECONDS = (2.0, 4.0, 8.0)  # before attempts 2, 3 and 4
_OVERLOAD_JITTER = 0.2
_OVERLOAD_MAX_TOTAL_WAIT_SECONDS = 60.0
_sleep = time.sleep  # tests swap in a recorder

_logger = logging.getLogger("llm.anthropic_client")


def _is_overload(exc: Exception) -> bool:
    """429, 529 or another 5xx from the API: rejected, so not billed. A 504 is
    a gateway timeout, and that request may have run. A 429 for a spend cap is
    not an overload: it fails until the month turns or the limit is raised
    (`is_spend_limit`)."""
    status = getattr(exc, "status_code", None)
    return (
        (getattr(type(exc), "__module__", "") or "").startswith("anthropic")
        and isinstance(status, int)
        and (status == 429 or (status >= 500 and status != 504))
        and not is_spend_limit(exc)
    )


def _retry_if_overloaded(attempt: Callable[[], Any], *, where: str, op: str, model: Any) -> Any:
    """Run `attempt()`, retrying an overload (`_is_overload`) up to
    `_OVERLOAD_MAX_ATTEMPTS` attempts in all. The SDK is built with
    `max_retries=0`, so this is the only retry. Never after a timeout (the
    SDK's, a 504, or our deadline): that request may have run and been billed.

    Each wait honors the API's `retry-after` when present, else backs off 2, 4
    then 8 s with +/-20% jitter so parallel import workers don't retry in
    lockstep. A wait that would take the total past 60 s is not taken: the
    overload surfaces instead of retrying earlier than the API asked."""
    waited = 0.0
    for attempt_number in range(1, _OVERLOAD_MAX_ATTEMPTS):
        try:
            return attempt()
        except Exception as exc:
            if not _is_overload(exc):
                raise
            wait = retry_after_seconds(exc)
            if wait is None:
                wait = _OVERLOAD_BACKOFF_SECONDS[attempt_number - 1] * random.uniform(
                    1 - _OVERLOAD_JITTER, 1 + _OVERLOAD_JITTER
                )
            if waited + wait > _OVERLOAD_MAX_TOTAL_WAIT_SECONDS:
                raise
            log_llm_unavailable(
                _logger,
                exc,
                where=where,
                op=op,
                model=model,
                attempt=attempt_number,
                wait_ms=round(wait * 1000),
            )
        _sleep(wait)
        waited += wait
    return attempt()


def _create_with_timeout(
    sdk_client: Any,
    timeout: float,
    op: str,
    *,
    meta: dict[str, Any] | None = None,
    **kwargs: Any,
) -> Any:
    """Run `sdk_client.messages.create(**kwargs)` on a daemon thread and wait
    at most `timeout` seconds, then raise `LlmTimeoutError(op)`. A hung call
    hangs neither the caller nor, via `deadline.call_within_deadline`, the process at
    exit.

    Given `meta`, sends the request through `messages.with_raw_response` (the
    SDK's only way to read a non-streamed response's headers) and sets
    `meta["headers"]` to the last attempt's response headers.

    Anthropic SDK transport/status failures are logged here (class, status,
    op — never message/body text) before re-raise so SSE/route mapping to
    `LLM_UNAVAILABLE` is diagnosable in prod/dev logs."""

    def send() -> Any:
        if meta is None:
            return sdk_client.messages.create(**kwargs, timeout=timeout)
        raw = sdk_client.messages.with_raw_response.create(**kwargs, timeout=timeout)
        meta["headers"] = raw.headers
        return raw.parse()

    def attempt() -> Any:
        return call_within_deadline(send, timeout, name="llm-call")

    try:
        return _retry_if_overloaded(
            attempt, where="anthropic_client", op=op, model=kwargs.get("model")
        )
    except DeadlineExceeded:
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


def _stream_final_with_timeout(
    sdk_client: Any,
    timeout: float,
    op: str,
    *,
    meta: dict[str, Any] | None = None,
    **kwargs: Any,
) -> Any:
    """Consume an SDK Messages stream and return its accumulated final Message.

    Long, high-effort responses can legitimately exceed the safe idle period
    for a non-streaming request. Anthropic's stream emits SSE ping events while
    the model works, and ``get_final_message`` preserves the same Message shape
    used by the existing strict-tool validator.

    When given `meta`, sets, for the last attempt: `meta["ttft_ms"]`, the
    delay before the stream's first event (message_start, which already
    carries the first output token, so it measures queueing plus prefill: what
    a warm prompt cache shortens); `meta["headers"]`, the HTTP response
    headers; and `meta["request_id"]`, the stream's `request_id` (the
    accumulated final message carries none).
    """

    active_stream: dict[str, Any] = {}

    def consume() -> Any:
        started = time.monotonic()
        with sdk_client.messages.stream(**kwargs, timeout=timeout) as stream:
            active_stream["value"] = stream
            try:
                if meta is not None:
                    meta["headers"] = getattr(getattr(stream, "response", None), "headers", None)
                    meta["request_id"] = getattr(stream, "request_id", None)
                # `get_final_message` drains whatever this leaves unread.
                if next(stream, None) is not None and meta is not None:
                    meta["ttft_ms"] = round((time.monotonic() - started) * 1000)
                return stream.get_final_message()
            finally:
                active_stream.pop("value", None)

    try:
        return _retry_if_overloaded(
            lambda: call_within_deadline(consume, timeout, name="llm-call"),
            where="anthropic_client_stream",
            op=op,
            model=kwargs.get("model"),
        )
    except DeadlineExceeded:
        # Closing the stream is what actually ends the abandoned call here —
        # it breaks the read loop the daemon thread is parked on, so the
        # thread exits rather than lingering until the SDK's own timeout.
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


def _response_with_timeout(
    sdk_client: Any,
    timeout: float,
    op: LlmOp,
    *,
    meta: dict[str, Any],
    **kwargs: Any,
) -> Any:
    if op.stream_response:
        return _stream_final_with_timeout(sdk_client, timeout, op.name, meta=meta, **kwargs)
    return _create_with_timeout(sdk_client, timeout, op.name, meta=meta, **kwargs)


# (log field, response header): the request and token buckets of the model's
# per-minute rate limit, as the API reports them after this request.
_RATE_LIMIT_HEADERS = tuple(
    (f"rl_{field}_{kind}", f"anthropic-ratelimit-{bucket}-{kind}")
    for field, bucket in (
        ("requests", "requests"),
        ("input", "input-tokens"),
        ("output", "output-tokens"),
    )
    for kind in ("remaining", "limit")
)


def _rate_limit_fields(headers: Any) -> list[str]:
    """`name=value` per `_RATE_LIMIT_HEADERS`: an integer, or `-` when the
    header is absent or not a number (nothing else from a header is logged)."""
    fields = []
    for name, header in _RATE_LIMIT_HEADERS:
        try:
            value: Any = int(headers.get(header))
        except (AttributeError, TypeError, ValueError):
            value = "-"
        fields.append(f"{name}={value}")
    return fields


def _out_bytes(response: Any, op_name: str) -> int | str:
    """Byte size of the logged response's tool input as JSON, or `-` without
    one. A size only: the input itself is never logged."""
    tool_use = _find_tool_use(response, op_name)
    if tool_use is None:
        return "-"
    return len(json.dumps(tool_use.input, ensure_ascii=False, default=str).encode("utf-8"))


class _RecoverableLlmError(Exception):
    """Internal: a call came back without a valid tool_use.input for the
    requested op -- either no matching tool_use block at all, or one
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


# Opus 5.5 and Sonnet 5.5 reject a forced `tool_choice` (`tool`/`any`), so
# every op offers its one strict tool with `auto`, allows at most one call,
# and asks for it in the prompt. A prose reply without the call gets one
# retry, even on fail-closed ops; a refusal gets none (`_call`).
_TOOL_CHOICE: dict[str, Any] = {"type": "auto", "disable_parallel_tool_use": True}


def _ask_for_tool(user_message: str, op_name: str) -> str:
    return f"{user_message}\n\nAnswer by calling the {op_name} tool exactly once."


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
        # `max_tokens: 0` is the documented prewarm; drops to 1 for good if
        # the API ever rejects 0 and accepts 1 (see `prewarm_cache`).
        self._prewarm_max_tokens = 0
        # Ops (and prewarms) running now, across threads: `in_flight=`.
        self._in_flight = 0
        self._in_flight_lock = threading.Lock()

    def _tool_for(self, op: LlmOp) -> dict[str, Any]:
        if op.name not in self._tool_cache:
            self._tool_cache[op.name] = _build_tool(op)
        return self._tool_cache[op.name]

    def _timeout_for(self, op: LlmOp) -> float:
        if op.call_timeout_seconds is not None:
            return op.call_timeout_seconds
        return self._call_timeout_seconds

    @contextmanager
    def _counted(self) -> Iterator[int]:
        """Count a request as in flight while it runs; yields the count at its
        start, itself included. A call abandoned on its deadline stops counting
        though its HTTP request may still be running, so after timeouts the
        count runs low."""
        with self._in_flight_lock:
            self._in_flight += 1
            count = self._in_flight
        try:
            yield count
        finally:
            with self._in_flight_lock:
                self._in_flight -= 1

    def _send(self, op: LlmOp, meta: dict[str, Any], **kwargs: Any) -> Any:
        """One op request, overload retries included; fills `meta` for `_log`."""
        with self._counted() as in_flight:
            meta["in_flight"] = in_flight
            return _response_with_timeout(self._sdk, self._timeout_for(op), op, meta=meta, **kwargs)

    def _log(
        self,
        op: LlmOp,
        prompt_version: str,
        model: str,
        response: Any,
        *,
        retried: bool,
        started: float,
        meta: dict[str, Any],
        failed: bool = False,
        input_hash: str | None = None,
    ) -> None:
        usage = getattr(response, "usage", None)
        content = getattr(response, "content", []) or []
        content_types = ",".join(str(getattr(block, "type", "unknown")) for block in content)
        unit = current_import_unit()
        ttft_ms = meta.get("ttft_ms")
        _logger.info(
            "llm_call op=%s run_id=%s stage=%s scene=%s prompt_version=%s model=%s "
            "retried=%s failed=%s input_tokens=%s output_tokens=%s out_bytes=%s "
            "cache_write=%s cache_read=%s elapsed_ms=%s ttft_ms=%s queue_ms=%s "
            "in_flight=%s %s stop_reason=%s response_id=%s request_id=%s "
            "content_types=%s input_hash=%s",
            op.name,
            current_import_run_id(),
            "-" if unit is None else unit.stage,
            "-" if unit is None or unit.scene is None else unit.scene,
            prompt_version,
            model,
            retried,
            failed,
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
            _out_bytes(response, op.name),
            # A cached-prefix op whose cache_read stays 0 across a run has a
            # silent invalidator (a per-call nonce, a changed tool list, a
            # changed effort). These counters are the only symptom.
            getattr(usage, "cache_creation_input_tokens", None),
            getattr(usage, "cache_read_input_tokens", None),
            # Wall time of the whole op, overload waits and the rule-9 retry
            # included; TTFT of the logged response, streamed ops only.
            round((time.monotonic() - started) * 1000),
            "-" if ttft_ms is None else ttft_ms,
            # How long the import unit waited for a pool worker, and how many
            # ops were running when this one started (itself included).
            "-" if unit is None or unit.queue_ms is None else unit.queue_ms,
            meta.get("in_flight", "-"),
            " ".join(_rate_limit_fields(meta.get("headers"))),
            getattr(response, "stop_reason", None),
            getattr(response, "id", None),
            # A streamed call's id comes from its stream, not its message.
            meta.get("request_id") or getattr(response, "_request_id", None),
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
        minimum is model-specific and NOT monotonic across generations (Haiku
        4.5 needed 4096 tokens; Opus 5 needed 512). A short episode can
        therefore pay full input rate for its prefix on every call while a
        longer one caches. That is not harmful — the context is still
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

    def _request(
        self, op: LlmOp, *, system: str, user_message: str, cache_prefix: str | None
    ) -> dict[str, Any]:
        """The Messages request for one op call. `prewarm_cache` sends this
        same request, so anything that changes the cached prefix (model, tool,
        system, thinking, effort) can never drift between the two."""
        kwargs: dict[str, Any] = {
            "model": self._models[op.role],
            "max_tokens": op.max_tokens if op.max_tokens is not None else self._max_tokens,
            "system": self._system_param(system, cache_prefix),
            "tools": [self._tool_for(op)],
            "tool_choice": _TOOL_CHOICE,
            "messages": [{"role": "user", "content": _ask_for_tool(user_message, op.name)}],
        }
        if op.adaptive_thinking:
            kwargs["thinking"] = {"type": "adaptive"}
        if op.effort is not None:
            kwargs["output_config"] = {"effort": op.effort}
        return kwargs

    def prewarm_cache(
        self,
        op: str,
        *,
        system: str,
        user_message: str,
        cache_prefix: str | None = None,
    ) -> None:
        """Best-effort: write the prompt cache for `op` without generating an answer.

        Sends exactly the request the real `op` call sends (`_request`: model,
        tool, `tool_choice`, system with its cache breakpoint, thinking,
        effort, timeout) with `max_tokens: 0`. Per the prompt-caching docs
        (claude-api skill, shared/prompt-caching.md "Pre-warming the cache";
        https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
        the API then runs prefill only, writes the cache at the breakpoint and
        returns `content: []`, `stop_reason: "max_tokens"`, no output tokens.
        Thinking and effort must match the real calls, because both are
        rendered into the prompt: a mismatched prewarm writes an entry the real
        calls never read. `max_tokens: 0` is rejected with `stream: true`, so
        this always uses `messages.create`, even for a streamed op; streaming
        is transport, not part of the cached prefix.

        Never validates (there is no tool call, so rule 9 does not apply) and
        never raises for a failed request: a cold cache costs money, not
        correctness, so the error is logged and swallowed. Never retried on an
        overload either; the calls it warms for retry on their own. If the API
        400s on `max_tokens: 0` and accepts 1, 1 is used from then on. An
        unknown `op` is a caller bug and raises `KeyError`, as everywhere."""
        spec = OP_REGISTRY[op]
        kwargs = self._request(
            spec, system=system, user_message=user_message, cache_prefix=cache_prefix
        )
        timeout = self._timeout_for(spec)
        started = time.monotonic()
        max_tokens = self._prewarm_max_tokens

        def send(tokens: int) -> Any:
            request = {**kwargs, "max_tokens": tokens}
            return call_within_deadline(
                lambda: self._sdk.messages.create(**request, timeout=timeout),
                timeout,
                name="llm-prewarm",
            )

        try:
            with self._counted():
                try:
                    response = send(max_tokens)
                except Exception as exc:
                    # A spend-limit refusal is a 400 too; 1 token fares no better.
                    if (
                        max_tokens != 0
                        or getattr(exc, "status_code", None) != 400
                        or is_spend_limit(exc)
                    ):
                        raise
                    max_tokens = 1
                    response = send(max_tokens)
                    self._prewarm_max_tokens = 1
        except Exception as exc:
            _logger.warning(
                "llm_prewarm op=%s run_id=%s model=%s failed=True status=%s cause=%s "
                "max_tokens=%s elapsed_ms=%s",
                spec.name,
                current_import_run_id(),
                kwargs["model"],
                getattr(exc, "status_code", None),
                type(exc).__name__,
                max_tokens,
                round((time.monotonic() - started) * 1000),
            )
            return
        usage = getattr(response, "usage", None)
        _logger.info(
            "llm_prewarm op=%s run_id=%s model=%s max_tokens=%s cache_write=%s cache_read=%s "
            "elapsed_ms=%s",
            spec.name,
            current_import_run_id(),
            kwargs["model"],
            max_tokens,
            getattr(usage, "cache_creation_input_tokens", None),
            getattr(usage, "cache_read_input_tokens", None),
            round((time.monotonic() - started) * 1000),
        )

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
        input_hash = self._input_hash(user_message)
        kwargs = self._request(
            op, system=system, user_message=user_message, cache_prefix=cache_prefix
        )
        started = time.monotonic()
        meta: dict[str, Any] = {}
        response = self._send(op, meta, **kwargs)
        try:
            result = _validate_tool_response(response, op)
        except _RecoverableLlmError as first_error:
            stop_reason = getattr(response, "stop_reason", None)
            # A prose answer is not a duplicate verdict, so fail-closed ops
            # retry it too. A refusal is never replayed: the same request
            # would be refused again, and one that came back before any
            # output has no content to replay.
            prose_only = first_error.tool_use_id is None and stop_reason == "end_turn"
            if stop_reason == "refusal" or not (op.retry_schema_once or prose_only):
                self._log(
                    op,
                    prompt_version,
                    model,
                    response,
                    retried=False,
                    started=started,
                    meta=meta,
                    failed=True,
                    input_hash=input_hash,
                )
                raise SchemaInvalidLlmError(op.name) from None
            result = self._retry_once(
                op, kwargs, response, first_error, prompt_version, model, input_hash, started
            )
            return result

        self._log(
            op,
            prompt_version,
            model,
            response,
            retried=False,
            started=started,
            meta=meta,
            input_hash=input_hash,
        )
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
        started: float,
    ) -> BaseModel:
        retry_messages = [*kwargs["messages"]]
        if first_response.content:
            # An assistant turn with empty content is a 400.
            retry_messages.append({"role": "assistant", "content": first_response.content})
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
            # `disable_parallel_tool_use` normally yields at most one
            # tool_use, but every id replayed in the
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
            # No tool_use block at all (the model answered in prose) --
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
        meta: dict[str, Any] = {}
        response2 = self._send(op, meta, **retry_kwargs)
        try:
            result = _validate_tool_response(response2, op)
        except _RecoverableLlmError:
            self._log(
                op,
                prompt_version,
                model,
                response2,
                retried=True,
                started=started,
                meta=meta,
                failed=True,
                input_hash=input_hash,
            )
            raise SchemaInvalidLlmError(op.name) from None

        self._log(
            op,
            prompt_version,
            model,
            response2,
            retried=True,
            started=started,
            meta=meta,
            input_hash=input_hash,
        )
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
        """Stream an op's tool input as raw JSON fragments (prompt spec
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
            "tool_choice": _TOOL_CHOICE,
            "messages": [{"role": "user", "content": _ask_for_tool(user_message, op.name)}],
            "stream": True,
        }
        usage: Any = None
        # Writer-tier models (observed with claude-sonnet-5) sometimes emit a
        # *second* tool_use block for the same tool in one message.
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
        stream = _create_with_timeout(self._sdk, self._timeout_for(op), op.name, **kwargs)
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
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> StoryEntities:
        return self._call(
            "infer_story_entities",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
            cache_prefix=cache_prefix,
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

    def infer_scene_motivations(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> SceneMotivations:
        return self._call(
            "infer_scene_motivations",
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

    def check_structure(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredStructureCheck:
        return self._call(
            "check_structure",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def verify_structure_check(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> StructureCheckVerification:
        return self._call(
            "verify_structure_check",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def segment_scene(
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> SegmentedScene:
        return self._call(
            "segment_scene",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
            cache_prefix=cache_prefix,
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
