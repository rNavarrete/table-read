# Import Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the import wizard's progress list with the live "Breaking the Board" view. It runs on a new additive `found` SSE event, fixes the progress page's honesty problems, and holds on the finished board at the end.

**Architecture:**

- **Server:** the import pipeline yields `ImportFound` events built from data already in memory, and `create_import` streams them as `event: found`.
- **Web:**
  - a pure reducer folds `found` events into a `BoardState`
  - React components render it with the prototype's materials and motion (CSS and the Web Animations API)
  - `ImportWizard` swaps its stage list for the board, and holds at the finale.

**Tech Stack:** FastAPI/Pydantic, Zod contract, React 18 + TS + Tailwind tokens, Vitest, Playwright, MockLlmClient.

**Spec:** `docs/superpowers/specs/2026-10-12-import-board-design.md`

**Prototype:** `docs/superpowers/prototypes/2026-10-12-breaking-the-board.html`, the visual reference. Match its look, motion and copy.

## Execution shape

```
Task 1 contract ──┬── Task 2 server ───────────────┐
                  └── Task 3 web model → Task 4 web UI ─┴── Task 5 integrate (merge, e2e, docs)
```

Tasks 2 and 3/4 run in parallel in separate worktrees; Task 4 starts on Task 3's commit. Each task owns only its listed files.

## Global Constraints

- **Never touch the live checkout.** Never edit `/Users/rolandonavarrete/Documents/tableread` (live checkout; its dev API runs `uvicorn --reload`). Work only in your assigned worktree under `/private/tmp/claude-501/-Users-rolandonavarrete-Documents-tableread/e01f6f26-992e-40b8-b7ce-ce2105b26759/scratchpad/`.
- **Run tools directly, not via `make`.**
  - Python: `/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/{python,pytest,ruff}`, with `PYTHONDONTWRITEBYTECODE=1` and `pytest -p no:cacheprovider`. Import app modules only inside pytest.
  - JS: `npx …` from the worktree root.
  - Formatting: `npm run format:check` inside `apps/web` and `packages/contract`. The root-level prettier check fails on `tokens.css` already.
- **Rule 1:** MockLlmClient only. Never call the Anthropic API.
- **Rule 3:** the new event goes in Zod, Pydantic, data contract §9.3 and the test plan; `scripts/check_contract.py` must pass. It's not an LLM op, so there is no tool-schema change, no `PROMPT_VERSION` bump, and no evals (evals are on hold anyway).
- **Rule 5:** `found` frames never contain `scriptText`. Log lines for them carry stage, kind and counts only.
- **Rule 6:** colors and spacing come from tokens only. New tokens go in `apps/web/src/styles/tokens.css` and UI spec §1 (Task 4).
- **Rule 10:** no new dependencies; motion is CSS or WAAPI.
- **The stream loop must never await an animation.** Coalesce `found` frames once per `requestAnimationFrame`. When more than 8 arrive in one frame, or `cached` is true, apply them without motion.
- **`prefers-reduced-motion`** disables tilt, flight, lamp, count-up and sweep.
- **Model-written strings** carry the `~` prefix (as the prototype does): `whatHappens`, thread labels and the logline.
- **Commits:** `area: imperative summary`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

1. **A cached resume:** a burst of `found` frames with `cached: true` rebuilds the board instantly, without animating 54 cards one by one or skewing the ETA. Pinned in Task 3 (reducer and ETA tests) and Task 4 (no-animation path).
2. **Failure mid-stage:** the board freezes where it got to, the step reads Stopped, the sweep and clock stop, and Retry / Edit source / Return to dashboard still work. Pinned in Task 3 and Task 4 (wizard test).
3. **Mock speed (e2e):** all frames arrive in under a second, and the page must still reach the finale with working buttons. Pinned in Task 5 (e2e).
4. **A failed scene unit:** an amber "Couldn't break into beats" card, never an empty success. Pinned in Task 2 (server emits `failed: true`) and Task 3 (reducer).
5. **120 scenes:** compact cards keep the board within about two screens and the act-break FLIP stays smooth (transform only). Pinned in Task 4 (compact-mode test).

## Fixed interfaces

