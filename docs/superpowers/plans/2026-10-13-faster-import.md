# Faster import — Phase 1 plan

**Date:** 2026-10-13 · **Approved by:** owner ("lets go with all four changes")

**Research:** `reports/Import speed plan.md` in the owner's checkout (round 1, skeptic-checked). This plan implements its Phase 1 (1a–1d) and nothing else.

**Goal:** cut a 54–68-scene import from 7.4–8.7 min to about 2.5–3 min (estimate), with **byte-identical saved output**:

- no prompt, schema or model change
- no hand check needed
- locks, snapshots and rule 9 unchanged
- one atomic write at the end, as today.

## Global constraints

- **Worktrees only.** Work in your assigned worktree under `/private/tmp/claude-501/-Users-rolandonavarrete-Documents-tableread/e01f6f26-992e-40b8-b7ce-ce2105b26759/scratchpad/`. Never edit `/Users/rolandonavarrete/Documents/tableread` (its API runs `uvicorn --reload`). **Never use `git stash`**: the stash is shared and holds the owner's WIP.
- **Run tools directly, not via `make`:** `/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/{pytest,ruff,python}` with `PYTHONDONTWRITEBYTECODE=1` and `-p no:cacheprovider`, and `npx` from the worktree root.
- **No Anthropic API calls, ever.** Tests use MockLlmClient or fake SDK clients. Never run `make evals`.
- **Rule 5:** new log fields are numbers only (ms, token counts), never prompt or script text.
- **Rule 10:** no new dependencies.
- **Escape hatches** (env vars; the defaults are the new behavior):
  - `TABLEREAD_IMPORT_CONCURRENCY`: default **8**, clamped to 1–16.
  - `TABLEREAD_IMPORT_OVERLAP=0`: restores today's serial stage order.
- **Commits:** `area: imperative summary`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Fixed interfaces

### Task A → B, C

In `apps/api/llm/protocol.py` (`LlmClient`), the Anthropic client, and the mock:

```python
def prewarm_cache(self, op: str, *, system: str, user_message: str) -> None:
    """Best-effort: write the prompt cache for `op` without generating an answer."""
```

- **Request shape:** exactly the real `op`'s request — model, tools, `tool_choice`, system, thinking/effort, and the same `cache_control` breakpoints — with `max_tokens=0`.
  - If the API rejects `max_tokens=0` with a 400, retry once with `max_tokens=1` and use 1 from then on.
  - Confirm in the bundled claude-api skill docs or the official prompt-caching docs whether pre-warming with `max_tokens: 0` is supported, and whether thinking settings must match for message-cache hits. Follow the docs; cite them in a code comment.
- **Never validates output, never raises.** Any error is logged (`llm_prewarm op=… failed=True status=…`) and swallowed, because a cold cache costs money, not correctness.
- **Logs** `llm_prewarm op=… model=… cache_write=… elapsed_ms=…`.
- **Mock:** records the invocation (`_invocations['prewarm_cache:' + op]`) and returns `None`.

Also, in the per-call log line (`anthropic_client.py` ~306), add `elapsed_ms=<int>` and `ttft_ms=<int or ->`. `ttft_ms` is for streamed calls; other calls log `-`.

### Task B (pipeline)

- `IMPORT_LLM_CONCURRENCY` reads `TABLEREAD_IMPORT_CONCURRENCY` (default 8, clamp 1–16).
- `_run_ordered_parallel(…, prewarm: Callable[[], None] | None = None)` replaces `warm_cache_first`. When more than one item is outstanding, it calls `prewarm()` once (synchronously), then fans out all items.

## Tasks

### Task A — AI client (first)

**Files:**

- `apps/api/llm/anthropic_client.py`
- `apps/api/llm/protocol.py`
- `apps/api/llm/mock.py`
- tests: `apps/api/tests/test_llm_anthropic_client.py`, `test_llm_mock.py`, and a new `test_llm_retry.py` if cleaner.

**1. Bounded overload retry.** Replace `_retry_once_if_overloaded` with `_retry_if_overloaded`:

