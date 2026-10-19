# Plan Redesign — Phase 3 (T3.7 Episode chart and live order check) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is deliberately lean: it gives exact interfaces, test names with their key assertions, and code only where the logic is easy to get wrong. Write the rest in the style of the Phase 1–2 files it names.

**Goal:** Put a sticky SVG episode chart under the highlight bar (act bands, blocks sized by script share, setup→payoff arcs, open-thread "?" arcs, the secret lane, note rules, unsaved dots, click to select), and add the live order check: a pure check over the board order that drives Order notes (with **Go to scene n** and **Undo the move**), a "⚠ order with n" tape, amber arcs and secret-lane segments, the Continuity highlight and N, plus a drag prediction on the drop target and "Locked — can't swap".

**Architecture:** The order check is one pure function, `orderIssues(episode)` in `apps/web/src/plan/story.ts`, run inside the memoized `boardModel`, which hangs each scene's computed Order notes on its `SceneSignals` so every existing consumer (card chip, highlights, N, announcements, Episode view) picks them up from the same model. Every board move (swap, act change, empty-act drop) goes through one new `applySceneMove(project, move)` in `planTree.ts` that returns the PATCH ops and their optimistic twin; the drag prediction (`predictMove`) runs the same function on a hypothetical move, so a prediction can never disagree with the save. A small `useUndoMove` hook remembers the last move's head snapshot and offers **Undo the move** only while that snapshot is still the head (POST `/undo` with `If-Match`, in place, like Phase 1's Dismiss Undo). The chart is a hand-written SVG component, `EpisodeChart`, whose geometry (`chartLayout`, `chartMarks`) is exported pure and memoized on the model and the measured width.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 4 (`--tr-*` tokens only), Vitest + Testing Library (jsdom 29), Playwright e2e against the real FastAPI app with a seeded temp DB and `MockLlmClient`; types from `packages/contract` (`contract`).

**Spec:** `docs/superpowers/specs/2026-10-13-plan-redesign-design.md` (§4.4, §4.8, §4.2 tape, §4.5 Continuity, §4.6 Order note, §4.9 chart dot, §4.11, §6, §7 Phase 3, §8). Visual reference: the owner's clickable mockup `reports/Plan redesign/Plan redesign mockup.html` in the owner's checkout (its `renderChart`, `orderIssues`, `relTape`, the D4 drag handlers and the Order note in `renderPanel`). It is built on a copyrighted script: **never copy its text into the repo, tests or docs.** Use `docs/tableread-fixture.json` ("The Long Pour") and generic wording ("The spare key", "The moved cash").

## Global Constraints

- No contract change, no new endpoint, no new LLM operation, no PROMPT_VERSION bump.
- Tokens only. **Phase 3 adds no token.** SVG colours are Tailwind `fill-tr-*` / `stroke-tr-*` classes from literal maps (precedent: `stroke-tr-sky` in `projects/wizard/board/ImportBoard.tsx`): `sky`, `sky-soft`, `amber`, `coral`, `surface-clay`, `surface-raised`, `border-strong`, `text-primary`, `ledger-secret-ink`, `accent-ink`. SVG geometry (x, width, stroke width, radius) is computed data, like Phase 2's share-bar `style.width`. No hex outside `:root`; SVG text uses `text-11` (nothing below 11px).
- Rule 8 / quiet AI: the chart, the order check, the prediction and Undo the move call no model. No component in this plan imports `suggestInstructions` or `createChangeSet`.
- Rule 4: every move is **one** PATCH that snapshots once and rolls back on failure (`useProjectPatch`): a swap sends `buildSceneSwapPatch`'s ops, an act change (Act select or empty-act drop) one `replace …/act`. Undo the move is one `POST /projects/{pid}/undo` with `If-Match` = the move's head. Order notes are computed: never stored, never dismissed (no `dismissConsistencyFlag` call for them).
- Drag stays **swap** (insert is Phase 4). A locked card (scene or episode lock) never drags and never takes a drop; while a card is dragged over it, it says "Locked — can't swap". Nothing drags while `busy`.
- Performance at 70 scenes: `orderIssues` runs inside the memoized `boardModel`; `chartLayout`/`chartMarks` are `useMemo`'d on `model` and the measured width; the width changes only through a `ResizeObserver` (nothing runs on scroll); the prediction runs only while a dragged card is over a target.
- Reduced motion: the chart has no transition or animation; a block click scrolls its card in with `scrollIntoView({ block: 'nearest' })` (never `smooth`).
- Accessibility: the chart SVG is `aria-hidden` and not focusable, with a one-sentence `sr-only` summary beside it; the board stays the accessible structure. Order notes are reachable from the card (⚑ count), N and the strip.
- Kept test ids: `act-frame-{n}`, `scene-card-{id}` (+ `data-locked`), `consistency-flag-badge`, `inspector`, `lock-toggle`, combobox "Act", `mode-switcher`, `unsaved-dot`, `notes-strip`, `plan-live`. New: `episode-chart`; `chart-block-{sceneId}` (+ `data-chart-block`, `data-scene-id`, `data-note`, `data-draft`, `data-locked`, `data-match`, `data-selected`); `chart-arc-{threadId}` (+ `data-tone="sky|amber"`, `data-open`); `chart-lane-{secretId}` (+ `data-tone="secret|amber"`); `order-note-{issueId}`.
- No new dependencies (no ResizeObserver polyfill: guard `typeof ResizeObserver`). No `DESIGN-GAP` comments are expected; if one is needed it must name a task id (`// DESIGN-GAP(T3.7): …`).
- Commits: `area: imperative summary`, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tests beside code; e2e in `apps/web/e2e/`.
- Never edit the owner's checkout, never `git stash`, never push, never `make`, never call the Anthropic API.

## Review Focus

1. **The order check is right, and the prediction is the save's own result** — all three cases on board order (act, then index), abandoned threads / a payoff in its own setup scene / missing scenes skipped, stable ids; `predictMove` applies the exact PATCH twin. *Pinned by:* Task 1 ("orders by act, then index", "predictMove equals the new problems of the saved result"), Task 4 ("dragging over a card predicts the swap on it").
2. **Undo the move never undoes anything else** — offered only on the problems the last move added and only while that move's snapshot is the head; POST `/undo` with `If-Match` = that head; a stale head shows the copy and drops the offer; a failed move offers nothing. *Pinned by:* Task 2 (`useUndoMove.test`), Task 6 ("Undo the move is gone once another edit moves the head", "a failed move rolls back and offers nothing"), Task 6 e2e.
3. **Locks and one write per gesture** — a locked target says "Locked — can't swap" and never takes the drop; a move sends exactly one PATCH; the prediction, the chart and the order check send nothing. *Pinned by:* Task 4 ("a locked card says Locked — can't swap and refuses the drop"), Task 6 ("an act change sends one PATCH; the prediction and the chart send nothing").
4. **Order notes behave as notes, but computed** — no Dismiss, clear when the order is fixed, open the strip only when a new problem lands on the selected scene, and count wherever story notes count (⚑ chip, collapsed act, Continuity, N, jump bar, announcement, Episode view). *Pinned by:* Task 1 ("Continuity and N count order problems"), Task 5 ("an Order note comes first and has no Dismiss"), Task 6 ("the Order note shows at once and opens the strip").
5. **The chart is cheap, quiet and secondary** — `aria-hidden` SVG with one sentence beside it; ~70 scenes fit 1,000px at ≥6px; equal widths without script; no animation; a block click only selects. *Pinned by:* Task 3 (`chartLayout` "70 scenes fit 1,000px", "the SVG is hidden from assistive tech…", "never animates", "a block click selects its scene").

---

## How to run things in this worktree

Every command starts from the worktree root. Run each line as its own shell call, or keep the `( … )` subshells.

- Unit tests: `(cd apps/web && npx vitest run <paths>)`; the whole suite: `(cd apps/web && npx vitest run)`
- Typecheck: `(cd apps/web && npx tsc -b)`
- Lint: `(cd apps/web && npx eslint <files>)`
- Format: `(cd apps/web && npx prettier --write <your files>)`, then `npx prettier --check <your files>`
- E2E (ports as given by the orchestrator: `E2E_API_PORT`, `E2E_WEB_PORT`). Playwright 1.61.1 expects chromium 1228 but only 1243 is installed, so use a TEMPORARY config and a TEMPORARY venv symlink, and delete both before any lint or commit:

```bash
ln -s /Users/rolandonavarrete/Documents/tableread/apps/api/.venv apps/api/.venv
cat > apps/web/e2e/playwright.local.config.ts <<'EOF'
// TEMPORARY (local Chromium path on this machine). Delete before committing.
import os from 'node:os'
import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    launchOptions: {
      executablePath: `${os.homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    },
  },
})
EOF
(cd apps/web && E2E_API_PORT=<api> E2E_WEB_PORT=<web> npx playwright test --config=e2e/playwright.local.config.ts <specs>)
rm apps/web/e2e/playwright.local.config.ts apps/api/.venv
git status --short   # neither temporary path may appear
```

- Six Write-mode e2e tests may already fail on `origin/main`: `error-states.spec.ts` (×2), `locked-beat.spec.ts`, `quiet-ai.spec.ts`, `write.spec.ts` (×2). Before blaming this work, run the same spec on a baseline worktree of `origin/main` (`git worktree add <scratchpad>/wt-baseline origin/main`, same temporary config and symlink, then `git worktree remove`). Never `git stash`.
- One e2e worker shares one seeded DB; files run in name order (`plan-notes.spec.ts` before `plan.spec.ts` before `review.spec.ts`). When the new `plan.spec.ts` tests run (appended at the end): `scene-4` is in act 1, act 2 is empty, `scene-5` is in act 3, `scene-6` is locked, and `scene-5` carries the open story note `plan-notes.spec.ts` brought back. `review.spec.ts` locks `scene-5` later. The fixture has `threads: []` and no `secrets` key.

## Codebase facts the tasks rely on

- `story.ts` (Phases 1–2): `boardOrder` (act, then index), `boardModel(project, episode, flags)` → `{ order, signals, acts, threads, characters, hasScript, hasThreads }`; `SceneSignals` has `number` (`index + 1`), `place`, `storyNotes`, `importNotes`, `setsUp`, `paysOff`, `neverPaidOff`, `secret`, `scriptLength`, …; `ActSummary` has `act`, `label`, `scenes`, `share`, …; `relationTape`, `highlightTape`, `matchesHighlight` (None = has a story note), `highlightCount`, `nextMatchId`, `selectionAnnouncement`, `HIGHLIGHT_TONE`. Live threads = `status !== 'abandoned'`; a payoff counts only when its setup scene is in the episode.
- `storyNotes` consumers outside `story.ts`: `BoardCard` (amber ⚑ chip, accessible name), `Board` (collapsed act "k with notes"), `panel/EpisodeView` (Notes count and rows via `NoteRows`).
- `planTree.ts`: `buildSceneSwapPatch` (the dragged scene takes the target's index **and act**; the target takes the dragged index and keeps its act) and its twin `swapScenesLocally`; `buildScenePatch` / `withSceneField`; `findScene`. It imports nothing from `story.ts` (no cycle when `story.ts` imports from it).
- `PlanScreen`: `saveSceneField(sceneId, 'act', n)` is the Act select's save and the empty-act drop's; `handleReorder` is the swap; `busy = patcher.pending || dismissal.busy || openingReview`; `announce(message)` sets `plan-live`; `selectScene(id)` expands a collapsed act and announces; `cardEl(id)`; Board's `header` slot holds `<HighlightBar>`; `NotesStrip` is keyed by the scene id and gets `noteCount` via `ScenePanel`.
- Undo paths today: the top bar's Undo (`AppShell.handleUndo`) sends `POST /undo` **without** `If-Match` and reloads, wrapped in `runHistoryChange` (the leave guard). Phase 1's Dismiss Undo (`panel/useDismissNote.ts`) sends `undoProject(projectId, { expectedHeadSnapshotId: headAfter })` and applies the restored project in place (no reload); its stale copy is "Can't undo the dismiss — Plan changed since. Use Undo in the top bar." `undoProject` resolves the restored `Project`.
- The server scans for new consistency flags only on structural fields (`whatHappens`, `premise`, storyline summaries): an `act`/`index` PATCH returns the bare project, creates no flag and calls no model. Snapshots restore flags with the doc, so undoing a move needs no flag refetch.
- `useProjectPatch.patch(ops, optimisticNext)` resolves `true` only when the server accepted; it refuses a second call while one is in flight.
- `BoardCard`: drop target = `ring-2 ring-tr-sky`; a locked card's `handleDragOver` returns before `onDragOver()`; the tape is `max-w-[134px] truncate`, `aria-hidden`, and its text is in the accessible name. `Board`: `scroll-pt-48` sized for the bar alone; `onDragOver={() => setDropTargetId(id)}` is unconditional.
- jsdom 29: no layout (`getBoundingClientRect` is zeros), **no `ResizeObserver`**, `requestAnimationFrame` exists; `HTMLDialogElement.showModal` is stubbed in `PlanScreen.test.tsx`, which also mocks `undoProject` (`undoProjectMock`).

## Defaults this plan takes (product calls the spec leaves open)

Each is built as written unless the owner says otherwise; none blocks the work.

1. **Undo the move runs in place.** It sends the same `POST /undo` the top bar's Undo sends, with `If-Match` = the move's head, and applies the restored project without a reload (Phase 1's Dismiss Undo pattern). A move changes only `act`/`index`, so drafts stay valid and the leave guard is not asked.
2. **The check is stateless.** Any current problem shows (also one present on load, e.g. an imported thread whose payoff precedes its setup); "new" (opens the strip, offers Undo the move) means added by the last move.
3. **Order notes count as story notes** everywhere story notes count: the card's amber ⚑ count, the collapsed act's "with notes", None's N and Fold, Continuity (tape "⚠ order" wins over "⚑ continuity"), the jump bar, the selection announcement, and the Episode view's Notes (listed once, on the out-of-order scene).
4. A move that adds problems away from the selected scene keeps the selection; `plan-live` says "Moved. n new order problem(s)." and the chart and cards show where.
5. All of `episode.secrets` share one secret lane; a problem turns that secret's whole lane amber.
6. Chart blocks also show the active highlight (sky-soft fill and a rule in the highlight's hue), as in the mockup.
7. The drop target's tape: amber "⚠ 5 would pay off before 2" (+k for more) when the swap adds problems, else sky "Swap with n" (n = the dragged scene's number); numbers are the ones on the cards now. An empty act under a drag reads the prediction or "Move scene n here". Predictions are not announced (a mouse drag); the Act select's result is.

## File Structure

`src/` = `apps/web/src/`.

| File | Status | Task | Responsibility |
|---|---|---|---|
| `src/plan/planTree.ts` (+ `.test.ts`) | modify | 1 | `SceneMove`, `applySceneMove` (ops + optimistic twin) |
| `src/plan/story.ts` (+ `.test.ts`) | modify | 1 | `orderIssues`, `newOrderIssues`, `predictMove`, `predictionTape`, Order notes on `SceneSignals`, `issues`/`secrets` on `BoardModel`, `short` on `ActSummary`; order in relation tape, Continuity, None's matches, announcement |
| `src/plan/ActHeader.test.tsx` | modify | 1 | `short` in the `summary()` builder (the type change breaks `tsc -b` otherwise) |
| `src/plan/useProjectPatch.ts` (+ `.test.ts`) | modify | 2 | Optional `onSaved(project)` on `patch` |
| `src/plan/useUndoMove.ts` (+ `.test.ts`) | new | 2 | The last move, whether Undo the move is on offer, the undo request |
| `src/plan/EpisodeChart.tsx` (+ `.test.tsx`) | new | 3 | The SVG chart, `chartLayout`, `chartMarks`, `chartSummary` |
| `src/plan/Board.tsx` (+ `.test.tsx`) | modify | 4 | Drop-target tape (prediction, Swap with n, Locked — can't swap), empty-act prediction, order notes in the collapsed count, scroll padding |
| `src/plan/BoardCard.tsx` (+ `.test.tsx`) | modify | 4 | Order notes in the chip and name, locked dragover, drop ring and related outline follow the tape tone |
| `src/plan/panel/NotesStrip.tsx` (+ `.test.tsx`) | modify | 5 | Order note cards, Undo the move, `defaultExpanded` |
| `src/plan/panel/EpisodeView.tsx` (+ `.test.tsx`) | modify | 5 | Order notes in Notes |
| `src/plan/PlanScreen.tsx` (+ `.test.tsx`) | modify | 6 | `applyMove`, `useUndoMove`, chart in the header, prediction to Board, Order notes to the strip |
| `apps/web/e2e/plan.spec.ts` | modify | 6 | Order note + Undo the move; chart blocks select |
| `docs/tableread-ui-spec.md`, `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md` | modify | 7 | Per-PR docs |

Untouched: `HighlightBar.tsx` (its counts come from `highlightCount`), `ScenePanel.tsx`, `usePlanKeys.ts`, `ActHeader.tsx`, `useDismissNote.ts`, `api/client.ts`, `AppShell.tsx`, `packages/contract`, `apps/api`, `onboarding/recipes.json`, `tokens.css`.

## PR boundary and order

One PR, **T3.7 Episode chart and live order check**, on `feat/plan-chart` (this worktree, cut from `main`).

```
1 (story.ts, planTree.ts) ─┬─► 3 (EpisodeChart) ──────┐
                           ├─► 4 (Board, BoardCard) ──┼─► 6 (PlanScreen + e2e) ─► 7 (docs)
                           └─► 5 (NotesStrip, Ep.View)┤