**Contract (Task 1 → all).** In `packages/contract/src/index.ts`, next to `ProjectImportProgressEvent` (~line 892):

```ts
const NonNeg = z.number().int().nonnegative()
export const ImportFoundScene = z.object({
  index: NonNeg,
  slugline: z.string(),
  lineCount: NonNeg,
  intExt: z.enum(['int', 'ext', 'other']),
})
export const ProjectImportFound = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scenes'), scenes: z.array(ImportFoundScene) }),
  z.object({ kind: z.literal('scene'), index: NonNeg, beatCount: NonNeg, whatHappens: z.string(), failed: z.boolean() }),
  z.object({ kind: z.literal('acts'), format: ShowFormat, sceneActs: z.array(NonNeg) }),
  z.object({ kind: z.literal('castRead'), sceneIndexes: z.array(NonNeg) }),
  z.object({
    kind: z.literal('cast'),
    total: NonNeg,
    characters: z.array(z.object({ name: z.string(), sceneCount: NonNeg })),
  }),
  z.object({
    kind: z.literal('threads'),
    threads: z.array(
      z.object({
        label: z.string(),
        status: z.enum(['open', 'paid_off', 'abandoned']),
        setupSceneIndex: NonNeg.nullable(),
        payoffSceneIndex: NonNeg.nullable(),
      }),
    ),
  }),
  z.object({
    kind: z.literal('overview'),
    logline: z.string(),
    beatSheet: z.array(z.object({ label: z.string(), sceneIndex: NonNeg.nullable() })),
  }),
  z.object({ kind: z.literal('facts'), index: NonNeg, factCount: NonNeg, secretCount: NonNeg, failed: z.boolean() }),
  z.object({ kind: z.literal('flags'), contradictions: NonNeg, tensions: NonNeg, other: NonNeg }),
])
export type ProjectImportFound = z.infer<typeof ProjectImportFound>
// add to the ProjectImportProgressEvent union:
//   z.object({ type: z.literal('found'), stage: ProjectImportStageName, cached: z.boolean().default(false), data: ProjectImportFound }),
```

**Server (Task 2).**

- `fountain/pipeline.py`:

  ```python
  @dataclass(frozen=True)
  class ImportFound:
      stage: str
      data: dict
      cached: bool = False
  ```

- Builders are pure functions in a new `fountain/found.py`, each returning the camelCase dict for one `data` variant:
  - `scenes_found(spans)`
  - `scene_found(index, beats, reading, failed)`
  - `acts_found(format_dict, scene_acts)`
  - `cast_read_found(scene_indexes)`
  - `cast_found(characters, scene_docs, shooting_script)`
  - `threads_found(threads, scene_index_by_id)`
  - `overview_found(overview, scene_index_by_id)`
  - `facts_found(index, extraction, failed)`
  - `flags_found(flags)`

**Web model (Task 3 → Task 4).** New `apps/web/src/projects/wizard/importBoard.ts`:

```ts
import type { ConsistencyFlag, LedgerFact, Project, ProjectImportFound, ShowFormat } from 'contract'

export type BoardScene = {
  index: number
  slugline: string
  lineCount: number
  intExt: 'int' | 'ext' | 'other'
  read: 'pending' | 'read' | 'failed'
  beatCount: number
  whatHappens: string
  act: number | null
  castRead: boolean
  factCount: number | null
  secretCount: number
  factsFailed: boolean
  pins: number[] // 1-based thread numbers pinned on this card
}
export type BoardThread = {
  label: string
  status: 'open' | 'paid_off' | 'abandoned'
  setupSceneIndex: number | null
  payoffSceneIndex: number | null
}
export type BoardState = {
  scenes: BoardScene[]
  format: ShowFormat | null
  actsKnown: boolean
  cast: { total: number; characters: { name: string; sceneCount: number }[] } | null
  threads: BoardThread[] | null
  logline: string | null
  beatSheet: { label: string; sceneIndex: number | null }[]
  flags: { contradictions: number; tensions: number; other: number } | null
  latestIndex: number | null // newest filled card (read or facts) for the lift/lamp
  factTotal: number
}
export function emptyBoard(): BoardState
export function applyFound(state: BoardState, data: ProjectImportFound): BoardState // pure, never mutates input
export function reconcileWithResult(
  state: BoardState,
  result: { project: Project; newFacts: LedgerFact[]; consistencyFlags: ConsistencyFlag[] },
): BoardState
export function actGroups(state: BoardState): { act: number; label: string; sceneIndexes: number[] }[] // labels via plan/planTree.actLabel; [] until actsKnown
```

