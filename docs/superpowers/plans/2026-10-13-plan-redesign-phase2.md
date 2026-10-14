# Plan Redesign — Phase 2 (T3.5 Index cards and act headers, T3.6 Highlights, Episode view, Story Layers retirement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is deliberately lean: it gives exact interfaces, test names with their key assertions, and code only where the logic is easy to get wrong. Write the rest in the style of the Phase 1 files it names.

**Goal:** Turn Plan's board into the import board's index cards under act headers that read the episode's shape (share of the script, set up / paid off, marked landmarks, act-split notes), make the board keyboard-first (one tab stop, live region), then add the highlight bar with rings and tapes, Fold the rest, J/K/N/Esc/⌘↵, the Episode view as the nothing-selected panel, and retire Story Layers and its tokens.

**Architecture:** One new pure derivation, `boardModel(project, episode, openFlags)` in `apps/web/src/plan/story.ts`, computes everything the board, act headers, highlight bar and Episode view read (per-scene signals, act summaries, cast); `PlanScreen` memoizes it and passes it down, so components stay dumb and every rule is unit-tested in one file. The card is a new `BoardCard` (the import board's ruled index-card face); `Board` owns drag, the empty-act drop and the roving tab stop; `PlanScreen` owns selection, collapse (persisted), highlight, fold, the live region and the document-level keys. Every edit is still one `useProjectPatch` PATCH (an empty-act drop is the same `act` PATCH as the Act select). The `PlanSelection` model (`null | scene | beat`) is unchanged: `null` is the Episode view.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 4 (`--tr-*` tokens only), Vitest + Testing Library (jsdom 29), Playwright e2e against the real FastAPI app with a seeded temp DB and `MockLlmClient`; types from `packages/contract` (`contract`).

**Spec:** `docs/superpowers/specs/2026-10-13-plan-redesign-design.md` (§4.2, §4.3, §4.5, §4.7, §4.10, §4.11, §4.13, §7 Phase 2). Visual reference: the owner's clickable mockup `reports/Plan redesign/Plan redesign mockup.html` in the owner's checkout (read its CSS for the card face, act header, highlight bar, tapes and rings). It is built on a copyrighted script: never copy its text into the repo, tests or docs. Use `docs/tableread-fixture.json` ("The Long Pour") and generic wording.

## Global Constraints

- No contract change, no new endpoint, no new LLM operation, no PROMPT_VERSION bump.
- Tokens only. **Phase 2 adds no token.** Cards use `--tr-card-board-w/h` (`w-card-board-w h-card-board-h`), `--tr-board-paper`, `--tr-board-rule`, `--tr-board-rule-top`, `--tr-shadow-card-board`, `--tr-shadow-card-lift`. T3.6 **removes** `--tr-panel-story-layers` and `--tr-card-scene` from every home (`tokens.css` `:root` and `@theme`, `tokens.expected.ts`, `dev/TokensPage.tsx`, UI spec §1). No hex outside `:root`; Tailwind's 4px scale (including quarter steps like `w-0.75`) is allowed; no text below 11px (`text-11`).
- Rule 8 / quiet AI: nothing in Plan calls a model on mount, select, hover, focus, key press, highlight change, fold or N. No component in this plan imports `suggestInstructions`.
- Rule 4: every edit is one direct-edit PATCH that snapshots once; optimistic updates roll back (`useProjectPatch`, unchanged). An empty-act drop sends exactly the Act select's PATCH (`replace …/act`).
- Drag stays **swap** (`buildSceneSwapPatch`); insert is Phase 4. Locked cards (scene or episode lock) don't drag and are not drop targets; nothing drags while a write is in flight (`pending`).
- Non-matches under a highlight go quiet (flat, no ruled paper, no shadow) **at full opacity with `text-tr-text-primary`** — never `opacity-*`.
- Kept test ids: `act-frame-{n}`, `scene-card-{id}` (+ `data-locked`), `consistency-flag-badge` (story and import chips both), `inspector`, `lock-toggle` (the scene's only), combobox "Act", `mode-switcher`, `unsaved-dot`. `story-layers-panel` disappears in T3.6. The lock-and-regenerate recipe (`scene-card-scene-3`, `lock-toggle`) works unchanged: Plan still opens with a scene selected.
- New test ids: `plan-live` (the live region), `data-scene-card` (attribute on every card), `data-match` on highlighted cards, `data-kind="story|import"` on the flag chip, `data-tick="story|import|plain"` on beat ticks.
- Heuristics stay labelled (`ponytail:` notes where a rule is a heuristic). Cast is always "from dialogue cues and recorded wants".
- No new dependencies. No `DESIGN-GAP` comments are expected; if one is needed it must name a task id (`// DESIGN-GAP(T3.6): …`).
- Order notes, "⚠ order" tapes, drag prediction, "Locked — can't swap" and the chart are **Phase 3** (T3.7). Continuity in Phase 2 counts story continuity notes only.
- Commits: `area: imperative summary`, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tests beside code; e2e in `apps/web/e2e/`.
- Never edit the owner's checkout, never `git stash`, never push, never `make`, never call the Anthropic API.

## Review Focus

1. **Locks on the board** — a locked card (scene or episode) never drags and never takes a swap; an empty act takes a drop only from a draggable card and sends exactly one `…/act` replace; nothing drags while `pending`. *Pinned by:* Task 4 (`Board.test` "a locked card neither drags nor takes a drop", "an empty act takes a drop as one act change"; `PlanScreen.test` "an empty-act drop sends one act PATCH and nothing else"), Task 5 e2e.
2. **One tab stop, always** — exactly one card has `tabIndex=0` (the selected card if rendered, else the last focused, else the first) after collapse, fold and Esc; arrows/Home/End select and focus; Enter on the selected card reaches the panel heading; Esc in the panel returns to the card; document keys ignore text fields, selects, dialogs and modifier chords. *Pinned by:* Task 4 ("exactly one card is a tab stop"), Task 5 (ScenePanel "Esc in the panel goes back to the card"), Task 10 ("roving order skips folded scenes"), Task 11 (`usePlanKeys.test` "ignores fields, dialogs and modifier chords").
3. **Highlights never dim and never call AI** — every count is "scenes that match"; None shows no ring, tape or quiet card; quiet cards carry no `opacity-*` class; choosing a highlight, Fold, N, J/K and Esc make no request. *Pinned by:* Task 7 (`highlightCount`), Task 10 ("non-matches go quiet at full opacity"), Task 11 (`PlanScreen.test` "highlights, fold and keys make no request").
4. **Missing story data** — a raw PATCH doc or an idea-born project (no threads, secrets, storyOverview, scriptText, cast) renders: no share bar, no thread counts, no landmark chips, highlights read 0 and do nothing, each Episode view section shows one quiet line. *Pinned by:* Task 1 ("missing story data"), Task 3 ("no share bar without script, no counts without threads"), Task 7 ("missing data counts 0"), Task 9 ("an idea-born episode shows one quiet line per section").
5. **Story Layers leaves cleanly** — no `story-layers-panel`, no `w-panel-story-layers`/`w-card-scene` class anywhere, both tokens gone from every home, the act chevron replaces the eye toggle, recipes and `plan`, `plan-notes`, `review`, `newproject-resume` e2e pass. *Pinned by:* Task 11 (`tokens.test`, `TokensPage.test`, `PlanScreen.test` layout test, e2e run).

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
- One e2e worker shares one seeded DB, and files run in name order (`plan-notes.spec.ts` before `plan.spec.ts`). The fixture's acts: 0 cold open `scene-1`; 1 `scene-2`, `scene-3`; 2 `scene-4`; 3 `scene-5`; 4 `scene-6`. `plan.spec.ts` moves `scene-4` into act 1 (act 2 empties), moves `scene-5` to act 2 (act 3 empties) and locks `scene-6`. Write new e2e tests so they hold whatever ran before them.

## Codebase facts the tasks rely on

- `story.ts` (Phase 1) already exports `flagKind`, `notesForScene` (story notes first, then import, in beat order; drops flags on missing beats), `importNoteText`, `linkifyNote` (a fact id always reads "a Ledger fact"; with `facts = []` the joined segment text is safe plain text), `placeTitle`, `boardOrder` (act, then index), `landmarksForScene`, `castFromDialogue`, `threadsForScene`, `secretsForScene` (role order: set, out, kept), `factsForScene`.
- `planTree.ts`: `actNumbersForBoard(format, scenes)` (format range ∪ acts present), `actLabel(act, format)` ("COLD OPEN", "ACT ONE"…), `groupScenesByAct(scenes)`, `buildSceneSwapPatch`/`swapScenesLocally`, `buildScenePatch`/`withSceneField`.
- `ledger/structure/tvActStructure.ts`: `tvActStages(format, storyOverview)` returns the format's canonical stages ("Cold Open", "Act One Turn", "Act One Out", …, "Climax", "Tag") with `status: 'hit' | 'missing'`, `sceneId`, `beatId`. "Marked" = `hit`.
- `projects/wizard/board/IndexCard.tsx` holds the ruled-paper style as a module constant `RULED`; `boardText.ts` exports `plural`. `write/sceneType.ts` exports `sceneLocationType(scene)` and `sceneTypeDotClass(type)`.
- `PlanScreen` owns `project`, `ledger`, `openFlags`, `selection` (`undefined` = not chosen yet → resume or first scene; `null` = nothing selected), the draft store, `useLeaveGuard` (`confirmLeave()`), `useProjectPatch` (`patch(ops, next)`), and `busy` (any write in flight). `saveSceneField(sceneId, 'act', n)` is the Act select's save.
- The panel (`panel/ScenePanel.tsx`) is `data-testid="inspector"`; its sticky `PanelHeader` renders the title `<h2>`. `panel/EpisodePanel.tsx` is Phase 1's nothing-selected view (premises only). `useSectionOpenState` persists `<details>` state in `localStorage` `tr.plan.sections.v1` for a fixed id union.
- `AppShell` handles ⌘1–4 on `document`. React 18 attaches its listeners at the root, so a card's `onKeyDown` that calls `preventDefault()` runs before a `document` listener, which then sees `event.defaultPrevented`.
- jsdom 29: no layout (`getBoundingClientRect` is all zeros: stub it per element for ↑/↓), `<details>` `toggle` fires asynchronously, `HTMLDialogElement.showModal` is stubbed in `PlanScreen.test.tsx`, `src/test-setup.ts` installs no-op `scrollIntoView`/`scrollTo`. `requestAnimationFrame` exists.
- Fixture `proj-longpour`: format cold open + 4 acts, title "Last Call", 6 scenes, no flags, threads, secrets or story overview; motivations: scene-1 Marta + Dan, scene-2 Dan, scene-3 Marta + Dan, scene-4 Marta, scene-5 Marta + Dan, scene-6 Reyes + Dan (`char-marta` "Marta Vega", `char-dan` "Dan Vega", `char-reyes` "Detective Ana Reyes").

## Defaults this plan takes (product calls the spec leaves open)

Each is built as written unless the owner says otherwise; none blocks the work.

1. An act header hides the ≈ share bar when the episode has no script text, and hides "↗ set up · ↘ paid off" when it has no threads (no "≈0%" or "↗0 · ↘0" on idea-born projects).
2. A card's `ACT OUT` tag marks the last scene of its act on the board (position), not the beat sheet's "Act n Out" row; a marked "Act n Out" still shows as the act header's chip and as the Act shape tape.
3. Arrow keys on the board select as focus moves (the panel follows), as in the mockup; Enter on the selected card goes to the panel heading.
4. Selecting a scene inside a collapsed act (‹ ›, J/K, N, a note or act-split link) re-opens that act, and the open state is saved.
5. Highlight and Fold the rest last for the visit only; act collapse is saved per project.
6. Plan still opens with a scene selected (resume point or first scene), so the lock-and-regenerate recipe is unchanged; the Episode view comes from Esc, "← Episode" or a stale `?scene=`.

## File Structure

`src/` = `apps/web/src/`.

| File | Status | Task | Responsibility |
|---|---|---|---|
| `src/plan/story.ts` (+ `story.test.ts`) | modify | 1, 7 | `boardModel` (scene signals, act summaries, cast), relation tape, note sentence, announcements (1); highlight matchers, tapes, counts, cast counts, next match (7) |
| `src/plan/BoardCard.tsx` (+ `.test.tsx`) | new | 2, 10 | The index card face: chips, ticks, counts, tags, tape, selected/related/focus states (2); ring and quiet (10) |
| `src/projects/wizard/board/IndexCard.tsx` | modify | 2 | `export const RULED` (one word) |
| `src/plan/ActHeader.tsx` (+ `.test.tsx`) | new | 3 | Act header row, act-split notes, `ShareBar` |
| `src/plan/useCollapsedActs.ts` (+ `.test.ts`) | new | 3 | Persisted collapsed acts per project |
| `src/plan/Board.tsx` (+ `.test.tsx`) | modify | 4, 10 | Act frames with headers, cards, empty-act drop, roving tab stop, relation tape, `PlanSelection` type (4); highlight, fold stubs, header slot (10) |
| `src/plan/SceneCard.tsx`, `src/plan/flaggedScenes.ts` (+ `.test.ts`) | delete | 4 | Replaced by `BoardCard` / `boardModel` |
| `src/plan/StoryLayersPanel.tsx` | modify, then delete | 4 (import line), 11 | |
| `src/plan/PlanScreen.tsx` (+ `.test.tsx`) | modify | 4, 5, 11 | Model memo, collapse, act drop, panel focus (4); live region (5); highlight, fold, keys, Episode view, Story Layers out (11) |
| `src/plan/panel/PanelHeader.tsx` | modify | 4 | Title `<h2 tabIndex={-1}>` with a focus ring |
| `src/plan/panel/ScenePanel.tsx` (+ `.test.tsx`) | modify | 5 | Esc in the panel → the scene's card |
| `src/plan/HighlightBar.tsx` (+ `.test.tsx`) | new | 8 | Highlight buttons with counts, Who's in it select, Fold the rest, Next note/match |
| `src/plan/panel/EpisodeView.tsx` (+ `.test.tsx`) | new | 9 | The Episode view (spec §4.7) |
| `src/plan/panel/useSectionOpenState.ts` (+ `.test.ts`) | modify | 9 | Episode section ids (Premise closed by default) |
| `src/plan/panel/EpisodePanel.tsx` (+ `.test.tsx`) | delete | 11 | Replaced by `EpisodeView` |
| `src/plan/usePlanKeys.ts` (+ `.test.ts`) | new | 11 | J/K, N/Shift+N, Esc, ⌘↵ on `document` |
| `src/styles/tokens.css`, `tokens.expected.ts`, `src/dev/TokensPage.tsx` | modify | 11 | Remove `--tr-panel-story-layers`, `--tr-card-scene` |
| `apps/web/e2e/plan.spec.ts` | modify | 5, 11 | Empty-act drop, keyboard (5); highlight + N, Episode view (11) |
| `apps/web/e2e/plan-notes.spec.ts` | modify | 5 | The scene-5 card's `consistency-flag-badge` |
| `docs/tableread-ui-spec.md`, `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md` | modify | 6, 12 | Per-PR docs; Task 12 also amends `docs/narrative-sidekick-design-doc.md`'s Story Layers line |

Untouched: `planTree.ts`, `useProjectPatch.ts`, `Card.tsx` (Ledger uses it), `Chip.tsx`, every other `panel/*` file, `api/client.ts`, `packages/contract`, `apps/api`, `onboarding/recipes.json`.

## PR boundaries and order

| PR | Branch | Tasks |
|---|---|---|
| **T3.5 Index cards and act headers** | `feat/plan-board` (this worktree, cut from `main`) | 1–6 |
| **T3.6 Highlights, Episode view, Story Layers retirement** | `feat/plan-highlights`, cut from `feat/plan-board` after Task 1's commit | 7–12 |

```
T3.5:  1 ─┬─► 2 ─┐
          ├─► 3 ─┴─► 4 ─► 5 ─► 6
T3.6:     ├─► 7 ─┬─► 8 ────────────────┐
          │      ├─► 9 (needs 3) ──────┼─► 11 (needs 5) ─► 12 (needs 6)
          │      └─► 10 (needs 4) ─────┘
```

- After Task 1, Tasks 2, 3 and 7 run in parallel (disjoint files). Tasks 8 and 9 run in parallel with 4 and 5. Task 10 runs in parallel with 5 and 6.
- `feat/plan-highlights` touches no T3.5 file until Task 10. Rebase it onto `feat/plan-board` (or onto `main` once T3.5 merges) before Task 10 starts.
- Shared files, in order: `story.ts` (1, then 7); `BoardCard.tsx` (2, then 10); `Board.tsx` (4, then 10); `PlanScreen.tsx` (4, 5, then 11); `e2e/plan.spec.ts` (5, then 11); docs (6, then 12).

---

## T3.5 PR: Index cards and act headers (Tasks 1–6)

### Task 1: `boardModel` and the board derivations in `story.ts`

**PR:** T3.5 · **Depends on:** none · **e2e:** no

**Files:** modify `apps/web/src/plan/story.ts`, `apps/web/src/plan/story.test.ts`.

**Interfaces:**
- Consumes: Phase 1 `story.ts` exports; `planTree.actNumbersForBoard`, `actLabel`, `groupScenesByAct`; `tvActStages`; `boardText.plural`; contract `Character, ConsistencyFlag, Episode, Project, Scene, StoryThread`.
- Produces:

```ts
export type TapeTone = 'sky' | 'amber' | 'secret' | 'accent'
/** The one strip of tape above a card (spec §4.2). */
export interface CardTape { text: string; tone: TapeTone }
export type BeatTick = 'story' | 'import' | 'plain'

export interface SceneSignals {
  scene: Scene
  /** The card number: scene.index + 1. */
  number: number
  /** placeTitle(scene) */
  place: string
  /** notesForScene(...) split by kind, each in beat order */
  storyNotes: PlanNote[]
  importNotes: PlanNote[]
  /** One per beat in index order, at most 12; a story note wins over an import note. */
  ticks: BeatTick[]
  /** Set up here and paid off in another scene, or never. */
  setsUp: StoryThread[]
  /** Paid off here, set up in another scene. */
  paysOff: StoryThread[]
  /** One of setsUp has no payoff scene in this episode. */
  neverPaidOff: boolean
  /** The first secret touching this scene (secretsForScene order), or null. */
  secret: 'set' | 'kept' | 'out' | null
  /** The marked (tvActStages 'hit') landmark label placed on this scene, e.g. "Act One Turn". */
  landmark: string | null
  /** The last scene of its act on the board. */
  actOut: boolean
  /** Character ids from dialogue cues or a recorded want, bible order. */
  castIds: string[]
  /** Character ids with a recorded want (scene.motivations). */
  wantIds: string[]
  /** Sum of the scene's beat scriptText lengths. */
  scriptLength: number
}

export interface ActLandmark { label: string; short: string; sceneId: string; number: number }
export interface ActSplitNote { sceneId: string; number: number; text: string }

export interface ActSummary {
  act: number
  label: string            // actLabel(act, format)
  scenes: Scene[]          // board order
  /** This act's share of the episode's script text; null when the episode has none. */
  share: number | null
  /** Threads whose setup scene is in this act. */
  setUp: number
  /** Threads paid off in this act and set up in another scene. */
  paidOff: number
  landmarks: ActLandmark[] // marked only; short = label without "Act One "
  actOutSceneId: string | null
  actSplitNotes: ActSplitNote[]
}

export interface BoardModel {
  order: Scene[]                                // boardOrder(episode.scenes)
  signals: ReadonlyMap<string, SceneSignals>
  acts: ActSummary[]                            // one per actNumbersForBoard(format, scenes)
  threads: StoryThread[]                        // episode.threads ?? []
  characters: Character[]                       // project.seriesBible.characters
  hasScript: boolean
  hasThreads: boolean
}

export function boardModel(project: Project, episode: Episode, flags: readonly ConsistencyFlag[]): BoardModel
/** "TURN" for a marked turn, else "ACT OUT" for an act's last scene, else null. */
export function cardTag(signals: SceneSignals): 'TURN' | 'ACT OUT' | null
/** How a card relates to the selected scene through a thread (spec §4.2):
 * "↘ pays off n" / "↗ sets up n" (n = the selected scene's number), sky; null otherwise. */
export function relationTape(model: BoardModel, selectedSceneId: string | null, sceneId: string): CardTape | null
/** One plain sentence for a note: an import note's importNoteText, else the
 * first sentence of the explanation with scene/fact references as plain text. */
export function noteSentence(note: PlanNote, scene: Scene, scenes: readonly Scene[]): string
/** "Scene 3, The Long Pour - Bar, locked. 2 notes, 1 from the import." (spec §4.10) */
export function selectionAnnouncement(signals: SceneSignals, locked: boolean): string
```

**Tests** (add a `project(ep, format?)` builder beside the existing `scene`/`beat`/`episode`/`flag` builders; generic or fixture wording only):
- `describe('boardModel')`
  - "orders scenes like the board and numbers them by index" — `order` ids by (act, index); `signals.get('scene-3').number === 3`; `place` is `placeTitle`.
  - "splits a scene's notes by kind and marks one tick per beat, story over import, at most 12" — a beat with both kinds reads `'story'`; 14 beats → 12 ticks; a flag on a missing beat adds nothing.
  - "counts setups and payoffs across scenes, not a thread set up and paid off in one scene, and flags a setup never paid off" — thread A→B: A.setsUp 1, B.paysOff 1; A→A: neither; A→null and A→`scene-99`: `neverPaidOff`.
  - "reads the secret role (set, kept, out) and null elsewhere".
  - "places only the beat-sheet landmarks tvActStages marks, by scene id or by beat; cardTag reads TURN for a turn and ACT OUT for an act's last scene" — a row labelled "Act One Turn" with `sceneId: null` and a beat of scene-2 lands on scene-2; an unlabelled or "Midpoint" row is ignored; the last scene of each non-empty act has `actOut`.
  - "summarises every board act, empty ones included" — fixture-like format (cold open + 4 acts) with acts 0–3 used: 5 summaries, act 4 `scenes: []`, `share 0` when the episode has script, `actOutSceneId null`; shares sum to 1; `setUp`/`paidOff` per the thread rule above; `landmarks[0]` `{ label: 'Act One Turn', short: 'Turn', number }`; an act-split note on a scene in act 2 appears in act 2's `actSplitNotes` as its first sentence, with no raw `fact-…` id.
  - "cast is dialogue cues plus recorded wants, in bible order" — a cue-only character and a want-only character both appear; an unmatched cue does not.
- `describe('relationTape')` — "↘ pays off 4" on the payoff card when scene-4 (the setup) is selected; "↗ sets up 4" on the setup card when the payoff scene-4 is selected; null for the selected card, an unrelated card and no selection.
- `describe('noteSentence')` — first sentence only; "Scene 12" kept as text; a fact id reads "a Ledger fact"; an import note reads `importNoteText` with "n.m".
- `describe('selectionAnnouncement')` — `'Scene 3, The Long Pour - Bar, locked. 2 notes, 1 from the import.'` and `'Scene 1, The Long Pour. No notes.'`.
- Extend `describe('missing story data')` — "boardModel reads a doc with no threads, secrets, overview or script": delete `threads`, `secrets`, `storyOverview` and every `scriptText` from the episode object (`as unknown as Episode`) → no throw, `hasScript false`, `hasThreads false`, every `share === null`, no landmarks, no ticks marked.

**Implementation notes:**
- Build once, in order: `order`, the per-scene lengths (`total = Σ`), `marked` landmarks, `acts = actNumbersForBoard(project.format, order)`, `groups = groupScenesByAct(order)` (pass `order`, already a copy), then signals, then summaries. Read every defaulted key with `?? []` / `?? ''`.
- Marked landmarks — `tvActStages` already returns canonical labels; resolve a hit with no usable `sceneId` through its beat:

```ts
function markedLandmarks(project: Project, episode: Episode): { label: string; sceneId: string }[] {
  const ids = new Set(episode.scenes.map((s) => s.id))
  const sceneOfBeat = new Map(
    episode.scenes.flatMap((s) => s.beats.map((b) => [b.id, s.id] as const)),
  )
  return (tvActStages(project.format, episode.storyOverview) ?? []).flatMap((stage) => {
    if (stage.status !== 'hit') return []
    const sceneId =
      stage.sceneId && ids.has(stage.sceneId)
        ? stage.sceneId
        : stage.beatId
          ? sceneOfBeat.get(stage.beatId)
          : undefined
    return sceneId ? [{ label: stage.label, sceneId }] : []
  })
}
```

- `short`: `label.replace(/^Act \w+ /, '')` ("Turn", "Out"; "Cold Open", "Climax", "Tag" unchanged). `cardTag`: `/ Turn$/.test(landmark ?? '') ? 'TURN' : actOut ? 'ACT OUT' : null`.
- `secret`: `secretsForScene(episode, id, new Set())[0]?.role ?? null`.
- `castIds`: `const cued = new Set(castFromDialogue(scene, characters).map((c) => c.id))`, then `characters.filter((c) => cued.has(c.id) || wants.has(c.id)).map((c) => c.id)`.
- `noteSentence` for story notes: `linkifyNote(text, scenes, []).map((s) => s.text).join('')`, then the first sentence. Mark the sentence split as a heuristic: `// ponytail: first sentence = up to the first . ! or ? followed by a space or the end; abbreviations ("Mr.") cut early. Fine for a one-line summary; the full text is one click away.`
- `selectionAnnouncement` uses `plural` from `../projects/wizard/board/boardText`.
- Update the `notesForScene` doc comment: it no longer mentions `flaggedScenes.ts` (deleted in Task 4).

**Commands:** `(cd apps/web && npx vitest run src/plan/story.test.ts)`, `npx tsc -b`, eslint + prettier on both files.

**Commit:** `plan: derive the board model in story.ts`

---

### Task 2: `BoardCard`, the index card face

**PR:** T3.5 · **Depends on:** 1 · **e2e:** no

**Files:** create `apps/web/src/plan/BoardCard.tsx`, `apps/web/src/plan/BoardCard.test.tsx`; modify `apps/web/src/projects/wizard/board/IndexCard.tsx` (`const RULED` → `export const RULED`, nothing else).

**Interfaces:**
- Consumes: `SceneSignals`, `CardTape`, `cardTag` (Task 1); `RULED`; `sceneLocationType`, `sceneTypeDotClass`.
- Produces:

```ts
export interface BoardCardProps {
  signals: SceneSignals
  /** Effective: scene or episode lock. */
  locked: boolean
  selected: boolean
  /** Roving tab stop: Board gives exactly one card 0. */
  tabIndex: 0 | -1
  /** A write is in flight: no drag. */
  pending: boolean
  unsaved: boolean
  /** At most one tape (spec §4.2). */
  tape: CardTape | null
  /** Shares a thread with the selected scene: dashed sky outline. */
  related: boolean
  dragging: boolean
  dropTarget: boolean
  onSelect: () => void
  onOpenInWrite: () => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onFocus: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: () => void
}
export function BoardCard(props: BoardCardProps): JSX.Element
```

**Tests** (`BoardCard.test.tsx`, jsdom; build signals with `boardModel` from Task 1 over a small project):
- "shows the index card face: number, INT/EXT dot, cleaned place title, a 4-line reading, the full slug in the tooltip" — text `3` and `The Long Pour - Bar`; `title` contains `INT. THE LONG POUR - BAR - DAY` and the reading; reading has `line-clamp-4`; root has `w-card-board-w h-card-board-h` and the ruled `backgroundImage`.
- "story notes show an amber ⚑n chip; import-only notes a quiet chip; both are consistency-flag-badge" — `data-kind="story"` text `⚑2` (`bg-tr-amber-soft`); import-only `data-kind="import"` text `⚑1` (`bg-tr-surface-sunken`); no chip without notes.
- "beat ticks mark story and import notes" — `[data-tick="story"]`, `[data-tick="import"]`, `[data-tick="plain"]` counts.
- "shows ↗/↘ counts, ◆ or ◇ for the secret and the TURN / ACT OUT tag".
- "a locked card shows the lock glyph, says data-locked=true and does not drag; a pending card does not drag" — `draggable="false"`; `fireEvent.dragStart` → `onDragStart` not called and the event is `defaultPrevented`.
- "the coral unsaved dot only when unsaved" (`unsaved-dot`).
- "at most one tape, hidden from assistive tech, its text in the accessible name".
- "selected: aria-pressed, coral-soft fill and an inset coral ring; related: a dashed sky outline; the focus ring is a separate 2px sky outline offset 4px" — class assertions: `bg-tr-coral-soft`, `inset-ring-2 inset-ring-tr-coral`; `outline-dashed outline-tr-sky`; `focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-tr-sky`.
- "its accessible name reads number, place, lock, notes, threads, secret, tag, draft and tape" — e.g. `'Scene 3, The Long Pour - Bar, locked, 2 notes, 1 from the import, sets up 1, pays off 1, secret kept, act out, unsaved draft'`.
- "click selects, double-click opens Write; a locked card refuses a drop (no preventDefault on dragover)".

**Implementation notes:**
- Root: `<div role="button" aria-pressed={selected} data-scene-card data-scene-id={id} data-testid={`scene-card-${id}`} data-locked={locked} tabIndex draggable={!locked && !pending} aria-label={…} title={`${number}. ${scene.location}\n${scene.whatHappens}`} style={RULED}>`. Layout follows the mockup's `.card` (`relative flex flex-col rounded-[4px] px-2 pb-1 pt-[7px] bg-tr-board-paper shadow-card-board`, hover `shadow-card-lift`). Keep Phase 1's drag rules verbatim (refuse `dragstart` when not draggable; locked → no `preventDefault` on `dragover`/`drop`).
- Head row (`aria-hidden`): `number` (semibold, tabular) · dot (`sceneTypeDotClass(sceneLocationType(scene))`, `size-1.5 rounded-full`) · `place` (`truncate`) · flag chip · lock glyph (reuse Phase 1's `LockGlyph` SVG, `text-tr-amber`) · unsaved dot (`data-testid="unsaved-dot"`, `size-2 rounded-full bg-tr-coral`, keep Phase 1's `role="img" aria-label="Unsaved edits"`).
- Body: `whatHappens`, `font-ledger-display text-13 leading-[15px] line-clamp-4 text-tr-text-primary` (the import board's reading face).
- Foot (`aria-hidden`, `text-11`): ticks (`w-0.75 h-2 rounded-[1px] bg-tr-border-strong`; story `h-2.5 bg-tr-amber`; import `h-2.5 bg-transparent inset-ring inset-ring-tr-text-secondary`) · `↗n` (amber when `neverPaidOff`) · `↘n` · `◆`/`◇` (`text-tr-ledger-secret-ink`) · tag.
- Tape: `<span aria-hidden className="absolute -top-2.5 left-2 z-[2] max-w-[134px] truncate rounded-[3px] px-1.5 text-11 font-semibold leading-4 text-tr-surface-raised shadow-raised {TONE_BG[tone]}">`, with a literal class map (Tailwind needs whole class names):

```ts
const TONE_BG: Record<TapeTone, string> = {
  sky: 'bg-tr-sky',
  amber: 'bg-tr-amber',
  secret: 'bg-tr-ledger-secret-ink',
  accent: 'bg-tr-accent-ink',
}
```

- No `Card`/`Chip` import: the face is its own markup. Keep `PlanSelection` where it is for now (Task 4 moves it).

**Commands:** `(cd apps/web && npx vitest run src/plan/BoardCard.test.tsx src/projects/wizard/board)`, `npx tsc -b`, eslint + prettier on the three files.

**Commit:** `plan: add the index-card face for the board`

---

### Task 3: `ActHeader`, `ShareBar` and persisted act collapse

**PR:** T3.5 · **Depends on:** 1 · **e2e:** no

**Files:** create `apps/web/src/plan/ActHeader.tsx`, `ActHeader.test.tsx`, `useCollapsedActs.ts`, `useCollapsedActs.test.ts`.

**Interfaces:**
- Consumes: `ActSummary` (Task 1).
- Produces:

```ts
export interface ActHeaderProps {
  summary: ActSummary
  /** Acts on the board, for the even-share tick (1 / actCount). */
  actCount: number
  /** model.hasThreads: no "↗0 set up · ↘0 paid off" on a project without threads. */
  showThreads: boolean
  collapsed: boolean
  onToggle: () => void
  onSelectScene: (sceneId: string) => void
}
export function ActHeader(props: ActHeaderProps): JSX.Element
/** ≈ share bar with an even-share tick; "≈43%". Used by ActHeader and the Episode view. */
export function ShareBar(props: { share: number; even: number; actCount: number }): JSX.Element

// useCollapsedActs.ts
export function useCollapsedActs(projectId: string): {
  collapsed: Set<number>
  toggle: (act: number) => void
  /** Opens a collapsed act (selecting a scene inside it); no-op when open. */
  expand: (act: number) => void
}
```

**Tests:**
- `ActHeader.test.tsx`
  - "names the act and counts its scenes, with the share bar, its even-share tick and ≈ percent" — `ACT ONE`, `2 scenes`; bar fill `style.width === '43%'` (share 0.43), tick `style.left === '25%'` (even 0.25), text `≈43%`, `title` mentions "share of the script text" and "an even split across 4 acts".
  - "no share bar without script text and no thread counts without threads" — `share: null` → no `≈`; `showThreads false` → no `set up`.
  - "shows ↗ set up and ↘ paid off counts".
  - "chips only for marked landmarks: '✓ Turn · 3'" — two landmarks → two chips; none → no chip and no "not marked" text.
  - "an act-split note reads its sentence and Open scene n selects that scene".
  - "the chevron says Hide/Show ACT ONE, carries aria-expanded and calls onToggle".
  - "an empty act shows no share bar or counts".
- `useCollapsedActs.test.ts` (`renderHook`)
  - "remembers collapsed acts per project across mounts" — key `tr.plan.collapsedActs.v1.proj-a`; a second project starts empty.
  - "keeps toggling in memory when storage throws" — stub `Storage.prototype.getItem/setItem` to throw.
  - "expand opens a collapsed act and returns the same set when it is already open".

**Implementation notes:**
- Header row per the mockup `.acthead`: chevron button (`aria-expanded={!collapsed}`, `aria-label={`${collapsed ? 'Show' : 'Hide'} ${label}`}`, SVG rotates `-90deg` when collapsed, `motion-reduce:transition-none`) · `<h2 className="font-display text-15 font-semibold uppercase tracking-wide">` · `n scenes` · `ShareBar` (when `scenes.length > 0 && share !== null`) · `↗n set up · ↘n paid off` (when `scenes.length > 0 && showThreads`) · chips (`Chip hue="sage"`: `✓ {short} · {number}`, `title` = full label).
- `ShareBar`: `w-18 h-1.5 rounded-chip bg-tr-surface-raised inset-ring inset-ring-tr-border-strong relative`; fill `absolute inset-y-0 left-0 rounded-chip bg-tr-text-secondary` with `style={{ width: pct(share) }}`; tick `absolute -top-[3px] h-3 w-0.5 bg-tr-text-primary` with `style={{ left: pct(even) }}`; `pct = (x) => `${Math.round(x * 1000) / 10}%``. Inline `style` for a computed width is data, not a hardcoded spacing token.
- Act-split notes under the row: `rounded-card bg-tr-amber-soft px-2.5 py-1.5 text-12 text-tr-text-primary`, "⚑ Act split" (amber, semibold) · `text` · `<button>Open scene {number}</button>` (`text-tr-sky underline`, focus ring).
- `useCollapsedActs`: copy `useSectionOpenState`'s guarded-storage pattern; store a JSON number array; `useState(() => load(projectId))`.

**Commands:** `(cd apps/web && npx vitest run src/plan/ActHeader.test.tsx src/plan/useCollapsedActs.test.ts)`, `npx tsc -b`, eslint + prettier on the four files.

**Commit:** `plan: add act headers with share bar and persisted collapse`

---

### Task 4: Board with index cards, act headers, empty-act drop and roving tabindex

**PR:** T3.5 · **Depends on:** 2, 3 · **e2e:** no

**Files:** modify `apps/web/src/plan/Board.tsx`, `Board.test.tsx` (rewrite), `PlanScreen.tsx`, `PlanScreen.test.tsx`, `panel/PanelHeader.tsx`, `StoryLayersPanel.tsx` (import line only); delete `SceneCard.tsx`, `flaggedScenes.ts`, `flaggedScenes.test.ts`.

**Interfaces:**
- Consumes: `boardModel`, `relationTape`, `BoardModel` (1); `BoardCard` (2); `ActHeader`, `useCollapsedActs` (3).
- Produces:

```ts
// Board.tsx (PlanSelection moves here from SceneCard.tsx)
export type PlanSelection =
  | { type: 'scene'; sceneId: string }
  | { type: 'beat'; sceneId: string; beatId: string }
  | null

export interface BoardProps {
  model: BoardModel
  episodeLocked: boolean
  selection: PlanSelection
  collapsedActs: ReadonlySet<number>
  pending: boolean
  draftSceneIds?: ReadonlySet<string>
  onSelectScene: (sceneId: string) => void
  onOpenInWrite?: (sceneId: string) => void
  onReorder: (draggedSceneId: string, targetSceneId: string) => void
  /** An empty act took a dropped card (spec §4.3): the Act select's save. */
  onMoveToAct: (sceneId: string, act: number) => void
  onToggleAct: (act: number) => void
  /** Enter on the selected card: focus the panel heading. */
  onEnterPanel: () => void
}

/** The card in the next (dir 1) or previous (-1) visual row whose centre is
 * nearest this one's; null at the edge. Exported for the test. */
export function gridNeighbor(
  boxes: readonly Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>[],
  from: number,
  dir: 1 | -1,
): number | null
```

- `PlanScreen` (inside the component): `const model = useMemo(…, [project, openFlags])` computed before the early returns from `project?.seasons[0]?.episodes[0]`; `const acts = useCollapsedActs(activeProjectId)` replaces `collapsedActs` state; `moveToAct(sceneId, act) = void saveSceneField(sceneId, 'act', act)`; `focusPanelHeading() = document.querySelector<HTMLElement>('[data-testid="inspector"] h2')?.focus()`; `selectScene` also calls `acts.expand(scene.act)` when that act is collapsed. Story Layers keeps working off the same `acts.collapsed` / `acts.toggle` until Task 11.
- `PanelHeader`: the title `<h2>` gets `tabIndex={-1}` and `outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tr-sky`.

**Tests:**
- `Board.test.tsx` (keep the builders; render with `model={boardModel(project(ep), ep, flags)}`):
  - "renders a frame per board act with its header, and its cards in board order" — `act-frame-0` … `act-frame-4`; header text `ACT ONE`; card order inside `act-frame-1`.
  - "a collapsed act keeps its header and says how many scenes are hidden, and how many have notes" — `2 scenes hidden · 1 with notes`; no cards; the chevron calls `onToggleAct(1)`.
  - "an empty act says so and takes a drop as one act change" — text `No scenes yet. Drag a card here, or use the Act control.`; `fireEvent.dragStart(card)`, `fireEvent.dragOver(empty)` (default prevented), `fireEvent.drop(empty)` → `onMoveToAct('scene-1', 4)` once, `onReorder` never.
  - "an empty act ignores a drag that never started (a locked card)" — `dragStart` on a locked card, then `drop` on the empty act → no call.
  - "a locked card neither drags nor takes a drop; dragging one card onto another swaps" — carry over Phase 1's three drag tests (locked, pending, `onReorder(dragged, target)`).
  - "exactly one card is a tab stop: the selected one, else the first" — `container.querySelectorAll('[data-scene-card][tabindex="0"]').length === 1` with a selection, without one, and with the selected scene's act collapsed (then the first rendered card).
  - "→ ← Home End select and focus the neighbour in board order, across acts" — `user.keyboard('{ArrowRight}')` from the cold-open card selects and focuses the first card of act 1; `End` the last card.
  - "↓ ↑ move to the nearest card in the next or previous row" (code below).
  - "Enter on the selected card asks for the panel; Enter or Space on another card selects it".
  - "a card that shares a thread with the selection wears the relation tape and the dashed outline".
  - "click selects, double-click opens Write, the unsaved dot follows draftSceneIds" (carried over).
  - `describe('gridNeighbor')` — rows at top 0 and 120; from the middle of row 0, `dir 1` returns the row-1 box nearest by centre; `null` from the last row.
- `PlanScreen.test.tsx`:
  - "an empty-act drop sends one act PATCH and nothing else" — fixture-like project with an empty act 4; drag `scene-1` to the empty act; `patchProjectMock` called once and its ops are exactly `[{ op: 'replace', path: '/seasons/0/episodes/0/scenes/0/act', value: 4 }]`; `suggestInstructionsMock` and `createChangeSetMock` never called.
  - "act collapse survives a remount (per project)".
  - "selecting a scene in a collapsed act opens that act" — collapse act 1, then ‹/› in the panel into it → its cards render.
  - "Enter on the selected card puts focus on the panel heading" — `document.activeElement` is the inspector's `h2`.
  - Update "← Episode switches the panel…": assert the card's `aria-pressed="false"` instead of the old fill class.

```tsx
it('↓ ↑ move to the nearest card in the next or previous row', async () => {
  const user = userEvent.setup()
  const onSelectScene = vi.fn()
  // Four act-1 cards; jsdom has no layout, so give each a box: two rows of two.
  renderBoard({ model: fourCardModel(), selection: sel('scene-1'), onSelectScene })
  const boxes: Record<string, [number, number]> = {
    'scene-1': [0, 0], 'scene-2': [0, 162], 'scene-3': [124, 0], 'scene-4': [124, 162],
  }
  for (const [id, [top, left]] of Object.entries(boxes)) {
    screen.getByTestId(`scene-card-${id}`).getBoundingClientRect = () =>
      ({ top, bottom: top + 106, left, width: 150 }) as DOMRect
  }
  screen.getByTestId('scene-card-scene-2').focus()
  await user.keyboard('{ArrowDown}')
  expect(onSelectScene).toHaveBeenLastCalledWith('scene-4')
  expect(document.activeElement).toBe(screen.getByTestId('scene-card-scene-4'))
  await user.keyboard('{ArrowUp}')
  expect(onSelectScene).toHaveBeenLastCalledWith('scene-2')
})
```

**Implementation notes:**
- Board root stays `<div className="min-w-0 flex-1 overflow-y-auto p-5" aria-label="Plan board">` (the PlanScreen layout test reads `overflow-y-auto` and `min-w-0`). Frames: `rounded-frame bg-tr-surface-clay px-3.5 pb-4 pt-2.5`, cards `mt-4 flex flex-wrap gap-x-3 gap-y-4`. At 1440 wide without Story Layers this fits 6 cards (6 × 150 + 5 × 12 = 960 px).
- `rendered` (DOM order of visible cards) = `model.acts.filter((a) => !collapsedActs.has(a.act)).flatMap((a) => a.scenes.map((s) => s.id))`. Tab stop:

```ts
const selectedId = selection?.sceneId ?? null
const tabStop =
  [selectedId, focusedId].find((id) => id !== null && rendered.includes(id)) ??
  rendered[0] ??
  null
```

  `focusedId` is Board state set by each card's `onFocus`.
- Card keys (Board passes `onKeyDown={(e) => handleKey(e, id)}`): return when `e.target !== e.currentTarget` or any of `altKey`/`metaKey`/`ctrlKey` (⌥←/→ is Phase 4's insert move). `ArrowRight`/`ArrowLeft` → `rendered[at ± 1]`; `Home`/`End`; `ArrowDown`/`ArrowUp` → `gridNeighbor(cardEls().map((el) => el.getBoundingClientRect()), at, ±1)` where `cardEls()` = `rootRef.current.querySelectorAll<HTMLElement>('[data-scene-card]')`; `Enter`/`' '` → `preventDefault()`, then `selectedId === id ? onEnterPanel() : onSelectScene(id)`. For a move: `preventDefault()`, `onSelectScene(to)`, then focus `cardEls()` entry with `dataset.sceneId === to` (it is already rendered). Unhandled keys fall through untouched (Task 11's `document` listener handles J/K/N).
- `gridNeighbor`:

```ts
export function gridNeighbor(boxes, from, dir) {
  const here = boxes[from]
  if (!here) return null
  const centre = (b: (typeof boxes)[number]) => b.left + b.width / 2
  // ponytail: 4px tolerance for sub-pixel row tops; rows are flex-wrap lines.
  const beyond = boxes
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => (dir > 0 ? b.top > here.bottom - 4 : b.bottom < here.top + 4))
  if (beyond.length === 0) return null
  const tops = beyond.map(({ b }) => b.top)
  const rowTop = dir > 0 ? Math.min(...tops) : Math.max(...tops)
  return beyond
    .filter(({ b }) => Math.abs(b.top - rowTop) < 4)
    .reduce((best, c) =>
      Math.abs(centre(c.b) - centre(here)) < Math.abs(centre(best.b) - centre(here)) ? c : best,
    ).i
}
```

- Empty act (not collapsed, no scenes): a dashed box (`mt-3 rounded-card border border-dashed border-tr-border-strong p-4 text-center text-12 text-tr-text-primary`) with `onDragOver={(e) => { if (!dragSourceId) return; e.preventDefault(); setDropAct(act) }}`, `onDragLeave → setDropAct(null)`, `onDrop={(e) => { e.preventDefault(); if (dragSourceId) onMoveToAct(dragSourceId, act); clearDrag() }}`. While `dropAct === act` the frame gets `inset-ring-2 inset-ring-tr-sky`. `dragSourceId` is only ever set by a card that was allowed to start a drag, so locked and pending cards never reach it.
- Collapsed body: `{n} scenes hidden` plus ` · {k} with notes` when any has a story note.
- Each card: `tape = relationTape(model, selectedId, id)`, `related = tape !== null`, `locked = scene.locked || episodeLocked`, `unsaved = draftSceneIds.has(id)`.
- `StoryLayersPanel.tsx`: change only `import type { PlanSelection } from './SceneCard'` → `'./Board'`. Its `collapsedActs: Set<number>` prop accepts `acts.collapsed` (the hook returns `Set<number>`).
- Delete `SceneCard.tsx`; delete `flaggedScenes.ts` and its test (the chips now come from `model.signals`; `git grep sceneIdsWithOpenFlags` must be empty).

**Commands:** `(cd apps/web && npx vitest run src/plan)`, `npx tsc -b`, `(cd apps/web && npx eslint src/plan)`, prettier on touched files.

**Commit:** `plan: put index cards and act headers on the board`

---

### Task 5: Live region, Esc back to the card, and the T3.5 e2e

**PR:** T3.5 · **Depends on:** 4 · **e2e:** yes

**Files:** modify `apps/web/src/plan/PlanScreen.tsx`, `PlanScreen.test.tsx`, `panel/ScenePanel.tsx`, `panel/ScenePanel.test.tsx`, `apps/web/e2e/plan.spec.ts`, `apps/web/e2e/plan-notes.spec.ts`.

**Interfaces:**
- Consumes: `selectionAnnouncement` (1); `model` and `selectScene` (4).
- Produces: PlanScreen state `live: string` and `announce(message: string)`; `<p role="status" aria-live="polite" data-testid="plan-live" className="sr-only">{live}</p>` rendered once inside the Plan column. `selectScene(sceneId)` (used by the board, the panel's ‹ ›, notes links and act-split notes) announces `selectionAnnouncement(signals, scene.locked || episode.locked)`. Nothing is announced on first load.
- `ScenePanel` aside: `onKeyDown` — Esc outside a field focuses the scene's card.

**Tests:**
- `PlanScreen.test.tsx`
  - "the live region announces a selection from the board and from ‹ ›" — click `scene-card-scene-2` → `plan-live` reads `Scene 2, …. No notes.`; Next scene → the next announcement.
  - "a note on the scene is part of the announcement" — with `OPEN_FLAG` on scene-1, selecting it reads `1 note`.
  - "nothing is announced on first load" — `plan-live` is empty after `loadPlan()`.
- `ScenePanel.test.tsx`
  - "Esc in the panel goes back to the card" — render a `<div data-testid="scene-card-scene-1" tabIndex={-1} />` beside the panel; focus the "Next scene" button; `{Escape}` → the card is focused.
  - "Esc in a text field stays in the field" — focus What happens; `{Escape}` → still focused, draft kept.
- e2e `plan.spec.ts` (append after the Act combobox test; both hold whatever ran before):

```ts
test('an empty act takes a dropped card as an act change, and it persists (T3.5)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  // scene-5 is Act Three's only scene in the fixture: park it in Act Two
  // (a no-op if an earlier test already did) so Act Three is empty.
  const card = page.getByTestId('scene-card-scene-5')
  await card.click()
  await page
    .getByTestId('inspector')
    .getByRole('combobox', { name: 'Act' })
    .selectOption('2')
  await expect(card).toHaveAttribute('draggable', 'true') // the PATCH has settled
  const empty = page.getByTestId('act-frame-3').getByText('No scenes yet')
  await expect(empty).toBeVisible()

  await card.dragTo(empty)
  await expect(
    page.getByTestId('act-frame-3').getByTestId('scene-card-scene-5'),
  ).toBeVisible()
  await expect(card).toHaveAttribute('draggable', 'true') // saved, not just optimistic

  await page.reload()
  await expect(
    page.getByTestId('act-frame-3').getByTestId('scene-card-scene-5'),
  ).toBeVisible()
})

test('the board is one tab stop: arrows select, Enter reaches the panel, Esc comes back (T3.5)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-1').click()
  const stop = page.locator('[data-scene-card][tabindex="0"]')
  await expect(stop).toHaveCount(1)

  await page.keyboard.press('ArrowRight')
  await expect(stop).toBeFocused()
  await expect(stop).toHaveAttribute('aria-pressed', 'true')
  await expect(stop).not.toHaveAttribute('data-testid', 'scene-card-scene-1')
  await expect(page.getByTestId('plan-live')).toContainText('Scene ')

  await page.keyboard.press('Enter')
  await expect(
    page.getByTestId('inspector').locator('h2').first(),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(stop).toBeFocused()
})
```

- e2e `plan-notes.spec.ts`: in the first test, after selecting `scene-card-scene-5` and before Show, add `await expect(page.getByTestId('scene-card-scene-5').getByTestId('consistency-flag-badge')).toContainText('⚑')`.

**Implementation notes:**
- `ScenePanel` aside: `onKeyDown={(event) => { if (event.key !== 'Escape' || (event.target as HTMLElement).closest('input, textarea, select')) return; document.querySelector<HTMLElement>(`[data-testid="scene-card-${scene.id}"]`)?.focus() }}`.
- `announce` just sets state; the same message twice in a row is not re-read (acceptable: it is the same scene).
- Run the T3.5 e2e set: `plan.spec.ts plan-notes.spec.ts review.spec.ts recipes.spec.ts newproject-resume.spec.ts`. All must pass (the six Write-mode baseline failures are in other files).

**Commands:** `(cd apps/web && npx vitest run src/plan)`, `npx tsc -b`, eslint + prettier on touched files, then the e2e block above.

**Commit:** `plan: announce selection and keep keyboard focus on the board`

---

### Task 6: T3.5 docs

**PR:** T3.5 · **Depends on:** 5 · **e2e:** no

**Files:** modify `docs/tableread-ui-spec.md`, `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md`.

- UI spec §1 (layout comment, line ~92): "scene cards 214px" → "Plan board cards reuse the import board's `--tr-card-board-w/h` (150×106; `--tr-card-scene` is unused, removed in T3.6)".
- UI spec §5: rewrite the **Acts as frames** and **Scene cards** bullets to the shipped board — act header (chevron with persisted collapse, name, scene count, ≈ share bar with the even-share tick and its "share of the script text" tooltip, hidden without script; ↗ set up · ↘ paid off, hidden without threads; marked landmark chips only; act-split note with Open scene n); empty act copy and drop (an act change, same PATCH as the Act select); the index card (face, chips, ticks, counts, tags, tape rule "relation to the selection; the highlight label lands in T3.6", selected / related / focus states, double-click → Write); a new **Keyboard and screen readers** bullet (one tab stop, ← → ↑ ↓ Home End select, Enter → panel heading, Esc in the panel → card, `plan-live` announces "Scene n, Place. k notes."). Keep the Story Layers bullet (removed in T3.6).
- Build plan T3.5: replace `_Accept:_` with what shipped (Vitest: `boardModel` shares/counts/landmarks/ticks/cast/missing data, `BoardCard` face and states, `ActHeader`, collapse persistence, roving tab stop incl. ↑/↓ geometry, empty-act drop = one act PATCH, live region; e2e: empty-act drop persists, keyboard tab stop, `consistency-flag-badge` on the scene-5 card).
- Test plan: one "Plan board (T3.5)" sentence in the Vitest paragraph and one in the E2E paragraph, same content.
- Handoff decision log: one row — "2026-10-13: Plan board cards become the import board's index card (150×106) under act headers with share, set up/paid off, marked landmarks and act-split notes; an empty act is a drop target (an act change); the board is one tab stop with a live region. Collapse is persisted per project; share bars and thread counts hide when the episode has no script or threads." | "Read the shape from the board (spec §1 job 1) without opening anything".

**Commit:** `docs: plan board cards and act headers (T3.5)`

---

## T3.6 PR: Highlights, Episode view, Story Layers retirement (Tasks 7–12)

### Task 7: Highlight derivations in `story.ts`

**PR:** T3.6 · **Depends on:** 1 · **e2e:** no

**Files:** modify `apps/web/src/plan/story.ts`, `story.test.ts`.

**Interfaces:**
- Consumes: `BoardModel`, `SceneSignals`, `CardTape`, `TapeTone` (1).
- Produces:

```ts
export type HighlightKind = 'none' | 'threads' | 'secret' | 'continuity' | 'acts' | 'who'
export interface Highlight { kind: HighlightKind; who: string | null } // who: character id
export const NO_HIGHLIGHT: Highlight
/** Bar order and labels: None, Setups & payoffs, The secret, Continuity, Act shape, Who's in it. */
export const HIGHLIGHT_LABELS: Record<HighlightKind, string>
/** Ring hue per highlight: threads sky, secret secret-ink, continuity amber, acts accent-ink, who sky. */
export const HIGHLIGHT_TONE: Record<Exclude<HighlightKind, 'none'>, TapeTone>
/** The tape a matching card wears (spec §4.5 table); null = no match. Always null for 'none'. */
export function highlightTape(model: BoardModel, sceneId: string, highlight: Highlight): CardTape | null
/** Matches for N and Fold: 'none' → the scene has a story note; else highlightTape !== null. */
export function matchesHighlight(model: BoardModel, sceneId: string, highlight: Highlight): boolean
/** Scenes that match ("every count means scenes that match"). */
export function highlightCount(model: BoardModel, highlight: Highlight): number
/** Characters in at least one scene (castIds), most scenes first, bible order on ties. */
export function castCounts(model: BoardModel): { character: Character; scenes: number }[]
/** "Highlight: Setups and payoffs. 19 scenes match." / "1 scene matches." / "Highlight off." */
export function highlightAnnouncement(model: BoardModel, highlight: Highlight): string
/** The next (dir 1) or previous (-1) scene in board order after `fromSceneId`
 * that matches, wrapping; from nothing, the first (or last). null when none. */
export function nextMatchId(model: BoardModel, fromSceneId: string | null, dir: 1 | -1, highlight: Highlight): string | null
```

**Tests:**
- `describe('highlightTape')`:
  - "Setups & payoffs: ↗ sets up n, ↘ pays off n, amber ↗ never paid off, +k for more" — thread scene-2→scene-5: scene-2 `{ text: '↗ sets up 5', tone: 'sky' }`, scene-5 `'↘ pays off 2'`; a never-paid setup `{ text: '↗ never paid off', tone: 'amber' }`; two threads → `'↗ sets up 5 +1'`.
  - "The secret: ◆ set, ◆ kept, ◇ out in the secret hue".
  - "Continuity: story continuity notes only" — continuity note → `{ text: '⚑ continuity', tone: 'amber' }`; act-split-only and import-only scenes → null.
  - "Act shape: the landmark name, else ACT OUT, else ACT SPLIT?" — `'ACT ONE TURN'`, `'ACT OUT'`, `'ACT SPLIT?'` (tone accent).
  - "Who's in it: NAME · wants for a recorded want, NAME for a dialogue cue only" — `'MARTA VEGA · wants'`, `'DAN VEGA'`; `who: null` → null.
  - "None never tapes".
- "matchesHighlight with None means a story note" — an import-only scene doesn't match.
- "highlightCount counts scenes that match" — per kind on one model.
- "castCounts orders by scenes, then bible order, and leaves out the absent".
- "highlightAnnouncement" — the four strings above, `&` read as "and", the character's name for Who's in it.
- "nextMatchId wraps both ways, starts from the ends with no selection, and is null when nothing matches".
- Extend "missing story data": every kind counts 0 on the raw doc; `castCounts` still lists characters with recorded wants.

**Implementation notes:**
- Scene numbers in tapes come from `model.signals.get(otherId)?.number`; a thread whose other scene is missing reads "never paid off" (setup) or is skipped (payoff), matching Task 1's counts.
- Who's in it tape: `name.toUpperCase()` plus ` · wants` when `wantIds.includes(who)`; the card truncates long names (its accessible name keeps the full tape).
- Mark the who rule: `// ponytail: presence = a dialogue cue or a recorded want; a character who is in the scene but never speaks and wants nothing is missed. Labelled "from dialogue cues and recorded wants" wherever it shows.`

**Commands:** `(cd apps/web && npx vitest run src/plan/story.test.ts)`, `npx tsc -b`, eslint + prettier.

**Commit:** `plan: derive highlights, counts and next match in story.ts`

---

### Task 8: `HighlightBar`

**PR:** T3.6 · **Depends on:** 7 · **e2e:** no

**Files:** create `apps/web/src/plan/HighlightBar.tsx`, `HighlightBar.test.tsx`.

**Interfaces:**
- Consumes: `BoardModel`, `Highlight`, `HIGHLIGHT_LABELS`, `highlightCount`, `castCounts` (7).
- Produces:

```ts
export interface HighlightBarProps {
  model: BoardModel
  highlight: Highlight
  fold: boolean
  onHighlight: (highlight: Highlight) => void
  onToggleFold: () => void
  /** N: next note (None) or next match. */
  onNext: () => void
}
export function HighlightBar(props: HighlightBarProps): JSX.Element
```

**Tests:**
- "offers None, Setups & payoffs, The secret, Continuity, Act shape and Who's in it, with scene counts; the active one is pressed" — `getByRole('group', { name: 'Highlight' })`; each a button with `aria-pressed`; None has no count.
- "a click picks a highlight; clicking the pressed one goes back to None".
- "Who's in it starts on the most-present character; the select switches character" — click → `onHighlight({ kind: 'who', who: 'char-marta' })`; `selectOption('char-dan')` → `{ kind: 'who', who: 'char-dan' }`; the select is labelled "Character to highlight" with title "From dialogue cues and recorded wants".
- "with no cast, Who's in it reads 0 and the select is disabled".
- "Fold the rest is a pressed toggle; Next note becomes Next match under a highlight and calls onNext" — `aria-keyshortcuts="N"` / `"Shift+N"` documented in its title.

**Implementation notes:**
- Mockup `.seg`: `role="group" aria-label="Highlight"`, `flex flex-wrap items-center gap-0.5 rounded-control bg-tr-surface-sunken p-0.5`; pressed button `bg-tr-surface-raised font-semibold shadow-raised`; counts `text-11 tabular-nums text-tr-text-primary`; every label is `text-tr-text-primary` (AA). The select sits right of the Who's in it button, options `character.name` with value `character.id`.
- Fold the rest and Next are plain buttons after the group; focus rings as elsewhere (`focus-visible:outline-2 focus-visible:outline-tr-sky`).
- No storage, no requests: the bar is pure props.

**Commands:** `(cd apps/web && npx vitest run src/plan/HighlightBar.test.tsx)`, `npx tsc -b`, eslint + prettier.

**Commit:** `plan: add the highlight bar`

---

### Task 9: `EpisodeView`, the nothing-selected panel

**PR:** T3.6 · **Depends on:** 3, 7 · **e2e:** no

**Files:** create `apps/web/src/plan/panel/EpisodeView.tsx`, `EpisodeView.test.tsx`; modify `panel/useSectionOpenState.ts`, `panel/useSectionOpenState.test.ts`.

**Interfaces:**
- Consumes: `BoardModel`, `castCounts`, `noteSentence`, `Highlight` (1, 7); `ShareBar` (3); `PanelSection`, `PlanField`, `draftKey` (Phase 1); `characterName` (planTree).
- Produces:

```ts
export interface EpisodeViewProps {
  project: Project
  episode: Episode
  model: BoardModel
  pending: boolean
  openingReview: boolean
  onSelectScene: (sceneId: string) => void
  onHighlight: (highlight: Highlight) => void
  /** "See all n in Ledger → Threads". */
  onOpenLedgerThreads: () => void
  onSaveEpisodePremise: (value: string) => Promise<boolean>
  onSaveSeriesPremise: (value: string) => Promise<boolean>
}
export function EpisodeView(props: EpisodeViewProps): JSX.Element

// useSectionOpenState.ts
export type PlanSectionId =
  | 'scene' | 'wants' | 'touches' | 'beats' | 'details'
  | 'ep-acts' | 'ep-threads' | 'ep-secret' | 'ep-notes' | 'ep-cast' | 'ep-premise'
// DEFAULT_OPEN: every ep-* open except 'ep-premise'
```

**Tests** (`EpisodeView.test.tsx`; port Phase 1's three `EpisodePanel.test.tsx` tests first):
- "is the inspector aside, titled by the episode, with the logline and a format line" — `data-testid="inspector"`; `h2` `Episode 1: Last Call` with `tabIndex -1`; logline from `storyOverview.logline`; `Drama · 60 min · 4 acts + cold open`.
- "Acts: one row per act with its share bar, scene count, marked landmarks and act-out scene with what the audience learns and feels; the row selects that scene" — click the act-out button → `onSelectScene('scene-3')`; footnote "Length is a share of the script text, not pages." (only when `model.hasScript`).
- "Threads: open threads with their setup scene, and See all n in Ledger" — row text `↗ {label}` + "never paid off"; click → `onSelectScene(setup)`; See all → `onOpenLedgerThreads`.
- "The secret: set, kept in n scenes, out or never revealed, hidden from whom, and Highlight on the board" — Highlight on the board → `onHighlight({ kind: 'secret', who: null })`.
- "Notes are grouped by scene, and From the import is a closed group" — a story note row selects its scene; the import `<details>` is not `open`; no `[code]` and no raw fact id in the text.
- "Who's in it chips switch the board highlight" — chip `Marta Vega 4` → `onHighlight({ kind: 'who', who: 'char-marta' })`; labelled "from dialogue cues and recorded wants".
- "Premise is closed by default and still saves through the structural footer; a locked episode makes its premise read-only" (ported).
- "an idea-born episode shows one quiet line per empty section" — `No threads recorded.`, `No secret recorded.`, `No open notes.`, `No cast yet.`; no share bars.
- `useSectionOpenState.test.ts`: "episode sections default open except Premise, and persist like the scene sections".

**Implementation notes:**
- Root mirrors `ScenePanel`'s: `<aside data-testid="inspector" aria-label="Episode" className="w-panel-plan shrink-0 overflow-y-auto bg-tr-surface-raised">`; header block `p-4` with an "Episode" eyebrow, `<h2 tabIndex={-1}>` (same focus classes as `PanelHeader`), logline (`text-15`), format line (`text-12`). No jump bar (spec §4.7 lists none).
- Sections are `PanelSection`s with ids `ep-acts` ("Acts, side by side"), `ep-threads` ("Threads"), `ep-secret` ("The secret"), `ep-notes` ("Notes", count = scenes with story notes), `ep-cast` ("Who's in it"), `ep-premise` ("Premise"), each wired to `useSectionOpenState`.
- Act rows: `ShareBar` with `even = 1 / model.acts.length` when `share !== null`; landmark chips `✓ {short} · {number}`; the act-out row is a button: `Act out · {number} {place}`, then `audienceLearns` and an italic "Feels: {audienceFeels}" (each only when non-empty); an empty act reads "No scenes yet.".
- Threads: `model.threads.filter((t) => t.status !== 'abandoned' && !model.signals.has(t.payoffSceneId ?? ''))`; summary count "n open · m paid off".
- The secret: one callout per `episode.secrets ?? []` (`bg-tr-ledger-secret-surface border-tr-ledger-secret-border`, ◆ glyph): summary; "Set in n" button · "kept in k scenes" · "out in m" button or "never revealed"; "Hidden from {names}" via `characterName`; "Highlight on the board".
- Notes: for each `model.order` scene with `storyNotes`, a button `{number} · {place}` followed by each `noteSentence`; then `<details>` "From the import · n" (closed) grouping import notes the same way.
- Premise: Phase 1 `EpisodePanel`'s two `PlanField`s, unchanged.

**Commands:** `(cd apps/web && npx vitest run src/plan/panel)`, `npx tsc -b`, eslint + prettier.

**Commit:** `plan: add the Episode view`

---

### Task 10: Rings, tapes, quiet cards and Fold the rest on the board

**PR:** T3.6 · **Depends on:** 4, 7 · **e2e:** no

**Files:** modify `apps/web/src/plan/Board.tsx`, `Board.test.tsx`, `BoardCard.tsx`, `BoardCard.test.tsx`.

**Interfaces:**
- Consumes: `highlightTape`, `matchesHighlight`, `HIGHLIGHT_TONE`, `NO_HIGHLIGHT` (7).
- Produces (all optional, so `PlanScreen` compiles unchanged until Task 11):

```ts
// BoardProps additions
highlight?: Highlight            // default NO_HIGHLIGHT
fold?: boolean                   // default false
unfolded?: ReadonlySet<string>   // run keys (first scene id) the writer opened
onUnfold?: (key: string) => void
/** Rendered sticky at the top of the board's scroll area (the highlight bar). */
header?: ReactNode

// BoardCardProps additions
ring?: TapeTone | null           // a highlight match: 2px ring in the highlight's hue
quiet?: boolean                  // a non-match under a highlight
```

**Tests:**
- `BoardCard.test.tsx`
  - "a match wears a 2px ring in its hue and says data-match" — `ring-2 ring-tr-ledger-secret-ink` for `'secret'`; `data-match="true"`.
  - "a quiet card is flat but keeps full opacity and primary text" — no ruled `backgroundImage`, `bg-tr-surface-sunken shadow-none`; no class matching `/opacity-/`; reading still `text-tr-text-primary`.
- `Board.test.tsx`
  - "under a highlight, matches wear its ring and tape and the rest go quiet" — Who's in it Marta: her cards have `data-match` and the tape `MARTA VEGA · wants`; others are quiet.
  - "the relation tape wins over the highlight tape; there is only ever one tape" — `querySelectorAll('[data-tape]')` per card ≤ 1 (give the tape `data-tape`).
  - "the selected card never goes quiet".
  - "None shows no ring, tape-from-highlight or quiet card".
  - "Fold the rest turns each run of non-matches into one stub; a stub opens its run; the selected scene never folds" — stub `aria-label` `Show 2 folded scenes, 3 to 4`; click → `onUnfold('scene-3')`; with `unfolded` containing it, the cards render.
  - "roving order skips folded scenes" — → from the card before a stub lands on the card after it.
  - "the header slot renders inside the scroll area, before the acts".

**Implementation notes:**
- Per card: `match = highlight.kind !== 'none' ? highlightTape(model, id, highlight) : null`; `tape = relation ?? match`; `ring = match ? HIGHLIGHT_TONE[highlight.kind] : null`; `quiet = highlight.kind !== 'none' && !match && id !== selectedId`. Literal ring class map like `TONE_BG` (`ring-tr-sky`, `ring-tr-amber`, `ring-tr-ledger-secret-ink`, `ring-tr-accent-ink`). Rings and the selected inset ring compose (both are box-shadow rings); the focus ring stays an outline.
- Quiet: drop `style={RULED}` and `shadow-card-board`, add `bg-tr-surface-sunken shadow-none`. Never an opacity class.
- Fold (the `keep` rule is "matches or is selected"; with None, matches = has a story note):

```ts
type BoardItem =
  | { type: 'card'; scene: Scene }
  | { type: 'stub'; key: string; scenes: Scene[] }

function foldRuns(
  scenes: readonly Scene[],
  keep: (sceneId: string) => boolean,
  unfolded: ReadonlySet<string>,
): BoardItem[] {
  const items: BoardItem[] = []
  let run: Scene[] = []
  const flush = () => {
    if (run.length === 0) return
    if (unfolded.has(run[0].id))
      items.push(...run.map((scene) => ({ type: 'card' as const, scene })))
    else items.push({ type: 'stub', key: run[0].id, scenes: run })
    run = []
  }
  for (const scene of scenes) {
    if (keep(scene.id)) {
      flush()
      items.push({ type: 'card', scene })
    } else run.push(scene)
  }
  flush()
  return items
}
```

  Without `fold`, every scene is a card. `rendered` (the roving order) now = the card items of every open act.
- Stub: `<button type="button" aria-label="Show {n} folded scene(s), {a} to {b}">` (`w-10 h-card-board-h rounded-[4px] border border-dashed border-tr-border-strong text-11 text-tr-text-primary`, vertical number range). Stubs are ordinary buttons, not part of the roving order.
- `header` renders as `<div className="sticky top-0 z-10 -mx-5 -mt-5 mb-4 bg-tr-surface-page px-5 py-2">{header}</div>` inside the scroll container, before the act list (Phase 3 adds the chart under it).

**Commands:** `(cd apps/web && npx vitest run src/plan/Board.test.tsx src/plan/BoardCard.test.tsx)`, `npx tsc -b`, eslint + prettier.

**Commit:** `plan: ring, tape and fold the board under a highlight`

---

### Task 11: Wire highlights, keys and the Episode view; retire Story Layers

**PR:** T3.6 · **Depends on:** 5, 8, 9, 10 · **e2e:** yes

**Files:** create `apps/web/src/plan/usePlanKeys.ts`, `usePlanKeys.test.ts`; modify `PlanScreen.tsx`, `PlanScreen.test.tsx`, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/tokens.expected.ts`, `apps/web/src/dev/TokensPage.tsx`, `apps/web/e2e/plan.spec.ts`; delete `StoryLayersPanel.tsx`, `StoryLayersPanel.test.tsx`, `panel/EpisodePanel.tsx`, `panel/EpisodePanel.test.tsx`.

**Interfaces:**
- Consumes: Tasks 7–10; `saveLedgerView` (`ledger/viewPreference`), `navigateToMode`.
- Produces:

```ts
// usePlanKeys.ts
export interface PlanKeyHandlers {
  onStep: (dir: 1 | -1) => void        // j / k
  onNext: (dir: 1 | -1) => void        // n / N (Shift+n)
  onEpisodeView: () => void            // Escape outside the inspector
  onOpenInWrite: () => void            // ⌘↵ / Ctrl+↵
}
/** Plan's document shortcuts (spec §4.10). Ignores text fields, selects,
 * contentEditable, anything inside a <dialog>, already-handled events and
 * other modifier chords. Esc inside the inspector is the panel's (Task 5). */
export function usePlanKeys(handlers: PlanKeyHandlers): void
```

- `PlanScreen` state: `highlight` (`NO_HIGHLIGHT`), `fold` (false), `unfolded` (`Set<string>`, cleared on every highlight or fold change). Handlers:
  - `changeHighlight(h)` → set, clear `unfolded`, `announce(highlightAnnouncement(model, h))`.
  - `toggleFold()` → announce "Folded the scenes that don't match." / "Unfolded.".
  - `next(dir)` → `nextMatchId(model, selectedId, dir, highlight)`; `null` → announce "No story notes left." (None) / "Nothing else matches."; else `selectScene(id)` and, when a card had focus, focus the new card next frame.
  - `step(dir)` → the neighbour in `model.order` (clamped; from nothing: first for J, last for K), same focus rule.
  - `showEpisode()` → `setSelection(null)`, `announce('Episode view')`; when focus was inside the inspector, focus the Episode view's `h2` next frame. ScenePanel's "← Episode" uses it too.
  - `openSelectedInWrite()` → `openInWrite(selectedId)` when a scene is selected (goes through the leave guard).
  - `openLedgerThreads()` → `leave.confirmLeave().then((ok) => { if (!ok) return; saveLedgerView(activeProjectId, 'threads'); navigateToMode('Ledger') })`. (`navigateToMode` passes the now-empty guard.)
- Layout: the row is `Board` + panel only. `Board` gets `header={<HighlightBar …/>}`, `highlight`, `fold`, `unfolded`, `onUnfold`. The nothing-selected panel is `<EpisodeView …/>`.

**Tests:**
- `usePlanKeys.test.ts` (`renderHook`, `fireEvent.keyDown(target, …)`):
  - "j/k step, n/N go to the next and previous match, ⌘↵ and Ctrl+↵ open in Write, Esc shows the episode".
  - "ignores fields, selects, contentEditable, dialogs, handled events and modifier chords" — an `<input>`, `<textarea>`, `<select>`, a `contenteditable` div, a button inside `<dialog open>`, an event with `defaultPrevented`, and `Alt+j` / `Ctrl+j` reach no handler.
  - "leaves Esc inside the inspector to the panel".
- `PlanScreen.test.tsx`:
  - Rewrite the layout test as "fills the height the shell leaves; the board and the panel scroll on their own; Story Layers is gone" — `queryByTestId('story-layers-panel')` null; no element has class `w-panel-story-layers` or `w-card-scene`.
  - "Esc from the board shows the Episode view and announces it".
  - "choosing a highlight announces it; highlights, fold and keys make no request" — after clicking every highlight, Fold, pressing n/N/j/k/Esc: `suggestInstructionsMock`, `createChangeSetMock`, `patchProjectMock` not called; `getProjectMock` called once.
  - "N selects the next match and announces the scene".
  - "a Who's in it chip in the Episode view switches the board highlight" — the bar's Who's in it is pressed and the select shows that character.
  - "⌘↵ with unsaved edits asks before opening Write".
  - "See all in Ledger → Threads asks first with drafts, then saves the Threads view" (`localStorage` `tr.ledger.view.proj-longpour` = `threads` only after Discard and leave).
- Tokens: `tokens.test.ts` and `dev/TokensPage.test.tsx` pass unchanged after the removal (they compare `tokens.css` with `tokens.expected.ts` and `TokensPage`).
- e2e `plan.spec.ts` (append):

```ts
test("Who's in it rings the matching cards and N selects the next match (T3.6)", async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  const scene1 = page.getByTestId('scene-card-scene-1')
  await scene1.click()
  const bar = page.getByRole('group', { name: 'Highlight' })
  await bar.getByRole('button', { name: /Who's in it/ }).click()
  await page.getByLabel('Character to highlight').selectOption('char-marta')
  await expect(page.getByTestId('plan-live')).toContainText(
    'Highlight: Marta Vega.',
  )
  // scene-1 records Marta's want in the fixture.
  await expect(scene1).toHaveAttribute('data-match', 'true')

  await scene1.focus() // keys are ignored while the select has focus
  await page.keyboard.press('n')
  const selected = page.locator('[data-scene-card][aria-pressed="true"]')
  await expect(selected).not.toHaveAttribute('data-testid', 'scene-card-scene-1')
  await expect(selected).toHaveAttribute('data-match', 'true')
})

test('Esc shows the Episode view, and Story Layers is gone (T3.6)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  await expect(page.getByTestId('story-layers-panel')).toHaveCount(0)
  await page.getByTestId('scene-card-scene-2').click()
  await page.keyboard.press('Escape')

  const panel = page.getByTestId('inspector')
  await expect(panel.locator('h2').first()).toContainText('Last Call')
  await expect(panel.getByTestId('lock-toggle')).toHaveCount(0)
  await expect(page.getByTestId('scene-card-scene-2')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await panel
    .locator('#plan-section-ep-cast')
    .getByRole('button', { name: /Dan Vega/ })
    .click()
  await expect(
    page
      .getByRole('group', { name: 'Highlight' })
      .getByRole('button', { name: /Who's in it/ }),
  ).toHaveAttribute('aria-pressed', 'true')
})
```

**Implementation notes:**
- `usePlanKeys`:

```ts
export function usePlanKeys(handlers: PlanKeyHandlers): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null
      if (
        event.defaultPrevented ||
        target?.closest('input, textarea, select, [contenteditable="true"], dialog')
      )
        return
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        handlers.onOpenInWrite()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const run = (fn: () => void) => {
        event.preventDefault()
        fn()
      }
      if (event.key === 'j') run(() => handlers.onStep(1))
      else if (event.key === 'k') run(() => handlers.onStep(-1))
      else if (event.key === 'n') run(() => handlers.onNext(1))
      else if (event.key === 'N') run(() => handlers.onNext(-1))
      else if (event.key === 'Escape' && !target?.closest('[data-testid="inspector"]'))
        run(handlers.onEpisodeView)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [handlers])
}
```

  `PlanScreen` passes a fresh object each render; re-subscribing a `document` listener per render is cheap and keeps the handlers current with no refs.
- Story Layers out: delete the component and its test, drop its import and `<StoryLayersPanel>` from the row; `useCollapsedActs` now feeds only `Board`.
- Tokens: in `tokens.css` delete `--tr-panel-story-layers: 232px;`, `--tr-card-scene: 214px;` and their `@theme` aliases `--spacing-panel-story-layers`, `--spacing-card-scene`; delete the two entries in `tokens.expected.ts` and the two `TokensPage.tsx` rows. Then `git grep -n "story-layers\|card-scene\|StoryLayers\|EpisodePanel" -- apps/web` must return only e2e `toHaveCount(0)` lines and this test's negative assertions.
- Run the T3.6 e2e set: `plan.spec.ts plan-notes.spec.ts review.spec.ts recipes.spec.ts newproject-resume.spec.ts`, then the whole suite once; only the six known Write-mode baseline failures may fail.

**Commands:** `(cd apps/web && npx vitest run)`, `npx tsc -b`, `(cd apps/web && npx eslint .)`, `(cd apps/web && npx prettier --check .)`, then e2e.

**Commit:** `plan: wire highlights and the Episode view, retire Story Layers`

---

### Task 12: T3.6 docs

**PR:** T3.6 · **Depends on:** 6, 11 · **e2e:** no

**Files:** modify `docs/tableread-ui-spec.md`, `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md`, `docs/narrative-sidekick-design-doc.md` (one line).

- UI spec §1 layout comment: drop "Story Layers 232px" and the card-scene mention; Plan reads "board cards reuse `--tr-card-board-w/h`; scene panel 400px (`--tr-panel-plan`)".
- UI spec §5: layout line → two columns (board · 400px panel) that scroll on their own; remove the **Story Layers panel** bullet and the **Connector lines** bullet (the chart's arcs replace it in T3.7); add **Highlight bar** (sticky; six highlights with neutral "scenes that match" counts; rings in the highlight's hue + one tape; quiet non-matches at full opacity and AA text; Who's in it from dialogue cues and recorded wants; Fold the rest stubs; Next note / Next match); extend the keyboard bullet (J/K, N/Shift+N, Esc → Episode view, ⌘↵ Open in Write; ignored in fields and dialogs); replace the _Nothing selected_ state with the **Episode view** (title, logline, format line, Acts side by side with share and act-out learns/feels, open Threads with See all in Ledger, The secret with Highlight on the board, Notes by scene with From the import closed, Who's in it chips, Premise closed with the structural footer); add the idea-born state (one quiet line per section, highlights read 0).
- Build plan T3.6 `_Accept:_` → what shipped (Vitest: highlight tapes/matchers/counts/cast/next match/announcements, bar, Episode view sections and quiet lines, rings/quiet/fold on the board, `usePlanKeys`, no request on highlight/fold/keys; e2e: Who's in it + N, Esc → Episode view without `story-layers-panel`, recipes unchanged).
- Test plan: "Plan highlights and Episode view (T3.6)" sentences in the Vitest and E2E paragraphs.
- Handoff decision log row: "2026-10-13: Story Layers retired (with `--tr-panel-story-layers` and `--tr-card-scene`); the board's highlight bar asks story questions with rings and tapes at full contrast, never dimming; nothing selected is the Episode view; J/K, N, Esc and ⌘↵ outside text fields. Highlight and fold are per visit, not stored." | "Story Layers duplicated the board and its Bible node was a dead end (spec §2)".
- Design doc line ~162 (Story Layers panel): append "(Plan redesign 2026-10-13: retired; its jobs moved to the act headers, the Episode view and the highlight bar — `docs/superpowers/specs/2026-10-13-plan-redesign-design.md`)".

**Commit:** `docs: plan highlights, Episode view and Story Layers retirement (T3.6)`

---

## Self-check before each PR

- [ ] `(cd apps/web && npx vitest run)`, `npx tsc -b`, `npx eslint .`, `npx prettier --check .` clean.
- [ ] The PR's e2e set passes (only the six known Write-mode baseline failures elsewhere).
- [ ] `git grep -n "DESIGN-GAP" -- apps/web/src/plan` shows none, or each names a task id.
- [ ] No hex, no new `--tr-*` token, no `opacity-` class on a Plan card, no `suggestInstructions` call outside the Suggest… button.
- [ ] `git status --short` shows no `playwright.local.config.ts` and no `apps/api/.venv`.
- [ ] PR description quotes the build-plan acceptance lines with pass/fail and flags no new dependency.