2 (useUndoMove, useProjectPatch) ─────────────────────┘
```

- Tasks 1 and 2 run in parallel; after Task 1, Tasks 3, 4 and 5 run in parallel (disjoint files). Task 6 needs 2–5; Task 7 needs 6.
- Every file has exactly one owning task.

---

### Task 1: The order check and board moves (`story.ts`, `planTree.ts`)

**Depends on:** none · **e2e:** no

**Files:** modify `apps/web/src/plan/planTree.ts`, `planTree.test.ts`, `story.ts`, `story.test.ts`, `ActHeader.test.tsx`.

**Interfaces:**

```ts
// planTree.ts
export type SceneMove =
  | { type: 'swap'; sceneId: string; targetSceneId: string }
  | { type: 'act'; sceneId: string; act: number }

/** One board move as its single PATCH and the PATCH's optimistic twin
 * (rule 4): a swap is buildSceneSwapPatch + swapScenesLocally; an act change
 * is the Act select's one `replace …/act` + withSceneField. null when there is
 * nothing to move (unknown scene, a swap with itself, the scene's own act). */
export function applySceneMove(
  project: Project,
  move: SceneMove,
): { ops: JsonPatchOp[]; next: Project } | null

// story.ts — Order check (spec §4.8)
export type OrderIssueKind =
  | 'payoff_first'   // a thread's payoff scene plays before its setup scene
  | 'revealed_first' // the secret comes out before it is established
  | 'kept_after'     // the secret is kept after it is out
  | 'kept_before'    // the secret is kept before it is established