**Web UI (Task 4).** These testids are used by the e2e test in Task 5:

- `import-board`
- `board-card-<index>` (with `data-state="pending|read|failed"`)
- `board-act-<act>`
- `board-headline`
- `board-step-<stage>` (with `data-status="done|now|waiting|stopped"`)
- `board-logline`
- `board-cast`
- `board-threads`
- `board-finale`
- `open-your-story`, `see-it-in-plan`.

---

### Task 1: Contract for the `found` event

**Files:**

- Modify:
  - `packages/contract/src/index.ts`
  - `packages/contract/src/index.test.ts`
  - `apps/api/schemas.py` (mirror next to `ProjectImportProgressEvent`, ~line 860–895)
  - `packages/contract/scripts/export-json-schema.ts` and `scripts/check_contract.py` (`SCHEMA_NAMES`, only if the event or its parts are listed there today)
  - `docs/tableread-data-contract.md` §9.3

**Interfaces:**

- Produces: `ProjectImportFound`, `ImportFoundScene`, and the `found` variant, exactly as in "Fixed interfaces".

- [ ] **Step 1: Contract tests first.** In `index.test.ts`:
  - `ProjectImportProgressEvent.parse` accepts one example of every `found` kind.
  - `cached` defaults to `false`.
  - It rejects `{kind:'scene', index:-1, …}` and an unknown kind.
  - Run `npx vitest run --root packages/contract`. Expect FAIL.
