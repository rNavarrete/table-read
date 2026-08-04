# Import concurrency + progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce large-script import wall-clock by running per-scene LLM work four-at-a-time and show truthful scene counters, elapsed time, and ETA throughout Analyze.

**Architecture:** `analyze_import` emits typed internal stage/progress events and uses a `ThreadPoolExecutor` within the segmentation and extraction stage barriers. The create-import SSE adapter maps those internal events to the synchronized Zod/Pydantic wire union; the wizard consumes progress frames and computes ETA locally without changing prompts or persistence.

**Tech Stack:** Python 3.12, `concurrent.futures`, FastAPI SSE, Pydantic, Zod, React 18, TypeScript, Vitest, pytest.

## Global Constraints

- Approved spec: `docs/superpowers/specs/2026-07-12-import-parallel-progress-design.md`.
- Stage order stays segment all → extract all → consistency scan → one atomic save.
- `IMPORT_LLM_CONCURRENCY = 4`; results are restored to source scene order.
- Per-scene typed-start retry remains inside the segmentation worker.
- First hard worker failure cancels pending work, emits failure, and persists nothing.
- Progress event is exactly `{ type: "progress", stage, done, total }`; `done` is monotonic and never exceeds `total`.
- UI marks a stage Done only when the next stage starts or `complete` arrives.
- ETA uses the latest 10 completion intervals, appears after 5 completions, and is hidden after 30 seconds without progress; elapsed remains visible.
- Use existing `--tr-*` tokens only; throttle `aria-live` scene announcements to every 10 completions.
- Update Zod, Pydantic, and data-contract together; `make check-contract` must pass.
- No LLM operation schema or prompt changes; do not bump `PROMPT_VERSION`; do not run `make evals`.

---

### Task 1: Progress event contract and SSE adapter

**Files:**

- Modify: `packages/contract/src/index.ts`
- Modify: `apps/api/schemas.py`
- Modify: `apps/api/fountain/create_import.py`
- Modify: `apps/api/tests/test_import_create.py`
- Modify: `docs/tableread-data-contract.md`

**Interfaces:**

- Produces Pydantic `ImportProgressItemEvent` and wire union variant:
  `{type: "progress", stage: ImportProgressStageName, done: int, total: int}`.
- Produces `_progress_frame(stage: str, done: int, total: int) -> str`.
- Consumes the internal pipeline events Task 2 defines as
  `ImportStageStarted(name)` and `ImportStageProgress(stage, done, total)`.

- [ ] **Step 1: Add failing Zod/Pydantic contract assertions**

Extend contract tests or `test_import_create.py` to validate:

```python
event = ProjectImportProgressEvent.model_validate({
    "type": "progress",
    "stage": "segmenting_beats",
    "done": 2,
    "total": 3,
})
assert event.root.done == 2
```

Add an SSE frame assertion:

```python
assert parse_frame(_progress_frame("segmenting_beats", 2, 3)) == (
    "progress",
    {"type": "progress", "stage": "segmenting_beats", "done": 2, "total": 3},
)
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
cd apps/api && .venv/bin/pytest tests/test_import_create.py -q --tb=short
```

Expected: missing progress variant/frame.

- [ ] **Step 3: Add synchronized schemas**

Zod union variant:

```ts
z.object({
  type: z.literal('progress'),
  stage: ProjectImportStageName,
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})
```

Pydantic mirror:

```python
class ImportProgressItemEvent(_Base):
    type: Literal["progress"]
    stage: ImportProgressStageName
    done: int = Field(ge=0)
    total: int = Field(ge=0)
```

Include it in `ProjectImportProgressEvent`.

- [ ] **Step 4: Update SSE adapter**

Add `_progress_frame`. Change `create_and_import_events` to inspect the internal event class rather than assuming every yielded value is a stage string:

```python
if isinstance(event, ImportStageStarted):
    yield _stage_frame(event.name)
elif isinstance(event, ImportStageProgress):
    yield _progress_frame(event.stage, event.done, event.total)
```

Task 1 may temporarily import event classes added in the same commit by Task 2; if executing strictly sequentially, Task 1 implementer should add the small immutable event dataclasses to `pipeline.py` without parallel behavior.

- [ ] **Step 5: Update data contract §9.3**

Document the progress variant, monotonic `done <= total`, and example segment/extract frames.

- [ ] **Step 6: Verify**

Run:

```bash
cd apps/api && .venv/bin/pytest tests/test_import_create.py -q
cd ../.. && make check-contract
```

Expected: all pass; 39 schemas synchronized (or current synchronized count).