export interface OrderIssue {
  /** Stable across moves: `${kind}:${sourceId}:${sceneId}`. */
  id: string
  kind: OrderIssueKind
  /** The thread or secret id. */
  sourceId: string
  /** The thread's label; null for a secret. */
  label: string | null
  /** The scene now out of order: the payoff, the reveal, or the scene keeping the secret. */
  sceneId: string
  /** The scene it is out of order with: the setup, the establishing scene, or the reveal. */
  otherSceneId: string
}

/** An Order note as one side of a problem reads it. */
export interface OrderNote {
  issue: OrderIssue
  /** The other side's scene, for "Go to scene n". */
  otherSceneId: string
  otherNumber: number
  /** One sentence from this scene's side, e.g. 'Pays off “The spare key” before its setup in scene 2.' */
  text: string
}

/** Problems in the episode's board order (act, then index). Abandoned
 * threads, a payoff in its own setup scene, and scene ids not in the episode
 * are skipped. Threads first (episode order), then secrets. */
export function orderIssues(episode: Episode): OrderIssue[]
/** What `after` has that `before` doesn't (by id): the problems a move adds. */
export function newOrderIssues(
  before: readonly OrderIssue[],
  after: readonly OrderIssue[],
): OrderIssue[]
/** The drag / Act prediction: the problems `move` would add, computed on
 * applySceneMove's optimistic twin, so it always matches the save. [] when
 * there is nothing to move. */
export function predictMove(project: Project, move: SceneMove): OrderIssue[]
/** The drop target's amber tape: "⚠ 5 would pay off before 2" (+k for more),
 * with today's card numbers; null for []. */
export function predictionTape(
  model: BoardModel,
  issues: readonly OrderIssue[],
): CardTape | null

// Additions to existing types
interface SceneSignals { /* … */ orderNotes: OrderNote[] }  // this scene on either side, issue order
interface ActSummary   { /* … */ short: string }            // "CO" for a cold open, else the act's ordinal ("1", "2"…)
interface BoardModel   { /* … */ issues: OrderIssue[]; secrets: Secret[] } // orderIssues(episode); episode.secrets ?? []
```

Behaviour changes to existing functions (all in `story.ts`):
- `relationTape`: first, when the selected scene shares an order problem with this card → `{ text: '⚠ order with ' + selected.number, tone: 'amber' }`; it wins over the thread tapes.
- `highlightTape` Continuity: `'⚠ order'` when the scene has an Order note, else `'⚑ continuity'` for a story continuity note (tone amber both).
- `matchesHighlight` with None: a story note **or** an Order note (so N, Fold and Next note reach it).
- `selectionAnnouncement`: the note count adds the Order notes ("Scene 5, Kitchen. 1 note.").

**Tests** (use `story.test.ts`'s existing builders: `scene(id, index, overrides)`, `episode(scenes, overrides)`, `project(ep, format?, characters?)`, `thread(id, setup, payoff)` (its label is its id: spread `{ ...thread(…), label: 'The spare key' }` where the text matters) and `secret(overrides)`; generic wording only):
- `planTree.test.ts` `describe('applySceneMove')`:
  - "a swap is buildSceneSwapPatch's ops with swapScenesLocally's doc" — `toEqual` both.
  - "an act change is one replace of …/act with withSceneField's doc" — ops exactly `[{ op: 'replace', path: '/seasons/0/episodes/0/scenes/4/act', value: 0 }]`.
  - "nothing to move is null" — unknown scene, a swap with itself, the scene's own act.
- `story.test.ts` `describe('orderIssues')`:
  - "a thread whose payoff plays before its setup" — setup `scene-4`, payoff `scene-2` → one issue `{ id: 'payoff_first:thread-1:scene-2', kind: 'payoff_first', sourceId: 'thread-1', label: 'The spare key', sceneId: 'scene-2', otherSceneId: 'scene-4' }`; in order → `[]`.
  - "skips abandoned threads, a payoff in its own setup scene, no payoff, and missing scenes".
  - "orders by act, then index, not by index" — setup index 3 in act 1, payoff index 1 in act 2 → `[]`; move the payoff to act 0 → one issue.
  - "the secret revealed before it is established" → `revealed_first` on the reveal, other = the established scene.
  - "the secret kept after it is out, or kept before it is established" — kept between set and out → none; kept after out → `kept_after` (other = the reveal); kept before set → `kept_before` (other = the established scene); never revealed → only the `kept_before` check runs; an established scene missing from the episode skips the secret.
  - "reads a raw doc with no threads or secrets" — keys deleted → `[]`.
- `describe('predictMove')`:
  - "predictMove equals the new problems of the saved result" (code below).
  - "a move that keeps an existing problem predicts nothing new; nothing to move predicts []".
- `describe('boardModel order notes')`:
  - "each side of a problem gets an Order note in its own words, with the other scene's number" — payoff side `'Pays off “The spare key” before its setup in scene 4.'` (`otherNumber 4`); setup side `'Sets up “The spare key”, but it now pays off earlier, in scene 2.'`; the four secret sentences (see notes); `model.issues` equals `orderIssues(episode)`; `model.secrets` is `[]` for a doc without the key.
  - "act short labels" — `CO` for the cold open, `1` for ACT ONE (cold-open format), `1` for act 0 without a cold open.
- Highlights and tapes:
  - "relationTape: ⚠ order with n wins over the thread tape" — a thread that both relates and is out of order → `{ text: '⚠ order with 4', tone: 'amber' }` on the payoff card when the setup `scene-4` is selected.
  - "Continuity and N count order problems" — Continuity tape `'⚠ order'` on both sides; `highlightCount` includes them; `matchesHighlight(model, id, NO_HIGHLIGHT)` is true for an order-only scene; `nextMatchId` with None reaches it.
  - "selectionAnnouncement counts Order notes" — an order-only scene reads `'Scene 2, The Long Pour. 1 note.'`.
  - "predictionTape" — `'⚠ 2 would pay off before 4'`; two issues → `' +1'` suffix; secrets: `'⚠ 5 would reveal the secret before 3'`, `'⚠ 6 would keep the secret after 5'`, `'⚠ 1 would keep the secret before 3'`; `[]` → null; tone amber.
- Extend `describe('missing story data')`: the raw doc has `issues: []`, `secrets: []`, every `orderNotes: []`.

```ts
it('predictMove equals the new problems of the saved result', () => {
  // setup scene-2 (act 1) → payoff scene-5 (act 3): moving scene-5 to the
  // cold open, or swapping it with scene-1, plays the payoff first.
  const p = project(
    episode(
      [scene('scene-1', 0, { act: 0 }), scene('scene-2', 1, { act: 1 }), scene('scene-5', 4, { act: 3 })],
      { threads: [thread('thread-1', 'scene-2', 'scene-5')] },
    ),
  )
  const moves: SceneMove[] = [
    { type: 'act', sceneId: 'scene-5', act: 0 },
    { type: 'swap', sceneId: 'scene-5', targetSceneId: 'scene-1' },
  ]
  for (const move of moves) {
    const saved = applySceneMove(p, move)!.next.seasons[0].episodes[0]
    const expected = newOrderIssues(orderIssues(p.seasons[0].episodes[0]), orderIssues(saved))
    expect(expected).toHaveLength(1)
    expect(predictMove(p, move)).toEqual(expected)
  }
})
```

**Implementation notes:**
- `orderIssues`:

```ts
export function orderIssues(episode: Episode): OrderIssue[] {
  const pos = new Map(boardOrder(episode.scenes).map((s, i) => [s.id, i]))
  const out: OrderIssue[] = []
  const add = (kind: OrderIssueKind, sourceId: string, label: string | null, sceneId: string, otherSceneId: string) =>
    out.push({ id: `${kind}:${sourceId}:${sceneId}`, kind, sourceId, label, sceneId, otherSceneId })
  for (const t of episode.threads ?? []) {
    if (t.status === 'abandoned' || !t.payoffSceneId) continue
    const setup = pos.get(t.setupSceneId)
    const payoff = pos.get(t.payoffSceneId)
    if (setup !== undefined && payoff !== undefined && payoff < setup)
      add('payoff_first', t.id, t.label, t.payoffSceneId, t.setupSceneId)
  }
  for (const x of episode.secrets ?? []) {
    const set = pos.get(x.establishedSceneId)
    if (set === undefined) continue
    const revealedId = x.revealedSceneId && pos.has(x.revealedSceneId) ? x.revealedSceneId : null
    const out_ = revealedId ? pos.get(revealedId)! : undefined
    if (revealedId && out_! < set) add('revealed_first', x.id, null, revealedId, x.establishedSceneId)
    for (const kept of x.concealmentSceneIds ?? []) {
      const k = pos.get(kept)
      if (k === undefined) continue
      if (revealedId && k > out_!) add('kept_after', x.id, null, kept, revealedId)
      else if (k < set) add('kept_before', x.id, null, kept, x.establishedSceneId)
    }
  }
  return out
}
```

- `predictMove`: `const applied = applySceneMove(project, move); if (!applied) return []`; the episode is the one holding `move.sceneId` in each doc (`project.seasons.flatMap((s) => s.episodes).find(…)`); return `newOrderIssues(orderIssues(before), orderIssues(after))`.
- `boardModel`: compute `issues = orderIssues(episode)` once, then each scene's `orderNotes` from the issues where it is `sceneId` or `otherSceneId`. Sentences (this side · the other side); `“…”` around the label; `n` = the other scene's number:
  - `payoff_first`: `Pays off “{label}” before its setup in scene {n}.` · `Sets up “{label}”, but it now pays off earlier, in scene {n}.`
  - `revealed_first`: `Reveals the secret before scene {n} establishes it.` · `Establishes the secret after it comes out in scene {n}.`
  - `kept_after`: `Keeps the secret after it comes out in scene {n}.` · `Reveals the secret, but scene {n} still keeps it afterwards.`
  - `kept_before`: `Keeps the secret before scene {n} establishes it.` · `Establishes the secret after scene {n} already keeps it.`
  - Mark it: `// ponytail: "the secret" names no secret; with two secrets the sentences don't say which. Name it (secret.summary's first clause) if episodes start carrying several.`