- [ ] **Step 2: Add the Zod schemas** from "Fixed interfaces". Expect PASS.
- [ ] **Step 3: Pydantic mirror.**
  - Use one `_Base` class per variant, with `kind: Literal['scenes']` and so on, plus `ImportFoundScene`, `ProjectImportFoundEvent`, and the union member on the `ProjectImportProgressEvent` RootModel.
  - Follow the existing discriminated-union pattern in `schemas.py`, with the discriminator field declared first (check_contract's `discriminator_order_failures`).
  - Then run `PYTHONDONTWRITEBYTECODE=1 …/python scripts/check_contract.py` and expect `check-contract: OK`.
- [ ] **Step 4: Docs.** Data contract §9.3 lists the `found` event and each kind with one line on when it fires and that it is post-merge with no `scriptText`. Add a §9.3 note: "Additive; clients ignore unknown event types."
- [ ] **Step 5: Gate and commit.**
  - Run: contract vitest, API pytest (full), ruff, check_contract.
  - Commit `contract: add the import found event`.

### Task 2: Server emits `found` (parallel with 3–4)

**Files:**

- Create:
  - `apps/api/fountain/found.py`
  - `apps/api/tests/test_import_found.py`
- Modify:
  - `apps/api/fountain/pipeline.py` (the `ImportFound` dataclass and the yields)
  - `apps/api/fountain/create_import.py` (map to `event: found`, log counts; today it raises `TypeError` on unknown events, ~line 225)

**Interfaces:**

- Consumes: Task 1's Pydantic types (validate builder output against them in tests).
- Produces: the frames in the spec's Data section.

- [ ] **Step 1: Tests first** (`test_import_found.py`). Drive the import through the existing harness in `tests/test_import.py` (`client.post('/api/v1/projects/{pid}/import', …)` with `mock_llm.set_responses('segment_scene', one_beat_per_scene(src))` …), or through `create_and_import_events` directly, and collect frames. Assert:
  - Exactly one `scenes` frame, with `len == N`, the right `intExt` and line counts.
  - One `scene` frame per scene, with each `index` covered once and `beatCount` matching the result.
  - One `acts` frame whose `sceneActs` has length N, and one `castRead` per entity chunk.
  - One `cast` frame: `total` equals the final bible character count, `characters` is sorted by `sceneCount` descending with at most 12 entries, and each count is the number of scenes where that character speaks.
  - One `threads` frame matching the episode threads' setup/payoff scene indexes.
  - One `overview` frame with the logline and the beat-sheet labels.
  - One `facts` frame per scene, and one `flags` frame with severity counts.
  - **A segment that fails twice** emits `{kind:'scene', failed:true, beatCount:1}`.
  - **Resume:** a second import with the same Idempotency-Key after a forced failure mid-facts (pattern: existing resume tests in `test_import_create.py`) re-emits earlier `scene` frames with `cached: true`.
  - **No `found` frame** contains any beat's `scriptText` (check every string value against the source lines).
  - **Rule 5:** `caplog` from `fountain.create_import` contains no slugline, whatHappens, label or logline text.
  - Existing `stage`/`progress` frames are unchanged; the existing tests still pass.
- [ ] **Step 2: `found.py`.** Builders are pure; each returns the exact camelCase dict.
  - `intExt`:
    - `int` if the slugline (after an optional leading scene number) starts with `INT` but not `INT./EXT` or `INT/EXT`
    - `ext` if it starts with `EXT` but not `EXT./INT` or `EXT/INT`
    - `other` for everything else.
  - `cast_found`:
    - per scene, take the cue names (`fountain.characters.cues_from_scenes([scene], shooting_script=<whole-script decision>)`)
    - resolve each to a character with `resolve_character_id`
    - count distinct scenes per character
    - `total = len(characters)`.
  - `scene_index_by_id`: `{f"scene-{i+1}": i}`.
- [ ] **Step 3: Yield the events in `pipeline.py`.**
  - **Parsing:** yield `scenes` after the spans are built.
  - **Segmenting:**
    - In `_run_ordered_parallel`, after each unit is checkpointed and before or with its progress frame, yield `scene`. Thread a per-stage `found` callback through the existing `on_result` path rather than duplicating the loop.
    - At stage start, yield cached units' `scene` frames with `cached=True`. Today `_run_ordered_parallel` skips `on_result` for cached units, so emit those first.
  - **Acts:** yield `acts` after the act merge.
  - **Entities:** yield `castRead` per chunk (the chunk's scene ids → indexes), and `cast` after the stage-end merge.
  - **Promises:** yield `threads` after the merge.
  - **Overview:** yield `overview` after the merge.
  - **Facts:** yield `facts` per scene result, including cached units with `cached=True` at stage start.
  - **Consistency:** yield `flags` after the server adds its own flags.
  - **Never** yield the raw pre-merge cast.
- [ ] **Step 4: `create_import.py`.**
  - Map `ImportFound` to `sse_frame('found', {'type': 'found', 'stage': e.stage, 'cached': e.cached, 'data': e.data})`, using the existing frame helper.
  - Log `import_found stage=… kind=… cached=… count=…`, where count is the length of the list or 1.
  - Keep the `TypeError` for truly unknown events.
- [ ] **Step 5: Gate and commit.**
  - Run the full API pytest and ruff.
  - Commit `import: stream what each step found as it finds it`.

### Task 3: Web board model and honesty fixes (parallel with 2; before 4)

**Files:**

- Create:
  - `apps/web/src/projects/wizard/importBoard.ts`
  - `apps/web/src/projects/wizard/importBoard.test.ts`
  - `apps/web/src/projects/wizard/importTimings.ts`
- Modify:
  - `apps/web/src/projects/wizard/importProgress.ts` (+ its test)
  - `apps/web/src/api/sse.ts`, only if typing the new event needs it.

**Interfaces:**

- Produces: everything in "Fixed interfaces / Web model".
- Also:
  - `importProgress` state gains `stoppedStage: ProjectImportStageName | null` and `stageStartedAtMs: Partial<Record<ProjectImportStageName, number>>`.
  - `isIndeterminate(stage)` is true for `inferring_acts`, `inferring_promises`, `inferring_overview`, `checking_consistency` and `saving`.
  - `etaRange(state, sceneCount): {lowMin: number; highMin: number} | null`.
  - `importTimings.ts` exports `STEP_SECONDS_PER_SCENE` with these values:

    | Step | Seconds per scene |
    |---|---|
    | segmenting | 1.97 |
    | acts | 0.19 (10 s floor) |
    | entities | 1.04 |
    | threads | 1.55 |
    | overview | 0.88 |
    | facts | 1.97 |
    | consistency | 0.64 |

    It also exports `usualRange(stage, sceneCount)`, which returns a ±40% band.

- [ ] **Step 1: Reducer tests first** (`importBoard.test.ts`, node env):
  - `scenes` creates N pending cards.
  - `scene` out of order fills by index; `failed` → `read:'failed'`.
  - `acts` sets `act` per card and `actsKnown`; `actGroups` uses `actLabel` (cold open → 'COLD OPEN').
  - `castRead` marks those cards.
  - `cast` stored as given.
  - `threads` sets `pins`: thread `k` (1-based) appears on its setup and payoff cards, and null indexes add no pin.
  - `overview` sets the logline and beat sheet.
  - `facts` sets per-card counts, `factTotal` sums them, and `failed` → `factsFailed`.
  - `flags` stored.
  - `latestIndex` follows the last `scene` or `facts` frame.
  - The input state is never mutated (deep-freeze in the test).
  - `reconcileWithResult` sets final counts from the project. Cards keep their reading, and missing data, such as scenes the client never saw, is filled from the project's scenes and beats.
- [ ] **Step 2: Implement `importBoard.ts`** to pass. Keep it pure, with no React.
- [ ] **Step 3: Honesty tests in `importProgress.test.ts`:**
  - Promises' `progress 1/2` still reads as indeterminate (no half bar).
  - A `failed` frame sets `stoppedStage` and the stage's status to `stopped`.
  - The ETA ignores a burst: more than 3 units within 200 ms right after a stage start don't count as speed.
  - `etaRange` includes the singleton stages' priors.
- [ ] **Step 4: Implement** the changes in `importProgress.ts` and `importTimings.ts` to pass. Keep existing exports working; `ImportWizard` still uses them until Task 4.
- [ ] **Step 5: Gate and commit.**
  - Run: `npx vitest run --root apps/web`, `npx tsc -b apps/web`, `npx eslint apps/web/src`, and `npm run format:check` in `apps/web`.
  - Commit `wizard: board model and honest progress`.

### Task 4: Web board UI and wizard integration (after 3; parallel with 2)

**Files:**

- Create, in `apps/web/src/projects/wizard/board/`:
  - `ImportBoard.tsx`
  - `IndexCard.tsx`
  - `BoardRail.tsx` (logline, format, cast Polaroids, notes/threads)
  - `StepSpine.tsx`
  - `boardMotion.ts` (WAAPI helpers: deal, actBreakFlip, drawString, countUp, `prefersReducedMotion()`)
  - tests: `ImportBoard.test.tsx`, `IndexCard.test.tsx`, `boardMotion.test.ts`
- Modify:
  - `apps/web/src/projects/wizard/ImportWizard.tsx` (+ `ImportWizard.test.tsx`)
  - `apps/web/src/styles/tokens.css`
  - `docs/tableread-ui-spec.md` §1 (the new tokens) and §2a (the board replaces the stage list; live results approved 2026-10-12)
  - `apps/web/src/index.css`, only for keyframes that must be global, under a reduced-motion guard.

**Interfaces:**

- Consumes: Task 3's model.
- Produces: the testids in "Fixed interfaces / Web UI".

- [ ] **Step 1: Tokens.** Add the spec's tokens to `tokens.css`, mirrored into the Tailwind theme the same way existing tokens are, and list them in UI spec §1. Values come from the prototype's `:root` and card CSS.
- [ ] **Step 2: Component tests first** (jsdom). `IndexCard`:
  - pending shows "Not read yet"
  - read shows `~ whatHappens`, one tick per beat (capped at 12), and an `aria-label` of "Scene 3, INT. BAR, read, 5 beats"
  - failed shows amber text
  - facts stamp, ◆ when `secretCount > 0`, and pins.

  `ImportBoard`:
  - before `actsKnown`, one frame labelled "In script order"
  - after, one `board-act-<n>` frame per group with a tape label
  - more than 40 scenes uses compact cards
  - threads render the rail list with status text; the first thread's string is drawn as an SVG path between its two cards
  - the finale renders `board-finale` with `open-your-story` focused and `see-it-in-plan`.

  `StepSpine`: done, now, waiting and stopped as text, not color alone.
- [ ] **Step 3: Implement the components** to match the prototype:
  - **Paper cards:**
    - ruled lines and a header rule
    - unread cards get a small tilt from `index`
    - read cards square up
    - the newest card lifts and the lamp moves to it
    - compact size above 40 scenes.
  - **Tape labels** on act frames.
  - **Rail:** the Logline card (ruled placeholder, fades the logline in whole), the Format card, cast Polaroids with name and scene count, and Notes (latest find or focused card) that become the threads list with status chips, then flags as amber chips.
  - **Strings:** sagging quadratic paths between pins, drawn with `stroke-dashoffset`. The first thread is strong (1.8px), the rest faint.
  - **Headline narrator:** Newsreader 40, cross-fading per stage.
  - **Reduced motion:** every helper in `boardMotion.ts` becomes a no-op, and tilt is off.
- [ ] **Step 4: Wire `ImportWizard.tsx`.**
  - When the stream starts, render `ImportBoard` in place of today's stage-card list, keeping the existing step-2 shell. Keep `Elapsed m:ss` and the existing error block (Retry / Edit source / Return to dashboard).
  - **Handle `found` frames** in the stream loop by pushing them to a queue. A `requestAnimationFrame` flush applies `applyFound` for the queued frames in one `setState`. Pass `animate=false` when the batch is longer than 8 or any frame is `cached`. Never await inside the loop.
  - **On `complete`:** `reconcileWithResult`, then show the finale.
    - Do **not** call `window.location.assign` automatically.
    - **Open your story:** `saveLedgerView(result.project.id, 'story')`, then navigate to `/ledger?project=…`, exactly as today.
    - **See it in Plan:** goes to the Plan route for the project (copy how other screens navigate to Plan).
  - **On `failed`:** the board freezes and the step spine shows `stopped` for that stage.
  - **Step clock:** the caption shows `<label> · m:ss on this step · usually <range>` (`usualRange`) for indeterminate stages. `aria-live` announces stage starts, the act result and every 10th scene only.
  - **Update `ImportWizard.test.tsx`:**
    - stage starts render in the spine
    - `found` frames fill cards
    - singletons are indeterminate (no fake half bar)
    - a failed stage reads Stopped and loses its indeterminate testid
    - `complete` shows the finale and does NOT navigate until **Open your story** is clicked, then saves the Story view and navigates.
- [ ] **Step 5: Gate and commit.**
  - Run: web vitest (all), `tsc -b`, eslint, and `npm run format:check` in `apps/web`.
  - Commit `wizard: build the board live while the script imports`.

### Task 5: Integrate, e2e, docs

**Files:**

- Modify:
  - `apps/web/e2e/zz-newproject-import-success.spec.ts`
  - `apps/web/e2e/newproject-import-failure.spec.ts`
  - `docs/tableread-test-plan.md`
  - `docs/tableread-handoff.md` (decision log, 2026-10-12: import board chosen; live results amend UI spec §2a; finale holds with Open your story)

- [ ] **Step 1: Merge** Task 2's and Task 4's branches into `feat/import-board` with `--no-ff`. Then run the full gate: API pytest, ruff, check_contract, web and contract vitest, `tsc -b`, eslint, and `format:check`.
- [ ] **Step 2: Update the e2e specs.**
  - **Success:** the board reaches `board-finale`; `board-card-0` has `data-state="read"`; an act frame exists; clicking `open-your-story` lands on `/ledger?project=` with the Story tab.
  - **Failure:** the spine shows a `stopped` step and the error actions work.
  - Run with `E2E_API_PORT=8100 E2E_WEB_PORT=5180`. If the installed Playwright browser is the wrong version, use a temporary untracked config that points at an installed chromium, and remove it before committing.
- [ ] **Step 3: Docs.**
  - Test plan entries: `found` frames, cached replay, failed unit, no `scriptText` in frames, log privacy, the board reducer, honesty fixes, finale hold.
  - Handoff decision rows.
- [ ] **Step 4: Gate and commit.** Commit `docs: import board in test plan and handoff`.
