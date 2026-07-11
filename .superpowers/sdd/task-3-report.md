# Task 3 Report: Per-call 120s timeout

## Status: DONE

## What changed

- `llm/errors.py`: added `LlmTimeoutError(op)` — deliberately not a
  `SchemaInvalidLlmError` subclass, so it can never be mistaken for a
  rule-9 retry-exhausted failure.
- `llm/anthropic_client.py`:
  - `DEFAULT_LLM_CALL_TIMEOUT_SECONDS = 120`.
  - `_create_with_timeout(sdk_client, timeout, op, **kwargs)`: submits
    `sdk_client.messages.create(**kwargs)` to a single-worker
    `ThreadPoolExecutor`, waits via `future.result(timeout=...)`, and on
    `concurrent.futures.TimeoutError` best-effort-cancels the future and
    raises `LlmTimeoutError(op)`. Does **not** wait for `executor.shutdown()`
    on the timeout path (`wait=False`) — waiting would re-introduce the
    exact hang the timeout exists to avoid.
  - `AnthropicClient.__init__` gained `call_timeout_seconds: float =
    DEFAULT_LLM_CALL_TIMEOUT_SECONDS`, stored as `self._call_timeout_seconds`.
  - Every `self._sdk.messages.create(...)` call site now goes through the
    helper: the first call in `_call`, the rule-9 retry call in
    `_retry_once`, and the stream-opening call in `_stream_tool` (per the
    brief: "non-stream + stream entry if it also calls create"). Because the
    first `create()` call sits *outside* the `try/except _RecoverableLlmError`
    block, a first-call timeout propagates `LlmTimeoutError` straight out of
    `_call` without ever reaching `_retry_once` — no code change needed
    beyond the exception type to satisfy "timeout must not enter rule-9
    retry." A retry-call timeout likewise propagates out of `_retry_once`
    unmodified (no fabricated `SchemaInvalidLlmError`).
- `evals/graders.py`: `ContinuityJudge` gained the same
  `call_timeout_seconds` constructor param and now calls
  `_create_with_timeout(..., "continuity_judge", ...)` (imported from
  `llm.anthropic_client`) instead of `self._sdk.messages.create(...)`
  directly.
- `evals/checks.py` / `evals/adoption.py`: every
  `except SchemaInvalidLlmError:` that wraps a `messages.create`-backed call
  is now `except (SchemaInvalidLlmError, LlmTimeoutError):` (7 sites total).
  `continuity_eval` additionally wraps the previously-unguarded
  `judge.grade(...)` call in its own `try/except LlmTimeoutError`, counting a
  judge timeout into the same `schema_failures` bucket as a client-side
  schema failure (commented as an intentional bucket reuse, not a literal
  "schema failure").
- `apps/api/tests/test_llm_timeout.py` (new): constant value, hung-first-call
  timeout + `.op`, hung-retry-call timeout (proves no third attempt / no
  fabricated `SchemaInvalidLlmError`), `LlmTimeoutError` is not a
  `SchemaInvalidLlmError` subclass (or vice versa), default-timeout wiring,
  and an eval-loop integration test (`schema_validity_eval` scores a
  timeout as invalid, not valid) using a fake `LlmClient` that raises
  `LlmTimeoutError` for every op — no real sleeping in that last test.

## Tests

`pytest tests/test_llm_timeout.py tests/test_evals_checks.py
tests/test_llm_anthropic_client.py tests/test_llm_factory.py
tests/test_llm_protocol.py -v` → 55 passed. Full suite: `pytest -q` → **722
passed**. `ruff check` clean on all six touched/created files.

## Self-review / concerns

1. **`_create_with_timeout` is imported across a module boundary as a
   "private" (underscore-prefixed) name** (`evals/graders.py` imports it
   from `llm.anthropic_client`). Avoids duplicating the executor plumbing;
   flagging in case the team prefers a small shared `llm/timeout.py` instead.
2. **Thread lingers past the timeout.** `future.cancel()` is a no-op once
   the SDK call has actually started (Python threads have no cooperative
   cancellation), so a genuinely hung real call keeps its worker thread
   alive until the underlying I/O eventually returns or the process exits
   (`concurrent.futures.thread`'s atexit handler joins pending threads at
   interpreter shutdown, which could itself stall shutdown on a truly
   wedged connection). This is inherent to thread-based timeouts over
   blocking SDK calls and matches the brief's specified mechanism
   (ThreadPoolExecutor + `future.result`); a stronger guarantee would need
   the SDK's own request-level timeout/cancellation instead.
3. **`calibrate()` does not catch `LlmTimeoutError`.** The brief scoped the
   timeout-as-schema-invalid treatment to `continuity_eval`'s run loop, not
   the calibration gate. A timeout during calibration currently propagates
   uncaught rather than resolving to `calibrated: False` the way
   `GraderError` does. Flagging as a candidate follow-up, not fixed here
   since it was out of the stated brief scope.
4. **Streaming steady-state hangs aren't covered.** Only the call that
   *opens* the stream (`_stream_tool`'s `messages.create(..., stream=True)`)
   is timed, per the brief. A stream that opens fine but then stalls
   mid-delivery has no timeout here — that's a different mechanism
   (per-chunk read timeout) the brief didn't ask for.

No regressions to Task 1 (tiered runs) or Task 2 (progress) — both their
test files are in the 722-passed full-suite run.

## Important Review Finding Fix — 2026-07-11

- Fixed the calibration timeout gap called out in self-review concern 3:
  `evals/graders.py::calibrate()` and `evals/run.py --calibrate-only` now catch
  `(GraderError, LlmTimeoutError)`. A judge timeout during calibration fails
  closed (`calibrated: False` / CLI mismatch) rather than crashing or
  fabricating a verdict.
- Added regression coverage in `apps/api/tests/test_llm_timeout.py`:
  `test_grader_calibration_timeout_fails_closed_without_fabricating_verdict`.
- Red check before fix:
  `cd "/Users/rolandonavarrete/Documents/tableread/.worktrees/evals-harness" && apps/api/.venv/bin/pytest apps/api/tests/test_llm_timeout.py -k calibration`
  → failed with uncaught `llm.errors.LlmTimeoutError` from `calibrate()`.
- Covering tests after fix:
  `cd "/Users/rolandonavarrete/Documents/tableread/.worktrees/evals-harness" && apps/api/.venv/bin/pytest apps/api/tests/test_llm_timeout.py apps/api/tests/test_evals_checks.py`
  → 32 passed in 1.14s.