- `predictionTape` verbs: `would pay off before`, `would reveal the secret before`, `would keep the secret after`, `would keep the secret before`; the first number is the issue's `sceneId`, the second its `otherSceneId`, both from `model.signals` (fallback `?`).
- `ActSummary.short`: `project.format.coldOpen && act === 0 ? 'CO' : String(project.format.coldOpen ? act : act + 1)` (the chart's narrow-band label; `actLabel`'s ordinal rule).
- Existing tests that `toEqual` a whole `BoardModel`/`ActSummary`/`SceneSignals` gain the new keys; use `toMatchObject` where the test is about something else.
- `ActHeader.test.tsx`'s `summary()` builder returns a full `ActSummary` and is typechecked (`tsconfig.app.json` includes `src`): add `short: '1'` to it. `ActHeader.tsx` stays untouched.

**Commands:** `(cd apps/web && npx vitest run src/plan/story.test.ts src/plan/planTree.test.ts src/plan)`, `(cd apps/web && npx tsc -b)`, eslint + prettier on the five files.

**Commit:** `plan: check scene order and predict moves in story.ts`

---

### Task 2: `useUndoMove` and `onSaved` on `useProjectPatch`

**Depends on:** none · **e2e:** no

**Files:** modify `apps/web/src/plan/useProjectPatch.ts`, `useProjectPatch.test.ts`; create `apps/web/src/plan/useUndoMove.ts`, `useUndoMove.test.ts`.

**Interfaces:**

```ts
// useProjectPatch.ts — the third argument is new and optional
patch(ops: JsonPatchOp[], optimisticNext: Project, onSaved?: (saved: Project) => void): Promise<boolean>

// useUndoMove.ts
export interface LastMove {
  /** OrderIssue ids the move added (may be empty). */
  issueIds: string[]
  /** The head snapshot the move created; null until the server accepts it. */
  head: string | null
}
export const UNDO_MOVE_STALE =
  "Can't undo the move — Plan changed since. Use Undo in the top bar."
export function useUndoMove(options: {
  projectId: string
  /** The project's current head. */
  headSnapshotId: string | null
  onProject: (project: Project) => void
}): {
  move: LastMove | null
  setMove: Dispatch<SetStateAction<LastMove | null>>
  /** The move's snapshot is still the head: its Order notes offer Undo the move. */
  undoable: boolean
  /** POST /undo with If-Match = the move's head; applies the restored project
   * in place. Resolves true when undone. Always forgets the move. */
  undo: () => Promise<boolean>
  busy: boolean
  error: string | null
  clearError: () => void
}
```

**Tests:**
- `useProjectPatch.test.ts`: "onSaved gets the server's project after a success, and is not called on a failure or a refused second patch".
- `useUndoMove.test.ts` (`renderHook`, mock `../api/client` `undoProject` like `panel/useDismissNote.test.ts`):
  - "offers Undo the move only while the move's snapshot is the head" — `head: null` → false; `head 'snap-2'` with `headSnapshotId 'snap-2'` → true; rerender with `'snap-3'` → false.
  - "undo posts with If-Match = the move's head and hands back the restored project" — `undoProject` called once with `('proj-a', { expectedHeadSnapshotId: 'snap-2' })`; `onProject` gets the restored project; resolves `true`; `move` is `null`.
  - "a stale head shows the Plan-changed copy and drops the offer" — reject with `new ApiError(409, { code: 'CONFLICT_STALE_HEAD', message: 'head moved' })` → `error === UNDO_MOVE_STALE`, resolves `false`, `undoable` false.
  - "busy covers the round trip, and undo does nothing when the move isn't the head" — no request when `undoable` is false.