- [ ] **Step 7: Commit**

```bash
git add packages/contract/src/index.ts apps/api/schemas.py \
  apps/api/fountain/create_import.py apps/api/fountain/pipeline.py \
  apps/api/tests/test_import_create.py docs/tableread-data-contract.md
git commit -m "import: add per-scene progress SSE contract"
```

---

### Task 2: Parallel per-scene pipeline coordinator

**Files:**

- Modify: `apps/api/fountain/pipeline.py`
- Modify: `apps/api/tests/test_import.py`
- Modify: `apps/api/tests/test_import_create.py`

**Interfaces:**

- Consumes internal `ImportStageStarted` / `ImportStageProgress` from Task 1.
- Produces four-worker ordered segmentation and extraction.
- `analyze_import(...)` yields `ImportPipelineEvent`, then returns `ImportAnalysis`.

- [ ] **Step 1: Add RED progress/order tests**

Add a three-scene test that drains `analyze_import` and asserts:

```python
segment = [e for e in events if isinstance(e, ImportStageProgress)
           and e.stage == STAGE_SEGMENTING_BEATS]
assert [(e.done, e.total) for e in segment] == [(1, 3), (2, 3), (3, 3)]
```

Add a concurrency-2 fake LLM whose scene calls complete out of order; assert final scene locations, beat text, and ids remain source order. Add a failing worker test asserting the create-import path emits `failed` and DB row counts remain zero.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
cd apps/api && .venv/bin/pytest tests/test_import.py tests/test_import_create.py -q --tb=short
```

- [ ] **Step 3: Extract pure worker functions**

In `pipeline.py`:

```python
IMPORT_LLM_CONCURRENCY = 4

@dataclass(frozen=True)
class ImportStageStarted:
    name: str

@dataclass(frozen=True)
class ImportStageProgress:
    stage: str
    done: int
    total: int
```

Create `_segment_one(index, span, project_doc, llm)` containing the existing prompt, first normalization, optional retry, score selection, and privacy-safe logging. Create `_extract_one(index, scene, new_doc, episode_id, characters, llm)` returning the raw validated extraction without mutating shared lists.

- [ ] **Step 4: Add ordered parallel coordinator**

Use an explicit executor (not a `with` block, whose `__exit__` waits for
already-running futures after failure):

```python
def _run_ordered_parallel(items, worker, *, stage):
    results = [None] * len(items)
    pool = ThreadPoolExecutor(max_workers=IMPORT_LLM_CONCURRENCY)
    try:
        futures = {pool.submit(worker, index, item): index
                   for index, item in enumerate(items)}
        done = 0
        for future in as_completed(futures):
            index = futures[future]
            results[index] = future.result()
            done += 1
            yield ImportStageProgress(stage, done, len(items))
    except BaseException:
        pool.shutdown(wait=False, cancel_futures=True)
        raise
    else:
        pool.shutdown(wait=True)
    return results
```

Because a yielding helper's return value must be captured, add a small `_drain_parallel` pattern or inline each stage coordinator clearly. Do not yield from worker threads.
Python cannot stop an already-running HTTP call; cancellation is best-effort for
pending futures, and the coordinator must return the failure without waiting
for unrelated running calls to finish.

- [ ] **Step 5: Parallelize segmentation and extraction**

Replace bare stage strings with `ImportStageStarted`. Collect results by index. During extraction, workers return extraction objects; the coordinator sequentially mints fact ids and appends facts in scene order after the barrier, preserving deterministic ids.

Update `run_to_completion` to ignore all `ImportPipelineEvent` values.

- [ ] **Step 6: Verify behavior and atomicity**

```bash
cd apps/api && .venv/bin/pytest tests/test_import.py tests/test_import_create.py \
  tests/test_fountain_parse.py -q
```

Expected: pass, including progress, out-of-order completion, retries, and zero persistence on failure.

- [ ] **Step 7: Commit**

```bash
git add apps/api/fountain/pipeline.py apps/api/tests/test_import.py \
  apps/api/tests/test_import_create.py
git commit -m "import: parallelize per-scene LLM stages"
```

---

### Task 3: Truthful wizard progress, elapsed time, and ETA

**Files:**

- Create: `apps/web/src/projects/wizard/importProgress.ts`
- Create: `apps/web/src/projects/wizard/importProgress.test.ts`
- Modify: `apps/web/src/projects/wizard/ImportWizard.tsx`
- Modify: `apps/web/src/projects/wizard/ImportWizard.test.tsx`

**Interfaces:**

- Consumes wire `progress` events from Task 1.
- Produces pure `advanceImportProgress(state, event, nowMs)` and
  `formatElapsed(ms)` / `estimateRemainingMs(state, nowMs)`.

- [ ] **Step 1: Write RED pure-state tests**

Cover:

```ts
// stage starts but is not Done
expect(state.currentStage).toBe('segmenting_beats')
expect(state.completedStages).not.toContain('segmenting_beats')

