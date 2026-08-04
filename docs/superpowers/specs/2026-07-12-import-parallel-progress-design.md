# Import concurrency + truthful per-scene progress — design spec

**Date:** 2026-07-12  
**Status:** approved (conversation)  
**Authority after merge:** updates `docs/tableread-data-contract.md` §9.3 (new `progress` SSE event), `docs/tableread-ui-spec.md` (Analyze step), `docs/tableread-test-plan.md`, and `docs/tableread-build-plan.md` (new task, suggested T7.12). Zod (`packages/contract`) + Pydantic (`schemas.py`) change together per hard rule 3. **No LLM operation schema or prompt template changes** — `PROMPT_VERSION` stays, no `make evals` required.

## 1. Goal

A ~110-scene feature import runs ~220 sequential LLM calls today and reports only five coarse stage names, with stages marked Done at start. Two changes, one design:

1. **Speed:** parallelize per-scene LLM calls within each stage (~4× wall-clock reduction on the LLM-heavy stages).
2. **Honesty:** per-scene progress events over SSE, client-computed ETA, and correct stage Done semantics.

Unchanged trust posture: analyze is still the single explicit AI gesture; the import is still atomic (one write at the end; failure persists nothing); lock guard still runs before any LLM call.

## 2. Locked decisions

| Decision                      | Choice                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parallelism scope             | Within-stage only; stage barriers stay (segment all → extract all → scan)                                                                                           |
| Mechanism                     | `concurrent.futures.ThreadPoolExecutor` (pipeline + Anthropic client are sync)                                                                                      |
| Worker count                  | Default **4**, one module constant (`IMPORT_LLM_CONCURRENCY`)                                                                                                       |
| Ordering                      | Results gathered by scene index; document order, `scene-<i>` / `beat-<i>-<j>` ids, and flag attribution unchanged and deterministic                                 |
| Per-scene retry               | Stays inside the scene's worker task (typed-start repair retry, unchanged semantics)                                                                                |
| Error handling                | First hard failure cancels remaining work and fails the import (existing semantics — nothing persisted)                                                             |
| Progress event                | `{ "type": "progress", "stage": <stageName>, "done": n, "total": m }` emitted by the coordinator as workers finish                                                  |
| Emission guarantee            | Monotonic `done` per stage; emitted from the SSE generator thread (workers push to a queue / callback; only the coordinator writes to the stream)                   |
| Stage Done semantics (UI fix) | A stage is In progress from its `stage` event until the _next_ `stage` event (or `complete`); Done only after that                                                  |
| ETA                           | Client-side: rolling average of last 10 per-scene completions × remaining scene-units across segment+extract stages; shown after ≥5 completions, else "estimating…" |
| Elapsed time                  | Always shown once streaming starts                                                                                                                                  |
| a11y                          | `aria-live` progress announcements throttled to every ~10 scenes                                                                                                    |
| Schema homes                  | `ProjectImportProgressEvent` union gains the `progress` variant in Zod + Pydantic + data-contract §9.3; `make check-contract` green                                 |
| Evals                         | Not required (no prompt/tool-schema change)                                                                                                                         |

## 3. Non-goals

- Cross-stage pipelining (extraction starting while segmentation is still running)
- Import-job cache / resume (T7.11, queued separately)
- Model or craft-level changes; batch API
- Server-side ETA
- Progress persistence across page reloads (SSE stream is the source; a dropped connection still surfaces CONNECTION_ERROR as today)

## 4. Server design

### 4.1 Coordinator shape (`fountain/pipeline.py`)

`analyze_import` stays a generator the SSE route drains; its yields become richer:

- Yields `("stage", name)` at each stage start (wire-compatible with today's stage event).
- For segment and extract stages: submit one task per scene to a pool of `IMPORT_LLM_CONCURRENCY` workers; as futures complete (`as_completed`), yield `("progress", stage, done, total)` from the generator (never from worker threads).
- Store each result at its scene index; after the barrier, proceed exactly as today.
- On any task raising: cancel pending futures, re-raise — route maps to the existing failure envelope; nothing persisted.

`run_to_completion` and `run_import` (non-SSE caller) ignore progress items — same drain loop, tuple-aware.

### 4.2 Threading constraints

- Workers call only `render.build_*` + `llm.segment_scene` / `llm.extract_ledger_facts` and pure normalization — no DB session, no shared mutable doc state.
- MockLlmClient's queued `set_responses` pops must stay deterministic under concurrency for tests: PR-path tests may set `IMPORT_LLM_CONCURRENCY = 1` via monkeypatch where response order matters, plus one dedicated test with concurrency > 1 asserting order-independence of the assembled doc (keyed by scene index, not completion order).
- Logging unchanged (ids/counts only), now includes the stage's `done/total` counters.

## 5. Wire contract (data contract §9.3)

New event in the import SSE union:

```ts
{ type: "progress", stage: ProjectImportStageName, done: number, total: number }
```

- `total` = scene count for `segmenting_beats` and `extracting_facts`; `1` for singleton stages (no progress events required for those).
- `done` monotonic within a stage, `done <= total`.
- Existing `stage`, `complete`, `failed` events unchanged — old clients that ignore unknown `type` values keep working.

Zod: extend the import progress event union in `packages/contract/src/index.ts`. Pydantic: mirror in `schemas.py`. Docs: §9.3 example stream gains progress lines.

## 6. UI design (Analyze step)

- Stage rows: Pending → In progress (from its `stage` event) → Done (next `stage` event or `complete`). Fixes the current Done-at-start bug.
- LLM-heavy stage rows render `— {done} of {total}` plus a thin determinate progress bar (tokens only; reuse existing surfaces — no new colors).
- Status line under the list: `Elapsed 2:41 · about 4 min left` — ETA from rolling mean of the last 10 per-scene completion intervals × remaining units (segment+extract combined); "estimating…" until 5 completions; hide ETA (keep elapsed) if no progress event for >30s.
- `aria-live="polite"` announcement every 10th scene and on stage changes, not every event.
- Failure state keeps the cost/estimate line and Retry/Edit source/Return actions as today.

## 7. Tests

| Case                    | Expect                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pipeline emits progress | Mock LLM, 3 scenes: progress events `(1..3)/3` for segment and extract stages, monotonic, coordinator-emitted        |
| Order independence      | Concurrency 2 with staggered mock latencies: assembled scenes/beats identical to sequential run (ids by scene index) |
| Failure cancels         | One scene's mock raises: import fails, nothing persisted, no further progress events after failure                   |
| Contract                | Zod/Pydantic progress event round-trips; `make check-contract` green                                                 |
| Wizard stage semantics  | Stage row not Done while its own stage events still arriving; Done after next stage event                            |
| Wizard counters + ETA   | Progress frames drive `x of y`; ETA appears after 5 completions; elapsed always renders                              |
| a11y throttle           | announcements at scene 10, 20 … not every frame                                                                      |

## 8. Rollout notes

- One PR-sized task is likely too big; split server (pipeline + contract) and web (wizard) into two tasks in the plan, same feature branch.
- `IMPORT_LLM_CONCURRENCY = 4` chosen for low-tier Anthropic rate limits; bumping later is a one-line change.
- If rate-limit 429s appear in real use, the Anthropic client's existing retry/timeout handling applies unchanged; concurrency constant is the only knob (backoff redesign out of scope).