**Implementation notes:**
- `useProjectPatch`: call `onSaved?.(next)` right after `setProject(next)` in the success path; nothing else changes (the hook's doc comment gains one line).
- `useUndoMove.undo`:

```ts
async function undo(): Promise<boolean> {
  const head = move?.head
  if (!head || head !== headSnapshotId) return false
  setBusy(true)
  setError(null)
  try {
    // If-Match: after any later edit this fails safely instead of undoing it.
    onProject(await undoProject(projectId, { expectedHeadSnapshotId: head }))
    return true
  } catch (err) {
    setError(
      err instanceof ApiError && err.code === 'CONFLICT_STALE_HEAD'
        ? UNDO_MOVE_STALE
        : err instanceof Error ? err.message : 'Undo failed',
    )
    return false
  } finally {
    setMove(null)
    setBusy(false)
  }
}
```

- No flag refetch: a move is not a structural edit and the snapshot restores flags with the doc (see Codebase facts). Say so in a one-line comment.

**Commands:** `(cd apps/web && npx vitest run src/plan/useProjectPatch.test.ts src/plan/useUndoMove.test.ts)`, `npx tsc -b`, eslint + prettier on the four files.

**Commit:** `plan: remember the last move and undo it in place`

---

### Task 3: `EpisodeChart`, the sticky SVG chart

**Depends on:** 1 · **e2e:** no

**Files:** create `apps/web/src/plan/EpisodeChart.tsx`, `EpisodeChart.test.tsx`.

**Interfaces:**

```ts
export interface ChartBlock { sceneId: string; number: number; x: number; w: number; cx: number }
export interface ChartBand {
  act: number
  /** The act's label, or its short label when the band is under 72px wide. */
  text: string
  /** The full label, for the band's <title>. */
  title: string
  x0: number
  x1: number
}
export interface ChartLayout {
  width: number
  blocks: ChartBlock[] // board order
  byId: ReadonlyMap<string, ChartBlock>
  bands: ChartBand[] // acts with scenes only
}
/** Spec §4.4: act gaps of 12, block gaps of 2, a minimum of 6–12px per block
 * (as wide as fits), the rest shared by each scene's share of the script text
 * (equal shares without script). */
export function chartLayout(model: BoardModel, width: number): ChartLayout

export interface ChartArc {
  threadId: string
  setupSceneId: string
  /** null = open: never paid off in this episode. */
  payoffSceneId: string | null
  x1: number // the setup block's centre
  x2: number // the payoff block's centre, or the open arc's end
  /** The payoff plays first (a payoff_first issue). */
  amber: boolean
}
export interface ChartLane {
  secretId: string
  /** set, kept…, out: the scenes the lane touches (bold when one is selected). */
  sceneIds: string[]
  set: number
  kept: number[]
  /** null = never revealed in this episode: the line runs dashed to the right edge. */
  out: number | null
  x0: number
  x1: number
  /** Any order issue on this secret. */
  amber: boolean
}
/** Live threads (abandoned skipped, a setup missing from the board skipped, a
 * payoff in its own setup scene skipped) and secrets established on the board. */
export function chartMarks(model: BoardModel, layout: ChartLayout): { arcs: ChartArc[]; lanes: ChartLane[] }
/** One sentence beside the aria-hidden SVG. */
export function chartSummary(model: BoardModel): string

export interface EpisodeChartProps {
  model: BoardModel
  /** May be a stale id: then nothing is selected. */
  selectedId: string | null
  highlight: Highlight
  draftSceneIds: ReadonlySet<string>
  episodeLocked: boolean
  onSelectScene: (sceneId: string) => void
}
/** null when the episode has no scenes. */
export function EpisodeChart(props: EpisodeChartProps): JSX.Element | null
```

**Tests** (`EpisodeChart.test.tsx`; build models with `boardModel` over small projects; jsdom has no `ResizeObserver`, so the chart draws at its 960px fallback):
- `describe('chartLayout')`:
  - "lays blocks out in board order with act gaps of 12 and block gaps of 2, ending at the width" — 3 acts, 6 scenes, width 600: consecutive blocks in one act are 2 apart, across acts 12; the last block ends within 0.5 of 600.
  - "a block is the minimum plus its share of the script text" — two scenes with script lengths 300 and 100: `(w1 - min) / (w2 - min) ≈ 3`.
  - "equal widths without script".
  - "70 scenes fit 1,000px with blocks of at least 6px" — 5 acts × 14 scenes: last block ends ≤ 1000.5; every `w >= 6`; the minimum is 11 here (`Math.floor(952 / 70) - 2`).
  - "bands cover their act's blocks, empty acts get none, and a band under 72px reads its short label" — `{ text: 'CO', title: 'COLD OPEN' }` for a one-scene cold open; `ACT ONE` for a wide band.
- `describe('chartMarks')`:
  - "an arc joins a setup to its payoff and turns amber when the payoff plays first".
  - "an open thread ends 120px to the right, inside the width" — `x2 === Math.min(width - 8, x1 + 120)`; a payoff whose scene is missing is open too.
  - "skips abandoned threads, a payoff in its own setup scene and a setup off the board".
  - "the secret lane spans set, kept and out; it is amber when the secret is out of order; it runs to the right edge when never revealed".
- `describe('chartSummary')`: `'Episode chart of 6 scenes in 5 acts, with 2 setup-payoff threads (1 open), 1 secret and 1 order problem; the board below lists every scene.'`; an idea-born model reads `'Episode chart of 3 scenes in 2 acts; the board below lists every scene.'`.
- `describe('EpisodeChart')`:
  - "draws one block per scene in board order inside act bands" — `[data-chart-block]` ids in board order; band texts.
  - "the SVG is hidden from assistive tech and a one-sentence summary sits beside it" — `svg` has `aria-hidden="true"` and no focusable descendant; an `.sr-only` element inside `episode-chart` reads `chartSummary(model)`.
  - "a block click selects its scene" — `fireEvent.click(getByTestId('chart-block-scene-3'))` → `onSelectScene('scene-3')`.
  - "sky arcs join setups to payoffs, the selected scene's arcs are bold, an out-of-order arc is amber" — `chart-arc-thread-1` `data-tone="sky"`, `stroke-width="2"` when `selectedId` is its setup, `1.25` otherwise; `data-tone="amber"` for a payoff-first thread.
  - "an open thread is a dashed amber arc ending in ?" — `data-open`, `stroke-dasharray="3 3"`, a `<text>` reading `?`.
  - "the secret lane: ◆ set, a dot per kept scene, ◇ out" — `chart-lane-secret-1`; amber `data-tone` when out of order.
  - "a story note or an order problem draws an amber top rule; a draft draws a coral dot; a locked scene is underlined" — `data-note`, `data-draft`, `data-locked` on the right blocks only (episode lock underlines every block).
  - "under a highlight, matching blocks are lit" — `data-match` on matches only; none under None.
  - "never animates" — no element in the chart has a class matching `/transition|animate/`, and there is no `<animate>`.
  - "renders nothing without scenes".

**Implementation notes:**
- Geometry (the only tricky part):

```ts
const ACT_GAP = 12
const GAP = 2

export function chartLayout(model: BoardModel, width: number): ChartLayout {
  const acts = model.acts.filter((a) => a.scenes.length > 0)
  const n = model.order.length
  const blocks: ChartBlock[] = []
  const bands: ChartBand[] = []
  if (n > 0) {
    const min = Math.max(6, Math.min(12, Math.floor((width - (acts.length - 1) * ACT_GAP) / n) - GAP))
    const spare = Math.max(0, width - (acts.length - 1) * ACT_GAP - (n - acts.length) * GAP - n * min)
    const total = model.order.reduce((t, s) => t + (model.signals.get(s.id)?.scriptLength ?? 0), 0)
    const share = (id: string) => (total > 0 ? (model.signals.get(id)?.scriptLength ?? 0) / total : 1 / n)
    let x = 0
    for (const act of acts) {
      const x0 = x
      for (const scene of act.scenes) {
        const w = min + spare * share(scene.id)
        blocks.push({ sceneId: scene.id, number: scene.index + 1, x, w, cx: x + w / 2 })
        x += w + GAP
      }
      const x1 = x - GAP
      bands.push({ act: act.act, title: act.label, text: x1 - x0 >= 72 ? act.label : act.short, x0, x1 })
      x = x1 + ACT_GAP
    }
  }
  // ponytail: past ~150 scenes at 1,000px the 6px floor overflows the width; scroll the chart if that happens.
  return { width, blocks, byId: new Map(blocks.map((b) => [b.sceneId, b])), bands }
}
```

- Width: a ref on the wrapper and a `ResizeObserver` whose callback sets `Math.round(entry.contentRect.width) || 960`; initial state 960; skip when `typeof ResizeObserver === 'undefined'`. The callback, not the effect body, sets state (eslint `react-hooks`). Nothing listens to scroll.
- Memoize: `const layout = useMemo(() => chartLayout(model, width), [model, width])`, `const marks = useMemo(() => chartMarks(model, layout), [model, layout])`. Selection, highlight, drafts and lock are applied while rendering (cheap). `// ponytail: re-renders with the board on each keystroke (drafts); memo both if typing lags at 70 scenes.`
- Markup (mockup `#chart`, 84px):

```
<div data-testid="episode-chart" ref={ref} className="mt-1.5">
  <svg aria-hidden="true" width="100%" height={84} viewBox={`0 0 ${width} 84`} className="block overflow-visible">
    bands:  <text x={x0} y={11} className="text-11 font-semibold tracking-wide fill-tr-text-primary"><title>{title}</title>{text}</text>
            <line x1={x0} x2={x1} y1={16} y2={16} className="stroke-tr-border-strong" />
    arcs:   <path data-testid={`chart-arc-${id}`} data-tone=… fill="none" …/>   (drawn before the blocks)
            paid:  d=`M${x1} 47 C${x1} ${47 - h * 1.3} ${x2} ${47 - h * 1.3} ${x2} 47`, h = Math.min(28, 6 + Math.abs(x2 - x1) * 0.08)
            open:  d=`M${x1} 47 C${x1} 22 ${x2 - 26} 22 ${x2} 22`, strokeDasharray="3 3", amber, plus <text x={x2 + 3} y={26}>?</text>
            strokeWidth 2 when selected or amber, else 1.25; opacity 1 when selected, amber, or under Setups & payoffs, else 0.45
    blocks: <g data-testid={`chart-block-${id}`} data-chart-block data-scene-id={id} … className="cursor-pointer" onClick={() => onSelectScene(id)}>
              <title>{number} · {place}{notes ? ' — has a note' : ''}{locked ? ' — locked' : ''}</title>
              <rect x y={48} width={w} height={16} rx={3} fill: selected coral · match sky-soft · else surface-clay; stroke border-strong (none when selected) />
              match:  <rect y={61.5} height={2.5} className={TONE_FILL[HIGHLIGHT_TONE[kind]]} />
              note:   <rect y={48} height={2.5} className="fill-tr-amber" />            (storyNotes or orderNotes)
              draft:  <circle cx={cx} cy={44} r={2.5} className="fill-tr-coral" />
              number: when w >= 16, <text x={cx} y={60} textAnchor="middle" className="text-11 font-semibold …">
              locked: <rect x={x + 2} y={65} width={w - 4} height={1.5} className="fill-tr-amber" />
            </g>
    lanes:  <g data-testid={`chart-lane-${id}`} data-tone=…>  line at y 74 (dashed when out is null), ◆ at set, <circle r={2.2}> per kept, ◇ at out;
            ink ledger-secret-ink, amber when out of order; opacity 1 when a lane scene is selected, amber, or under The secret, else 0.6
  </svg>
  <p className="sr-only">{chartSummary(model)}</p>
  <div aria-hidden="true" className="mt-1 flex flex-wrap gap-4 text-11 text-tr-text-primary">legend</div>
</div>
```

- `chartSummary`: `Episode chart of {plural(scenes, 'scene')} in {plural(bands, 'act')}`, then — only for the parts that exist — `{plural(arcs, 'setup-payoff thread')}` with ` ({open} open)` when any arc is open, `{plural(lanes, 'secret')}`, `{plural(model.issues.length, 'order problem')}`, joined as ", with a, b and c"; it ends `; the board below lists every scene.` Counts come from `chartLayout`/`chartMarks` at any width (the counts don't depend on it).
- Literal class maps, like `BoardCard`'s `TONE_BG`: `TONE_FILL: Record<TapeTone, string>` (`fill-tr-sky`, `fill-tr-amber`, `fill-tr-ledger-secret-ink`, `fill-tr-accent-ink`) and the stroke equivalents.
- Legend (aria-hidden, entries only when they apply; its marks are styled `<span>`s, never inline `<svg>`, so the chart holds exactly one `<svg>` for the tests' `svg` locators): a sky line "setup → payoff" (`model.hasThreads`), a dashed amber line "? open thread" (an open arc exists), "◆ set · • kept · ◇ out" (a lane exists), an amber-topped swatch "has a note" (a block has a note).
- No transition or animation classes anywhere in the chart.

**Commands:** `(cd apps/web && npx vitest run src/plan/EpisodeChart.test.tsx)`, `npx tsc -b`, eslint + prettier on both files.

**Commit:** `plan: draw the episode chart`

---

### Task 4: Drop prediction, "Locked — can't swap" and order notes on the board

**Depends on:** 1 · **e2e:** no

**Files:** modify `apps/web/src/plan/Board.tsx`, `Board.test.tsx`, `BoardCard.tsx`, `BoardCard.test.tsx`.

**Interfaces:**

```ts
// BoardProps addition (optional, so PlanScreen compiles unchanged until Task 6)
/** The order problems a move would add (story.predictMove on the project). */
predict?: (move: SceneMove) => OrderIssue[]   // default () => []
```

`BoardCardProps` is unchanged; its behaviour changes: a locked card calls `onDragOver()` (so Board can tape it) but never `preventDefault()`s; the drop-target ring is amber when the tape is amber, else sky; the related outline is amber when the tape is amber, else sky; the ⚑ chip and the accessible name count Order notes as story notes.

**Tests:**
- `BoardCard.test.tsx`
  - "Order notes join the amber ⚑ count and the accessible name's notes" — one story note + one Order note → `data-kind="story"` chip `⚑2`; name has `2 notes`; an Order note alone → amber `⚑1`.
  - "a locked card reports dragover for its tape but never accepts the drop" — `onDragOver` called; the `dragover` event is not `defaultPrevented`; `drop` → `onDrop` not called. (Update Phase 2's "a locked card refuses a drop" test to this.)
  - "a drop target's ring follows its tape: amber for a problem or a lock, sky otherwise" — `ring-tr-amber` / `ring-tr-sky`.
  - "the related outline turns amber with an order tape".
- `Board.test.tsx` (render with `model = boardModel(...)` and a `predict` stub):
  - "dragging over a card predicts the swap on it" — `dragStart(scene-5)`, `dragOver(scene-1)` → `predict` called with `{ type: 'swap', sceneId: 'scene-5', targetSceneId: 'scene-1' }`; the target's `[data-tape]` reads `predictionTape(model, issues).text` and has an amber ring; with `predict` returning `[]` it reads `Swap with 5` (sky).
  - "a locked card says Locked — can't swap and refuses the drop" — `dragOver(locked)` → tape `Locked — can't swap`, `predict` never called for it; `drop(locked)` → `onReorder` not called.
  - "an empty act shows the act change's prediction while a card is over it" — text `⚠ 5 would pay off before 2` (or `Move scene 5 here` with `[]`); `predict` called with `{ type: 'act', sceneId: 'scene-5', act: 4 }`; the frame's inset ring is amber with a problem.
  - "a dragover without a drag from this board changes nothing" — `dragOver(card)` with no `dragStart` → no tape, no ring, no `predict` call.
  - "the drop tape replaces the relation and highlight tapes; a card never wears two" — while over a related, highlighted card: one `[data-tape]`, the drop text.
  - "a collapsed act counts scenes with Order notes as with notes" — `2 scenes hidden · 1 with notes` for an order-only scene.

**Implementation notes:**
- Board, per render (no memo needed: it only runs while dragging, and dragover re-sets the same state, which React skips):

```ts
const dragged = dragSourceId ? model.signals.get(dragSourceId) : undefined
function dropTape(target: SceneSignals): CardTape {
  if (target.scene.locked || episodeLocked) return { text: "Locked — can't swap", tone: 'amber' }
  return (
    predictionTape(model, predict({ type: 'swap', sceneId: dragged!.scene.id, targetSceneId: target.scene.id })) ??
    { text: `Swap with ${dragged!.number}`, tone: 'sky' }
  )
}
// per card
const over = !!dragged && id === dropTargetId && id !== dragged.scene.id
const tape = over ? dropTape(signals) : (relation ?? match)
// <BoardCard … tape={tape} related={!over && relation !== null} dropTarget={over} onDragOver={() => { if (dragSourceId) setDropTargetId(id) }} />
```

- Empty act: while `dropAct === act && dragged`, the box reads the act change's prediction (amber, semibold) or "Move scene n here", and a prediction turns the frame ring `inset-ring-tr-amber` instead of `inset-ring-tr-sky`:

```ts
const actTape = predictionTape(model, predict({ type: 'act', sceneId: dragged.scene.id, act }))
const boxText = actTape?.text ?? `Move scene ${dragged.number} here`
```
- Collapsed count: `storyNotes.length + orderNotes.length > 0`.
- Scroll padding: the sticky header now holds the bar, the 84px chart and its legend: `scroll-pt-48` → `scroll-pt-72`, and update the `ponytail:` note (sized for the bar wrapped to three rows plus the chart).
- BoardCard: `handleDragOver` becomes `onDragOver(); if (locked) return; event.preventDefault()`. Ring: `dropTarget ? (tape?.tone === 'amber' ? ' ring-2 ring-tr-amber' : ' ring-2 ring-tr-sky') : ring ? …`. Related outline: `outline-tr-amber` when `tape?.tone === 'amber'`. Chip count and `cardLabel`'s notes: `storyNotes.length + orderNotes.length` (+ import).

**Commands:** `(cd apps/web && npx vitest run src/plan/Board.test.tsx src/plan/BoardCard.test.tsx)`, `npx tsc -b`, eslint + prettier on the four files.

**Commit:** `plan: predict a drop on its target and refuse locked swaps`

---

### Task 5: Order notes in the notes strip and the Episode view

**Depends on:** 1 · **e2e:** no

**Files:** modify `apps/web/src/plan/panel/NotesStrip.tsx`, `NotesStrip.test.tsx`, `panel/EpisodeView.tsx`, `EpisodeView.test.tsx`.

**Interfaces:**

```ts
// NotesStripProps additions (all optional, so PlanScreen compiles until Task 6)
/** This scene's computed Order notes (spec §4.8): shown first, never dismissable. */
orderNotes?: OrderNote[]                     // default []
/** Issue ids whose note offers Undo the move. */
undoableIssueIds?: ReadonlySet<string>       // default empty
onUndoMove?: () => void
/** Start open: a new order problem just landed on this scene (PlanScreen re-keys the strip). */
defaultExpanded?: boolean                    // default false
```

**Tests:**
- `NotesStrip.test.tsx`
  - "a scene with only an Order note shows the strip, counts it and peeks at it" — summary `⚑ 1 note`; `notes-peek` reads the note's text.
  - "an Order note comes first, says it is computed, and has no Dismiss" — `order-note-{id}` is the first card; it reads `Order` and `from the board order · clears when fixed`; `within(card).queryByRole('button', { name: /dismiss/i })` is null.
  - "Go to scene n selects the other scene" — `onSelectScene('scene-4')`.
  - "Undo the move only on an undoable note, disabled while busy" — absent without the id in `undoableIssueIds`; present and calling `onUndoMove` with it; disabled when `busy`.
  - "defaultExpanded starts the strip open".
- `EpisodeView.test.tsx`
  - "an order problem is a note on its out-of-order scene, first in that scene's row" — the payoff scene's row reads `Order: Pays off “The spare key” before its setup in scene 4.` before its story notes; the setup scene has no row for it; the Notes count includes it; `No open notes.` is gone.

**Implementation notes:**
- Strip: `if (notes.length === 0 && orderNotes.length === 0) return null`; `useState(defaultExpanded)`. Summary counts `story.length + orderNotes.length` as story notes; the peek is `orderNotes[0]?.text` before the first story note. Order card (above the story cards):

```tsx
<article data-testid={`order-note-${note.issue.id}`}
  className="rounded-card border border-tr-amber bg-tr-surface-raised p-3 text-13 text-tr-text-primary">
  <p className="mb-1 flex items-center gap-2 text-12">
    <span className="rounded-chip bg-tr-amber-soft px-2 font-semibold text-tr-amber">Order</span>
    from the board order · clears when fixed
  </p>
  <p>{note.text}</p>
  <div className="mt-2 flex flex-wrap gap-1">
    <button type="button" onClick={() => onSelectScene(note.otherSceneId)} className={VERB}>Go to scene {note.otherNumber}</button>
    {undoableIssueIds.has(note.issue.id) && (
      <button type="button" disabled={busy} onClick={onUndoMove} className={VERB}>Undo the move</button>
    )}
  </div>
</article>
```

- Episode view: `NoteRows`' `pick` returns `{ key: string; text: string }[]`; import rows map `importNotes` the same way; `notedScenes` counts scenes with a story note or an Order note on their side. Story rows:

```ts
const storyLines = (s: SceneSignals) => [
  // An Order note is listed once, on the scene that is out of order.
  ...s.orderNotes
    .filter((n) => n.issue.sceneId === s.scene.id)
    .map((n) => ({ key: n.issue.id, text: `Order: ${n.text}` })),
  ...s.storyNotes.map((note) => ({ key: note.flag.id, text: noteSentence(note, s.scene, model.order) })),
]
```

**Commands:** `(cd apps/web && npx vitest run src/plan/panel)`, `npx tsc -b`, eslint + prettier on the four files.

**Commit:** `plan: show Order notes in the notes strip and the Episode view`

---

### Task 6: Wire moves, Undo the move, the chart and the prediction; e2e

**Depends on:** 2, 3, 4, 5 · **e2e:** yes

**Files:** modify `apps/web/src/plan/PlanScreen.tsx`, `PlanScreen.test.tsx`, `apps/web/e2e/plan.spec.ts`.

**Interfaces (inside `PlanScreen`):**
- `const undoMove = useUndoMove({ projectId: activeProjectId, headSnapshotId: project?.headSnapshotId ?? null, onProject: setProject })`, next to `dismissal`; `busy` adds `undoMove.busy`.
- `applyMove(move: SceneMove): Promise<boolean>` — every board move. `handleReorder` calls it with a swap; `saveSceneField` starts with `if (field === 'act') return applyMove({ type: 'act', sceneId, act: Number(value) })` (so the Act select and the empty-act drop share it).
- `undoTheMove()` — runs `undoMove.undo()`; on success announces "Move undone." and, next frame, focuses the strip's Show/Hide (`#plan-section-notes button[aria-expanded]`), else the panel heading.
- Board gets `predict={(move) => predictMove(project, move)}` and `header={<><HighlightBar …/><EpisodeChart model={model} selectedId={selectedId} highlight={highlight} draftSceneIds={drafts.dirtySceneIds} episodeLocked={episode.locked} onSelectScene={selectFromChart} /></>}`, where `selectFromChart(id)` = `selectScene(id)` then, next frame, `cardEl(id)?.scrollIntoView({ block: 'nearest' })` (no focus move).
- Strip: `orderNotes = model.signals.get(selectedScene.id)?.orderNotes ?? []`; `ScenePanel`'s `noteCount = sceneNotes.length + orderNotes.length`; `NotesStrip` gets `key`, `defaultExpanded`, `orderNotes`, `undoableIssueIds`, `onUndoMove={undoTheMove}` (below).
- A toast for `undoMove.error` beside `dismissal.error`'s.

```ts
/** A swap or an act change: one PATCH, one snapshot (rule 4). The problems it
 * adds show at once from the optimistic doc; Undo the move is offered once
 * the server has made this move the head. */
function applyMove(move: SceneMove): Promise<boolean> {
  if (!project) return Promise.resolve(false)
  const applied = applySceneMove(project, move)
  if (!applied) return Promise.resolve(false)
  const fresh = predictMove(project, move)
  undoMove.setMove({ issueIds: fresh.map((i) => i.id), head: null })
  if (fresh.length) announce(`Moved. ${plural(fresh.length, 'new order problem')}.`)
  return patcher
    .patch(applied.ops, applied.next, (saved) =>
      undoMove.setMove((m) => m && { ...m, head: saved.headSnapshotId }),
    )
    .then((ok) => {
      if (!ok) undoMove.setMove(null)
      return ok
    })
}

// render, with the strip
const fresh = undoMove.move?.issueIds ?? []
const freshHere = orderNotes.filter((n) => fresh.includes(n.issue.id)).map((n) => n.issue.id)
// <NotesStrip key={`${selectedScene.id}:${freshHere.join(' ')}`} defaultExpanded={freshHere.length > 0}
//   undoableIssueIds={undoMove.undoable ? new Set(fresh) : NO_IDS} … />
```

A new problem on the selected scene re-keys the strip, which remounts open (spec: "a new order problem opens the strip"); returning to the scene while that move is still the last one opens it again.

**Tests** (`PlanScreen.test.tsx`; `patchProjectMock` resolves `{ project: { ...next, headSnapshotId: 'snap-moved' }, consistencyFlags: [] }`). Add one builder, `orderProject()`: `project()` with exactly these scenes, in this array order (array position = `index`, so scene-5 is `scenes/4`), and one thread:

| scene | `act` | `index` |
|---|---|---|
| scene-1 | 0 | 0 |
| scene-2 | 1 | 1 |
| scene-3 | 1 | 2 |
| scene-4 | 2 | 3 |
| scene-5 | 3 | 4 |

`threads`: `storyProject()`'s thread literal with `id: 'thread-1'`, `label: 'The spare key'`, `setupSceneId: 'scene-2'`, `payoffSceneId: 'scene-5'`, `status: 'paid_off'`. scene-2 must sit after the cold open: with scene-2 in act 0 (the `scene()` default), moving scene-5 to act 0 still plays it after its setup and the order tests below find no problem.

- "an act change that plays a payoff first shows the Order note at once and opens the strip" — select scene-5, Act → `0` with a deferred PATCH: before it resolves, `notes-strip` is expanded and reads `Pays off “…” before its setup in scene 2.`; no Undo the move yet; `plan-live` reads `Moved. 1 new order problem.`; after it resolves, Undo the move appears.
- "an act change sends one PATCH; the prediction and the chart send nothing" — `patchProjectMock` called once with exactly `[{ op: 'replace', path: '/seasons/0/episodes/0/scenes/4/act', value: 0 }]`; a `dragStart`/`dragOver` prediction and a chart block click add no call; `suggestInstructionsMock`, `createChangeSetMock`, `dismissConsistencyFlagMock` never called.
- "Undo the move posts /undo with If-Match = the move's head and clears the Order note" — click it → `undoProjectMock` called with `('proj-longpour', { expectedHeadSnapshotId: 'snap-moved' })`; it resolves the pre-move project → the Order note is gone, scene-5 is back in `act-frame-3`, `plan-live` reads `Move undone.`; `getProjectMock` still called once (no reload, no refetch).
- "Undo the move is gone once another edit moves the head; Go to scene n still selects" — after the move, a lock toggle saves (head `snap-later`) → no Undo the move; Go to scene 2 selects scene-2.
- "a failed move rolls back and offers nothing" — `patchProjectMock` rejects → scene-5 back in act 3, no Order note, no Undo the move.
- "a drag predicts on the target with the save's own transform" — `dragStart(scene-5)`, `dragOver(scene-1)` → scene-1's tape reads `⚠ 5 would pay off before 2`; no PATCH.
- "Undo the move 409 shows the stale copy and drops the offer" — `undoProjectMock` rejects with `CONFLICT_STALE_HEAD` → toast `UNDO_MOVE_STALE`; no Undo the move.
- "the chart sits in the board's sticky header and a block click selects its scene" — `episode-chart` is inside the Board's sticky wrapper; click `chart-block-scene-3` → `scene-card-scene-3` `aria-pressed="true"`; `plan-live` announces Scene 3.
- "a Continuity count and N include order problems" — after the move (board order now scene-1, scene-5, scene-2, …) the Continuity button's count is 2; select scene-1, press `n` → scene-5 is selected, `n` again → scene-2.

**e2e** `plan.spec.ts` (append both at the end; each holds whatever ran before it):

```ts
test('an act change that plays a payoff first shows the Order note, and Undo the move restores the order (T3.7)', async ({
  page,
  request,
}) => {
  // The fixture has no threads: seed one (setup scene-2 → payoff scene-5) and
  // clear it again whatever happens, so later specs see the fixture's [].
  const threads = (value: unknown[]) =>
    request.patch('/api/v1/projects/proj-longpour', {
      data: [{ op: 'replace', path: '/seasons/0/episodes/0/threads', value }],
    })
  const seeded = await threads([
    {
      id: 'thread-e2e-cash',
      label: 'The moved cash',
      summary: 'Dan moves the cash; later the count comes up short.',
      status: 'paid_off',
      ownerCharacterIds: [],
      setupSceneId: 'scene-2',
      payoffSceneId: 'scene-5',
      setupQuote: '',
      payoffQuote: '',
      setupBeatId: null,
      payoffBeatId: null,
      locked: false,
    },
  ])
  expect(seeded.ok()).toBeTruthy()
  try {
    await page.goto('/plan?project=proj-longpour')
    const arc = page.getByTestId('chart-arc-thread-e2e-cash')
    await expect(arc).toHaveAttribute('data-tone', 'sky')
    await page.getByTestId('scene-card-scene-5').click()
    const inspector = page.getByTestId('inspector')

    // The cold open plays before scene-2's act: the payoff now comes first.
    await inspector.getByRole('combobox', { name: 'Act' }).selectOption('0')
    await expect(
      page.getByTestId('act-frame-0').getByTestId('scene-card-scene-5'),
    ).toBeVisible()
    // The strip opened itself (scene-5 also keeps plan-notes.spec's note).
    const orderNote = inspector.getByText(/before its setup in scene 2/)
    await expect(orderNote).toBeVisible()
    await expect(arc).toHaveAttribute('data-tone', 'amber')
    await expect(page.getByTestId('scene-card-scene-2')).toContainText(
      '⚠ order with 5',
    )

    await inspector.getByRole('button', { name: 'Undo the move' }).click()
    await expect(orderNote).toHaveCount(0)
    await expect(
      page.getByTestId('act-frame-0').getByTestId('scene-card-scene-5'),
    ).toHaveCount(0)
    await expect(arc).toHaveAttribute('data-tone', 'sky')
    await expect(page.getByTestId('plan-live')).toContainText('Move undone.')

    await page.reload() // undone on the server, not just on screen
    await expect(
      page.getByTestId('act-frame-0').getByTestId('scene-card-scene-5'),
    ).toHaveCount(0)
  } finally {
    await threads([])
  }
})

test('the episode chart draws a block per scene and a block selects its scene (T3.7)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  const chart = page.getByTestId('episode-chart')
  await expect(chart.locator('[data-chart-block]')).toHaveCount(6)
  await expect(chart.locator('svg')).toHaveAttribute('aria-hidden', 'true')
  await expect(chart).toContainText('the board below lists every scene')

  await chart.getByTestId('chart-block-scene-3').click()
  await expect(page.getByTestId('scene-card-scene-3')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
```

**Implementation notes:**
- Hook placement: `useUndoMove` goes with the other hooks above PlanScreen's early returns. `applyMove` replaces the body of `handleReorder`; nothing else calls `buildSceneSwapPatch` / `swapScenesLocally` any more (they stay exported for `applySceneMove`).
- `NO_IDS: ReadonlySet<string> = new Set()` at module scope.
- If an e2e click is intercepted by the sticky header, the scroll padding (Task 4) is too small for the viewport: raise it there rather than working around it in the test.
- Run the e2e set: `plan.spec.ts plan-notes.spec.ts review.spec.ts recipes.spec.ts newproject-resume.spec.ts`, then the whole suite once; only the six known Write-mode baseline failures may fail.

**Commands:** `(cd apps/web && npx vitest run)`, `npx tsc -b`, `(cd apps/web && npx eslint .)`, `(cd apps/web && npx prettier --check .)`, then the e2e block.

**Commit:** `plan: wire the episode chart, live order check and Undo the move`

---

### Task 7: T3.7 docs

**Depends on:** 6 · **e2e:** no

**Files:** modify `docs/tableread-ui-spec.md`, `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md`.

- UI spec §5 layout line: drop "The chart and the order check land in T3.7"; Story Layers' scene list now points to the board and the chart.
- UI spec §5, new **Episode chart** bullet (T3.7) after the highlight bar: sticky under the bar (84px, `episode-chart`); one block per scene in board order inside act bands (act gaps 12, block gaps 2; width = a 6–12px minimum plus the scene's share of the script text, equal without script; ~70 scenes fit 1,000px); narrow bands read "CO" / the act number; sky arcs setup → payoff, the selected scene's bold, amber when the payoff plays first; open threads a dashed amber arc ending in "?"; the secret lane (◆ set · dots kept · ◇ out, amber when out of order, dashed to the edge when never revealed); an amber top rule for a story note or an Order note, a coral dot for unsaved drafts, an amber underline when locked, lit blocks under a highlight; a block click selects its scene and scrolls its card in; `aria-hidden` with a one-sentence summary; no animation; redraws on resize only.
- UI spec §5, new **Live order check** bullet (T3.7): the three rules on board order (abandoned threads skipped; the check runs on any current order, not only after a move); each problem is an **Order** note on both scenes (computed, no Dismiss, clears when fixed; **Go to scene n**; **Undo the move** while that move is still the head: `POST /undo` with `If-Match`, in place, "Move undone."; stale → "Can't undo the move — Plan changed since. Use Undo in the top bar."); a new problem on the selected scene opens the strip and `plan-live` says "Moved. n new order problem(s)."; the card's ⚑ count, the collapsed act's "with notes", Continuity ("⚠ order"), N and the jump bar count Order notes; the relation tape "⚠ order with n" (amber, wins over the thread tapes); **drag prediction** on the target ("⚠ 5 would pay off before 2" with an amber ring, else "Swap with n"), on an empty act (the prediction or "Move scene n here"), "Locked — can't swap" on a locked card, which never takes the drop; the Act select's result shows at once (optimistic).
- UI spec §5 cards / highlight bar / notes strip bullets: replace the "lands in T3.7" / "joins in T3.7" mentions with the shipped behaviour (the chart block's coral dot, "⚠ order" tape, the Order card in the strip).
- Build plan T3.7 `_Accept:_` → what shipped (Vitest: `orderIssues` all three cases on board order, `predictMove` = the saved result's new problems, Order notes and their counts, `chartLayout` share and the 70-scene fit, chart marks and summary, Board prediction and Locked — can't swap, `useUndoMove` If-Match/stale, PlanScreen one PATCH per move and in-place undo; e2e: an act change that plays a payoff first shows the Order note, the amber arc and "⚠ order with 5", and Undo the move restores it after reload; a chart block selects its scene).
- Test plan: "Plan chart and order check (T3.7)" sentences in the Vitest paragraph and the E2E paragraph, same content.
- Handoff decision-log row: "2026-10-13: Plan's sticky episode chart (SVG, no dependency) and a live, client-side order check (payoff before setup; secret out before set; kept after out or before set). Order notes are computed (no Dismiss) and count as story notes; drags predict on the target and a locked card says "Locked — can't swap". Undo the move sends the top bar's `POST /undo` with `If-Match` = the move's head and applies it in place (no reload). Every move is one PATCH through `applySceneMove`, which the prediction reuses." | "Read the shape at a glance (spec §1 job 1) and catch a reorder that breaks a setup or the secret before or right after it lands; reusing the save's transform keeps the prediction honest".

**Commit:** `docs: plan episode chart and live order check (T3.7)`

---

## Self-check before the PR

- [ ] `(cd apps/web && npx vitest run)`, `npx tsc -b`, `npx eslint .`, `npx prettier --check .` clean.
- [ ] The e2e set passes (only the six known Write-mode baseline failures elsewhere).
- [ ] `git grep -n "DESIGN-GAP" -- apps/web/src/plan` shows none, or each names a task id.
- [ ] No hex, no new `--tr-*` token, no `transition`/`animate` class in `EpisodeChart.tsx`, no `opacity-*` class on a card, no `suggestInstructions` call outside the Suggest… button.
- [ ] `git grep -n "buildSceneSwapPatch\|swapScenesLocally" -- apps/web/src/plan/PlanScreen.tsx` is empty (every move goes through `applySceneMove`).
- [ ] `git status --short` shows no `playwright.local.config.ts` and no `apps/api/.venv`.
- [ ] PR description quotes the build-plan T3.7 acceptance line with pass/fail and flags no new dependency.