// next stage completes previous
expect(next.completedStages).toContain('segmenting_beats')

// monotonic counter
expect(next.progress.segmenting_beats).toEqual({ done: 5, total: 10 })

// ETA only after 5 samples; latest 10 samples; stale >30s => null
```

- [ ] **Step 2: Run and confirm RED**

```bash
cd apps/web && npx vitest run \
  src/projects/wizard/importProgress.test.ts \
  src/projects/wizard/ImportWizard.test.tsx
```

- [ ] **Step 3: Implement pure progress model**

State includes:

```ts
interface StageProgress {
  done: number
  total: number
}
interface ProgressSample {
  atMs: number
  completedUnits: number
}
interface ImportProgressState {
  currentStage: ProjectImportStageName | null
  completedStages: ProjectImportStageName[]
  stages: Partial<Record<ProjectImportStageName, StageProgress>>
  startedAtMs: number | null
  lastProgressAtMs: number | null
  samples: ProgressSample[]
}
```

Keep at most 11 cumulative samples so the latest 10 intervals drive ETA. Remaining units combine unfinished segment and extraction totals. Return no ETA before 5 completed units or after 30 seconds stale.

- [ ] **Step 4: Wire SSE events**

On a `stage` event, mark the prior `currentStage` complete, then set the new stage current. On `progress`, clamp stale/out-of-order frames so UI counters never regress. On `complete`, mark all started stages Done before navigation.

- [ ] **Step 5: Render rows and timer**

Each heavy stage renders `{done} of {total}` and:

```tsx
<div
  role="progressbar"
  aria-valuemin={0}
  aria-valuemax={total}
  aria-valuenow={done}
  className="h-1 overflow-hidden rounded-card bg-tr-surface-sunken"
>
  <div
    className="h-full bg-tr-coral"
    style={{ width: `${(done / total) * 100}%` }}
  />
</div>
```

The width is data-derived, not a hardcoded design color/spacing exception. Add a one-second UI clock while streaming; always show elapsed. Show `estimating…`, `about N min left`, or only elapsed when stale.

Throttle the live announcement string to stage changes and `done % 10 === 0`; visual counters still update every frame.

- [ ] **Step 6: Verify**

```bash
cd apps/web && npx vitest run src/projects/wizard/
```

Expected: all wizard tests pass, including stage semantics, counter/bar, ETA, stale state, elapsed, and a11y throttle.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/projects/wizard/importProgress.ts \
  apps/web/src/projects/wizard/importProgress.test.ts \
  apps/web/src/projects/wizard/ImportWizard.tsx \
  apps/web/src/projects/wizard/ImportWizard.test.tsx
git commit -m "web: show truthful import progress and ETA"
```

---

### Task 4: Authority docs and final verification

**Files:**

- Modify: `docs/tableread-ui-spec.md`
- Modify: `docs/tableread-test-plan.md`
- Modify: `docs/tableread-build-plan.md`
- Modify: `docs/tableread-handoff.md`

- [ ] **Step 1: Update docs**

Add T7.12 with acceptance criteria: four workers, ordered results, monotonic per-scene events, honest Done semantics, elapsed, ETA after 5 completions, stale ETA hidden, atomic failure.

- [ ] **Step 2: Run required verification**

```bash
make test
make lint
make check-contract
git diff --check
```

Expected: all pass. Do not run `make evals`.

- [ ] **Step 3: Final focused smoke**

Start `make dev`, import a multi-scene fixture, and verify progress counters rise while stages remain In progress until the next stage begins. Stop the smoke server afterward if this task started it.

- [ ] **Step 4: Commit**

```bash
git add docs/tableread-ui-spec.md docs/tableread-test-plan.md \
  docs/tableread-build-plan.md docs/tableread-handoff.md
git commit -m "docs: T7.12 parallel import progress"
```

## Self-review

- Spec coverage: server concurrency, wire progress, ordering, cancellation, UI semantics, ETA, stale behavior, a11y, docs, and all required gates each map to a task.
- No prompt/tool-schema change appears in any task; evals remain explicitly forbidden.
- The internal event names and wire property names are consistent across Tasks 1–3.
- No placeholder steps remain.