- **Scope:** 429, 529, and 5xx other than 504; up to 4 attempts.
- **Wait:** honor `retry-after` (seconds, from the SDK error's response headers) when present. Otherwise use exponential backoff of 2, 4, 8 s, plus or minus 20% jitter. Cap the total wait at 60 s.
- **Never** after a timeout or a 504.
- **Each wait is logged** through `log_llm_unavailable`, with ids and numbers only.
- **Tests:**
  - `retry-after` is honored (fake `sleep`)
  - attempts are capped
  - the total-wait cap holds
  - a 504 and a timeout are not retried
  - success on the 3rd attempt
  - a 400 is not retried.

**2. Timing fields** on the `llm_call` line. Test that they're present and numeric.

**3. `prewarm_cache`** per the interface. Tests against the fake SDK:

- identical tools, system, `tool_choice` and thinking/effort as the real op call
- `max_tokens=0`
- the 400 fallback to 1, remembered thereafter
- errors swallowed and logged
- no output validation.

**Gate:** full API pytest and ruff. Commit `llm: bounded overload retries, call timing and cache prewarm`.

### Task B — Pipeline (after A; parallel with C)

**Files:**

- `apps/api/fountain/pipeline.py`
- tests: `apps/api/tests/test_import*.py`, plus a new `test_import_overlap.py`.

**1. Concurrency setting** per the interface. Test the clamp and default.

**2. Prewarm instead of warm-first.**

- In segmenting, entities and facts, pass `prewarm=lambda: llm.prewarm_cache(op, system=…, user_message=<first outstanding item's user message>)`.
- Additionally, start the cast and facts prewarms **right after acts**, on a background thread, if their cached prefix doesn't depend on later stages. Check the facts prompt: round 1 found the character list sits in the uncached part. If it does depend, prewarm just before that stage.
- **Tests (mock):** `prewarm_cache` is called once per fan-out stage, and no item runs alone first.

**3. Overlap the late stages.**

- **What runs concurrently:** after the cast merge, threads (`infer_narrative_promises`), overview (`infer_story_overview`) and facts→consistency (facts fan-out, then `scan_consistency`).
  - Single Opus calls get their own executor, so they never queue behind facts calls.
  - **Build every prompt on the generator's thread before submitting.** Check each prompt builder's inputs: overview must not read threads (round 1: `render.py:527-560`), and facts must not read threads or overview. Prove it with a test that compares prompt hashes between serial and overlap mode.
- **Generator-thread rules:**
  - **All DB writes** (checkpoints, run rows) happen on the generator's thread as results are drained, never on workers.
  - **Merges** run in today's order: threads merge, then overview merge, then facts assembly, then consistency.
  - **Events** (`stage`, `progress`, `found`) are yielded in **exactly today's order**. Buffer facts and consistency events until the overview stage's events have been yielded, so the board and data contract §9.3 are unchanged.
- **Resume:** load all checkpoints (threads, overview, facts units, consistency) before any stage-reset logic (round 1 flagged the facts reset near `pipeline.py:714`). A resumed import never re-calls a finished unit.
- **Failure:** if any branch fails, checkpoint every finished sibling result before raising the first error, keeping today's error mapping (`SchemaInvalidLlmError`, timeouts, unavailable).
- **`TABLEREAD_IMPORT_OVERLAP=0`** restores today's serial path.
- **Tests:**
  - **Byte-identical output.** Run a multi-scene import (existing harness: `one_beat_per_scene`) in overlap mode and in serial mode (`TABLEREAD_IMPORT_OVERLAP=0`, `TABLEREAD_IMPORT_CONCURRENCY=1`). The created project doc, ledger facts and flags are identical, ignoring server-minted random ids if the existing tests do so. The full event sequence (types, stages, order) is identical.
  - **Real overlap.** With a slow fake LLM client (sleeping per op: threads 0.3 s, overview 0.2 s, each fact 0.05 s), wall time in overlap mode is well under serial. Use a generous margin so it isn't flaky.
  - **Resume:** a failure injected in facts while threads is done, then a resume, re-calls neither threads nor overview.
  - **A branch failure** checkpoints its siblings and surfaces the right error code.
- **Comments:** fix the stale comments round 1 flagged (`pipeline.py:546-547`, `663-665`, `1411`) to match the new behavior.

**Gate:** full API pytest, ruff and `scripts/check_contract.py`. Commit `import: run independent late stages together and prewarm caches`.

### Task C — Web estimate (after A; parallel with B)

**Files:**

- `apps/web/src/projects/wizard/importProgress.ts`
- `apps/web/src/projects/wizard/importTimings.ts`
- their tests.

**Changes:**

- **ETA by branch.** Remaining time after the cast step is `max(threads, overview, facts + consistency)` minus elapsed in each branch, not the sum. Before the cast step, it's the sum of remaining serial steps plus that max.
- **Priors.** Divide the per-scene priors for segmenting and facts by an assumed concurrency factor, `CONCURRENCY_SPEEDUP = 1.8` (an estimate for 8 workers versus 4; comment that it gets refit once the new `elapsed_ms` logs exist). Keep the single-call priors.
- **Tests:**
  - 40 s into threads, with facts done, the ETA reflects only threads' remainder
  - before the cast step, the ETA uses the max of the late branches, not their sum
  - the existing honesty tests still pass.

**Gate:** web Vitest, `tsc -b`, eslint, and `npm run format:check` in `apps/web`. Commit `wizard: estimate time along the longest branch`.

### Task D — Integrate

- Merge B and C into `perf/faster-import` and run every gate.
- The two import e2e specs pass with `E2E_API_PORT=8100 E2E_WEB_PORT=5180`. If the Playwright browser version mismatches, use a temporary config pointing at an installed chromium, and remove it before committing.
- Add a test-plan entry and a handoff decision-log row (2026-10-13: Phase 1 speed-ups; concurrency 8; overlap; prewarm; escape-hatch env vars).
- One review pass, then the PR.

## Verification the owner does after merge

- **Check the rate-limit tier** (Console → Limits). If it's the lowest tier, keep concurrency at 8.
- **Run one real import** and read the new `elapsed_ms` / `ttft_ms` / `llm_prewarm` lines and the total time against the baselines: Mr. Plow 445 s, Monorail 520 s.
- **If anything looks off,** set `TABLEREAD_IMPORT_OVERLAP=0` and/or `TABLEREAD_IMPORT_CONCURRENCY=4` to restore today's behavior instantly.
