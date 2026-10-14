# Plan Redesign — Phase 1 (T3.3 Panel restructure, T3.4 Notes and drafts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Plan's 296px stretch-to-the-board inspector with a 400px, independently scrolling scene panel that leads with what steers Next Beat (T3.3), then show each scene's notes with Dismiss and Undo and keep per-field drafts with a leave-Plan dialog (T3.4), with no contract, endpoint or LLM change.
**Architecture:** Every derivation (note kind and text, linkify, place title, board order, landmarks, cast, threads, secret, facts) is a pure function in `apps/web/src/plan/story.ts`, and the new panel in `apps/web/src/plan/panel/` derives its sections in render from the `project`, `ledger` and `openFlags` that `PlanScreen` already owns. Every field reads and writes one in-memory draft store that `PlanScreen` provides through context, and saves still go through `useProjectPatch` (one direct-edit PATCH, one snapshot, optimistic with rollback). The `PlanSelection` model (`null | scene | beat`) is unchanged, so Phase 2's Episode view, keys and roving focus land on top of it.
**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 4 (`--tr-*` tokens only), Vitest + Testing Library (jsdom 29), Playwright e2e against the real FastAPI app with a seeded temp DB and `MockLlmClient`; types from `packages/contract` (`contract`).
**Spec:** docs/superpowers/specs/2026-10-13-plan-redesign-design.md

## Global Constraints

- One new token only: `--tr-panel-plan: 400px` (owner-approved). `--tr-panel-inspector` stays (the import board's reading panel uses it). `--tr-panel-story-layers` and `--tr-card-scene` stay until Phase 2. No other new tokens, no hex outside `:root`.
- Tokens only (`--tr-*`); no hardcoded colours or spacing in components (the Tailwind 4px scale is allowed).
- No contract change, no new endpoint, no new LLM operation, no PROMPT_VERSION bump in Phase 1.
- All derivations are pure client functions in one module, `apps/web/src/plan/story.ts`, unit-tested.
- Rule 4: every edit stays a single direct-edit PATCH that snapshots once. Act select: immediate PATCH, one snapshot, no AI.
- Server is the source of truth; optimistic updates roll back on 4xx/5xx (`useProjectPatch`, unchanged).
- Rule 8 / decision 5: nothing in Plan calls a model on mount, select, hover, focus or highlight change. The A4 chips sit behind an explicit **Suggest…** button.
- No new dependencies.
- Heuristics are labelled: cast from dialogue cues is always marked "from dialogue cues"; the flag-kind text match carries a `ponytail:` note until a `flag.kind` field exists.
- Story Layers stays in Phase 1 (removed in T3.6).
- Storyline is hidden while `episode.storylines` is empty.
- Panel: `data-testid="inspector"`, 400px. Sections are native `<details>`, open/closed persisted per viewer. Details is closed by default.
- Locked banner: "Locked — unlock to edit. Review will never change this scene."
- Facts established here: active and pending only, "Show n retired".
- Drafts: leaving Plan with drafts opens a native `<dialog>` (Stay in Plan / Discard and leave). No blocking guard inside Plan, no silent discard.
- Kept test ids: `act-frame-{n}`, `scene-card-{id}` (+ `data-locked`), `consistency-flag-badge`, `inspector`, `lock-toggle`, combobox "Act", `mode-switcher`. `beat-card-{id}` moves to the beat row in the panel. The lock-and-regenerate recipe (`scene-card-scene-3`, `lock-toggle`) is unchanged.
- No text below 11px; identifying text meets AA; visible focus ring (2px `--tr-sky`).
- `// DESIGN-GAP(T3.x): …` must reference a task id (CI `scripts/check_design_gaps.py`). This plan adds none.
- Commits: `area: imperative summary`, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tests beside code (`foo.test.ts[x]`); e2e in `apps/web/e2e/`.
- Never `git stash`, never `make`, never `make evals`, never call the Anthropic API.
- Out of scope (later plans; do not build, do not block): index cards, act headers, roving tabindex, live region (T3.5); highlights, Episode view, Story Layers removal, J/K/N keys (T3.6); episode chart and order check (T3.7); insert drag (T3.8); Draft a fix (T3.9).

## Review Focus

1. **Missing or empty story data.** The e2e fixture after any save (PATCH returns the raw stored doc: no `secrets`, `timelineAnchors`, `relationshipStates`; motivations without `statedObjective`/`concealed`; characters without `aliases`) and idea-born projects (no threads, secret, overview or anchors; scenes without beats, motivations or facts) must not crash: one quiet line per empty section, jump counts 0, no landmark callout, no time-jump divider, no Also-in-the-scene line, scene-6 reads "No beats yet." *Pinned by:* Task 1 (`story.test.ts` "missing story data"), Task 5 ("reads a stored motivation without statedObjective / concealed"), Task 9 (ScenePanel "missing story keys and an empty scene render quiet, with zero counts"), Task 14 e2e (save, then keep using the panel).
2. **Dismiss moves the head.** `dismissConsistencyFlag` makes a snapshot but returns only the flag, so Plan refetches the project and flags; a field save right after a dismiss succeeds; Undo uses If-Match = the head after the dismiss, brings the note back without a reload and keeps drafts; Undo after another edit fails with "Plan changed since" and changes nothing; a dismiss 409 shows `staleHeadMessage`. *Pinned by:* Task 13 (`useDismissNote.test.ts`: refetch, undo If-Match, both 409 cases), Task 14 (PlanScreen "a field save right after a dismiss sends the head the dismiss left", "Dismiss refetches the head and flags, and Undo brings the note back", e2e "saving still works after").
3. **Draft lifecycle.** A draft survives a scene switch (text restored, header chip, card dot); a failed save keeps the text dirty; typing back to the saved value is clean; every way out of Plan with drafts asks first (mode tabs, ⌘1–4, Open in Write, card double-click, Open beat in Write, Ledger links, shell Undo and restore, Open Review excluding its own field); Stay keeps the drafts; Discard and leave navigates with no `beforeunload` prompt; with no drafts nothing prompts. *Pinned by:* Task 2 (store), Task 4 (PlanField failed save, typing back), Task 9 (unsaved chip), Task 10 (PlanScreen "a failed save keeps what the writer typed"), Task 12 (guarded navigations, `useLeaveGuard` no-drafts / Stay / Discard), Task 14 (unsaved dot, Write tab + Stay, card double-click, shell Undo, Open Review own-field and other-field cases, e2e Discard with no native prompt).
4. **Note text from the real server.** Every `[snake_case]` prefix is an import note and never shown raw; `[model_unassigned] … source lines 680-688 …` reads "The import couldn't place script lines 680–688 and kept them in beat 7.1."; "…has no ACT THREE break…" is `act_split`; "Scene 12" links `scene-12` by id; a missing scene id or fact id is plain text ("a Ledger fact"), never a dead link or raw id; a flag on a beat that no longer exists is dropped. *Pinned by:* Task 1 (`flagKind` per code, `importNoteText`, `linkifyNote`, `notesForScene` "gone-beat"), Task 13 (NotesStrip: no `[code]`, no raw fact id, plain "a Ledger fact").
5. **Locked scene, and Suggest… gating.** On a scene or episode lock every field is read-only with no Save, Discard, footer or Suggest…, the Act select is disabled, the banner shows, beat rows read the cascaded "Locked"; the Scene, Beat and Script locks, notes and Dismiss, Show beat, Open in Write and section toggles still work. Suggest… appears only on an empty, unlocked What happens and makes zero requests on mount, select, focus or typing; a late reply for another scene is not shown. *Pinned by:* Task 4 (locked PlanField; Suggest… no request on render/focus/typing, stale-key reply), Task 5 and Task 6 (locked sections), Task 8 (cascaded Locked; locks still toggle on a read-only beat), Task 9 (banner, Act disabled, lock switch live, no suggest on a scene change), Task 10 (no suggest on focus), Task 14 ("a locked scene still shows its notes, and Dismiss stays available").

---

## How to run things in this worktree

Every command in this plan starts from the worktree root. Run each line as its own shell call, or keep the `( … )` subshells as written, so the next line still starts at the root.

- Web unit tests: `cd apps/web && npx vitest run <path>`
- Typecheck: `cd apps/web && npx tsc -b`
- Lint: `cd apps/web && npx eslint .`
- Format: `cd apps/web && npx prettier --check .` (run `npx prettier --write <files you touched>` first)
- API tests (only if Python is touched; Phase 1 touches none): `cd apps/api && PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/pytest -p no:cacheprovider -q`
- E2E: ports `E2E_API_PORT=8100 E2E_WEB_PORT=5180`, a TEMPORARY Playwright config that points `launchOptions.executablePath` at the local headless shell, and a TEMPORARY venv symlink. Both temporary paths are deleted before any lint or commit:

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
(cd apps/web && E2E_API_PORT=8100 E2E_WEB_PORT=5180 npx playwright test --config=e2e/playwright.local.config.ts <specs>)   # <specs>: the spec files the task names
rm apps/web/e2e/playwright.local.config.ts apps/api/.venv
git status --short   # neither temporary path may appear
```

- Some e2e failures already exist on `origin/main`. Before blaming a change, run the same spec on a baseline: `git worktree add <scratchpad>/wt-baseline origin/main`, the same temporary config and symlink there, then `git worktree remove` it. Never `git stash`. On 2026-10-13 the baseline failures were six Write-mode tests: `error-states.spec.ts` (dropped connection; 503 on accept), `locked-beat.spec.ts`, `quiet-ai.spec.ts` and `write.spec.ts` (both tests).
- **This plan's code was dry-run.** Every task below was applied, in order, to a scratch copy of this worktree. After Tasks 9, 11 and 14 the whole `npx vitest run` (721 tests at Task 14), `npx tsc -b`, `npx eslint .` (no errors) and `npx prettier --check .` were clean; after Task 3, the token and `src/plan` tests, `tsc` and Prettier were. E2E: `plan.spec.ts` after Task 3; `plan`, `review`, `recipes` and `newproject-resume` after Task 11; the whole suite after Task 14, where only the six baseline failures above failed. The code blocks are Prettier-formatted: paste them as written.

## Codebase facts the tasks rely on

- `PlanScreen` owns `project`, `ledger` (all statuses, fetched once) and `openFlags` (`status=open`, merged after structural saves). `useProjectPatch(pid, project, setProject, mergeNewFlags)` runs one mutation at a time, sets the optimistic doc, PATCHes with `expectedHeadSnapshotId`, adopts the server doc and rolls back byte-for-byte on error. `patch(ops, next)` resolves `true` only when the server accepted it.
- `PATCH /projects/{pid}` returns the raw stored doc: defaulted keys can be missing (`episode.secrets`, `timelineAnchors`, `relationshipStates`, `motivation.statedObjective`/`concealed`, `character.aliases`). Read them with `?? []` / `?? ''` / `?? false`.
- `POST /consistency-flags/{fid}/dismiss` makes a snapshot and moves the head but returns only the flag. `POST /projects/{pid}/undo` restores it.
- Import notes are flags whose explanation starts with a `[snake_case]` repair code. Story notes call scenes "Scene 12", meaning the id `scene-12`, and facts by raw id.
- `MockLlmClient.scan_consistency` always returns one tension note on `scene-5`, so a "Save field only" on any What happens creates one.
- Fixture `proj-longpour`: 6 scenes; `beat-1-2` is locked and scriptLocked; scene-6 has no beats; `episode.storylines` has 2 entries (so Details shows the disabled Storyline select in e2e); no flags, threads, secrets, anchors or relationship states.
- jsdom 29: a `<details>` `toggle` fires asynchronously (`waitFor` the callback) and only when `open` changes; a closed `<details>` does not hide its contents from RTL queries (assert `details.open`); `HTMLDialogElement.showModal`/`close` are missing (tests stub them); `src/test-setup.ts` installs a no-op `scrollIntoView`.
- `eslint-plugin-react-hooks` 7.1.1 (`recommended`) errors on reading `ref.current` during render (`react-hooks/refs`); the draft store therefore uses `useSyncExternalStore`.
- `PlanField` shows its visible label in a `<p>`, never a `<label>`, and names the control with `aria-label`. Beat fields are named "Beat n.m: What happens", so the scene's "What happens" stays unique for `getByLabel` in `plan.spec.ts` and `review.spec.ts`.
- `lock-toggle` is the onboarding recipe's first-match target: only the scene toggle keeps it; beat toggles use `beat-lock-toggle-{id}` / `script-lock-toggle-{id}`.

## Decisions already made (spec-consistent; no DESIGN-GAP)

1. Plain (non-structural) fields get **Discard** next to Save, because drafts persist.
2. Shell Undo and history restore (which reload the page) use the same leave dialog when drafts exist.
3. Suggest… keeps today's rule: only on an empty, unlocked What happens.
4. "Scene n" in notes resolves to id `scene-n` (what the model was shown), not to the current position.
5. Beat cards leave the board in T3.3 (the ladder takes `beat-card-{id}`), not T3.5.
6. Keyboard shortcuts (J/K, N, Esc, ⌘↵) wait for T3.5/T3.6. Phase 1 has ‹ › buttons and the jump bar only.
7. A locked field shows the server value, not its draft; the draft is kept and comes back on unlock.
8. A stale `?scene=` id shows the nothing-selected panel (today it shows no inspector at all).

## File Structure

`src/` = `apps/web/src/`. New panel files live in `src/plan/panel/`, except `src/plan/story.ts`.

| File | Status | Task | Responsibility |
|---|---|---|---|
| `src/plan/story.ts` (+ `story.test.ts`) | new | 1 | Every pure Phase 1 derivation: flag kind, notes per scene, import note text, linkify, place title, board order, landmarks, cast from dialogue, threads, secrets, facts split |
| `src/plan/panel/usePlanDrafts.ts` (+ `.test.tsx`) | new | 2 | In-memory draft store (context), `useFieldDraft`, `draftKey` |
| `src/plan/panel/testDrafts.tsx` | new | 2 | Test-only `WithDrafts` wrapper with a real store |
| `src/styles/tokens.css`, `tokens.expected.ts`, `src/dev/TokensPage.tsx` | modify | 3 | `--tr-panel-plan: 400px`, `@theme` alias `--spacing-panel-plan`, TokensPage sample |
| `src/plan/StoryLayersPanel.tsx`, `src/plan/Inspector.tsx` | modify | 3 | Root/aside class: `overflow-y-auto` |
| `src/plan/panel/PlanField.tsx` (+ `.test.tsx`) | new | 4 | One editable field: draft-backed, auto-grow, Save/Discard or the structural footer, optional Suggest… |
| `src/plan/panel/WhatTheSceneDoes.tsx` (+ `.test.tsx`) | new | 5 | Section 1: What happens, landmark callout, The audience |
| `src/plan/panel/WhoWantsWhat.tsx` (+ `.test.tsx`) | new | 5 | Section 2: motivation cards, "Also in the scene … · from dialogue cues" |
| `src/plan/panel/useSectionOpenState.ts` (+ `.test.ts`) | new | 6 | Persisted open/closed per section (`localStorage` `tr.plan.sections.v1`) |
| `src/plan/panel/PanelSection.tsx` (+ `.test.tsx`) | new | 6 | Native `<details>` wrapper; the scroll-spy/jump DOM contract |
| `src/plan/panel/DetailsSection.tsx` (+ `.test.tsx`) | new | 6 | Section 5: Location, Time, Social situation (+ disabled Storyline only when storylines exist) |
| `src/plan/panel/WhatItTouches.tsx` (+ `.test.tsx`) | new | 7 | Section 3: threads, secret irony callout, status-filtered facts, relationship moments |
| `src/plan/panel/BeatLadder.tsx` (+ `.test.tsx`) | new | 8 | Section 4: beat rows (`beat-card-{id}`), expanded editing, Beat + Script locks, Script disclosure, time jump |
| `src/plan/LockToggle.tsx` | modify | 8 | Optional `testId` prop (default `lock-toggle`) |
| `src/plan/panel/PanelHeader.tsx` | new | 9 | Sticky header content: ← Episode, Scene n of N ‹ ›, title + lock glyph + unsaved chip, jump bar |
| `src/plan/panel/ScenePanel.tsx` (+ `.test.tsx`, covers PanelHeader) | new | 9 | The 400px scroll container (`data-testid="inspector"`): header, slug, controls, banner, notes slot, sections, scroll-spy |
| `src/plan/panel/EpisodePanel.tsx` (+ `.test.tsx`) | new | 9 | Nothing-selected view (premises) until T3.6's Episode view |
| `src/plan/PlanScreen.tsx` (+ `.test.tsx`) | modify | 3 (row class + one test), 10 (T3.3 wiring), 14 (T3.4 wiring) | Owner of state, handlers and the draft store |
| `src/plan/Board.tsx` (+ `.test.tsx`) | modify | 3 (root class), 10 (drop `onSelectBeat`), 14 (`draftSceneIds`) | |
| `src/plan/SceneCard.tsx` | modify | 10 (no chevron/BeatCard; beat selection marks the card), 14 (`unsaved` dot) | |
| `src/plan/planTree.test.ts` | modify | 10 | Retarget the deleted `InspectorProps` type import |
| `src/plan/Inspector.tsx`, `Inspector.test.tsx`, `BeatCard.tsx` | delete | 10 | Replaced by `panel/*` (coverage ported first) |
| `apps/web/e2e/plan.spec.ts` | modify | 10 | Beat rows in the panel, `lock-toggle`, Details, Beat lock persists |
| `docs/tableread-ui-spec.md` | modify | 3 (§1 token line), 11 (§1 final wording, §5 rewrite) | |
| `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md` | modify | 11 | T3.3–T3.9 entries, test-plan sentences, decision-log row |
| `src/shell/modeNavigation.ts` (+ `.test.ts`) | modify | 12 | `setLeaveGuard`, guarded navigations, `navigateToLedgerFact` |
| `src/plan/panel/useLeaveGuard.ts` (+ `.test.tsx`) | new | 12 | Leave confirmation state, guard registration, `beforeunload` |
| `src/plan/panel/LeavePlanDialog.tsx` (+ `.test.tsx`) | new | 12 | Native `<dialog>`: Stay in Plan / Discard and leave |
| `src/plan/panel/NotesStrip.tsx` (+ `.test.tsx`) | new | 13 | Notes strip: collapsed/expanded, note cards, From the import group |
| `src/plan/panel/useDismissNote.ts` (+ `.test.ts`) | new | 13 | Dismiss + refetch head/flags + Undo via `undoProject` |
| `apps/web/e2e/plan-notes.spec.ts` | new | 14 | Notes + drafts journeys |

Untouched: `planTree.ts` (its builders, `isBeatEffectivelyLocked`, `characterName`, `actLabel`, `actNumbersForFormat`, `affectedFacts` are reused), `useProjectPatch.ts`, `flaggedScenes.ts`, `Card.tsx`, `Chip.tsx`, `GuidedSetup*`, `write/SuggestionChips.tsx`, `api/client.ts`, everything in `packages/contract` and `apps/api`.

## PR boundaries and order

| PR | Branch | Tasks | Ships |
|---|---|---|---|
| **T3.3 Panel restructure** | `feat/plan-panel`, cut from `feat/plan-redesign` (spec + this plan) | 1–11 | Fixed-height layout, 400px panel, sticky header + jump bar + scroll-spy, persisted sections, auto-grow fields with per-field drafts and the unsaved chip, Who wants what, What it touches, beat ladder with `beat.locked`, Suggest…, docs |
| **T3.4 Notes and drafts** | `feat/plan-notes-drafts` | 12–14 | Leave dialog + `beforeunload`, unsaved dot, notes strip with linkify, quoted fact, Dismiss/Undo, From the import |

Why `story.ts` (Task 1) and the draft store (Task 2) land in T3.3: spec §6 wants one derivation module and T3.3's sections need it; the new panel no longer remounts per scene, so its fields need a single draft owner from day one. The only interim effect of T3.3 alone: drafts persist across scene switches, but leaving Plan still drops them silently (today's behaviour) until T3.4.

Dependencies (serial order for one executor: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 | 12, 13, 14):

```
T3.3:  Task 1 ─┬──────────────────► Task 5 ─┐
       Task 2 ─┼─► Task 4 ─┬─► Task 6 ─────┤
       Task 3 ─┘           ├─► Task 8 ─────┼─► Task 9 ─► Task 10 ─► Task 11
       Task 1 ─────────────┴─► Task 7 ─────┘
T3.4:  Task 12 (needs Task 2) ─┐
       Task 13 (needs Task 1) ─┴─► Task 14 (needs Task 10)
```

- Tasks 1, 2 and 3 have no dependencies. After Task 4, Tasks 5, 6, 7 and 8 are independent of each other (Task 7 needs only Task 1). Task 9 needs Tasks 1–8.
- **T3.4's helper tasks run in parallel with T3.3.** Tasks 12 and 13 touch no file a T3.3 task touches (`modeNavigation.ts` and new `panel/` files only) and need only Tasks 2 and 1. Cut `feat/plan-notes-drafts` from `feat/plan-panel` right after Task 2's commit and build Tasks 12 and 13 there while Tasks 3–11 proceed. Task 14 edits Task 10's `PlanScreen.tsx`, `PlanScreen.test.tsx`, `SceneCard.tsx` and `Board.tsx`, so rebase `feat/plan-notes-drafts` onto `feat/plan-panel` (or onto `main` once T3.3 merges) before starting it.
- Shared files and the hunk each task owns: `PlanScreen.tsx`: Task 3 changes only the `<div className="flex">` row class; Task 10 rewrites the file (keeping that class); Task 14 adds the T3.4 wiring. `PlanScreen.test.tsx`: Task 3 adds one test; Task 10 rewrites the file (keeping that test); Task 14 extends it. `Board.tsx`: Task 3 root class; Task 10 removes `onSelectBeat`; Task 14 adds `draftSceneIds`. `SceneCard.tsx`: Task 10, then Task 14.

---

## T3.3 PR: Panel restructure (Tasks 1–11)

### Task 1: `story.ts`, the pure Phase 1 derivations

**PR:** T3.3 · **Depends on:** none

**Files:**
- Create `apps/web/src/plan/story.ts`
- Test `apps/web/src/plan/story.test.ts` (new)

**Interfaces:**
- Consumes: `planTree.affectedFacts(ledger: LedgerFact[], sceneId: string): LedgerFact[]`, `write/fountainFormat.parseFountainLines(scriptText: string): FountainLine[]`, contract types `Beat, Character, ConsistencyFlag, Episode, LedgerFact, Scene, Secret, StoryOverviewBeatItem, StoryThread`.
- Produces:
  - `type FlagKind = 'continuity' | 'act_split' | 'import'`
  - `flagKind(flag: ConsistencyFlag): FlagKind`
  - `interface PlanNote { flag: ConsistencyFlag; kind: FlagKind; beat: Beat | null }`
  - `notesForScene(flags: readonly ConsistencyFlag[], scene: Scene): PlanNote[]`
  - `importNoteText(flag: ConsistencyFlag, beatLabel: string | null): string`
  - `type NoteSegment = { type: 'text'; text } | { type: 'scene'; text; sceneId } | { type: 'fact'; text: 'a Ledger fact'; factId }`
  - `linkifyNote(text: string, scenes: readonly Scene[], facts: readonly LedgerFact[]): NoteSegment[]`
  - `placeTitle(scene: Scene): string`
  - `boardOrder(scenes: readonly Scene[]): Scene[]`
  - `landmarksForScene(episode: Episode, scene: Scene): StoryOverviewBeatItem[]`
  - `castFromDialogue(scene: Scene, characters: readonly Character[]): Character[]`
  - `interface SceneThread { thread: StoryThread; role: 'sets_up' | 'pays_off'; otherSceneId: string | null }`
  - `threadsForScene(episode: Episode, sceneId: string): SceneThread[]`
  - `interface SceneSecret { secret: Secret; role: 'set' | 'out' | 'kept'; inTheDark: string[] }`
  - `secretsForScene(episode: Episode, sceneId: string, presentCharacterIds: ReadonlySet<string>): SceneSecret[]`
  - `factsForScene(ledger: readonly LedgerFact[], sceneId: string): { shown: LedgerFact[]; retired: LedgerFact[] }`

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/plan/story.test.ts`. It runs in the node environment (no DOM), and every sample text is generic or the repo's own mock or fixture wording.

```ts
import { describe, expect, it } from 'vitest'
import type {
  Beat,
  Character,
  ConsistencyFlag,
  Episode,
  LedgerFact,
  Scene,
  Secret,
  StoryOverviewBeatItem,
  StoryThread,
} from 'contract'
import {
  boardOrder,
  castFromDialogue,
  factsForScene,
  flagKind,
  importNoteText,
  landmarksForScene,
  linkifyNote,
  notesForScene,
  placeTitle,
  secretsForScene,
  threadsForScene,
} from './story'

function beat(id: string, index: number, overrides: Partial<Beat> = {}): Beat {
  return {
    id,
    index,
    locked: false,
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    scriptText: '',
    scriptLocked: false,
    ...overrides,
  }
}

function scene(
  id: string,
  index: number,
  overrides: Partial<Scene> = {},
): Scene {
  return {
    id,
    index,
    act: 1,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...overrides,
  }
}

function episode(scenes: Scene[], overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: '',
    seasonFunction: '',
    storylines: [],
    scenes,
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads: [],
    secrets: [],
    storyOverview: null,
    narrativeMap: null,
    structureChecks: [],
    ...overrides,
  }
}

function flag(overrides: Partial<ConsistencyFlag> = {}): ConsistencyFlag {
  return {
    id: 'flag-1',
    objectType: 'scene',
    objectId: 'scene-5',
    factId: null,
    explanation: 'The stakes here no longer match the ledger.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-1',
    ...overrides,
  }
}

function fact(
  id: string,
  sceneId: string,
  status: LedgerFact['status'],
): LedgerFact {
  return {
    id,
    fact: `Fact ${id}`,
    factType: 'state',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId,
      beatId: `beat-${sceneId}`,
      startLine: null,
      endLine: null,
      charStart: null,
      charEnd: null,
    },
    sourceText: '',
    knownBy: [],
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.9,
    status,
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
  }
}

function character(
  id: string,
  name: string,
  aliases: string[] = [],
): Character {
  return {
    id,
    name,
    locked: false,
    aliases,
    embodiment: '',
    presentation: '',
    hiding: '',
    traits: '',
    seriesArc: '',
    summary: '',
    bio: '',
  }
}

function thread(
  id: string,
  setupSceneId: string,
  payoffSceneId: string | null,
): StoryThread {
  return {
    id,
    label: id,
    summary: '',
    status: payoffSceneId ? 'paid_off' : 'open',
    ownerCharacterIds: [],
    setupSceneId,
    payoffSceneId,
    setupQuote: '',
    payoffQuote: '',
    setupBeatId: null,
    payoffBeatId: null,
    locked: false,
  }
}

function secret(overrides: Partial<Secret> = {}): Secret {
  return {
    id: 'secret-transfer',
    summary: 'Marta saw the transfer.',
    factId: null,
    holderCharacterIds: ['char-marta'],
    concealedFromCharacterIds: [],
    audienceKnows: true,
    establishedSceneId: 'scene-1',
    revealedSceneId: null,
    concealmentSceneIds: [],
    establishedQuote: '',
    revealedQuote: '',
    establishedBeatId: null,
    revealedBeatId: null,
    provenance: 'inferred',
    locked: false,
    ...overrides,
  }
}

function landmark(
  beatId: string,
  label: string,
  sceneId: string | null,
): StoryOverviewBeatItem {
  return { beatId, label, summary: `${label} summary`, sceneId, act: null }
}

const IMPORT_CODES = [
  'model_unassigned',
  'duplicate_start',
  'missing_initial_start',
  'empty_output',
  'no_valid_segments',
  'out_of_bounds_start',
  'no_beats_returned',
  'empty_beat_fields',
  'tool_markup',
  'unordered_segments',
  'segmentation_failed',
  'extraction_failed',
  'merge_proposal',
]

describe('flagKind', () => {
  it.each(IMPORT_CODES)('[%s] is an import note', (code) => {
    expect(
      flagKind(
        flag({
          explanation: `[${code}] The server repaired the scene segmentation; review the boundary.`,
        }),
      ),
    ).toBe('import')
  })

  it('reads an act-split note', () => {
    expect(
      flagKind(
        flag({
          explanation:
            'This scene plays like an act out, but the episode has no ACT THREE break before it.',
        }),
      ),
    ).toBe('act_split')
    expect(
      flagKind(
        flag({
          explanation: 'The act structure puts both reversals in one act.',
        }),
      ),
    ).toBe('act_split')
  })

  it('reads everything else as continuity', () => {
    expect(
      flagKind(
        flag({
          explanation:
            "The argument's stakes reference the bar as the money's hiding place, which is no longer true.",
        }),
      ),
    ).toBe('continuity')
    expect(
      flagKind(
        flag({
          explanation:
            'The cash box was last placed in "the office" (scene-2) but this scene places it in "the kitchen".',
        }),
      ),
    ).toBe('continuity')
  })
})

describe('notesForScene', () => {
  it('keeps open flags on the scene or its beats: story first, then import, each in beat order', () => {
    const s = scene('scene-5', 4, {
      beats: [beat('beat-5-1', 0), beat('beat-5-2', 1)],
    })
    const notes = notesForScene(
      [
        flag({
          id: 'import-b2',
          objectType: 'beat',
          objectId: 'beat-5-2',
          explanation: '[empty_beat_fields] The beat came back empty.',
        }),
        flag({ id: 'story-b2', objectType: 'beat', objectId: 'beat-5-2' }),
        flag({ id: 'story-scene' }),
        flag({
          id: 'import-b1',
          objectType: 'beat',
          objectId: 'beat-5-1',
          explanation: '[model_unassigned] The model marked source lines 1-4.',
        }),
        flag({ id: 'story-b1', objectType: 'beat', objectId: 'beat-5-1' }),
        flag({ id: 'other-scene', objectId: 'scene-4' }),
        flag({ id: 'gone-beat', objectType: 'beat', objectId: 'beat-5-9' }),
        flag({ id: 'dismissed', status: 'dismissed' }),
      ],
      s,
    )
    expect(notes.map((n) => n.flag.id)).toEqual([
      'story-scene',
      'story-b1',
      'story-b2',
      'import-b1',
      'import-b2',
    ])
    expect(notes[0].beat).toBeNull()
    expect(notes[1].beat?.id).toBe('beat-5-1')
    expect(notes.map((n) => n.kind)).toEqual([
      'continuity',
      'continuity',
      'continuity',
      'import',
      'import',
    ])
  })
})

describe('importNoteText', () => {
  const unassigned = flag({
    explanation:
      '[model_unassigned] The model marked source lines 680-688 as unassigned; the server preserved them in this beat. Review the boundary.',
  })

  it('says which script lines the import kept, and where', () => {
    expect(importNoteText(unassigned, '7.1')).toBe(
      "The import couldn't place script lines 680–688 and kept them in beat 7.1.",
    )
    expect(importNoteText(unassigned, null)).toBe(
      "The import couldn't place script lines 680–688 and kept them in this scene.",
    )
  })

  it('strips the code from any other import note', () => {
    expect(
      importNoteText(
        flag({
          explanation:
            '[no_beats_returned] The model returned no beats for this scene.',
        }),
        '2.1',
      ),
    ).toBe('The model returned no beats for this scene.')
  })
})

describe('linkifyNote', () => {
  const scenes = [scene('scene-3', 2), scene('scene-12', 11)]
  const facts = [fact('fact-ba9bd699f76c', 'scene-3', 'active')]

  it('links "Scene n" to the id scene-n, keeping the words as written', () => {
    expect(
      linkifyNote('Scene 12 says otherwise; see scene 3.', scenes, facts),
    ).toEqual([
      { type: 'scene', text: 'Scene 12', sceneId: 'scene-12' },
      { type: 'text', text: ' says otherwise; see ' },
      { type: 'scene', text: 'scene 3', sceneId: 'scene-3' },
      { type: 'text', text: '.' },
    ])
  })

  it('reads a raw scene id as "Scene n"', () => {
    expect(
      linkifyNote('Last placed in the office (scene-12).', scenes, facts),
    ).toEqual([
      { type: 'text', text: 'Last placed in the office (' },
      { type: 'scene', text: 'Scene 12', sceneId: 'scene-12' },
      { type: 'text', text: ').' },
    ])
  })

  it('leaves a scene that does not exist as plain text', () => {
    expect(
      linkifyNote('Scene 40 and scene-a1b2c3 both moved.', scenes, facts),
    ).toEqual([{ type: 'text', text: 'Scene 40 and scene-a1b2c3 both moved.' }])
  })

  it('turns a known fact id into "a Ledger fact" and never shows an unknown id', () => {
    expect(
      linkifyNote('fact-ba9bd699f76c contradicts fact-0000.', scenes, facts),
    ).toEqual([
      { type: 'fact', text: 'a Ledger fact', factId: 'fact-ba9bd699f76c' },
      { type: 'text', text: ' contradicts a Ledger fact.' },
    ])
  })
})

describe('placeTitle', () => {
  it.each([
    ['INT. THE LONG POUR - NIGHT', 'The Long Pour'],
    ['INT. THE LONG POUR - BASEMENT - NIGHT', 'The Long Pour - Basement'],
    ['EXT. HARBOR ST', 'Harbor St'],
    ["INT./EXT. MARTA'S CAR - MOVING - DAY", "Marta's Car - Moving"],
    ['I/E. DOCK - DAWN', 'Dock'],
    ['Int. The Long Pour - Night', 'The Long Pour'],
  ])('%s → %s', (location, title) => {
    expect(placeTitle(scene('scene-1', 0, { location }))).toBe(title)
  })

  it('falls back to the scene number', () => {
    expect(placeTitle(scene('scene-3', 2, { location: 'INT.' }))).toBe(
      'Scene 3',
    )
  })
})

describe('boardOrder', () => {
  it('orders by act, then index, like the board frames', () => {
    expect(
      boardOrder([
        scene('scene-4', 3, { act: 1 }),
        scene('scene-6', 5, { act: 4 }),
        scene('scene-1', 0, { act: 0 }),
        scene('scene-3', 2, { act: 1 }),
      ]).map((s) => s.id),
    ).toEqual(['scene-1', 'scene-3', 'scene-4', 'scene-6'])
  })
})

describe('landmarksForScene', () => {
  it('keeps labelled beat-sheet rows that sit in this scene', () => {
    const s = scene('scene-3', 2, { beats: [beat('beat-3-1', 0)] })
    const ep = episode([s], {
      storyOverview: {
        logline: '',
        outline: [],
        beatSheet: [
          landmark('beat-3-1', 'MIDPOINT', null),
          landmark('beat-9-1', 'CATALYST', 'scene-3'),
          landmark('beat-3-1', '', 'scene-3'),
          landmark('beat-4-1', 'BREAK INTO TWO', 'scene-4'),
        ],
        summary: '',
        provenance: 'inferred',
        locked: false,
      },
    })
    expect(landmarksForScene(ep, s).map((row) => row.label)).toEqual([
      'MIDPOINT',
      'CATALYST',
    ])
  })
})

describe('castFromDialogue', () => {
  it('matches dialogue cues to the bible by name, first name or alias, dropping the noise', () => {
    const characters = [
      character('char-marta', 'Marta Vega'),
      character('char-dan', 'Dan Vega'),
      character('char-reyes', 'Detective Ana Reyes', ['Reyes']),
      character('char-luz', 'Luz Vega'),
    ]
    const s = scene('scene-1', 0, {
      beats: [
        beat('beat-1-1', 0, {
          scriptText:
            "INT. THE LONG POUR - NIGHT\n\nDAN (CONT'D)\nWe're closed.\n\nCUT TO:\n\nBARTENDER\nLast call.\n\nBACK TO SCENE",
        }),
        beat('beat-1-2', 1, {
          scriptText:
            'REYES (V.O.)\nStay where you are.\n\nMARTA\nNot tonight.\n\nDAN\nFine.',
        }),
      ],
    })
    expect(castFromDialogue(s, characters).map((c) => c.id)).toEqual([
      'char-marta',
      'char-dan',
      'char-reyes',
    ])
  })
})

describe('threadsForScene', () => {
  const ep = episode(
    [scene('scene-2', 1), scene('scene-5', 4), scene('scene-6', 5)],
    {
      threads: [
        thread('thread-money', 'scene-2', 'scene-5'),
        thread('thread-open', 'scene-2', null),
        thread('thread-cut', 'scene-2', 'scene-40'),
        thread('thread-same', 'scene-6', 'scene-6'),
      ],
    },
  )
  const rows = (sceneId: string) =>
    threadsForScene(ep, sceneId).map((t) => [
      t.thread.id,
      t.role,
      t.otherSceneId,
    ])

  it('lists what a scene sets up, with the payoff scene or null when never paid off', () => {
    expect(rows('scene-2')).toEqual([
      ['thread-money', 'sets_up', 'scene-5'],
      ['thread-open', 'sets_up', null],
      ['thread-cut', 'sets_up', null],
    ])
  })

  it('lists what a scene pays off, with the setup scene', () => {
    expect(rows('scene-5')).toEqual([['thread-money', 'pays_off', 'scene-2']])
  })

  it('a thread set up and paid off in one scene yields two entries', () => {
    expect(rows('scene-6')).toEqual([
      ['thread-same', 'sets_up', 'scene-6'],
      ['thread-same', 'pays_off', 'scene-6'],
    ])
  })
})

describe('secretsForScene', () => {
  const transfer = secret({
    establishedSceneId: 'scene-1',
    revealedSceneId: 'scene-5',
    concealmentSceneIds: ['scene-3'],
    concealedFromCharacterIds: ['char-dan', 'char-luz'],
  })
  const ep = episode([scene('scene-1', 0), scene('scene-3', 2)], {
    secrets: [transfer],
  })

  it('names the role and who is in the dark among the people present', () => {
    expect(
      secretsForScene(ep, 'scene-1', new Set(['char-marta', 'char-dan'])),
    ).toEqual([{ secret: transfer, role: 'set', inTheDark: ['char-dan'] }])
    expect(secretsForScene(ep, 'scene-3', new Set(['char-luz']))).toEqual([
      { secret: transfer, role: 'kept', inTheDark: ['char-luz'] },
    ])
    expect(secretsForScene(ep, 'scene-5', new Set())).toEqual([
      { secret: transfer, role: 'out', inTheDark: [] },
    ])
    expect(secretsForScene(ep, 'scene-6', new Set())).toEqual([])
  })
})

describe('factsForScene', () => {
  it('shows active and pending facts and keeps the rest as retired, in ledger order', () => {
    const { shown, retired } = factsForScene(
      [
        fact('fact-01', 'scene-1', 'active'),
        fact('fact-09', 'scene-1', 'superseded'),
        fact('fact-06', 'scene-1', 'pending_review'),
        fact('fact-02', 'scene-2', 'active'),
        fact('fact-10', 'scene-1', 'stale'),
        fact('fact-11', 'scene-1', 'rejected'),
      ],
      'scene-1',
    )
    expect(shown.map((f) => f.id)).toEqual(['fact-01', 'fact-06'])
    expect(retired.map((f) => f.id)).toEqual(['fact-09', 'fact-10', 'fact-11'])
  })
})

describe('missing story data', () => {
  it('reads a doc whose defaulted keys are missing as empty (raw PATCH reply, idea-born project)', () => {
    const s = scene('scene-6', 5, {
      beats: [beat('beat-6-1', 0, { scriptText: 'REYES\nHold it.' })],
    })
    const raw = episode([s]) as unknown as Record<string, unknown>
    for (const key of [
      'threads',
      'secrets',
      'timelineAnchors',
      'relationshipStates',
      'storyOverview',
    ]) {
      delete raw[key]
    }
    const ep = raw as unknown as Episode
    const reyes = character(
      'char-reyes',
      'Detective Ana Reyes',
    ) as unknown as Record<string, unknown>
    delete reyes.aliases

    expect(threadsForScene(ep, 'scene-6')).toEqual([])
    expect(secretsForScene(ep, 'scene-6', new Set())).toEqual([])
    expect(landmarksForScene(ep, s)).toEqual([])
    expect(castFromDialogue(s, [reyes as unknown as Character])).toEqual([])

    const bare = secret() as unknown as Record<string, unknown>
    delete bare.concealmentSceneIds
    delete bare.concealedFromCharacterIds
    const withSecret = { ...raw, secrets: [bare] } as unknown as Episode
    expect(secretsForScene(withSecret, 'scene-6', new Set())).toEqual([])
    expect(
      secretsForScene(withSecret, 'scene-1', new Set(['char-dan']))[0]
        .inTheDark,
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**
  `cd apps/web && npx vitest run src/plan/story.test.ts`
  Expected: `FAIL src/plan/story.test.ts`, with `Error: Cannot find module './story' imported from …/src/plan/story.test.ts`.

- [ ] **Step 3: Minimal implementation.** Create `apps/web/src/plan/story.ts`:

```ts
import type {
  Beat,
  Character,
  ConsistencyFlag,
  Episode,
  LedgerFact,
  Scene,
  Secret,
  StoryOverviewBeatItem,
  StoryThread,
} from 'contract'
import { parseFountainLines } from '../write/fountainFormat'
import { affectedFacts } from './planTree'

// Every pure derivation the Plan panel reads (redesign spec §6: one module,
// unit-tested). Missing arrays read as empty everywhere: PATCH returns the
// raw stored doc, which omits defaulted keys (threads, secrets,
// timelineAnchors, relationshipStates, storyOverview, aliases…).

// ── Notes ────────────────────────────────────────────────────────────────

export type FlagKind = 'continuity' | 'act_split' | 'import'

const IMPORT_CODE = /^\[([a-z][a-z0-9_]*)\]\s*/
const ACT_SPLIT =
  /\bact (one|two|three|four|five|six)\b[^.]*\bbreak\b|\bact structure\b/i

/** ponytail: the kind is read from the explanation text. A leading
 * `[snake_case]` repair code (fountain/pipeline.py, fountain/characters.py)
 * means an import note; an act-break / act-structure phrase means an act-split
 * note; anything else is continuity. Replace with `flag.kind` once the
 * contract carries one (redesign spec §9). */
export function flagKind(flag: ConsistencyFlag): FlagKind {
  if (IMPORT_CODE.test(flag.explanation)) return 'import'
  if (ACT_SPLIT.test(flag.explanation)) return 'act_split'
  return 'continuity'
}

export interface PlanNote {
  flag: ConsistencyFlag
  kind: FlagKind
  /** null for a scene-level flag */
  beat: Beat | null
}

/** Open flags on this scene or one of its beats: story notes first, then
 * import notes, each group in beat order (scene-level first). A flag on a beat
 * this scene doesn't have is dropped, as in flaggedScenes.ts. */
export function notesForScene(
  flags: readonly ConsistencyFlag[],
  scene: Scene,
): PlanNote[] {
  const notes: PlanNote[] = []
  for (const flag of flags) {
    if (flag.status !== 'open') continue
    const beat =
      flag.objectType === 'beat'
        ? scene.beats.find((b) => b.id === flag.objectId)
        : undefined
    const onThisScene =
      flag.objectType === 'scene' ? flag.objectId === scene.id : !!beat
    if (onThisScene)
      notes.push({ flag, kind: flagKind(flag), beat: beat ?? null })
  }
  const beatOrder = (note: PlanNote) => (note.beat ? note.beat.index + 1 : 0)
  return notes.sort(
    (a, b) =>
      Number(a.kind === 'import') - Number(b.kind === 'import') ||
      beatOrder(a) - beatOrder(b),
  )
}

/** Plain-language import note; never shows the `[code]` marker. `beatLabel`
 * looks like "7.1"; null means the note is on the scene. */
export function importNoteText(
  flag: ConsistencyFlag,
  beatLabel: string | null,
): string {
  const code = IMPORT_CODE.exec(flag.explanation)
  if (!code) return flag.explanation
  const lines = /source lines (\d+)-(\d+)/.exec(flag.explanation)
  if (code[1] === 'model_unassigned' && lines) {
    const where = beatLabel ? `beat ${beatLabel}` : 'this scene'
    return `The import couldn't place script lines ${lines[1]}–${lines[2]} and kept them in ${where}.`
  }
  return flag.explanation.slice(code[0].length)
}

export type NoteSegment =
  | { type: 'text'; text: string }
  | { type: 'scene'; text: string; sceneId: string }
  | { type: 'fact'; text: 'a Ledger fact'; factId: string }

const NOTE_REF = /\bscene[ -](\d+)\b|\bfact-[0-9a-z]+\b/gi

/** Splits a note into text and links. "Scene 12" / "scene 12" / "scene-12"
 * all mean the id `scene-12` (what the model was shown, not a position), and
 * link only when that scene exists; the id form reads "Scene 12". A fact id
 * links as "a Ledger fact" when it is in the ledger and is plain "a Ledger
 * fact" text otherwise: a raw fact id is never shown. */
export function linkifyNote(
  text: string,
  scenes: readonly Scene[],
  facts: readonly LedgerFact[],
): NoteSegment[] {
  const sceneIds = new Set(scenes.map((s) => s.id))
  const factIds = new Set(facts.map((f) => f.id))
  const out: NoteSegment[] = []
  const pushText = (piece: string) => {
    if (!piece) return
    const last = out[out.length - 1]
    if (last?.type === 'text') last.text += piece
    else out.push({ type: 'text', text: piece })
  }
  let at = 0
  for (const match of text.matchAll(NOTE_REF)) {
    const start = match.index ?? 0
    pushText(text.slice(at, start))
    at = start + match[0].length
    if (match[1] !== undefined) {
      const sceneId = `scene-${match[1]}`
      if (!sceneIds.has(sceneId)) pushText(match[0])
      else
        out.push({
          type: 'scene',
          text: match[0].includes('-') ? `Scene ${match[1]}` : match[0],
          sceneId,
        })
    } else if (factIds.has(match[0])) {
      out.push({ type: 'fact', text: 'a Ledger fact', factId: match[0] })
    } else {
      pushText('a Ledger fact')
    }
  }
  pushText(text.slice(at))
  return out
}

// ── Scene reading ───────────────────────────────────────────────────────

const SLUG_PREFIX = /^(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.|EXT\.)\s*/i

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /(^|[\s\-/(])(\p{L})/gu,
      (_, sep: string, ch: string) => sep + ch.toUpperCase(),
    )
}

/** "INT. THE LONG POUR - NIGHT" → "The Long Pour": drops the INT./EXT./I/E.
 * prefix and, when there are two or more " - " parts, the last one (the
 * time); title-cases only an all-caps remainder. Empty → "Scene n". */
export function placeTitle(scene: Scene): string {
  const parts = scene.location.trim().replace(SLUG_PREFIX, '').split(' - ')
  if (parts.length >= 2) parts.pop()
  const place = parts.join(' - ').trim()
  if (!place) return `Scene ${scene.index + 1}`
  return place === place.toUpperCase() ? titleCase(place) : place
}

/** Board order: act, then index (Board's frames). Drives ‹ › and "of N". */
export function boardOrder(scenes: readonly Scene[]): Scene[] {
  return [...scenes].sort((a, b) => a.act - b.act || a.index - b.index)
}

/** Labelled beat-sheet rows that sit in this scene (by scene id or by one of
 * its beats). */
export function landmarksForScene(
  episode: Episode,
  scene: Scene,
): StoryOverviewBeatItem[] {
  const beatIds = new Set(scene.beats.map((b) => b.id))
  return (episode.storyOverview?.beatSheet ?? []).filter(
    (row) =>
      (row.label ?? '').trim() !== '' &&
      (row.sceneId === scene.id || beatIds.has(row.beatId)),
  )
}

/** ponytail: who speaks in this scene, from the character cues Write's
 * teleplay parser already finds (write/fountainFormat.ts), matched
 * case-insensitively to a character's name, first name or alias. Unmatched
 * cues ("BARTENDER", "BACK TO SCENE") are dropped: that is the noise filter.
 * Always shown labelled "from dialogue cues". Bible order, no duplicates. */
export function castFromDialogue(
  scene: Scene,
  characters: readonly Character[],
): Character[] {
  const cues = new Set<string>()
  for (const beat of scene.beats) {
    for (const line of parseFountainLines(beat.scriptText ?? '')) {
      if (line.type !== 'character') continue
      cues.add(
        line.text
          .replace(/\s*\([^)]*\)\s*$/, '')
          .trim()
          .toLowerCase(),
      )
    }
  }
  return characters.filter((c) =>
    [c.name, c.name.split(/\s+/)[0], ...(c.aliases ?? [])].some(
      (name) => !!name && cues.has(name.toLowerCase()),
    ),
  )
}

// ── What it touches ─────────────────────────────────────────────────────

export interface SceneThread {
  thread: StoryThread
  role: 'sets_up' | 'pays_off'
  /** sets_up → the payoff scene, pays_off → the setup scene; null when there
   * is none or it is not a scene in this episode ("Never paid off"). */
  otherSceneId: string | null
}

export function threadsForScene(
  episode: Episode,
  sceneId: string,
): SceneThread[] {
  const known = (id: string | null) =>
    id && episode.scenes.some((s) => s.id === id) ? id : null
  const out: SceneThread[] = []
  for (const thread of episode.threads ?? []) {
    if (thread.setupSceneId === sceneId)
      out.push({
        thread,
        role: 'sets_up',
        otherSceneId: known(thread.payoffSceneId ?? null),
      })
    if (thread.payoffSceneId === sceneId)
      out.push({
        thread,
        role: 'pays_off',
        otherSceneId: known(thread.setupSceneId),
      })
  }
  return out
}

export interface SceneSecret {
  secret: Secret
  /** first match in this order: establishedSceneId, revealedSceneId, concealmentSceneIds */
  role: 'set' | 'out' | 'kept'
  /** concealedFromCharacterIds present in this scene */
  inTheDark: string[]
}

export function secretsForScene(
  episode: Episode,
  sceneId: string,
  presentCharacterIds: ReadonlySet<string>,
): SceneSecret[] {
  const out: SceneSecret[] = []
  for (const secret of episode.secrets ?? []) {
    const role =
      secret.establishedSceneId === sceneId
        ? 'set'
        : secret.revealedSceneId === sceneId
          ? 'out'
          : (secret.concealmentSceneIds ?? []).includes(sceneId)
            ? 'kept'
            : null
    if (!role) continue
    out.push({
      secret,
      role,
      inTheDark: (secret.concealedFromCharacterIds ?? []).filter((id) =>
        presentCharacterIds.has(id),
      ),
    })
  }
  return out
}

/** Facts established in this scene (planTree.affectedFacts), split into the
 * ones Plan shows (active, pending_review) and the retired rest; both keep
 * ledger order. */
export function factsForScene(
  ledger: readonly LedgerFact[],
  sceneId: string,
): { shown: LedgerFact[]; retired: LedgerFact[] } {
  const shown: LedgerFact[] = []
  const retired: LedgerFact[] = []
  for (const fact of affectedFacts(ledger as LedgerFact[], sceneId)) {
    if (fact.status === 'active' || fact.status === 'pending_review')
      shown.push(fact)
    else retired.push(fact)
  }
  return { shown, retired }
}
```

- [ ] **Step 4: Run the tests to verify they pass.**
  `cd apps/web && npx vitest run src/plan/story.test.ts` → `38 passed`.
  Then: `cd apps/web && npx prettier --write src/plan/story.ts src/plan/story.test.ts && npx prettier --check . && npx eslint . && npx tsc -b` → clean.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/plan/story.ts apps/web/src/plan/story.test.ts
git commit -m "plan: add story.ts derivations for the scene panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: In-memory draft store

**PR:** T3.3 · **Depends on:** none

**Files:**
- Create `apps/web/src/plan/panel/usePlanDrafts.ts`
- Create `apps/web/src/plan/panel/testDrafts.tsx` (test-only wrapper)
- Test `apps/web/src/plan/panel/usePlanDrafts.test.tsx` (new)

**Interfaces:**
- Consumes: React only.
- Produces:
  - `interface PlanDrafts { get(key): string | undefined; set(key, sceneId: string | null, text): void; clear(key): void; clearAll(): void; readonly size: number; readonly dirtySceneIds: ReadonlySet<string> }`
  - `draftKey(objectId: string, field: string): string` (`${objectId}:${field}`)
  - `usePlanDraftStore(): PlanDrafts`
  - `PlanDraftsContext: React.Context<PlanDrafts | null>`
  - `usePlanDrafts(): PlanDrafts` (throws `PlanDraftsContext missing`)
  - `interface FieldDraft { text: string; dirty: boolean; set(next: string): void; discard(): void }`
  - `useFieldDraft(key: string, sceneId: string | null, value: string): FieldDraft`
  - `WithDrafts({ children }: { children: ReactNode }): JSX.Element` (from `testDrafts.tsx`)

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/plan/panel/usePlanDrafts.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WithDrafts } from './testDrafts'
import {
  draftKey,
  useFieldDraft,
  usePlanDraftStore,
  usePlanDrafts,
} from './usePlanDrafts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('draftKey', () => {
  it('joins the object id and the field', () => {
    expect(draftKey('scene-2', 'audienceLearns')).toBe('scene-2:audienceLearns')
    expect(draftKey('project', 'premise')).toBe('project:premise')
  })
})

describe('usePlanDraftStore', () => {
  it('sets, reads, clears one and clears all', () => {
    const { result } = renderHook(() => usePlanDraftStore())
    act(() => {
      result.current.set('scene-2:audienceLearns', 'scene-2', 'Dan has a key.')
      result.current.set('ep-1:premise', null, 'A bar on the edge.')
    })
    expect(result.current.get('scene-2:audienceLearns')).toBe('Dan has a key.')
    expect(result.current.size).toBe(2)

    act(() => result.current.clear('scene-2:audienceLearns'))
    expect(result.current.get('scene-2:audienceLearns')).toBeUndefined()
    expect(result.current.size).toBe(1)

    act(() => result.current.clearAll())
    expect(result.current.size).toBe(0)
  })

  it('size and get are current before React re-renders', () => {
    const { result } = renderHook(() => usePlanDraftStore())
    const drafts = result.current
    let sizeInHandler = -1
    act(() => {
      drafts.set('scene-3:time', 'scene-3', 'Dawn')
      sizeInHandler = drafts.size
    })
    expect(sizeInHandler).toBe(1)
    expect(drafts.get('scene-3:time')).toBe('Dawn')
  })

  it('publishes a new value per change; only scene fields mark a scene unsaved', () => {
    const { result } = renderHook(() => usePlanDraftStore())
    const first = result.current
    act(() => {
      result.current.set('scene-2:location', 'scene-2', 'INT. BACK ROOM')
      result.current.set('beat-2-1:whatHappens', 'scene-2', 'Dan counts.')
      result.current.set('project:premise', null, 'Two siblings, one bar.')
    })
    expect(result.current).not.toBe(first)
    expect([...result.current.dirtySceneIds]).toEqual(['scene-2'])
  })
})

describe('usePlanDrafts', () => {
  it('throws without a provider', () => {
    // React reports the render error to console and window 'error'; keep the run quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const quiet = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener('error', quiet)
    try {
      expect(() => renderHook(() => usePlanDrafts())).toThrow(
        'PlanDraftsContext missing',
      )
    } finally {
      window.removeEventListener('error', quiet)
    }
  })
})

describe('useFieldDraft', () => {
  function setup(value: string, key = 'scene-2:audienceLearns') {
    return renderHook(
      (props: { value: string; key: string }) => ({
        field: useFieldDraft(props.key, 'scene-2', props.value),
        drafts: usePlanDrafts(),
      }),
      { wrapper: WithDrafts, initialProps: { value, key } },
    )
  }

  it('shows the server value until edited; typing back to it is not unsaved', () => {
    const { result } = setup('The money is gone.')
    expect(result.current.field).toMatchObject({
      text: 'The money is gone.',
      dirty: false,
    })

    act(() => result.current.field.set('The money is in the basement.'))
    expect(result.current.field).toMatchObject({
      text: 'The money is in the basement.',
      dirty: true,
    })
    expect(result.current.drafts.dirtySceneIds.has('scene-2')).toBe(true)

    act(() => result.current.field.set('The money is gone.'))
    expect(result.current.field.dirty).toBe(false)
    expect(result.current.drafts.size).toBe(0)
  })

  it('keeps the typed text through a failed save (optimistic value, then rollback)', () => {
    const { result, rerender } = setup('Old')
    act(() => result.current.field.set('New'))

    rerender({ value: 'New', key: 'scene-2:audienceLearns' }) // optimistic setProject
    expect(result.current.field).toMatchObject({ text: 'New', dirty: false })

    rerender({ value: 'Old', key: 'scene-2:audienceLearns' }) // rollback on 409/5xx
    expect(result.current.field).toMatchObject({ text: 'New', dirty: true })
  })

  it('restores the draft when the panel comes back to the scene', () => {
    const { result, rerender } = setup('Old')
    act(() => result.current.field.set('New'))

    rerender({ value: 'Other', key: 'scene-3:audienceLearns' })
    expect(result.current.field).toMatchObject({ text: 'Other', dirty: false })

    rerender({ value: 'Old', key: 'scene-2:audienceLearns' })
    expect(result.current.field).toMatchObject({ text: 'New', dirty: true })
  })

  it('discard drops the draft and shows the server value', () => {
    const { result } = setup('Old')
    act(() => result.current.field.set('New'))
    act(() => result.current.field.discard())
    expect(result.current.field).toMatchObject({ text: 'Old', dirty: false })
    expect(result.current.drafts.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**
  `cd apps/web && npx vitest run src/plan/panel/usePlanDrafts.test.tsx`
  Expected: `FAIL`, with `Error: Cannot find module './testDrafts'` (or `'./usePlanDrafts'`).

- [ ] **Step 3: Minimal implementation.** Create `apps/web/src/plan/panel/usePlanDrafts.ts`:

```ts
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
} from 'react'

/** Unsaved Plan edits, in memory only (redesign spec §4.9 "while browsing"):
 * a draft survives scene switches, a failed save and a server value changing
 * underneath it. Leaving Plan with drafts asks first (useLeaveGuard). */
export interface PlanDrafts {
  get(key: string): string | undefined
  /** sceneId null = not a scene field (premises): counts for leaving, no card dot */
  set(key: string, sceneId: string | null, text: string): void
  clear(key: string): void
  clearAll(): void
  /** Live: current even before React re-renders (beforeunload, leave guard). */
  readonly size: number
  readonly dirtySceneIds: ReadonlySet<string>
}

/** `${objectId}:${field}`; objectId is a scene, beat or episode id, or 'project'. */
export function draftKey(objectId: string, field: string): string {
  return `${objectId}:${field}`
}

interface Entry {
  sceneId: string | null
  text: string
}

// A tiny external store. Every change replaces the map and publishes a new
// PlanDrafts value, so consumers re-render; `get` and `size` read the live
// map, so code that runs before that re-render (an unload, a guard) still
// sees the latest drafts. Not a ref: eslint-plugin-react-hooks 7 forbids
// reading ref.current during render.
function createDraftStore() {
  let entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()

  function commit(next: Map<string, Entry>) {
    entries = next
    snapshot = build()
    for (const listener of listeners) listener()
  }

  function build(): PlanDrafts {
    const dirtySceneIds = new Set<string>()
    for (const entry of entries.values()) {
      if (entry.sceneId) dirtySceneIds.add(entry.sceneId)
    }
    return {
      get: (key) => entries.get(key)?.text,
      set: (key, sceneId, text) =>
        commit(new Map(entries).set(key, { sceneId, text })),
      clear: (key) => {
        if (!entries.has(key)) return
        const next = new Map(entries)
        next.delete(key)
        commit(next)
      },
      clearAll: () => {
        if (entries.size > 0) commit(new Map())
      },
      get size() {
        return entries.size
      },
      dirtySceneIds,
    }
  }

  let snapshot = build()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
  }
}

/** PlanScreen owns one store and provides it through PlanDraftsContext.
 * ponytail: every keystroke re-renders PlanScreen (board + panel); memo Board
 * if typing lags at 70 scenes. */
export function usePlanDraftStore(): PlanDrafts {
  const [store] = useState(createDraftStore)
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

export const PlanDraftsContext = createContext<PlanDrafts | null>(null)

export function usePlanDrafts(): PlanDrafts {
  const drafts = useContext(PlanDraftsContext)
  if (!drafts) throw new Error('PlanDraftsContext missing')
  return drafts
}

export interface FieldDraft {
  /** the draft, else the server value */
  text: string
  /** a draft exists and differs from the server value */
  dirty: boolean
  /** typing back to the server value clears the draft */
  set(next: string): void
  discard(): void
}

/** One field's view of the store. A field calls `discard()` only after its
 * save resolves true: on a failed save the optimistic value equals the draft,
 * the rollback makes it dirty again, and the typed text stays. */
export function useFieldDraft(
  key: string,
  sceneId: string | null,
  value: string,
): FieldDraft {
  const drafts = usePlanDrafts()
  const stored = drafts.get(key)
  return {
    text: stored ?? value,
    dirty: stored !== undefined && stored !== value,
    set: (next) =>
      next === value ? drafts.clear(key) : drafts.set(key, sceneId, next),
    discard: () => drafts.clear(key),
  }
}
```

Create `apps/web/src/plan/panel/testDrafts.tsx`:

```tsx
import type { ReactNode } from 'react'
import { PlanDraftsContext, usePlanDraftStore } from './usePlanDrafts'

/** Test-only: a real draft store, provided the way PlanScreen provides it.
 * Use as `render(ui, { wrapper: WithDrafts })`. */
export function WithDrafts({ children }: { children: ReactNode }) {
  const drafts = usePlanDraftStore()
  return (
    <PlanDraftsContext.Provider value={drafts}>
      {children}
    </PlanDraftsContext.Provider>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass.**
  `cd apps/web && npx vitest run src/plan/panel/usePlanDrafts.test.tsx` → `9 passed`, with no stray error output (the provider-missing case silences React's report).
  Then: `cd apps/web && npx prettier --write src/plan/panel && npx prettier --check . && npx eslint . && npx tsc -b` → clean.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/plan/panel/usePlanDrafts.ts apps/web/src/plan/panel/testDrafts.tsx apps/web/src/plan/panel/usePlanDrafts.test.tsx
git commit -m "plan: add the in-memory Plan draft store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `--tr-panel-plan` token and independent scrolling

**PR:** T3.3 · **Depends on:** none

**Files:**
- Modify: `apps/web/src/styles/tokens.expected.ts` (after `'--tr-card-scene': '214px',`, ~line 115)
- Modify: `apps/web/src/styles/tokens.css` (Plan layout block ~line 124; `@theme` spacing block ~line 255)
- Modify: `apps/web/src/dev/TokensPage.tsx` (Layout group, after the `--tr-panel-inspector` entry, ~line 345)
- Modify: `apps/web/src/plan/PlanScreen.tsx` (line 346, the `<div className="flex">` wrapper only)
- Modify: `apps/web/src/plan/Board.tsx` (line 153, root `className` only)
- Modify: `apps/web/src/plan/StoryLayersPanel.tsx` (line 67, root `className` only)
- Modify: `apps/web/src/plan/Inspector.tsx` (lines 347, 389, 511: the three `<aside>` `className`s)
- Modify: `docs/tableread-ui-spec.md` (line 92, the §1 layout comment)
- Test: `apps/web/src/plan/PlanScreen.test.tsx` (new `it` at the end of the `describe`), plus the existing `src/styles/tokens.test.ts` and `src/dev/TokensPage.test.tsx`

**Interfaces:**
- Consumes: `--tr-shell-height` (exists), `EXPECTED_TOKENS` (exists).
- Produces: CSS custom property `--tr-panel-plan: 400px`; Tailwind alias `--spacing-panel-plan` (the `w-panel-plan` utility used by Task 9); a fixed-height Plan row (`h-[calc(100vh-var(--tr-shell-height))] min-h-0 overflow-hidden`) where the board (`min-w-0 flex-1 overflow-y-auto`), Story Layers and the right panel each scroll on their own.

- [ ] **Step 1: Write the failing tests.** Add the expected token to `apps/web/src/styles/tokens.expected.ts`:

```ts
  '--tr-card-scene': '214px',
  '--tr-panel-plan': '400px',
  '--tr-panel-ledger-filters': '236px',
```

Add this test as the last `it` inside `describe('PlanScreen', …)` in `apps/web/src/plan/PlanScreen.test.tsx` (it reuses the file's `project()` builder and mocks):

```tsx
  it('scrolls the board and both side panels on their own inside a fixed-height row', async () => {
    getProjectMock.mockResolvedValue(project())
    getLedgerMock.mockResolvedValue([])
    getConsistencyFlagsMock.mockResolvedValue([])
    window.history.pushState(null, '', '/plan?project=proj-longpour')

    render(<PlanScreen />)

    const board = await screen.findByLabelText('Plan board')
    expect(board.className).toContain('overflow-y-auto')
    expect(board.className).toContain('min-w-0')
    const row = board.parentElement as HTMLElement
    expect(row.className).toContain('h-[calc(100vh-var(--tr-shell-height))]')
    expect(row.className).toContain('overflow-hidden')
    expect(screen.getByTestId('story-layers-panel').className).toContain(
      'overflow-y-auto',
    )
    expect(screen.getByTestId('inspector').className).toContain(
      'overflow-y-auto',
    )
  })
```

(The `inspector` assertion keeps holding after Task 10, because `ScenePanel` and `EpisodePanel` are `overflow-y-auto` too.)

- [ ] **Step 2: Run them to verify they fail.**

```bash
(cd apps/web && npx vitest run src/styles/tokens.test.ts src/dev/TokensPage.test.tsx src/plan/PlanScreen.test.tsx)
```

Expected: 6 failures.
- `tokens.test.ts`, four of them: `expected { …(87) } to have property "--tr-panel-plan"`, `expected undefined to be '400px'`, the declared-list mismatch, and `…to match /--spacing-panel-plan\s*:\s*var\(--tr-…/`.
- `TokensPage.test.tsx`: the rendered HTML does not contain `>--tr-panel-plan<`.
- `PlanScreen.test.tsx`: `AssertionError: expected 'flex-1 p-6' to contain 'overflow-y-auto'`.

- [ ] **Step 3: Minimal implementation.**

`apps/web/src/styles/tokens.css` (Prettier-ignored, keep the column style). In the `/* Layout: Plan mode board (§5) panel/card widths. */` block:

```css
  --tr-panel-story-layers: 232px;
  --tr-panel-inspector: 296px;
  --tr-card-scene: 214px;
  --tr-panel-plan: 400px; /* Plan scene panel (redesign 2026-10-13) */
```

and in the `@theme` block's `w-panel-*` group:

```css
  --spacing-panel-inspector: var(--tr-panel-inspector);
  --spacing-panel-plan: var(--tr-panel-plan);
  --spacing-panel-ledger-filters: var(--tr-panel-ledger-filters);
```

`apps/web/src/dev/TokensPage.tsx`: in the `Layout` group, insert after the `--tr-panel-inspector` entry:

```tsx
      {
        cssVar: '--tr-panel-plan',
        description: 'Plan scene panel width (2026-10-13)',
        kind: 'width',
      },
```

`apps/web/src/plan/PlanScreen.tsx` line 346:

```tsx
      <div className="flex h-[calc(100vh-var(--tr-shell-height))] min-h-0 overflow-hidden">
```

`apps/web/src/plan/Board.tsx` line 153:

```tsx
    <div className="min-w-0 flex-1 overflow-y-auto p-6" aria-label="Plan board">
```

`apps/web/src/plan/StoryLayersPanel.tsx` line 67:

```tsx
      className="w-panel-story-layers shrink-0 overflow-y-auto bg-tr-surface-sunken p-4"
```

`apps/web/src/plan/Inspector.tsx`: replace all three occurrences (lines 347, 389, 511) of

```tsx
className="w-panel-inspector shrink-0 rounded-card bg-tr-surface-raised p-4"
```

with

```tsx
className="w-panel-inspector shrink-0 overflow-y-auto rounded-card bg-tr-surface-raised p-4"
```

`docs/tableread-ui-spec.md` line 92: in the layout comment, replace `Plan panels 232/296/214px;` with `Plan panels 232/296/214px; Plan scene panel 400px (--tr-panel-plan, redesign 2026-10-13);`.

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
(cd apps/web && npx vitest run src/styles/tokens.test.ts src/dev/TokensPage.test.tsx src/plan)
```
```bash
(cd apps/web && npx tsc -b)
(cd apps/web && npx eslint .)
(cd apps/web && npx prettier --check .)
```

Expected: all green. This is the one change before Task 10 that a browser can see, so smoke the existing Plan e2e as well. Use a temporary config and a temporary venv symlink, and delete both before committing.

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
(cd apps/web && E2E_API_PORT=8100 E2E_WEB_PORT=5180 npx playwright test --config=e2e/playwright.local.config.ts e2e/plan.spec.ts)
rm apps/web/e2e/playwright.local.config.ts apps/api/.venv
git status --short   # neither temporary path may appear
```

Expected: `plan.spec.ts` passes, as on `origin/main`. Some e2e failures already exist on main: if one fails, run the same spec on `origin/main` before blaming this change. `git status --short` must not list `apps/api/.venv` or the temporary config.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/styles/tokens.css apps/web/src/styles/tokens.expected.ts apps/web/src/dev/TokensPage.tsx apps/web/src/plan/PlanScreen.tsx apps/web/src/plan/PlanScreen.test.tsx apps/web/src/plan/Board.tsx apps/web/src/plan/StoryLayersPanel.tsx apps/web/src/plan/Inspector.tsx docs/tableread-ui-spec.md
git commit -F - <<'EOF'
plan: scroll the board and panels independently; add --tr-panel-plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `PlanField`, one editable field backed by the draft store

**PR:** T3.3 · **Depends on:** Task 2

**Files:**
- Create: `apps/web/src/plan/panel/PlanField.tsx`
- Test: `apps/web/src/plan/panel/PlanField.test.tsx`

**Interfaces:**
- Consumes:
  - From Task 2 (`./usePlanDrafts`): `useFieldDraft(key: string, sceneId: string | null, value: string): FieldDraft`, where `FieldDraft` is `{ text: string; dirty: boolean; set(next: string): void; discard(): void }`.
  - From Task 2 (`./testDrafts`): `WithDrafts({ children })`.
  - Existing: `SuggestionChips` (`src/write/SuggestionChips.tsx`; props `suggestions`, `onPick`, `disabled`; `data-testid="suggestion-chips"`).
- Produces:
  - `export type SceneTextField = 'whatHappens' | 'audienceLearns' | 'audienceFeels' | 'location' | 'time' | 'socialSituation'`
  - `export type BeatTextField = 'whatHappens' | 'audienceLearns' | 'audienceFeels' | 'scriptText'`
  - `export interface PlanFieldProps { label: string; ariaLabel?: string; draftKey: string; sceneId: string | null; value: string; multiline?: boolean; lead?: boolean; structural?: boolean; locked: boolean; saving: boolean; openingReview?: boolean; onSave: (value: string) => Promise<boolean>; onOpenReview?: (instruction: string) => void; onSuggest?: () => Promise<string[]> }`
  - `export function PlanField(props: PlanFieldProps): JSX.Element`

This test file ports Inspector.test's EditableField coverage: the structural footer, Open Review, the plain Save, read-only when locked, and the disabled Open Review without a target.

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/plan/panel/PlanField.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanField, type PlanFieldProps } from './PlanField'
import { WithDrafts } from './testDrafts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function props(overrides: Partial<PlanFieldProps> = {}): PlanFieldProps {
  return {
    label: 'What happens',
    draftKey: 'scene-1:whatHappens',
    sceneId: 'scene-1',
    value: 'Marta walks back in.',
    multiline: true,
    locked: false,
    saving: false,
    onSave: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('PlanField', () => {
  it('a structural field shows the review footer when dirty; Save field only sends the draft', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(<PlanField {...props({ structural: true, onSave })} />, {
      wrapper: WithDrafts,
    })
    expect(screen.queryByText('Structural change — review impact?')).toBeNull()

    const field = screen.getByLabelText('What happens')
    await user.clear(field)
    await user.type(field, 'A rewritten summary.')

    expect(
      screen.getByText('Structural change — review impact?'),
    ).not.toBeNull()
    // No onOpenReview → Open Review stays disabled with today's tooltip.
    const openReview = screen.getByRole('button', {
      name: 'Open Review',
    }) as HTMLButtonElement
    expect(openReview.disabled).toBe(true)
    expect(openReview.title).toBe('Open Review needs a scene or beat target')

    await user.click(screen.getByRole('button', { name: 'Save field only' }))
    expect(onSave).toHaveBeenCalledWith('A rewritten summary.')
  })

  it('Open Review sends the dirty draft', async () => {
    const user = userEvent.setup()
    const onOpenReview = vi.fn()
    render(<PlanField {...props({ structural: true, onOpenReview })} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText('What happens')
    await user.clear(field)
    await user.type(field, 'Marina rewrite.')
    await user.click(screen.getByRole('button', { name: 'Open Review' }))
    expect(onOpenReview).toHaveBeenCalledWith('Marina rewrite.')
  })

  it('Discard in the structural footer restores the server value', async () => {
    const user = userEvent.setup()
    render(<PlanField {...props({ structural: true })} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText('What happens') as HTMLTextAreaElement
    await user.type(field, ' More.')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(field.value).toBe('Marta walks back in.')
    expect(screen.queryByText('Structural change — review impact?')).toBeNull()
  })

  it('a plain field is silent: Save and Discard, never the review footer', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <PlanField
        {...props({
          label: 'Location',
          draftKey: 'scene-1:location',
          value: 'INT. THE LONG POUR - NIGHT',
          multiline: false,
          onSave,
        })}
      />,
      { wrapper: WithDrafts },
    )
    const input = screen.getByLabelText('Location')
    await user.clear(input)
    await user.type(input, 'INT. THE MARINA - DAY')

    expect(screen.queryByText('Structural change — review impact?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save field only' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Discard' })).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('INT. THE MARINA - DAY')
  })

  it('clears the draft only when the save succeeds', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(<PlanField {...props({ label: 'Audience learns', onSave })} />, {
      wrapper: WithDrafts,
    })
    await user.type(screen.getByLabelText('Audience learns'), ' Again.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull(),
    )
  })

  it('a failed save keeps the typed text and stays dirty through the optimistic value and its rollback', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(false)
    const base = props({ label: 'Audience learns', onSave })
    const { rerender } = render(<PlanField {...base} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText(
      'Audience learns',
    ) as HTMLTextAreaElement
    await user.type(field, ' Again.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // PlanScreen's optimistic set, then useProjectPatch's rollback.
    rerender(<PlanField {...base} value="Marta walks back in. Again." />)
    rerender(<PlanField {...base} value="Marta walks back in." />)

    expect(field.value).toBe('Marta walks back in. Again.')
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeNull()
  })

  it('typing back to the saved value is not dirty', async () => {
    const user = userEvent.setup()
    render(<PlanField {...props({ label: 'Audience learns' })} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText('Audience learns')
    await user.type(field, '!')
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeNull()
    await user.type(field, '{Backspace}')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('locked: read-only, shows the server value, no Save, Discard, footer or Suggest…', async () => {
    const user = userEvent.setup()
    const base = props({ structural: true, onSuggest: vi.fn() })
    const { rerender } = render(<PlanField {...base} />, {
      wrapper: WithDrafts,
    })
    await user.type(screen.getByLabelText('What happens'), ' Draft.')

    rerender(<PlanField {...base} locked />)
    const field = screen.getByLabelText('What happens') as HTMLTextAreaElement
    expect(field.readOnly).toBe(true)
    expect(field.value).toBe('Marta walks back in.')
    expect(screen.queryByText('Structural change — review impact?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()

    // Unlocking brings the kept draft back.
    rerender(<PlanField {...base} />)
    expect(field.value).toBe('Marta walks back in. Draft.')
  })

  it('disables the control and the buttons while a save is in flight', async () => {
    const user = userEvent.setup()
    const base = props({ label: 'Audience learns' })
    const { rerender } = render(<PlanField {...base} />, {
      wrapper: WithDrafts,
    })
    await user.type(screen.getByLabelText('Audience learns'), '!')
    rerender(<PlanField {...base} saving />)
    expect(
      (screen.getByLabelText('Audience learns') as HTMLTextAreaElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('auto-grows a multiline field to its content height', () => {
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      'scrollHeight',
      'get',
    ).mockReturnValue(120)
    render(<PlanField {...props()} />, { wrapper: WithDrafts })
    expect(
      (screen.getByLabelText('What happens') as HTMLTextAreaElement).style
        .height,
    ).toBe('120px')
  })

  it('waits for a closed <details> to open before sizing', () => {
    render(
      <details>
        <PlanField {...props()} />
      </details>,
      { wrapper: WithDrafts },
    )
    const field = screen.getByLabelText('What happens') as HTMLTextAreaElement
    expect(field.style.height).toBe('auto')
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      'scrollHeight',
      'get',
    ).mockReturnValue(96)
    field.closest('details')?.dispatchEvent(new Event('toggle'))
    expect(field.style.height).toBe('96px')
  })

  describe('Suggest…', () => {
    it('makes no request on render, focus or typing', async () => {
      const user = userEvent.setup()
      const onSuggest = vi.fn().mockResolvedValue([])
      render(<PlanField {...props({ value: '', onSuggest })} />, {
        wrapper: WithDrafts,
      })
      const field = screen.getByLabelText('What happens')
      await user.click(field)
      await user.type(field, 'x')
      await user.clear(field)
      expect(onSuggest).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Suggest…' })).not.toBeNull()
    })

    it('one click asks once; picking a chip fills the draft', async () => {
      const user = userEvent.setup()
      const onSuggest = vi
        .fn()
        .mockResolvedValue(['Dan stalls her at the office door.'])
      render(
        <PlanField {...props({ value: '', structural: true, onSuggest })} />,
        { wrapper: WithDrafts },
      )
      await user.click(screen.getByRole('button', { name: 'Suggest…' }))
      expect(onSuggest).toHaveBeenCalledTimes(1)
      await user.click(
        await screen.findByRole('listitem', {
          name: /Dan stalls her at the office door\./,
        }),
      )
      expect(
        (screen.getByLabelText('What happens') as HTMLTextAreaElement).value,
      ).toBe('Dan stalls her at the office door.')
      expect(screen.queryByTestId('suggestion-chips')).toBeNull()
      expect(
        screen.getByText('Structural change — review impact?'),
      ).not.toBeNull()
    })

    it('is hidden when the field has text or is locked', () => {
      const onSuggest = vi.fn()
      const { rerender } = render(<PlanField {...props({ onSuggest })} />, {
        wrapper: WithDrafts,
      })
      expect(screen.queryByRole('button', { name: 'Suggest…' })).toBeNull()
      rerender(<PlanField {...props({ value: '', locked: true, onSuggest })} />)
      expect(screen.queryByRole('button', { name: 'Suggest…' })).toBeNull()
    })

    it('says so when suggestions fail to load', async () => {
      const user = userEvent.setup()
      const onSuggest = vi.fn().mockRejectedValue(new Error('offline'))
      render(<PlanField {...props({ value: '', onSuggest })} />, {
        wrapper: WithDrafts,
      })
      await user.click(screen.getByRole('button', { name: 'Suggest…' }))
      expect(
        await screen.findByText("Couldn't load suggestions."),
      ).not.toBeNull()
    })

    it('never shows a reply that lands after the field moved to another scene', async () => {
      const user = userEvent.setup()
      const reply = deferred<string[]>()
      const onSuggest = vi.fn().mockReturnValue(reply.promise)
      const { rerender } = render(
        <PlanField {...props({ value: '', onSuggest })} />,
        { wrapper: WithDrafts },
      )
      await user.click(screen.getByRole('button', { name: 'Suggest…' }))
      rerender(
        <PlanField
          {...props({
            value: '',
            onSuggest,
            draftKey: 'scene-2:whatHappens',
            sceneId: 'scene-2',
          })}
        />,
      )
      reply.resolve(['Late idea for scene one.'])
      await act(async () => {
        await reply.promise
      })
      expect(screen.queryByTestId('suggestion-chips')).toBeNull()

      // The reply did land, on scene one's field, where it belongs.
      rerender(<PlanField {...props({ value: '', onSuggest })} />)
      expect(screen.getByTestId('suggestion-chips')).not.toBeNull()
      expect(onSuggest).toHaveBeenCalledTimes(1)
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

```bash
(cd apps/web && npx vitest run src/plan/panel/PlanField.test.tsx)
```

Expected: `FAIL … Error: Failed to resolve import "./PlanField" from "src/plan/panel/PlanField.test.tsx". Does the file exist?`

- [ ] **Step 3: Minimal implementation.** Create `apps/web/src/plan/panel/PlanField.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SuggestionChips } from '../../write/SuggestionChips'
import { useFieldDraft } from './usePlanDrafts'

export type SceneTextField =
  | 'whatHappens'
  | 'audienceLearns'
  | 'audienceFeels'
  | 'location'
  | 'time'
  | 'socialSituation'
export type BeatTextField =
  'whatHappens' | 'audienceLearns' | 'audienceFeels' | 'scriptText'

export interface PlanFieldProps {
  label: string
  /** Accessible name; defaults to `label`. Scene fields keep "Location",
   * "What happens", "Audience learns"… (e2e selectors). */
  ariaLabel?: string
  draftKey: string
  /** Scene the draft belongs to (card dot, header chip); null = premises. */
  sceneId: string | null
  /** The server value. */
  value: string
  /** Textarea that grows with its content. */
  multiline?: boolean
  /** 15px text (What happens). */
  lead?: boolean
  /** Dirty → "Structural change — review impact?" footer instead of Save. */
  structural?: boolean
  locked: boolean
  saving: boolean
  openingReview?: boolean
  /** Resolves true when the server took the value; only then is the draft dropped. */
  onSave: (value: string) => Promise<boolean>
  /** Omitted → Open Review stays disabled (premises: create can't target them). */
  onOpenReview?: (instruction: string) => void
  /** Set → an explicit "Suggest…" button on an empty, unlocked field. */
  onSuggest?: () => Promise<string[]>
}

const CONTROL =
  'mt-1 w-full rounded-card border border-tr-border bg-tr-surface-raised p-2 text-tr-text-primary outline-none focus:border-tr-sky disabled:opacity-50'

function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  // A closed <details> lays nothing out (scrollHeight 0): keep the rows
  // height until it opens; the toggle listener below measures again then.
  if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`
}

/**
 * One editable Plan field (UI spec §5 panel). The text lives in the Plan
 * draft store, not in local state, so it survives a scene switch, a failed
 * save (the optimistic value and its rollback never touch the draft) and a
 * server value changing underneath it. A locked field shows the server value
 * read-only and keeps any draft for when it is unlocked.
 *
 * AI stays behind a verb (CLAUDE.md rule 8, spec decision 5): `onSuggest` runs
 * only from the Suggest… click — never on mount, focus, typing or select.
 */
export function PlanField({
  label,
  ariaLabel,
  draftKey,
  sceneId,
  value,
  multiline = false,
  lead = false,
  structural = false,
  locked,
  saving,
  openingReview = false,
  onSave,
  onOpenReview,
  onSuggest,
}: PlanFieldProps) {
  const draft = useFieldDraft(draftKey, sceneId, value)
  const text = locked ? value : draft.text
  const dirty = !locked && draft.dirty
  const busy = saving || openingReview
  const areaRef = useRef<HTMLTextAreaElement>(null)
  // Keyed by draftKey so a reply for another scene's field never shows here.
  const [suggestion, setSuggestion] = useState<{
    key: string
    items: string[]
    failed: boolean
  } | null>(null)
  const [suggestingKey, setSuggestingKey] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (areaRef.current) grow(areaRef.current)
  }, [text])

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const regrow = () => grow(el)
    // `toggle` doesn't bubble; a capturing listener still sees every <details>.
    document.addEventListener('toggle', regrow, true)
    return () => document.removeEventListener('toggle', regrow, true)
  }, [])

  async function save() {
    if (await onSave(draft.text)) draft.discard()
  }

  async function suggest() {
    if (!onSuggest) return
    const key = draftKey
    setSuggestingKey(key)
    try {
      setSuggestion({ key, items: await onSuggest(), failed: false })
    } catch {
      setSuggestion({ key, items: [], failed: true })
    } finally {
      setSuggestingKey((current) => (current === key ? null : current))
    }
  }

  const shown = suggestion?.key === draftKey ? suggestion : null
  const canSuggest = !!onSuggest && !locked && text.trim() === ''
  const suggesting = suggestingKey === draftKey
  const controlClass = `${CONTROL} ${lead ? 'text-15' : 'text-13'}`

  return (
    <div>
      <p className="text-12 uppercase tracking-wide text-tr-text-muted">
        {label}
        {structural && (
          <span className="ml-2 normal-case tracking-normal">· structural</span>
        )}
      </p>
      {multiline ? (
        <textarea
          ref={areaRef}
          aria-label={ariaLabel ?? label}
          value={text}
          readOnly={locked}
          disabled={busy}
          rows={2}
          onChange={(e) => draft.set(e.target.value)}
          className={`${controlClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          aria-label={ariaLabel ?? label}
          value={text}
          readOnly={locked}
          disabled={busy}
          onChange={(e) => draft.set(e.target.value)}
          className={controlClass}
        />
      )}
      {canSuggest && (
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            disabled={suggesting || busy}
            onClick={() => void suggest()}
            className="text-12 text-tr-sky underline disabled:opacity-50"
          >
            {suggesting ? 'Suggesting…' : 'Suggest…'}
          </button>
          {shown?.failed && (
            <span className="text-12 text-tr-text-muted">
              Couldn&apos;t load suggestions.
            </span>
          )}
        </div>
      )}
      {canSuggest && shown && (
        <SuggestionChips
          suggestions={shown.items}
          disabled={busy}
          onPick={(picked) => {
            draft.set(picked)
            setSuggestion(null)
          }}
        />
      )}
      {dirty && structural && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-card border border-tr-border bg-tr-surface-sunken p-2">
          <p className="text-13 text-tr-text-secondary">
            Structural change — review impact?
          </p>
          <button
            type="button"
            disabled={!onOpenReview || busy}
            title={
              onOpenReview
                ? undefined
                : 'Open Review needs a scene or beat target'
            }
            onClick={() => onOpenReview?.(draft.text)}
            className="ml-auto rounded-card bg-tr-coral px-3 py-1 text-13 text-tr-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            {openingReview ? 'Opening…' : 'Open Review'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="text-13 text-tr-text-secondary underline disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save field only'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={draft.discard}
            className="text-13 text-tr-text-secondary underline disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      )}
      {dirty && !structural && (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-card bg-tr-coral px-3 py-1 text-13 text-tr-surface-raised disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={draft.discard}
            className="text-13 text-tr-text-secondary underline disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
(cd apps/web && npx vitest run src/plan/panel/PlanField.test.tsx)
```
```bash
(cd apps/web && npx tsc -b)
(cd apps/web && npx eslint .)
(cd apps/web && npx prettier --check .)
```

Expected: 16 tests pass; tsc, eslint and prettier are clean.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/plan/panel/PlanField.tsx apps/web/src/plan/panel/PlanField.test.tsx
git commit -F - <<'EOF'
plan: add PlanField backed by the draft store, with an explicit Suggest…

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Sections 1 and 2, What the scene does and Who wants what

**PR:** T3.3 · **Depends on:** Tasks 1, 4

**Files:**
- Create: `apps/web/src/plan/panel/WhatTheSceneDoes.tsx`
- Create: `apps/web/src/plan/panel/WhoWantsWhat.tsx`
- Test: `apps/web/src/plan/panel/WhatTheSceneDoes.test.tsx`
- Test: `apps/web/src/plan/panel/WhoWantsWhat.test.tsx`

**Interfaces:**
- Consumes:
  - From Task 4: `PlanField`.
  - From Task 2: `draftKey(objectId: string, field: string): string`, `WithDrafts`.
  - Existing: `Chip` (`src/plan/Chip.tsx`) and `characterName(characters, characterId)` (`src/plan/planTree.ts`).
  - `contract` types: `Scene`, `StoryOverviewBeatItem`, `Motivation`, `Character`.
- Produces:
  - `export interface WhatTheSceneDoesProps { scene: Scene; landmarks: StoryOverviewBeatItem[]; locked: boolean; saving: boolean; openingReview: boolean; onSaveField: (field: 'whatHappens' | 'audienceLearns' | 'audienceFeels', value: string) => Promise<boolean>; onOpenReview: (instruction: string) => void; onSuggest: () => Promise<string[]>; onShowBeat: (beatId: string) => void }`
  - `export function WhatTheSceneDoes(props: WhatTheSceneDoesProps): JSX.Element`
  - `export interface WhoWantsWhatProps { motivations: Motivation[]; characters: Character[]; alsoInScene: Character[] }`
  - `export function WhoWantsWhat(props: WhoWantsWhatProps): JSX.Element`
  - Accessible names kept for e2e: "What happens", "Audience learns", "Audience feels". The visible labels in The audience grid are "Learns" and "Feels".

- [ ] **Step 1: Write the failing tests.** Create `apps/web/src/plan/panel/WhatTheSceneDoes.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Scene, StoryOverviewBeatItem } from 'contract'
import {
  WhatTheSceneDoes,
  type WhatTheSceneDoesProps,
} from './WhatTheSceneDoes'
import { WithDrafts } from './testDrafts'

afterEach(cleanup)

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: '',
    whatHappens: 'Marta walks back in.',
    audienceLearns: 'Eight years away.',
    audienceFeels: 'Unease.',
    motivations: [],
    beats: [
      {
        id: 'beat-1-1',
        index: 0,
        locked: false,
        whatHappens: 'Dan covers his shock.',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: false,
      },
      {
        id: 'beat-1-2',
        index: 1,
        locked: true,
        whatHappens: 'Marta opens the books.',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: true,
      },
    ],
    ...overrides,
  }
}

function landmark(
  overrides: Partial<StoryOverviewBeatItem> = {},
): StoryOverviewBeatItem {
  return {
    beatId: 'beat-1-2',
    label: 'Catalyst',
    summary: 'Marta finds the transfer.',
    sceneId: 'scene-1',
    act: 0,
    ...overrides,
  }
}

function props(
  overrides: Partial<WhatTheSceneDoesProps> = {},
): WhatTheSceneDoesProps {
  return {
    scene: scene(),
    landmarks: [],
    locked: false,
    saving: false,
    openingReview: false,
    onSaveField: vi.fn().mockResolvedValue(true),
    onOpenReview: vi.fn(),
    onSuggest: vi.fn().mockResolvedValue([]),
    onShowBeat: vi.fn(),
    ...overrides,
  }
}

describe('WhatTheSceneDoes', () => {
  it('leads with What happens, then the audience Learns / Feels', () => {
    render(<WhatTheSceneDoes {...props()} />, { wrapper: WithDrafts })
    const fields = screen
      .getAllByRole('textbox')
      .map((el) => el.getAttribute('aria-label'))
    expect(fields).toEqual([
      'What happens',
      'Audience learns',
      'Audience feels',
    ])
    expect(
      (screen.getByLabelText('What happens') as HTMLTextAreaElement).className,
    ).toContain('text-15')
    expect(screen.getByText('The audience')).not.toBeNull()
  })

  it('What happens is structural: Save field only and Open Review carry the draft', async () => {
    const user = userEvent.setup()
    const onSaveField = vi.fn().mockResolvedValue(true)
    const onOpenReview = vi.fn()
    render(<WhatTheSceneDoes {...props({ onSaveField, onOpenReview })} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText('What happens')
    await user.clear(field)
    await user.type(field, 'Marta stays outside.')

    await user.click(screen.getByRole('button', { name: 'Open Review' }))
    expect(onOpenReview).toHaveBeenCalledWith('Marta stays outside.')
    await user.click(screen.getByRole('button', { name: 'Save field only' }))
    expect(onSaveField).toHaveBeenCalledWith(
      'whatHappens',
      'Marta stays outside.',
    )
  })

  it('the audience fields save with a plain Save', async () => {
    const user = userEvent.setup()
    const onSaveField = vi.fn().mockResolvedValue(true)
    render(<WhatTheSceneDoes {...props({ onSaveField })} />, {
      wrapper: WithDrafts,
    })
    await user.type(screen.getByLabelText('Audience feels'), ' And dread.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSaveField).toHaveBeenCalledWith(
      'audienceFeels',
      'Unease. And dread.',
    )
  })

  it('shows a landmark callout that jumps to its beat', async () => {
    const user = userEvent.setup()
    const onShowBeat = vi.fn()
    render(
      <WhatTheSceneDoes {...props({ landmarks: [landmark()], onShowBeat })} />,
      { wrapper: WithDrafts },
    )
    expect(screen.getByText('Catalyst')).not.toBeNull()
    expect(screen.getByText(/Marta finds the transfer\./)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Beat 1.2' }))
    expect(onShowBeat).toHaveBeenCalledWith('beat-1-2')
  })

  it('a landmark on a beat this scene no longer has shows no beat link', () => {
    render(
      <WhatTheSceneDoes
        {...props({ landmarks: [landmark({ beatId: 'beat-9-9' })] })}
      />,
      { wrapper: WithDrafts },
    )
    expect(screen.getByText('Catalyst')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^Beat / })).toBeNull()
  })

  it('locked: every field is read-only and Suggest… is gone', () => {
    const onSuggest = vi.fn()
    render(
      <WhatTheSceneDoes
        {...props({
          scene: scene({ whatHappens: '' }),
          locked: true,
          onSuggest,
        })}
      />,
      { wrapper: WithDrafts },
    )
    for (const label of ['What happens', 'Audience learns', 'Audience feels']) {
      expect(
        (screen.getByLabelText(label) as HTMLTextAreaElement).readOnly,
      ).toBe(true)
    }
    expect(screen.queryByRole('button', { name: 'Suggest…' })).toBeNull()
    expect(onSuggest).not.toHaveBeenCalled()
  })

  it('offers Suggest… on an empty What happens and asks only on click', async () => {
    const user = userEvent.setup()
    const onSuggest = vi.fn().mockResolvedValue([])
    render(
      <WhatTheSceneDoes
        {...props({ scene: scene({ whatHappens: '' }), onSuggest })}
      />,
      { wrapper: WithDrafts },
    )
    expect(onSuggest).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Suggest…' }))
    expect(onSuggest).toHaveBeenCalledTimes(1)
  })
})
```

Create `apps/web/src/plan/panel/WhoWantsWhat.test.tsx`. It ports Inspector.test's "motivations with resolved character name" case: Marta Vega / Come home.

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Character, Motivation } from 'contract'
import { WhoWantsWhat } from './WhoWantsWhat'

afterEach(cleanup)

function character(id: string, name: string): Character {
  return {
    id,
    name,
    locked: false,
    aliases: [],
    embodiment: '',
    presentation: '',
    hiding: '',
    traits: '',
    seriesArc: '',
    summary: '',
    bio: '',
  }
}

const characters = [
  character('char-marta', 'Marta Vega'),
  character('char-dan', 'Dan Vega'),
  character('char-luz', 'Luz Vega'),
]

function motivation(overrides: Partial<Motivation> = {}): Motivation {
  return {
    characterId: 'char-marta',
    objective: 'Come home',
    stakes: 'Everything',
    obstacle: 'Dan',
    statedObjective: '',
    concealed: false,
    ...overrides,
  }
}

describe('WhoWantsWhat', () => {
  it('one card per motivation with the name resolved and Wants / Up against / At stake', () => {
    render(
      <WhoWantsWhat
        motivations={[motivation()]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    const card = screen.getByRole('listitem')
    expect(within(card).getByText('Marta Vega')).not.toBeNull()
    expect(within(card).getByText('Come home')).not.toBeNull()
    expect(within(card).getByText('Dan')).not.toBeNull()
    expect(within(card).getByText('Everything')).not.toBeNull()
    expect(
      within(card)
        .getAllByRole('term')
        .map((el) => el.textContent),
    ).toEqual(['Wants', 'Up against', 'At stake'])
  })

  it('shows Says only when the stated want differs from the real one', () => {
    render(
      <WhoWantsWhat
        motivations={[
          motivation({ statedObjective: 'Just visiting for a week' }),
          motivation({
            characterId: 'char-dan',
            objective: 'Keep the office shut',
            statedObjective: 'Keep the office shut',
          }),
        ]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    const [marta, dan] = screen.getAllByRole('listitem')
    const says = within(marta).getByText('Just visiting for a week')
    expect(says.className).toContain('italic')
    expect(within(dan).queryByText('Says')).toBeNull()
  })

  it('marks a concealed want with a Hidden agenda chip', () => {
    render(
      <WhoWantsWhat
        motivations={[
          motivation({ statedObjective: 'Just visiting', concealed: true }),
        ]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    expect(screen.getByText('Hidden agenda')).not.toBeNull()
  })

  it('reads a stored motivation without statedObjective / concealed (raw PATCH doc)', () => {
    const raw = {
      characterId: 'char-marta',
      objective: 'Come home',
      stakes: '',
      obstacle: '',
    } as unknown as Motivation
    render(
      <WhoWantsWhat
        motivations={[raw]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    expect(screen.getByText('Come home')).not.toBeNull()
    expect(screen.queryByText('Says')).toBeNull()
    expect(screen.queryByText('Hidden agenda')).toBeNull()
    // Empty fields leave no empty rows.
    expect(screen.queryByText('Up against')).toBeNull()
  })

  it('falls back to the character id when the bible has no such character', () => {
    render(
      <WhoWantsWhat
        motivations={[motivation({ characterId: 'char-gone' })]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    expect(screen.getByText('char-gone')).not.toBeNull()
  })

  it('no recorded wants: one quiet line', () => {
    render(
      <WhoWantsWhat
        motivations={[]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    expect(screen.getByText('No wants recorded for this scene.')).not.toBeNull()
    expect(screen.queryByText(/Also in the scene/)).toBeNull()
  })

  it('names the rest of the cast, labelled as read from dialogue cues', () => {
    render(
      <WhoWantsWhat
        motivations={[]}
        characters={characters}
        alsoInScene={[characters[2], characters[1]]}
      />,
    )
    expect(
      screen.getByText('Also in the scene: Luz Vega, Dan Vega', {
        exact: false,
      }),
    ).not.toBeNull()
    expect(screen.getByText('· from dialogue cues')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail.**

```bash
(cd apps/web && npx vitest run src/plan/panel/WhatTheSceneDoes.test.tsx src/plan/panel/WhoWantsWhat.test.tsx)
```

Expected: both files fail with `Failed to resolve import "./WhatTheSceneDoes"` and `Failed to resolve import "./WhoWantsWhat"`.

- [ ] **Step 3: Minimal implementation.** Create `apps/web/src/plan/panel/WhatTheSceneDoes.tsx`:

```tsx
import type { Scene, StoryOverviewBeatItem } from 'contract'
import { PlanField } from './PlanField'
import { draftKey } from './usePlanDrafts'

export interface WhatTheSceneDoesProps {
  scene: Scene
  /** story.landmarksForScene: beat-sheet rows marked in this scene. */
  landmarks: StoryOverviewBeatItem[]
  locked: boolean
  saving: boolean
  openingReview: boolean
  onSaveField: (
    field: 'whatHappens' | 'audienceLearns' | 'audienceFeels',
    value: string,
  ) => Promise<boolean>
  onOpenReview: (instruction: string) => void
  onSuggest: () => Promise<string[]>
  onShowBeat: (beatId: string) => void
}

/**
 * Panel section 1 (spec §4.6): the fields that steer Next Beat. What happens
 * leads (15px, structural, with the explicit Suggest… button), then any
 * beat-sheet landmark marked in this scene, then The audience.
 */
export function WhatTheSceneDoes({
  scene,
  landmarks,
  locked,
  saving,
  openingReview,
  onSaveField,
  onOpenReview,
  onSuggest,
  onShowBeat,
}: WhatTheSceneDoesProps) {
  return (
    <div className="flex flex-col gap-3">
      <PlanField
        label="What happens"
        draftKey={draftKey(scene.id, 'whatHappens')}
        sceneId={scene.id}
        value={scene.whatHappens}
        multiline
        lead
        structural
        locked={locked}
        saving={saving}
        openingReview={openingReview}
        onSave={(value) => onSaveField('whatHappens', value)}
        onOpenReview={onOpenReview}
        onSuggest={onSuggest}
      />
      {landmarks.map((row) => {
        const beat = scene.beats.find((b) => b.id === row.beatId)
        return (
          <p
            key={`${row.beatId}:${row.label}`}
            className="rounded-card bg-tr-sky-soft px-3 py-2 text-13 text-tr-text-primary"
          >
            <span className="text-12 font-semibold uppercase tracking-wide">
              {row.label}
            </span>
            {row.summary && <> — {row.summary}</>}
            {beat && (
              <button
                type="button"
                onClick={() => onShowBeat(beat.id)}
                className="ml-2 text-tr-sky underline"
              >
                <span aria-hidden="true">→ </span>
                {`Beat ${scene.index + 1}.${beat.index + 1}`}
              </button>
            )}
          </p>
        )
      })}
      <div>
        <p className="text-12 font-semibold text-tr-text-secondary">
          The audience
        </p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <PlanField
            label="Learns"
            ariaLabel="Audience learns"
            draftKey={draftKey(scene.id, 'audienceLearns')}
            sceneId={scene.id}
            value={scene.audienceLearns}
            multiline
            locked={locked}
            saving={saving}
            onSave={(value) => onSaveField('audienceLearns', value)}
          />
          <PlanField
            label="Feels"
            ariaLabel="Audience feels"
            draftKey={draftKey(scene.id, 'audienceFeels')}
            sceneId={scene.id}
            value={scene.audienceFeels}
            multiline
            locked={locked}
            saving={saving}
            onSave={(value) => onSaveField('audienceFeels', value)}
          />
        </div>
      </div>
    </div>
  )
}
```

Create `apps/web/src/plan/panel/WhoWantsWhat.tsx`:

```tsx
import type { Character, Motivation } from 'contract'
import { Chip } from '../Chip'
import { characterName } from '../planTree'

export interface WhoWantsWhatProps {
  motivations: Motivation[]
  characters: Character[]
  /** story.castFromDialogue minus the characters with a recorded want. */
  alsoInScene: Character[]
}

/**
 * Panel section 2 (spec §4.6): one read-only card per recorded want. "Says"
 * is `statedObjective`, shown only when it differs from the real want;
 * `concealed` adds the Hidden agenda chip. Both default in the contract but
 * can be missing from a raw PATCH doc, so they are read with fallbacks.
 * Empty fields leave no empty rows.
 */
export function WhoWantsWhat({
  motivations,
  characters,
  alsoInScene,
}: WhoWantsWhatProps) {
  return (
    <div className="flex flex-col gap-2">
      {motivations.length === 0 ? (
        <p className="text-13 text-tr-text-muted">
          No wants recorded for this scene.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {motivations.map((m) => {
            const says = m.statedObjective ?? ''
            const rows = [
              ['Wants', m.objective],
              ['Says', says === m.objective ? '' : says],
              ['Up against', m.obstacle],
              ['At stake', m.stakes],
            ].filter(([, text]) => text)
            return (
              <li
                key={m.characterId}
                className="rounded-card border border-tr-border bg-tr-surface-raised p-3"
              >
                <p className="flex items-center gap-2 text-13 font-semibold text-tr-text-primary">
                  {characterName(characters, m.characterId)}
                  {(m.concealed ?? false) && (
                    <Chip hue="amber">
                      <span aria-hidden="true">◆</span>Hidden agenda
                    </Chip>
                  )}
                </p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-13">
                  {rows.map(([term, text]) => (
                    <div key={term} className="contents">
                      <dt className="text-12 text-tr-text-muted">{term}</dt>
                      <dd
                        className={
                          term === 'Says'
                            ? 'italic text-tr-text-secondary'
                            : 'text-tr-text-primary'
                        }
                      >
                        {text}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            )
          })}
        </ul>
      )}
      {alsoInScene.length > 0 && (
        <p className="text-13 text-tr-text-secondary">
          Also in the scene: {alsoInScene.map((c) => c.name).join(', ')}{' '}
          <span className="text-tr-text-muted">· from dialogue cues</span>
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
(cd apps/web && npx vitest run src/plan/panel/WhatTheSceneDoes.test.tsx src/plan/panel/WhoWantsWhat.test.tsx)
```
```bash
(cd apps/web && npx tsc -b)
(cd apps/web && npx eslint .)
(cd apps/web && npx prettier --check .)
```

Expected: 7 + 7 tests pass; tsc, eslint and prettier are clean.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/plan/panel/WhatTheSceneDoes.tsx apps/web/src/plan/panel/WhatTheSceneDoes.test.tsx apps/web/src/plan/panel/WhoWantsWhat.tsx apps/web/src/plan/panel/WhoWantsWhat.test.tsx
git commit -F - <<'EOF'
plan: add What the scene does and Who wants what panel sections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Persisted panel sections and the Details section

**PR:** T3.3 · **Depends on:** Tasks 2, 4

**Files:**
- Create: `apps/web/src/plan/panel/useSectionOpenState.ts`
- Create: `apps/web/src/plan/panel/PanelSection.tsx`
- Create: `apps/web/src/plan/panel/DetailsSection.tsx`
- Test: `apps/web/src/plan/panel/useSectionOpenState.test.ts`, `apps/web/src/plan/panel/PanelSection.test.tsx`, `apps/web/src/plan/panel/DetailsSection.test.tsx`

**Interfaces:**
- Consumes: `PlanField` (Task 4, `./PlanField`), `draftKey` (Task 2, `./usePlanDrafts`), `WithDrafts` (Task 2, `./testDrafts`), `Scene` (`contract`).
- Produces:
  ```ts
  // useSectionOpenState.ts
  export type PlanSectionId = 'scene' | 'wants' | 'touches' | 'beats' | 'details'
  export function useSectionOpenState(): {
    open: Record<PlanSectionId, boolean>          // defaults: all true except details: false
    setOpen: (id: PlanSectionId, open: boolean) => void   // stable (useCallback)
  }
  // PanelSection.tsx
  export interface PanelSectionProps { id: PlanSectionId; title: string; count?: number; steersNextBeat?: boolean; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }
  export function PanelSection(props: PanelSectionProps): JSX.Element
  //   <details id="plan-section-{id}" data-plan-section="{id}" open={open}> <summary>…</summary> {children} </details>
  // DetailsSection.tsx
  export interface DetailsSectionProps {
    scene: Scene
    showStoryline: boolean
    locked: boolean
    saving: boolean
    onSaveField: (field: 'location' | 'time' | 'socialSituation', value: string) => Promise<boolean>
  }
  export function DetailsSection(props: DetailsSectionProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/plan/panel/useSectionOpenState.test.ts`:

```ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSectionOpenState } from './useSectionOpenState'

const KEY = 'tr.plan.sections.v1'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useSectionOpenState', () => {
  it('opens every section except Details by default', () => {
    const { result } = renderHook(() => useSectionOpenState())
    expect(result.current.open).toEqual({
      scene: true,
      wants: true,
      touches: true,
      beats: true,
      details: false,
    })
  })

  it('remembers a toggle per viewer and reads it back in a new panel', () => {
    const first = renderHook(() => useSectionOpenState())
    act(() => first.result.current.setOpen('details', true))
    act(() => first.result.current.setOpen('wants', false))
    expect(first.result.current.open.details).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({
      details: true,
      wants: false,
    })
    first.unmount()

    const second = renderHook(() => useSectionOpenState())
    expect(second.result.current.open).toMatchObject({
      scene: true,
      wants: false,
      details: true,
    })
  })

  it('ignores a corrupt or partly invalid stored value', () => {
    localStorage.setItem(KEY, '{not json')
    expect(
      renderHook(() => useSectionOpenState()).result.current.open.details,
    ).toBe(false)

    localStorage.setItem(
      KEY,
      JSON.stringify({ details: 'yes', beats: false, extra: true }),
    )
    expect(renderHook(() => useSectionOpenState()).result.current.open).toEqual(
      { scene: true, wants: true, touches: true, beats: false, details: false },
    )
  })

  it('still toggles in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useSectionOpenState())
    expect(result.current.open.details).toBe(false)
    act(() => result.current.setOpen('details', true))
    expect(result.current.open.details).toBe(true)
  })
})
```

`apps/web/src/plan/panel/PanelSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelSection } from './PanelSection'

afterEach(cleanup)

describe('PanelSection', () => {
  it('is a native details element carrying the scroll-spy contract and a counted title', () => {
    render(
      <PanelSection id="beats" title="Beats" count={3} open onToggle={() => {}}>
        <p>ladder</p>
      </PanelSection>,
    )
    const details = document.getElementById(
      'plan-section-beats',
    ) as HTMLDetailsElement
    expect(details.tagName).toBe('DETAILS')
    expect(details.dataset.planSection).toBe('beats')
    expect(details.open).toBe(true)
    expect(screen.getByText('Beats (3)')).not.toBeNull()
    expect(screen.queryByText('steers Next Beat')).toBeNull()
  })

  it('marks the sections that steer Next Beat', () => {
    render(
      <PanelSection
        id="scene"
        title="What the scene does"
        steersNextBeat
        open
        onToggle={() => {}}
      >
        <p>fields</p>
      </PanelSection>,
    )
    expect(screen.getByText('steers Next Beat')).not.toBeNull()
  })

  it('reports the new open state when the summary is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <PanelSection
        id="details"
        title="Details"
        open={false}
        onToggle={onToggle}
      >
        <p>fields</p>
      </PanelSection>,
    )
    await user.click(screen.getByText('Details').closest('summary')!)
    // jsdom queues the details `toggle` event (setTimeout 0).
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(true))
  })
})
```

`apps/web/src/plan/panel/DetailsSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Scene } from 'contract'
import { DetailsSection, type DetailsSectionProps } from './DetailsSection'
import { WithDrafts } from './testDrafts'

afterEach(cleanup)

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night, closing time',
    socialSituation: 'Nearly empty bar; Dan closing alone.',
    whatHappens: 'Marta walks back in.',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...overrides,
  }
}

function renderDetails(overrides: Partial<DetailsSectionProps> = {}) {
  const props: DetailsSectionProps = {
    scene: scene(),
    showStoryline: false,
    locked: false,
    saving: false,
    onSaveField: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
  render(<DetailsSection {...props} />, { wrapper: WithDrafts })
  return props
}

describe('DetailsSection', () => {
  it('shows Location and Time on one line and Social situation as a growing text area', () => {
    renderDetails()
    expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe(
      'INT. THE LONG POUR - NIGHT',
    )
    expect(screen.getByLabelText('Time').tagName).toBe('INPUT')
    expect(screen.getByLabelText('Social situation').tagName).toBe('TEXTAREA')
  })

  it('hides Storyline while the episode has no storylines, and shows it disabled otherwise', () => {
    renderDetails()
    expect(screen.queryByLabelText('Storyline')).toBeNull()
    cleanup()

    renderDetails({ showStoryline: true })
    expect(
      (screen.getByLabelText('Storyline') as HTMLSelectElement).disabled,
    ).toBe(true)
  })

  it('editing location is silent: a plain Save, no structural footer (port from Inspector.test)', async () => {
    const user = userEvent.setup()
    const props = renderDetails()
    const input = screen.getByLabelText('Location')
    await user.clear(input)
    await user.type(input, 'INT. MARINA - DAY')

    expect(screen.queryByText('Structural change — review impact?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save field only' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSaveField).toHaveBeenCalledWith(
      'location',
      'INT. MARINA - DAY',
    )
  })

  it('a locked scene makes every detail read-only, with no Save', () => {
    renderDetails({ locked: true })
    expect(
      (screen.getByLabelText('Location') as HTMLInputElement).readOnly,
    ).toBe(true)
    expect(
      (screen.getByLabelText('Social situation') as HTMLTextAreaElement)
        .readOnly,
    ).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
(cd apps/web && npx vitest run src/plan/panel/useSectionOpenState.test.ts src/plan/panel/PanelSection.test.tsx src/plan/panel/DetailsSection.test.tsx)
```

Expected: all three files fail to load, with `Failed to resolve import "./useSectionOpenState"` (and likewise `./PanelSection` and `./DetailsSection`) and `Does the file exist?`.

- [ ] **Step 3: Minimal implementation**

`apps/web/src/plan/panel/useSectionOpenState.ts`:

```ts
import { useCallback, useState } from 'react'

export type PlanSectionId = 'scene' | 'wants' | 'touches' | 'beats' | 'details'

const STORAGE_KEY = 'tr.plan.sections.v1'

const DEFAULT_OPEN: Record<PlanSectionId, boolean> = {
  scene: true,
  wants: true,
  touches: true,
  beats: true,
  details: false,
}

function loadOpen(): Record<PlanSectionId, boolean> {
  const open = { ...DEFAULT_OPEN }
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '{}',
    )
    if (stored && typeof stored === 'object') {
      for (const id of Object.keys(open) as PlanSectionId[]) {
        const value = (stored as Record<string, unknown>)[id]
        if (typeof value === 'boolean') open[id] = value
      }
    }
  } catch {
    // Blocked storage or a corrupt value: the defaults still work.
  }
  return open
}

/**
 * Which scene-panel sections are open (spec §4.6: native `<details>`, open or
 * closed remembered per viewer). One setting per browser, not per project.
 * Every storage access is guarded, so the in-memory state keeps working in a
 * private window or with site data blocked (pattern: ledger/viewPreference.ts).
 */
export function useSectionOpenState(): {
  open: Record<PlanSectionId, boolean>
  setOpen: (id: PlanSectionId, open: boolean) => void
} {
  const [open, setOpenState] = useState(loadOpen)

  const setOpen = useCallback((id: PlanSectionId, next: boolean) => {
    setOpenState((prev) => {
      if (prev[id] === next) return prev
      const updated = { ...prev, [id]: next }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      } catch {
        // The in-memory state above still toggles.
      }
      return updated
    })
  }, [])

  return { open, setOpen }
}
```

`apps/web/src/plan/panel/PanelSection.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { PlanSectionId } from './useSectionOpenState'

export interface PanelSectionProps {
  id: PlanSectionId
  /** "What the scene does" | "Who wants what" | "What it touches" | "Beats" | "Details" */
  title: string
  /** Rendered as "Title (n)" (Who wants what, Beats). */
  count?: number
  /** Muted "steers Next Beat" note (sections 1–2: these fields feed every Next Beat prompt). */
  steersNextBeat?: boolean
  open: boolean
  onToggle: (open: boolean) => void
  children: ReactNode
}

/**
 * One scene-panel section (spec §4.6): a native `<details>` whose open state
 * the caller persists (useSectionOpenState). `id="plan-section-{id}"` plus
 * `data-plan-section` is the DOM contract ScenePanel's scroll-spy and jump
 * bar read.
 */
export function PanelSection({
  id,
  title,
  count,
  steersNextBeat = false,
  open,
  onToggle,
  children,
}: PanelSectionProps) {
  return (
    <details
      id={`plan-section-${id}`}
      data-plan-section={id}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="group border-t border-tr-border"
    >
      <summary className="flex cursor-pointer items-baseline gap-2 px-4 py-3 focus-visible:outline focus-visible:outline-selected focus-visible:-outline-offset-2 focus-visible:outline-tr-sky">
        <span
          aria-hidden="true"
          className="text-13 text-tr-text-secondary transition-transform group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
        <span className="text-13 font-semibold text-tr-text-primary">
          {count === undefined ? title : `${title} (${count})`}
        </span>
        {steersNextBeat && (
          <span className="ml-auto text-11 text-tr-text-secondary">
            steers Next Beat
          </span>
        )}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}
```

`apps/web/src/plan/panel/DetailsSection.tsx`:

```tsx
import type { Scene } from 'contract'
import { PlanField } from './PlanField'
import { draftKey } from './usePlanDrafts'

export interface DetailsSectionProps {
  scene: Scene
  /** `episode.storylines.length > 0`: owner decision 4 hides Storyline otherwise. */
  showStoryline: boolean
  locked: boolean
  saving: boolean
  onSaveField: (
    field: 'location' | 'time' | 'socialSituation',
    value: string,
  ) => Promise<boolean>
}

const FIELDS = [
  { field: 'location', label: 'Location', multiline: false },
  { field: 'time', label: 'Time', multiline: false },
  { field: 'socialSituation', label: 'Social situation', multiline: true },
] as const

/** Section 5 (closed by default): the scene's plain metadata (spec §4.6, §4.12). */
export function DetailsSection({
  scene,
  showStoryline,
  locked,
  saving,
  onSaveField,
}: DetailsSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      {FIELDS.map(({ field, label, multiline }) => (
        <PlanField
          key={field}
          label={label}
          draftKey={draftKey(scene.id, field)}
          sceneId={scene.id}
          value={scene[field]}
          multiline={multiline}
          locked={locked}
          saving={saving}
          onSave={(value) => onSaveField(field, value)}
        />
      ))}
      {showStoryline && (
        <div>
          <p className="text-12 uppercase tracking-wide text-tr-text-secondary">
            Storyline
          </p>
          <select
            aria-label="Storyline"
            disabled
            title="Storyline tagging is v2"
            className="mt-1 text-13 text-tr-text-secondary"
          >
            <option>{scene.storyline}</option>
          </select>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
(cd apps/web && npx vitest run src/plan/panel/useSectionOpenState.test.ts src/plan/panel/PanelSection.test.tsx src/plan/panel/DetailsSection.test.tsx)
(cd apps/web && npx prettier --write src/plan/panel/useSectionOpenState.ts src/plan/panel/useSectionOpenState.test.ts src/plan/panel/PanelSection.tsx src/plan/panel/PanelSection.test.tsx src/plan/panel/DetailsSection.tsx src/plan/panel/DetailsSection.test.tsx)
(cd apps/web && npx tsc -b && npx eslint . && npx prettier --check .)
```

Expected: 11 tests pass; tsc, eslint and prettier are clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/plan/panel/useSectionOpenState.ts apps/web/src/plan/panel/useSectionOpenState.test.ts apps/web/src/plan/panel/PanelSection.tsx apps/web/src/plan/panel/PanelSection.test.tsx apps/web/src/plan/panel/DetailsSection.tsx apps/web/src/plan/panel/DetailsSection.test.tsx
git commit -F - <<'EOF'
plan: add persisted panel sections and the Details section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: What it touches

**PR:** T3.3 · **Depends on:** Task 1

**Files:**
- Create: `apps/web/src/plan/panel/WhatItTouches.tsx`
- Test: `apps/web/src/plan/panel/WhatItTouches.test.tsx`

**Interfaces:**
- Consumes: `SceneThread`, `SceneSecret`, `factsForScene` (Task 1, `../story`); `characterName` (`../planTree`); `Chip` (`../Chip`); `Character`, `LedgerFact`, `RelationshipState`, `Scene` (`contract`).
- Produces:
  ```ts
  export interface WhatItTouchesProps {
    scenes: Scene[]
    threads: SceneThread[]
    secrets: SceneSecret[]
    facts: { shown: LedgerFact[]; retired: LedgerFact[] }
    relationshipMoments: RelationshipState[]
    characters: Character[]
    onSelectScene: (sceneId: string) => void
    onOpenFact: (factId: string) => void
    onOpenLedger: () => void
  }
  export function WhatItTouches(props: WhatItTouchesProps): JSX.Element
  ```
  Copy contract the tests pin: "↗ Sets up" / "↘ Pays off", "Pays off in n →", "Set up in n →", "Never paid off"; "Dramatic irony.", "The audience knows; A, B +n don't." / "… doesn't." / "The audience knows." / "The audience doesn't know yet.", "In this scene, X is in the dark.", "◆ Set here" / "◆ Kept here" / "◇ Out here", "Set in n", "Out in n"; fact rows: type chip (underscore → space), "Unconfirmed", "Superseded" / "Stale" / "Rejected", "◆ hidden from the audience", "Known by …"; "Show n retired" / "Hide retired", "Open in Ledger →"; "A & B: label"; empty lines "No threads start or land here.", "No secret is kept here.", "No facts established here.", "No relationship moments recorded."; all empty → "Nothing recorded yet: no threads, secret, facts or relationship moments touch this scene."

- [ ] **Step 1: Write the failing test**

`apps/web/src/plan/panel/WhatItTouches.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Character,
  LedgerFact,
  Scene,
  Secret,
  StoryThread,
} from 'contract'
import { factsForScene, type SceneSecret, type SceneThread } from '../story'
import { WhatItTouches, type WhatItTouchesProps } from './WhatItTouches'

afterEach(cleanup)

function scene(id: string, index: number): Scene {
  return {
    id,
    index,
    act: 1,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: '',
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
  }
}

const SCENES = [scene('scene-1', 0), scene('scene-2', 1), scene('scene-4', 3)]

function character(id: string, name: string): Character {
  return {
    id,
    name,
    locked: false,
    aliases: [],
    embodiment: '',
    presentation: '',
    hiding: '',
    traits: '',
    seriesArc: '',
    summary: '',
    bio: '',
  }
}

const CHARACTERS = [
  character('char-marta', 'Marta Vega'),
  character('char-dan', 'Dan Vega'),
  character('char-luz', 'Luz Vega'),
  character('char-reyes', 'Detective Ana Reyes'),
]

function thread(overrides: Partial<StoryThread> = {}): StoryThread {
  return {
    id: 'thread-1',
    label: 'The missing money',
    summary: 'Marta finds the $40,000 hole in the books.',
    status: 'open',
    ownerCharacterIds: ['char-marta'],
    setupSceneId: 'scene-1',
    payoffSceneId: null,
    setupQuote: '',
    payoffQuote: '',
    setupBeatId: null,
    payoffBeatId: null,
    locked: false,
    ...overrides,
  }
}

function secret(overrides: Partial<Secret> = {}): Secret {
  return {
    id: 'secret-1',
    summary: 'Dan took the $40,000.',
    factId: null,
    holderCharacterIds: ['char-dan'],
    concealedFromCharacterIds: ['char-marta', 'char-luz', 'char-reyes'],
    audienceKnows: true,
    establishedSceneId: 'scene-2',
    revealedSceneId: 'scene-4',
    concealmentSceneIds: ['scene-1'],
    establishedQuote: '',
    revealedQuote: '',
    establishedBeatId: null,
    revealedBeatId: null,
    provenance: 'inferred',
    locked: false,
    ...overrides,
  }
}

function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: 'fact-01',
    fact: 'Marta has been away for eight years',
    factType: 'state',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-1',
      beatId: 'beat-1-1',
      startLine: null,
      endLine: null,
      charStart: null,
      charEnd: null,
    },
    sourceText: '',
    knownBy: [],
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'writer_confirmed',
    confidence: 0.9,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
    ...overrides,
  }
}

function renderTouches(overrides: Partial<WhatItTouchesProps> = {}) {
  const props: WhatItTouchesProps = {
    scenes: SCENES,
    threads: [],
    secrets: [],
    facts: { shown: [], retired: [] },
    relationshipMoments: [],
    characters: CHARACTERS,
    onSelectScene: vi.fn(),
    onOpenFact: vi.fn(),
    onOpenLedger: vi.fn(),
    ...overrides,
  }
  render(<WhatItTouches {...props} />)
  return props
}

describe('WhatItTouches', () => {
  it('lists only this scene’s active and pending facts; retired ones wait behind "Show n retired" (port from Inspector.test)', async () => {
    const user = userEvent.setup()
    const ledger = [
      fact({ id: 'fact-01' }),
      fact({
        id: 'fact-02',
        fact: 'The stolen $40,000 is hidden inside the ice machine',
        sourceSpan: { ...fact().sourceSpan, sceneId: 'scene-2' },
      }),
      fact({
        id: 'fact-09',
        fact: 'Marta left town nine years ago',
        status: 'superseded',
      }),
    ]
    renderTouches({ facts: factsForScene(ledger, 'scene-1') })

    expect(
      screen.getByText('Marta has been away for eight years'),
    ).not.toBeNull()
    expect(screen.queryByText(/ice machine/)).toBeNull()
    expect(screen.queryByText('Marta left town nine years ago')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show 1 retired' }))
    expect(screen.getByText('Marta left town nine years ago')).not.toBeNull()
    expect(screen.getByText('Superseded')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Hide retired' })).not.toBeNull()
  })

  it('a pending fact reads Unconfirmed; a fact hidden from the audience says so; type and Known by show', () => {
    renderTouches({
      facts: {
        shown: [
          fact({
            id: 'fact-06',
            status: 'pending_review',
            audienceKnows: false,
            factType: 'world_rule',
            knownBy: ['char-marta', 'char-dan', 'char-luz'],
          }),
        ],
        retired: [],
      },
    })
    const row = screen.getByRole('button', { name: /Marta has been away/ })
    expect(within(row).getByText('Unconfirmed')).not.toBeNull()
    expect(within(row).getByText('world rule')).not.toBeNull()
    expect(within(row).getByText('◆ hidden from the audience')).not.toBeNull()
    expect(
      within(row).getByText('Known by Marta Vega, Dan Vega +1'),
    ).not.toBeNull()
  })

  it('a fact opens in Ledger, and "Open in Ledger →" opens the Ledger', async () => {
    const user = userEvent.setup()
    const props = renderTouches({ facts: { shown: [fact()], retired: [] } })
    await user.click(
      screen.getByRole('button', { name: /Marta has been away/ }),
    )
    expect(props.onOpenFact).toHaveBeenCalledWith('fact-01')
    await user.click(screen.getByRole('button', { name: 'Open in Ledger →' }))
    expect(props.onOpenLedger).toHaveBeenCalled()
  })

  it('threads link to the other end; a setup with no payoff scene says Never paid off', async () => {
    const user = userEvent.setup()
    const threads: SceneThread[] = [
      {
        thread: thread({ id: 'thread-1', payoffSceneId: 'scene-4' }),
        role: 'sets_up',
        otherSceneId: 'scene-4',
      },
      {
        thread: thread({ id: 'thread-2', label: 'The foreclosure notice' }),
        role: 'sets_up',
        otherSceneId: null,
      },
      {
        thread: thread({ id: 'thread-4', label: 'A deleted payoff' }),
        role: 'sets_up',
        otherSceneId: 'scene-99',
      },
      {
        thread: thread({
          id: 'thread-3',
          label: 'Her old stool',
          setupSceneId: 'scene-2',
        }),
        role: 'pays_off',
        otherSceneId: 'scene-2',
      },
    ]
    const props = renderTouches({ threads })

    expect(screen.getAllByText('↗ Sets up')).toHaveLength(3)
    expect(screen.getByText('↘ Pays off')).not.toBeNull()
    expect(screen.getAllByText('Never paid off')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Pays off in 4 →' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-4')
    await user.click(screen.getByRole('button', { name: 'Set up in 2 →' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-2')
  })

  it('the secret reads as a dramatic-irony callout, naming who in this scene is in the dark', async () => {
    const user = userEvent.setup()
    const secrets: SceneSecret[] = [
      { secret: secret(), role: 'kept', inTheDark: ['char-marta'] },
    ]
    const props = renderTouches({ secrets })

    expect(screen.getByText('Dramatic irony.')).not.toBeNull()
    expect(
      screen.getByText("The audience knows; Marta Vega, Luz Vega +1 don't."),
    ).not.toBeNull()
    expect(
      screen.getByText('In this scene, Marta Vega is in the dark.'),
    ).not.toBeNull()
    expect(screen.getByText('◆ Kept here')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Set in 2' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-2')
    await user.click(screen.getByRole('button', { name: 'Out in 4' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-4')
  })

  it('a secret the audience has not been told says so, and its own scene gets no self-link', () => {
    renderTouches({
      secrets: [
        {
          secret: secret({
            audienceKnows: false,
            establishedSceneId: 'scene-1',
          }),
          role: 'set',
          inTheDark: [],
        },
      ],
    })
    expect(screen.getByText("The audience doesn't know yet.")).not.toBeNull()
    expect(screen.getByText('◆ Set here')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^Set in/ })).toBeNull()
    expect(screen.queryByText(/in the dark/)).toBeNull()
  })

  it('relationship moments read "A & B: label"', () => {
    renderTouches({
      relationshipMoments: [
        {
          between: ['char-marta', 'char-dan'],
          label: 'estranged co-owners',
          sceneId: 'scene-1',
          quote: '',
        },
      ],
    })
    expect(
      screen.getByText('Marta Vega & Dan Vega: estranged co-owners'),
    ).not.toBeNull()
  })

  it('each empty group gets one quiet line; with nothing at all the section is one line', () => {
    renderTouches({ facts: { shown: [fact()], retired: [] } })
    expect(screen.getByText('No threads start or land here.')).not.toBeNull()
    expect(screen.getByText('No secret is kept here.')).not.toBeNull()
    expect(screen.getByText('No relationship moments recorded.')).not.toBeNull()
    cleanup()

    renderTouches()
    expect(
      screen.getByText(
        'Nothing recorded yet: no threads, secret, facts or relationship moments touch this scene.',
      ),
    ).not.toBeNull()
    expect(screen.queryByText('No threads start or land here.')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
(cd apps/web && npx vitest run src/plan/panel/WhatItTouches.test.tsx)
```

Expected: the file fails to load with `Failed to resolve import "./WhatItTouches"`.

- [ ] **Step 3: Minimal implementation**

`apps/web/src/plan/panel/WhatItTouches.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import type { Character, LedgerFact, RelationshipState, Scene } from 'contract'
import { Chip } from '../Chip'
import { characterName } from '../planTree'
import type { SceneSecret, SceneThread } from '../story'

export interface WhatItTouchesProps {
  /** To print other scenes' numbers (index + 1) and to link only to scenes that exist. */
  scenes: Scene[]
  threads: SceneThread[]
  secrets: SceneSecret[]
  facts: { shown: LedgerFact[]; retired: LedgerFact[] }
  relationshipMoments: RelationshipState[]
  characters: Character[]
  onSelectScene: (sceneId: string) => void
  onOpenFact: (factId: string) => void
  onOpenLedger: () => void
}

const ROLE_TAG: Record<SceneSecret['role'], string> = {
  set: '◆ Set here',
  kept: '◆ Kept here',
  out: '◇ Out here',
}

const RETIRED_WORD: Partial<Record<LedgerFact['status'], string>> = {
  superseded: 'Superseded',
  stale: 'Stale',
  rejected: 'Rejected',
}

const QUIET = 'text-13 text-tr-text-secondary'
const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'
const LINK = `text-13 text-tr-text-primary underline ${FOCUS}`

/** "A, B +2": the first two names, then how many more. */
function shortList(names: string[]): string {
  return names.length > 2
    ? `${names.slice(0, 2).join(', ')} +${names.length - 2}`
    : names.join(', ')
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-12 font-semibold uppercase tracking-wide text-tr-text-primary">
        {title}
      </h3>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </div>
  )
}

function FactRow({
  fact,
  knownBy,
  onOpen,
}: {
  fact: LedgerFact
  knownBy: string
  onOpen: (factId: string) => void
}) {
  const retiredWord = RETIRED_WORD[fact.status]
  return (
    <button
      type="button"
      onClick={() => onOpen(fact.id)}
      className={`flex w-full flex-col items-start gap-1 rounded-card border border-tr-border bg-tr-surface-raised p-2 text-left hover:bg-tr-surface-clay ${FOCUS}`}
    >
      <span className="text-13 text-tr-text-primary">{fact.fact}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-12 text-tr-text-secondary">
        <Chip hue="sky">{fact.factType.replace(/_/g, ' ')}</Chip>
        {fact.status === 'pending_review' && (
          <Chip hue="neutral">Unconfirmed</Chip>
        )}
        {retiredWord && <Chip hue="neutral">{retiredWord}</Chip>}
        {fact.audienceKnows === false && (
          <span>◆ hidden from the audience</span>
        )}
        {knownBy && <span>Known by {knownBy}</span>}
      </span>
    </button>
  )
}

/**
 * Section 3 (spec §4.6): what this scene connects to. Threads it sets up or
 * pays off, the secret as a dramatic-irony callout, the facts it establishes
 * (active and pending; retired behind a toggle, spec §4.12), and relationship
 * moments. Read-only; the data is derived in story.ts by ScenePanel.
 */
export function WhatItTouches({
  scenes,
  threads,
  secrets,
  facts,
  relationshipMoments,
  characters,
  onSelectScene,
  onOpenFact,
  onOpenLedger,
}: WhatItTouchesProps) {
  const [showRetired, setShowRetired] = useState(false)

  const sceneById = (id: string | null) => scenes.find((s) => s.id === id)
  const names = (ids: readonly string[]) =>
    ids.map((id) => characterName(characters, id))
  const sceneLink = (text: string, sceneId: string) => (
    <button
      type="button"
      onClick={() => onSelectScene(sceneId)}
      className={LINK}
    >
      {text}
    </button>
  )

  const total =
    threads.length +
    secrets.length +
    facts.shown.length +
    facts.retired.length +
    relationshipMoments.length
  if (total === 0) {
    return (
      <p className={QUIET}>
        Nothing recorded yet: no threads, secret, facts or relationship moments
        touch this scene.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Group title="Threads">
        {threads.length === 0 && (
          <p className={QUIET}>No threads start or land here.</p>
        )}
        {threads.map(({ thread, role, otherSceneId }) => {
          const other = sceneById(otherSceneId)
          return (
            <div key={`${thread.id}:${role}`} className="text-13">
              <p className="text-tr-text-primary">
                <span className="text-tr-text-secondary">
                  {role === 'sets_up' ? '↗ Sets up' : '↘ Pays off'}
                </span>{' '}
                <span className="font-semibold">{thread.label}</span>
              </p>
              {thread.summary && (
                <p className="text-tr-text-secondary">{thread.summary}</p>
              )}
              <p className="mt-1">
                {role === 'sets_up' ? (
                  other ? (
                    sceneLink(`Pays off in ${other.index + 1} →`, other.id)
                  ) : (
                    <Chip hue="amber">Never paid off</Chip>
                  )
                ) : (
                  other && sceneLink(`Set up in ${other.index + 1} →`, other.id)
                )}
              </p>
            </div>
          )
        })}
      </Group>

      <Group title="The secret">
        {secrets.length === 0 && (
          <p className={QUIET}>No secret is kept here.</p>
        )}
        {secrets.map(({ secret, role, inTheDark }) => {
          const hiddenFrom = names(secret.concealedFromCharacterIds ?? [])
          const setIn =
            role === 'set' ? undefined : sceneById(secret.establishedSceneId)
          const outIn =
            role === 'out' ? undefined : sceneById(secret.revealedSceneId)
          const audience =
            secret.audienceKnows === false
              ? "The audience doesn't know yet."
              : hiddenFrom.length === 0
                ? 'The audience knows.'
                : `The audience knows; ${shortList(hiddenFrom)} ${hiddenFrom.length === 1 ? "doesn't" : "don't"}.`
          return (
            <div
              key={secret.id}
              className="rounded-card border border-tr-border bg-tr-surface-sunken p-3 text-13 text-tr-text-primary"
            >
              <p>
                <span className="font-semibold">Dramatic irony.</span>{' '}
                {secret.summary}
              </p>
              <p className="mt-1">{audience}</p>
              {inTheDark.length > 0 && (
                <p className="mt-1 font-semibold">
                  {`In this scene, ${names(inTheDark).join(', ')} ${inTheDark.length === 1 ? 'is' : 'are'} in the dark.`}
                </p>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-3">
                <Chip hue="amber">{ROLE_TAG[role]}</Chip>
                {setIn && sceneLink(`Set in ${setIn.index + 1}`, setIn.id)}
                {outIn && sceneLink(`Out in ${outIn.index + 1}`, outIn.id)}
              </p>
            </div>
          )
        })}
      </Group>

      <Group title="Facts established here">
        {facts.shown.length === 0 && (
          <p className={QUIET}>No facts established here.</p>
        )}
        {facts.shown.map((fact) => (
          <FactRow
            key={fact.id}
            fact={fact}
            knownBy={shortList(names(fact.knownBy))}
            onOpen={onOpenFact}
          />
        ))}
        <p className="flex flex-wrap gap-3">
          {facts.retired.length > 0 && (
            <button
              type="button"
              aria-expanded={showRetired}
              onClick={() => setShowRetired((v) => !v)}
              className={LINK}
            >
              {showRetired
                ? 'Hide retired'
                : `Show ${facts.retired.length} retired`}
            </button>
          )}
          <button type="button" onClick={onOpenLedger} className={LINK}>
            Open in Ledger →
          </button>
        </p>
        {showRetired &&
          facts.retired.map((fact) => (
            <FactRow
              key={fact.id}
              fact={fact}
              knownBy={shortList(names(fact.knownBy))}
              onOpen={onOpenFact}
            />
          ))}
      </Group>

      <Group title="Relationships">
        {relationshipMoments.length === 0 ? (
          <p className={QUIET}>No relationship moments recorded.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-13 text-tr-text-primary">
            {relationshipMoments.map((moment, i) => (
              <li key={`${moment.between.join('&')}:${i}`}>
                {`${names(moment.between).join(' & ')}: ${moment.label}`}
              </li>
            ))}
          </ul>
        )}
      </Group>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
(cd apps/web && npx vitest run src/plan/panel/WhatItTouches.test.tsx)
(cd apps/web && npx prettier --write src/plan/panel/WhatItTouches.tsx src/plan/panel/WhatItTouches.test.tsx)
(cd apps/web && npx tsc -b && npx eslint . && npx prettier --check .)
```

Expected: 8 tests pass; tsc, eslint and prettier are clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/plan/panel/WhatItTouches.tsx apps/web/src/plan/panel/WhatItTouches.test.tsx
git commit -F - <<'EOF'
plan: add the What it touches panel section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Beat ladder with Beat and Script locks

**PR:** T3.3 · **Depends on:** Tasks 1, 2, 4

**Files:**
- Create: `apps/web/src/plan/panel/BeatLadder.tsx`
- Modify: `apps/web/src/plan/LockToggle.tsx` (props interface, lines 21–26; destructuring, lines 36–41; `data-testid`, line 48)
- Test: `apps/web/src/plan/panel/BeatLadder.test.tsx`

**Interfaces:**
- Consumes: `PlanField`, `BeatTextField` (Task 4, `./PlanField`); `draftKey` (Task 2); `WithDrafts` (Task 2, `./testDrafts`); `PlanNote` (Task 1, `../story`); `isBeatEffectivelyLocked` (`../planTree`); `Chip`, `LockToggle`.
- Produces:
  ```ts
  // LockToggle.tsx
  export interface LockToggleProps { locked: boolean; label: string; onChange: (next: boolean) => void; disabled?: boolean; testId?: string /* default 'lock-toggle' */ }
  // BeatLadder.tsx
  export interface BeatLadderProps {
    scene: Scene
    episodeLocked: boolean
    selectedBeatId: string | null
    notes: PlanNote[]
    landmarks: StoryOverviewBeatItem[]
    timeJump: TimelineAnchor | null
    pending: boolean
    onSelectBeat: (beatId: string | null) => void
    onToggleBeatLock: (beatId: string, locked: boolean) => void
    onToggleBeatScriptLock: (beatId: string, scriptLocked: boolean) => void
    onSaveBeatField: (beatId: string, field: BeatTextField, value: string) => Promise<boolean>
    onOpenBeatInWrite: (beatId: string) => void
  }
  export function BeatLadder(props: BeatLadderProps): JSX.Element
  ```
  DOM: row `<button data-testid="beat-card-{beat.id}" aria-expanded>`; expanded toggles `beat-lock-toggle-{id}` / `script-lock-toggle-{id}`; field aria-labels `Beat {n.m}: What happens | Audience learns | Audience feels | Script`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/plan/panel/BeatLadder.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Beat, ConsistencyFlag, Scene } from 'contract'
import type { PlanNote } from '../story'
import { BeatLadder, type BeatLadderProps } from './BeatLadder'
import { WithDrafts } from './testDrafts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function beat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: 'beat-1-1',
    index: 0,
    locked: false,
    whatHappens: 'Marta walks in mid-closing.',
    audienceLearns: 'She has been gone eight years.',
    audienceFeels: 'Unease.',
    scriptText: "INT. THE LONG POUR - NIGHT\n\nDAN\nWe're closed.",
    scriptLocked: false,
    ...overrides,
  }
}

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: '',
    whatHappens: 'Marta walks back in.',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [
      beat(),
      beat({
        id: 'beat-1-2',
        index: 1,
        locked: true,
        scriptLocked: true,
        whatHappens: 'Marta finds the transfer in the books.',
      }),
      beat({ id: 'beat-1-3', index: 2, whatHappens: '' }),
    ],
    ...overrides,
  }
}

function flag(overrides: Partial<ConsistencyFlag> = {}): ConsistencyFlag {
  return {
    id: 'flag-1',
    objectType: 'beat',
    objectId: 'beat-1-1',
    factId: null,
    explanation: 'Dan says the bar is closed, but Scene 3 has it open.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-1',
    ...overrides,
  }
}

function renderLadder(overrides: Partial<BeatLadderProps> = {}) {
  const props: BeatLadderProps = {
    scene: scene(),
    episodeLocked: false,
    selectedBeatId: null,
    notes: [],
    landmarks: [],
    timeJump: null,
    pending: false,
    onSelectBeat: vi.fn(),
    onToggleBeatLock: vi.fn(),
    onToggleBeatScriptLock: vi.fn(),
    onSaveBeatField: vi.fn().mockResolvedValue(true),
    onOpenBeatInWrite: vi.fn(),
    ...overrides,
  }
  const view = render(<BeatLadder {...props} />, { wrapper: WithDrafts })
  return { props, ...view }
}

describe('BeatLadder', () => {
  it("rows show each beat's number and plan, never its first script line", () => {
    renderLadder()
    const row = screen.getByTestId('beat-card-beat-1-1')
    expect(row.textContent).toContain('1.1')
    expect(row.textContent).toContain('Marta walks in mid-closing.')
    expect(row.textContent).not.toContain('INT. THE LONG POUR')
    expect(screen.getByTestId('beat-card-beat-1-3').textContent).toContain(
      '(no plan yet)',
    )
  })

  it('an effectively locked beat reads Locked, cascading from the episode and the scene', () => {
    const { props, rerender } = renderLadder()
    expect(screen.getByTestId('beat-card-beat-1-2').textContent).toContain(
      'Locked',
    )
    expect(screen.getByTestId('beat-card-beat-1-1').textContent).not.toContain(
      'Locked',
    )

    rerender(<BeatLadder {...props} episodeLocked />)
    expect(screen.getByTestId('beat-card-beat-1-1').textContent).toContain(
      'Locked',
    )

    rerender(<BeatLadder {...props} scene={scene({ locked: true })} />)
    expect(screen.getByTestId('beat-card-beat-1-3').textContent).toContain(
      'Locked',
    )
  })

  it('marks a beat with a story note and a beat with only an import note differently', () => {
    const s = scene()
    const notes: PlanNote[] = [
      { flag: flag(), kind: 'continuity', beat: s.beats[0] },
      {
        flag: flag({
          id: 'flag-2',
          objectId: 'beat-1-2',
          explanation: '[model_unassigned] source lines 10-12 were kept here',
        }),
        kind: 'import',
        beat: s.beats[1],
      },
    ]
    renderLadder({ scene: s, notes })
    expect(
      within(screen.getByTestId('beat-card-beat-1-1')).getByText('Story note'),
    ).not.toBeNull()
    expect(
      within(screen.getByTestId('beat-card-beat-1-2')).getByText('Import note'),
    ).not.toBeNull()
    expect(
      within(screen.getByTestId('beat-card-beat-1-3')).queryByText(/note/),
    ).toBeNull()
  })

  it('tags the landmark beat, says the last beat lands, and ends with the time jump', () => {
    renderLadder({
      landmarks: [
        {
          beatId: 'beat-1-2',
          label: 'ACT ONE TURN',
          summary: 'Marta finds the transfer.',
          sceneId: 'scene-1',
          act: 1,
        },
      ],
      timeJump: {
        afterSceneId: 'scene-1',
        label: 'The next morning',
        kind: 'relative',
        quote: '',
      },
    })
    expect(screen.getByTestId('beat-card-beat-1-2').textContent).toContain(
      'ACT ONE TURN',
    )
    expect(screen.getByTestId('beat-card-beat-1-3').textContent).toContain(
      'lands',
    )
    expect(screen.getByTestId('beat-card-beat-1-1').textContent).not.toContain(
      'lands',
    )
    expect(
      screen.getByText('↷ Then a time jump: The next morning'),
    ).not.toBeNull()
  })

  it('clicking a row selects it; clicking the open row goes back to the scene', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderLadder()
    const row = screen.getByTestId('beat-card-beat-1-1')
    expect(row.getAttribute('aria-expanded')).toBe('false')
    await user.click(row)
    expect(props.onSelectBeat).toHaveBeenCalledWith('beat-1-1')

    rerender(<BeatLadder {...props} selectedBeatId="beat-1-1" />)
    const open = screen.getByTestId('beat-card-beat-1-1')
    expect(open.getAttribute('aria-expanded')).toBe('true')
    await user.click(open)
    expect(props.onSelectBeat).toHaveBeenLastCalledWith(null)
  })

  it('expands only the selected row, with beat-scoped labels that leave "What happens" to the scene', () => {
    renderLadder({ selectedBeatId: 'beat-1-1' })
    expect(
      (screen.getByLabelText('Beat 1.1: What happens') as HTMLTextAreaElement)
        .value,
    ).toBe('Marta walks in mid-closing.')
    expect(screen.getByLabelText('Beat 1.1: Audience learns')).not.toBeNull()
    expect(screen.getByLabelText('Beat 1.1: Audience feels')).not.toBeNull()
    expect(screen.queryByLabelText('Beat 1.2: What happens')).toBeNull()
    // The scene's own field owns the exact name (e2e getByLabel strictness).
    expect(screen.queryByLabelText('What happens')).toBeNull()
  })

  it('Beat lock and Script lock call back with the flipped value and never take the scene lock-toggle id', async () => {
    const user = userEvent.setup()
    const { props } = renderLadder({ selectedBeatId: 'beat-1-1' })
    expect(screen.queryByTestId('lock-toggle')).toBeNull()

    await user.click(screen.getByTestId('beat-lock-toggle-beat-1-1'))
    expect(props.onToggleBeatLock).toHaveBeenCalledWith('beat-1-1', true)
    await user.click(screen.getByTestId('script-lock-toggle-beat-1-1'))
    expect(props.onToggleBeatScriptLock).toHaveBeenCalledWith('beat-1-1', true)
  })

  it('a locked toggle renders as the accent pill switch (port from Inspector.test)', () => {
    renderLadder({ selectedBeatId: 'beat-1-2' })
    const toggle = screen.getByTestId('script-lock-toggle-beat-1-2')
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.className).toContain('rounded-chip')
    expect(toggle.className).toContain('bg-tr-coral')
    expect(toggle.className).toContain('text-tr-surface-raised')
  })

  it('keeps the script behind a closed Script text disclosure, and opens the beat in Write', async () => {
    const user = userEvent.setup()
    const { props } = renderLadder({ selectedBeatId: 'beat-1-1' })
    const disclosure = screen
      .getByText('Script text')
      .closest('details') as HTMLDetailsElement
    expect(disclosure.open).toBe(false)
    expect(
      (screen.getByLabelText('Beat 1.1: Script') as HTMLTextAreaElement).value,
    ).toContain("We're closed.")

    await user.click(
      screen.getByRole('button', { name: 'Open beat in Write ↗' }),
    )
    expect(props.onOpenBeatInWrite).toHaveBeenCalledWith('beat-1-1')
  })

  it('an effectively locked beat is read-only, but its lock toggles still work (port from Inspector.test)', async () => {
    const user = userEvent.setup()
    const { props } = renderLadder({ selectedBeatId: 'beat-1-2' })
    expect(
      (screen.getByLabelText('Beat 1.2: What happens') as HTMLTextAreaElement)
        .readOnly,
    ).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

    await user.click(screen.getByTestId('beat-lock-toggle-beat-1-2'))
    expect(props.onToggleBeatLock).toHaveBeenCalledWith('beat-1-2', false)
  })

  it('disables both lock toggles while a save is pending', () => {
    renderLadder({ selectedBeatId: 'beat-1-1', pending: true })
    expect(
      (screen.getByTestId('beat-lock-toggle-beat-1-1') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId('script-lock-toggle-beat-1-1') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('saves an edited beat field through onSaveBeatField', async () => {
    const user = userEvent.setup()
    const { props } = renderLadder({ selectedBeatId: 'beat-1-1' })
    const learns = screen.getByLabelText('Beat 1.1: Audience learns')
    await user.clear(learns)
    await user.type(learns, 'She knows about the money.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSaveBeatField).toHaveBeenCalledWith(
      'beat-1-1',
      'audienceLearns',
      'She knows about the money.',
    )
  })

  it('scrolls the selected row into view', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderLadder({ selectedBeatId: 'beat-1-2' })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrollIntoView.mock.contexts[0]).toBe(
      screen.getByTestId('beat-card-beat-1-2'),
    )
  })

  it('says so when the scene has no beats yet', () => {
    renderLadder({ scene: scene({ beats: [] }) })
    expect(screen.getByText('No beats yet.')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
(cd apps/web && npx vitest run src/plan/panel/BeatLadder.test.tsx)
```

Expected: the file fails to load with `Failed to resolve import "./BeatLadder"`.

- [ ] **Step 3: Minimal implementation**

`apps/web/src/plan/LockToggle.tsx`: replace the props interface and the component signature, and use the prop for the test id.

```tsx
export interface LockToggleProps {
  locked: boolean
  label: string
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Defaults to `lock-toggle`, the lock-and-regenerate recipe's target
   * (first match in the DOM). Only the scene toggle may keep it; beat
   * toggles pass `beat-lock-toggle-{id}` / `script-lock-toggle-{id}`. */
  testId?: string
}
```

```tsx
export function LockToggle({
  locked,
  label,
  onChange,
  disabled,
  testId = 'lock-toggle',
}: LockToggleProps) {
```

and on the `<button>`, change `data-testid="lock-toggle"` to `data-testid={testId}`. Leave the rest of the file unchanged.

`apps/web/src/plan/panel/BeatLadder.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { Scene, StoryOverviewBeatItem, TimelineAnchor } from 'contract'
import { Chip } from '../Chip'
import { LockToggle } from '../LockToggle'
import { isBeatEffectivelyLocked } from '../planTree'
import type { PlanNote } from '../story'
import { PlanField, type BeatTextField } from './PlanField'
import { draftKey } from './usePlanDrafts'

// Moved from BeatCard.tsx (deleted in T3.3).
function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

/** ⚑ (amber) when the beat has a story note, ⚐ when it has only import notes;
 * the meaning is in words for screen readers, not in colour alone. */
function NoteMarker({ notes }: { notes: PlanNote[] }) {
  if (notes.length === 0) return null
  const story = notes.some((note) => note.kind !== 'import')
  return (
    <span className={story ? 'text-tr-amber' : 'text-tr-text-secondary'}>
      <span aria-hidden="true">{story ? '⚑' : '⚐'}</span>
      <span className="sr-only">{story ? 'Story note' : 'Import note'}</span>
    </span>
  )
}

const PLAN_FIELDS: { field: BeatTextField; label: string }[] = [
  { field: 'whatHappens', label: 'What happens' },
  { field: 'audienceLearns', label: 'Audience learns' },
  { field: 'audienceFeels', label: 'Audience feels' },
]

export interface BeatLadderProps {
  scene: Scene
  episodeLocked: boolean
  /** The one expanded row (driven by PlanSelection). */
  selectedBeatId: string | null
  /** story.notesForScene: the ⚑ / ⚐ marker per beat. */
  notes: PlanNote[]
  /** story.landmarksForScene: a tag on the matching beat row. */
  landmarks: StoryOverviewBeatItem[]
  /** The anchor whose afterSceneId is this scene: a divider after the last beat. */
  timeJump: TimelineAnchor | null
  pending: boolean
  /** null = collapse (back to the scene selection). */
  onSelectBeat: (beatId: string | null) => void
  onToggleBeatLock: (beatId: string, locked: boolean) => void
  onToggleBeatScriptLock: (beatId: string, scriptLocked: boolean) => void
  onSaveBeatField: (
    beatId: string,
    field: BeatTextField,
    value: string,
  ) => Promise<boolean>
  onOpenBeatInWrite: (beatId: string) => void
}

/**
 * Section 4 (spec §4.6): the scene's beats as a ladder. Rows show the beat's
 * plan (`whatHappens`), not its first script line, and carry the note
 * marker, the cascaded lock, the beat-sheet landmark and "lands" on the last
 * beat. Opening a row edits the beat in place: plan fields, the Beat lock
 * (`beat.locked`, new), the Script lock and the script behind a disclosure.
 * Fields are read-only when the beat is effectively locked; the lock
 * toggles stay live (lock fields are server-exempt) and only wait for a
 * save in flight.
 */
export function BeatLadder({
  scene,
  episodeLocked,
  selectedBeatId,
  notes,
  landmarks,
  timeJump,
  pending,
  onSelectBeat,
  onToggleBeatLock,
  onToggleBeatScriptLock,
  onSaveBeatField,
  onOpenBeatInWrite,
}: BeatLadderProps) {
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (!selectedBeatId) return
    listRef.current
      ?.querySelector(`[data-testid="beat-card-${selectedBeatId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedBeatId])

  const beats = [...scene.beats].sort((a, b) => a.index - b.index)
  const lastBeatId = beats.at(-1)?.id

  return (
    <div>
      {beats.length === 0 ? (
        <p className="text-13 text-tr-text-secondary">No beats yet.</p>
      ) : (
        <ol ref={listRef} className="flex flex-col gap-1">
          {beats.map((beat) => {
            const number = `${scene.index + 1}.${beat.index + 1}`
            const expanded = beat.id === selectedBeatId
            const locked = isBeatEffectivelyLocked(episodeLocked, scene, beat)
            const landmark = landmarks.find((item) => item.beatId === beat.id)
            const fieldProps = (field: BeatTextField, label: string) => ({
              label,
              ariaLabel: `Beat ${number}: ${label}`,
              draftKey: draftKey(beat.id, field),
              sceneId: scene.id,
              value: beat[field],
              multiline: true,
              locked,
              saving: pending,
              onSave: (value: string) => onSaveBeatField(beat.id, field, value),
            })
            return (
              <li
                key={beat.id}
                className={
                  expanded ? 'rounded-card bg-tr-surface-sunken' : undefined
                }
              >
                <button
                  type="button"
                  data-testid={`beat-card-${beat.id}`}
                  aria-expanded={expanded}
                  onClick={() => onSelectBeat(expanded ? null : beat.id)}
                  className="flex w-full items-start gap-2 rounded-card p-2 text-left hover:bg-tr-surface-clay focus-visible:outline focus-visible:outline-selected focus-visible:-outline-offset-2 focus-visible:outline-tr-sky"
                >
                  <span className="shrink-0 text-12 font-semibold text-tr-text-primary">
                    {number}
                  </span>
                  <span
                    className={
                      'min-w-0 flex-1 text-13' +
                      (beat.whatHappens
                        ? ' text-tr-text-primary'
                        : ' italic text-tr-text-secondary')
                    }
                  >
                    {beat.whatHappens || '(no plan yet)'}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <NoteMarker
                      notes={notes.filter((note) => note.beat?.id === beat.id)}
                    />
                    {locked && (
                      <Chip hue="amber">
                        <LockGlyph /> Locked
                      </Chip>
                    )}
                    {landmark && <Chip hue="sky">{landmark.label}</Chip>}
                    {beat.id === lastBeatId && (
                      <span className="text-11 text-tr-text-secondary">
                        lands
                      </span>
                    )}
                  </span>
                </button>
                {expanded && (
                  <div className="flex flex-col gap-3 px-2 pb-3 pt-1">
                    {PLAN_FIELDS.map(({ field, label }) => (
                      <PlanField key={field} {...fieldProps(field, label)} />
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <LockToggle
                        label="Beat"
                        locked={beat.locked}
                        disabled={pending}
                        testId={`beat-lock-toggle-${beat.id}`}
                        onChange={(next) => onToggleBeatLock(beat.id, next)}
                      />
                      <LockToggle
                        label="Script"
                        locked={beat.scriptLocked}
                        disabled={pending}
                        testId={`script-lock-toggle-${beat.id}`}
                        onChange={(next) =>
                          onToggleBeatScriptLock(beat.id, next)
                        }
                      />
                    </div>
                    <details>
                      <summary className="cursor-pointer text-13 text-tr-text-primary">
                        Script text
                      </summary>
                      {/* PlanField has no font prop; preflight's `font: inherit` carries Courier in. */}
                      <div className="mt-2 font-script">
                        <PlanField {...fieldProps('scriptText', 'Script')} />
                      </div>
                    </details>
                    <button
                      type="button"
                      onClick={() => onOpenBeatInWrite(beat.id)}
                      className="self-start text-13 text-tr-text-primary underline focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky"
                    >
                      Open beat in Write ↗
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {timeJump && (
        <p className="mt-2 border-t border-dashed border-tr-border pt-2 text-12 text-tr-text-secondary">
          ↷ Then a time jump: {timeJump.label}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
(cd apps/web && npx vitest run src/plan/panel/BeatLadder.test.tsx src/plan/Inspector.test.tsx)
(cd apps/web && npx prettier --write src/plan/panel/BeatLadder.tsx src/plan/panel/BeatLadder.test.tsx src/plan/LockToggle.tsx)
(cd apps/web && npx tsc -b && npx eslint . && npx prettier --check .)
```

Expected: 14 BeatLadder tests pass. Inspector.test still passes, because the default `testId` keeps `lock-toggle` on the existing scene and beat switches until Task 10 deletes it. tsc, eslint and prettier are clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/plan/panel/BeatLadder.tsx apps/web/src/plan/panel/BeatLadder.test.tsx apps/web/src/plan/LockToggle.tsx
git commit -F - <<'EOF'
plan: add the beat ladder with Beat and Script locks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Panel shell: sticky header, jump bar, ScenePanel, EpisodePanel

**PR:** T3.3 · **Depends on:** Tasks 1–8

**Files:**
- Create: `apps/web/src/plan/panel/PanelHeader.tsx`
- Create: `apps/web/src/plan/panel/ScenePanel.tsx`
- Create: `apps/web/src/plan/panel/EpisodePanel.tsx`
- Test: `apps/web/src/plan/panel/ScenePanel.test.tsx` (also covers PanelHeader)
- Test: `apps/web/src/plan/panel/EpisodePanel.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1 (`../story`): `boardOrder`, `castFromDialogue`, `factsForScene`, `landmarksForScene`, `notesForScene`, `placeTitle`, `secretsForScene`, `threadsForScene`.
  - Task 2: `usePlanDrafts().dirtySceneIds`, `draftKey`, `WithDrafts`.
  - Task 4: `PlanField`, `BeatTextField`. Task 5: `WhatTheSceneDoes`, `WhoWantsWhat`.
  - Task 6: `useSectionOpenState()`, `PlanSectionId`, `PanelSection`, `DetailsSection`. Task 7: `WhatItTouches`. Task 8: `BeatLadder`.
  - Existing: `LockToggle` (default test id `lock-toggle`); `actLabel` and `actNumbersForFormat` from `planTree`; `prefersReducedMotion` from `projects/wizard/board/boardMotion`.
- Produces (exact):
  - `export type JumpTarget = 'notes' | PlanSectionId`
  - `export interface JumpCounts { notes: number; wants: number; touches: number; beats: number }`
  - `export interface PanelHeaderProps { scene: Scene; total: number; prevSceneId: string | null; nextSceneId: string | null; locked: boolean; unsaved: boolean; counts: JumpCounts; active: JumpTarget; onBack: () => void; onSelectScene: (sceneId: string) => void; onJump: (target: JumpTarget) => void }` and `export function PanelHeader(props: PanelHeaderProps): JSX.Element`
  - `export interface ScenePanelProps` (exactly the props in Step 3 below) and `export function ScenePanel(props: ScenePanelProps): JSX.Element`
  - `export interface EpisodePanelProps { project: Project; episode: Episode; pending: boolean; openingReview: boolean; onSaveEpisodePremise: (value: string) => Promise<boolean>; onSaveSeriesPremise: (value: string) => Promise<boolean> }` and `export function EpisodePanel(props: EpisodePanelProps): JSX.Element`
  - DOM contract:
    - `<aside data-testid="inspector" aria-label="Inspector">` (400px, `overflow-y-auto`) and `data-testid="panel-header"` (sticky wrapper).
    - `data-testid="jump-bar"`, whose buttons read "Notes n" (only when `noteCount > 0`), "Scene", "Wants n", "Touches n", "Beats n" and "Details", with `aria-current="true"` on the active one.
    - `data-testid="unsaved-chip"`.
    - `<select id="plan-act-select" aria-label="Act">`, the target of Task 13's "Change the act".
    - The `role="status"` banner "Locked — unlock to edit. Review will never change this scene."
    - The `notes` slot is rendered right before the first section.
    - When `selectedBeatId` becomes non-null, the Beats section opens, so a landmark link or a note's "Show beat" (Task 14) never lands in a section the viewer left closed.

The ScenePanel tests port the remaining Inspector.test cases: the lock toggle callback, the locked banner and read-only fields, the Act select (format options, disabled when the episode is locked or a patch is pending, immediate save) and the Open Review scene id. The EpisodePanel tests port the nothing-selected case.

- [ ] **Step 1: Write the failing tests.** Create `apps/web/src/plan/panel/ScenePanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Episode, LedgerFact, Project, Scene } from 'contract'
import { ScenePanel, type ScenePanelProps } from './ScenePanel'
import { WithDrafts } from './testDrafts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: 'Alone',
    whatHappens: 'Marta walks back in.',
    audienceLearns: 'Eight years away.',
    audienceFeels: 'Unease.',
    motivations: [
      {
        characterId: 'char-marta',
        objective: 'Come home',
        stakes: 'Everything',
        obstacle: 'Dan',
        statedObjective: '',
        concealed: false,
      },
    ],
    beats: [
      {
        id: 'beat-1-1',
        index: 0,
        locked: false,
        whatHappens: 'Dan covers his shock.',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: false,
      },
      {
        id: 'beat-1-2',
        index: 1,
        locked: true,
        whatHappens: 'Marta opens the books.',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: true,
      },
    ],
    ...overrides,
  }
}

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: '',
    seasonFunction: '',
    storylines: [],
    scenes: [
      scene(),
      scene({
        id: 'scene-2',
        index: 1,
        act: 1,
        location: 'INT. THE LONG POUR - BASEMENT - NIGHT',
        motivations: [],
        beats: [],
      }),
    ],
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads: [],
    secrets: [],
    storyOverview: null,
    narrativeMap: null,
    structureChecks: [],
    ...overrides,
  }
}

function project(ep: Episode): Project {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: false,
      serialization: 0.8,
    },
    enabledComponents: [],
    premise: '',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters: [
        {
          id: 'char-marta',
          name: 'Marta Vega',
          locked: false,
          aliases: [],
          embodiment: '',
          presentation: '',
          hiding: '',
          traits: '',
          seriesArc: '',
          summary: '',
          bio: '',
        },
      ],
      relationships: [],
      audienceGoals: [],
      narratorGoals: [],
      worldQA: [],
    },
    seasons: [
      {
        id: 'season-1',
        index: 0,
        locked: false,
        seasonArc: '',
        characterArcs: [],
        episodes: [ep],
      },
    ],
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
  }
}

function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: 'fact-01',
    fact: 'Marta has been away for eight years',
    factType: 'state',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-1',
      beatId: 'beat-1-1',
      startLine: null,
      endLine: null,
      charStart: null,
      charEnd: null,
    },
    sourceText: '',
    knownBy: [],
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'writer_confirmed',
    confidence: 0.9,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
    ...overrides,
  }
}

function props(overrides: Partial<ScenePanelProps> = {}): ScenePanelProps {
  const ep = overrides.episode ?? episode()
  return {
    project: project(ep),
    episode: ep,
    scene: ep.scenes[0],
    selectedBeatId: null,
    ledger: [],
    flags: [],
    pending: false,
    openingReview: false,
    onBack: vi.fn(),
    onSelectScene: vi.fn(),
    onSelectBeat: vi.fn(),
    onToggleSceneLock: vi.fn(),
    onToggleBeatLock: vi.fn(),
    onToggleBeatScriptLock: vi.fn(),
    onSaveSceneField: vi.fn().mockResolvedValue(true),
    onSaveBeatField: vi.fn().mockResolvedValue(true),
    onOpenReview: vi.fn(),
    onSuggest: vi.fn().mockResolvedValue([]),
    onOpenInWrite: vi.fn(),
    onOpenBeatInWrite: vi.fn(),
    onOpenFact: vi.fn(),
    onOpenLedger: vi.fn(),
    ...overrides,
  }
}

function renderPanel(overrides: Partial<ScenePanelProps> = {}) {
  const p = props(overrides)
  return { props: p, ...render(<ScenePanel {...p} />, { wrapper: WithDrafts }) }
}

function sectionOrder(): (string | undefined)[] {
  return Array.from(
    screen
      .getByTestId('inspector')
      .querySelectorAll<HTMLElement>('[data-plan-section]'),
  ).map((el) => el.dataset.planSection)
}

function jumpLabels(): (string | null)[] {
  return within(screen.getByTestId('jump-bar'))
    .getAllByRole('button')
    .map((el) => el.textContent)
}

describe('ScenePanel', () => {
  it('is the inspector aside, 400px, scrolling on its own, sections in the new order', () => {
    renderPanel()
    const aside = screen.getByTestId('inspector')
    expect(aside.tagName).toBe('ASIDE')
    expect(aside.className).toContain('w-panel-plan')
    expect(aside.className).toContain('overflow-y-auto')
    expect(sectionOrder()).toEqual([
      'scene',
      'wants',
      'touches',
      'beats',
      'details',
    ])
  })

  it('header: scene number and cleaned place, the full slug below', () => {
    renderPanel()
    expect(screen.getByText('Scene 1 of 2')).not.toBeNull()
    expect(
      within(screen.getByTestId('panel-header')).getByRole('heading', {
        level: 2,
      }).textContent,
    ).toBe('1 · The Long Pour')
    expect(screen.getByText('INT. THE LONG POUR - NIGHT')).not.toBeNull()
  })

  it('jump bar counts wants, touches and beats; no Notes without notes', () => {
    renderPanel({
      ledger: [
        fact(),
        fact({ id: 'fact-03', status: 'superseded' }),
        fact({
          id: 'fact-02',
          sourceSpan: { ...fact().sourceSpan, sceneId: 'scene-2' },
        }),
      ],
      episode: episode({
        threads: [
          {
            id: 'thread-1',
            label: 'The transfer',
            summary: 'Where did the money go?',
            status: 'paid_off',
            ownerCharacterIds: [],
            setupSceneId: 'scene-1',
            payoffSceneId: 'scene-2',
            setupQuote: '',
            payoffQuote: '',
            setupBeatId: null,
            payoffBeatId: null,
            locked: false,
          },
        ],
      }),
    })
    // Touches = 1 thread + 1 shown fact (the superseded one and scene-2's don't count).
    expect(jumpLabels()).toEqual([
      'Scene',
      'Wants 1',
      'Touches 2',
      'Beats 2',
      'Details',
    ])
  })

  it('renders the notes slot before the sections and adds Notes n to the jump bar', () => {
    renderPanel({
      noteCount: 2,
      notes: (
        <section id="plan-section-notes" data-plan-section="notes">
          Two notes
        </section>
      ),
    })
    expect(sectionOrder()[0]).toBe('notes')
    expect(jumpLabels()[0]).toBe('Notes 2')
    expect(
      within(screen.getByTestId('jump-bar'))
        .getByRole('button', { name: 'Notes 2' })
        .getAttribute('aria-current'),
    ).toBe('true')
  })

  it('‹ › step through scenes in board order, not array order', async () => {
    const user = userEvent.setup()
    const ep = episode({
      scenes: [
        scene({ id: 'scene-a', index: 0, act: 0 }),
        scene({ id: 'scene-b', index: 1, act: 2 }),
        scene({ id: 'scene-c', index: 2, act: 1 }),
      ],
    })
    const { props: p } = renderPanel({ episode: ep, scene: ep.scenes[2] })
    await user.click(screen.getByRole('button', { name: 'Previous scene' }))
    expect(p.onSelectScene).toHaveBeenLastCalledWith('scene-a')
    await user.click(screen.getByRole('button', { name: 'Next scene' }))
    expect(p.onSelectScene).toHaveBeenLastCalledWith('scene-b')
  })

  it('‹ is disabled on the first scene in board order', () => {
    renderPanel()
    expect(
      (
        screen.getByRole('button', {
          name: 'Previous scene',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('← Episode goes back to the nothing-selected view', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    await user.click(screen.getByRole('button', { name: '← Episode' }))
    expect(p.onBack).toHaveBeenCalled()
  })

  it('shows the unsaved chip while this scene has a draft, and drops it when typed back', async () => {
    const user = userEvent.setup()
    renderPanel()
    expect(screen.queryByTestId('unsaved-chip')).toBeNull()
    const field = screen.getByLabelText('Audience learns')
    await user.type(field, '!')
    expect(screen.getByTestId('unsaved-chip')).not.toBeNull()
    await user.type(field, '{Backspace}')
    expect(screen.queryByTestId('unsaved-chip')).toBeNull()
  })

  it('scene lock toggle calls onToggleSceneLock with the flipped value', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    await user.click(screen.getByTestId('lock-toggle'))
    expect(p.onToggleSceneLock).toHaveBeenCalledWith('scene-1', true)
  })

  it('locked scene: banner, read-only fields, Act disabled; the lock switch still works', () => {
    const ep = episode()
    ep.scenes[0] = scene({ locked: true })
    renderPanel({ episode: ep, scene: ep.scenes[0] })
    expect(
      screen.getByText(
        'Locked — unlock to edit. Review will never change this scene.',
      ),
    ).not.toBeNull()
    expect(
      (screen.getByLabelText('What happens') as HTMLTextAreaElement).readOnly,
    ).toBe(true)
    expect(
      (screen.getByRole('combobox', { name: 'Act' }) as HTMLSelectElement)
        .disabled,
    ).toBe(true)
    const toggle = screen.getByTestId('lock-toggle') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.disabled).toBe(false)
    expect(
      within(screen.getByTestId('panel-header')).getByRole('img', {
        name: 'Locked',
      }),
    ).not.toBeNull()
  })

  it('Act select lists the format acts and saves a change immediately', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    const select = screen.getByRole('combobox', { name: 'Act' })
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['COLD OPEN', 'ACT ONE', 'ACT TWO', 'ACT THREE', 'ACT FOUR'])
    await user.selectOptions(select, '2')
    expect(p.onSaveSceneField).toHaveBeenCalledWith('scene-1', 'act', 2)
  })

  it('Act select is disabled when the episode is locked', () => {
    const ep = episode({ locked: true })
    renderPanel({ episode: ep, scene: ep.scenes[0] })
    expect(
      (screen.getByRole('combobox', { name: 'Act' }) as HTMLSelectElement)
        .disabled,
    ).toBe(true)
  })

  it('Act select and the lock switch are disabled while a patch is pending', () => {
    renderPanel({ pending: true })
    expect(
      (screen.getByRole('combobox', { name: 'Act' }) as HTMLSelectElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId('lock-toggle') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('Open in Write ↗ opens this scene', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    await user.click(screen.getByRole('button', { name: 'Open in Write ↗' }))
    expect(p.onOpenInWrite).toHaveBeenCalledWith('scene-1')
  })

  it('Open Review on What happens sends the scene id and the draft', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    const field = screen.getByLabelText('What happens')
    await user.clear(field)
    await user.type(field, 'Marina rewrite.')
    await user.click(screen.getByRole('button', { name: 'Open Review' }))
    expect(p.onOpenReview).toHaveBeenCalledWith('scene-1', 'Marina rewrite.')
  })

  it('keeps exactly one lock-toggle test id while a beat row is expanded', () => {
    renderPanel({ selectedBeatId: 'beat-1-1' })
    expect(screen.getAllByTestId('lock-toggle')).toHaveLength(1)
  })

  it('never asks for suggestions on render or on a scene change', () => {
    const onSuggest = vi.fn().mockResolvedValue([])
    const ep = episode()
    ep.scenes[0] = scene({ whatHappens: '' })
    const p = props({ episode: ep, scene: ep.scenes[0], onSuggest })
    const { rerender } = render(<ScenePanel {...p} />, { wrapper: WithDrafts })
    rerender(<ScenePanel {...p} scene={ep.scenes[1]} />)
    expect(onSuggest).not.toHaveBeenCalled()
  })

  it('a jump opens a closed section and scrolls the panel to it', async () => {
    const user = userEvent.setup()
    const scrollTo = vi
      .spyOn(Element.prototype, 'scrollTo')
      .mockImplementation(() => {})
    renderPanel()
    const details = document.getElementById(
      'plan-section-details',
    ) as HTMLDetailsElement
    expect(details.open).toBe(false)

    await user.click(
      within(screen.getByTestId('jump-bar')).getByRole('button', {
        name: 'Details',
      }),
    )

    expect(details.open).toBe(true)
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth' }),
      ),
    )
  })

  it('scroll-spy underlines the section under the sticky header', () => {
    renderPanel()
    const aside = screen.getByTestId('inspector')
    const tops: Record<string, number> = {
      scene: 100,
      wants: 300,
      touches: 500,
      beats: 700,
      details: 900,
    }
    aside.querySelectorAll<HTMLElement>('[data-plan-section]').forEach((el) =>
      Object.defineProperty(el, 'offsetTop', {
        value: tops[el.dataset.planSection ?? ''],
      }),
    )
    Object.defineProperty(screen.getByTestId('panel-header'), 'offsetHeight', {
      value: 50,
    })
    Object.defineProperty(aside, 'clientHeight', { value: 400 })
    Object.defineProperty(aside, 'scrollHeight', { value: 2000 })
    Object.defineProperty(aside, 'scrollTop', { value: 280 })

    fireEvent.scroll(aside)

    const current = within(screen.getByTestId('jump-bar'))
      .getAllByRole('button')
      .filter((el) => el.getAttribute('aria-current') === 'true')
      .map((el) => el.textContent)
    expect(current).toEqual(['Wants 1'])
  })

  it('opens a closed Beats section when a beat is selected', () => {
    localStorage.setItem(
      'tr.plan.sections.v1',
      JSON.stringify({ beats: false }),
    )
    const p = props()
    const { rerender } = render(<ScenePanel {...p} />, { wrapper: WithDrafts })
    const beats = document.getElementById(
      'plan-section-beats',
    ) as HTMLDetailsElement
    expect(beats.open).toBe(false)

    rerender(<ScenePanel {...p} selectedBeatId="beat-1-1" />)
    expect(beats.open).toBe(true)
  })

  it('missing story keys and an empty scene render quiet, with zero counts', () => {
    const ep = episode()
    const raw = { ...ep } as Record<string, unknown>
    delete raw.secrets
    delete raw.timelineAnchors
    delete raw.relationshipStates
    delete raw.threads
    delete raw.storyOverview
    const bare = raw as unknown as Episode
    renderPanel({ episode: bare, scene: bare.scenes[1] })
    expect(jumpLabels()).toEqual([
      'Scene',
      'Wants 0',
      'Touches 0',
      'Beats 0',
      'Details',
    ])
    expect(screen.getByText('No wants recorded for this scene.')).not.toBeNull()
    expect(screen.getByText('No beats yet.')).not.toBeNull()
  })
})
```

Create `apps/web/src/plan/panel/EpisodePanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Episode, Project } from 'contract'
import { EpisodePanel, type EpisodePanelProps } from './EpisodePanel'
import { WithDrafts } from './testDrafts'

afterEach(cleanup)

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: 'Episode premise text.',
    seasonFunction: '',
    storylines: [],
    scenes: [],
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads: [],
    secrets: [],
    storyOverview: null,
    narrativeMap: null,
    structureChecks: [],
    ...overrides,
  }
}

function project(ep: Episode): Project {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: false,
      serialization: 0.8,
    },
    enabledComponents: [],
    premise: 'Series premise text.',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters: [],
      relationships: [],
      audienceGoals: [],
      narratorGoals: [],
      worldQA: [],
    },
    seasons: [
      {
        id: 'season-1',
        index: 0,
        locked: false,
        seasonArc: '',
        characterArcs: [],
        episodes: [ep],
      },
    ],
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
  }
}

function props(overrides: Partial<EpisodePanelProps> = {}): EpisodePanelProps {
  const ep = overrides.episode ?? episode()
  return {
    project: project(ep),
    episode: ep,
    pending: false,
    openingReview: false,
    onSaveEpisodePremise: vi.fn().mockResolvedValue(true),
    onSaveSeriesPremise: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('EpisodePanel', () => {
  it('shows the episode title and both premises in the inspector aside', () => {
    render(<EpisodePanel {...props()} />, { wrapper: WithDrafts })
    expect(screen.getByTestId('inspector').className).toContain('w-panel-plan')
    expect(screen.getByText('Episode 1: Last Call')).not.toBeNull()
    expect(screen.getByDisplayValue('Episode premise text.')).not.toBeNull()
    expect(screen.getByDisplayValue('Series premise text.')).not.toBeNull()
  })

  it('a premise edit is structural: Save field only saves, Open Review stays disabled', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<EpisodePanel {...p} />, { wrapper: WithDrafts })
    await user.type(screen.getByLabelText('Series premise'), ' More.')
    expect(
      (screen.getByRole('button', { name: 'Open Review' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Save field only' }))
    expect(p.onSaveSeriesPremise).toHaveBeenCalledWith(
      'Series premise text. More.',
    )
  })

  it('a locked episode makes its premise read-only, not the series premise', () => {
    render(
      <EpisodePanel {...props({ episode: episode({ locked: true }) })} />,
      {
        wrapper: WithDrafts,
      },
    )
    expect(
      (screen.getByLabelText('Episode premise') as HTMLTextAreaElement)
        .readOnly,
    ).toBe(true)
    expect(
      (screen.getByLabelText('Series premise') as HTMLTextAreaElement).readOnly,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to verify they fail.**

```bash
(cd apps/web && npx vitest run src/plan/panel/ScenePanel.test.tsx src/plan/panel/EpisodePanel.test.tsx)
```

Expected: both files fail with `Failed to resolve import "./ScenePanel"` and `Failed to resolve import "./EpisodePanel"`.

- [ ] **Step 3: Minimal implementation.** Create `apps/web/src/plan/panel/PanelHeader.tsx`:

```tsx
import type { Scene } from 'contract'
import { placeTitle } from '../story'
import type { PlanSectionId } from './useSectionOpenState'

export type JumpTarget = 'notes' | PlanSectionId

export interface JumpCounts {
  notes: number
  wants: number
  touches: number
  beats: number
}

export interface PanelHeaderProps {
  scene: Scene
  /** Scenes in the episode. */
  total: number
  /** Neighbours in board order (story.boardOrder). */
  prevSceneId: string | null
  nextSceneId: string | null
  /** Effective: scene or episode lock. */
  locked: boolean
  /** This scene has at least one draft. */
  unsaved: boolean
  counts: JumpCounts
  active: JumpTarget
  onBack: () => void
  onSelectScene: (sceneId: string) => void
  onJump: (target: JumpTarget) => void
}

const STEP =
  'rounded-card px-2 text-15 text-tr-text-secondary hover:bg-tr-surface-clay disabled:opacity-50'

/**
 * The panel's sticky header (spec §4.6): back to the episode, "Scene n of N"
 * with ‹ ›, the scene title with its lock glyph and unsaved chip, and the
 * jump bar. ScenePanel owns the sticky wrapper and the scroll-spy.
 */
export function PanelHeader({
  scene,
  total,
  prevSceneId,
  nextSceneId,
  locked,
  unsaved,
  counts,
  active,
  onBack,
  onSelectScene,
  onJump,
}: PanelHeaderProps) {
  const n = scene.index + 1
  const jumps: { target: JumpTarget; label: string }[] = [
    ...(counts.notes > 0
      ? [{ target: 'notes' as const, label: `Notes ${counts.notes}` }]
      : []),
    { target: 'scene', label: 'Scene' },
    { target: 'wants', label: `Wants ${counts.wants}` },
    { target: 'touches', label: `Touches ${counts.touches}` },
    { target: 'beats', label: `Beats ${counts.beats}` },
    { target: 'details', label: 'Details' },
  ]

  return (
    <div className="flex flex-col gap-2 border-b border-tr-border px-4 pb-2 pt-3">
      <div className="flex items-center gap-2 text-13 text-tr-text-secondary">
        <button
          type="button"
          onClick={onBack}
          className="rounded-card px-1 hover:bg-tr-surface-clay"
        >
          ← Episode
        </button>
        <span className="ml-auto">
          Scene {n} of {total}
        </span>
        <button
          type="button"
          aria-label="Previous scene"
          disabled={!prevSceneId}
          onClick={() => prevSceneId && onSelectScene(prevSceneId)}
          className={STEP}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next scene"
          disabled={!nextSceneId}
          onClick={() => nextSceneId && onSelectScene(nextSceneId)}
          className={STEP}
        >
          ›
        </button>
      </div>
      <h2 className="flex items-center gap-2 font-display text-17 text-tr-text-primary">
        <span className="min-w-0 truncate">
          {n} · {placeTitle(scene)}
        </span>
        {locked && (
          <svg
            role="img"
            aria-label="Locked"
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 shrink-0 text-tr-text-secondary"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
        {unsaved && (
          <span
            data-testid="unsaved-chip"
            className="shrink-0 rounded-chip bg-tr-coral-soft px-2 py-0.5 text-12 text-tr-accent-ink"
          >
            unsaved
          </span>
        )}
      </h2>
      <nav
        aria-label="Panel sections"
        data-testid="jump-bar"
        className="flex flex-wrap gap-3 text-12"
      >
        {jumps.map(({ target, label }) => (
          <button
            key={target}
            type="button"
            aria-current={target === active ? 'true' : undefined}
            onClick={() => onJump(target)}
            className={
              'border-b-2 pb-0.5' +
              (target === active
                ? ' border-tr-coral text-tr-text-primary'
                : ' border-transparent text-tr-text-secondary hover:text-tr-text-primary')
            }
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
```

Create `apps/web/src/plan/panel/ScenePanel.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  ConsistencyFlag,
  Episode,
  LedgerFact,
  Project,
  Scene,
} from 'contract'
import { prefersReducedMotion } from '../../projects/wizard/board/boardMotion'
import { LockToggle } from '../LockToggle'
import { actLabel, actNumbersForFormat } from '../planTree'
import {
  boardOrder,
  castFromDialogue,
  factsForScene,
  landmarksForScene,
  notesForScene,
  secretsForScene,
  threadsForScene,
} from '../story'
import { BeatLadder } from './BeatLadder'
import { DetailsSection } from './DetailsSection'
import { PanelHeader, type JumpTarget } from './PanelHeader'
import { PanelSection } from './PanelSection'
import type { BeatTextField } from './PlanField'
import { usePlanDrafts } from './usePlanDrafts'
import { useSectionOpenState } from './useSectionOpenState'
import { WhatItTouches } from './WhatItTouches'
import { WhatTheSceneDoes } from './WhatTheSceneDoes'
import { WhoWantsWhat } from './WhoWantsWhat'

export interface ScenePanelProps {
  project: Project
  episode: Episode
  scene: Scene
  selectedBeatId: string | null
  ledger: LedgerFact[]
  /** All open flags; the panel derives this scene's notes. */
  flags: ConsistencyFlag[]
  pending: boolean
  openingReview: boolean
  /** T3.4 seam: the notes strip (id="plan-section-notes" data-plan-section="notes"). */
  notes?: ReactNode
  /** T3.4 seam: "Notes n" in the jump bar. */
  noteCount?: number
  onBack: () => void
  onSelectScene: (sceneId: string) => void
  onSelectBeat: (sceneId: string, beatId: string | null) => void
  onToggleSceneLock: (sceneId: string, locked: boolean) => void
  onToggleBeatLock: (sceneId: string, beatId: string, locked: boolean) => void
  onToggleBeatScriptLock: (
    sceneId: string,
    beatId: string,
    scriptLocked: boolean,
  ) => void
  onSaveSceneField: <K extends keyof Scene>(
    sceneId: string,
    field: K,
    value: Scene[K],
  ) => Promise<boolean>
  onSaveBeatField: (
    sceneId: string,
    beatId: string,
    field: BeatTextField,
    value: string,
  ) => Promise<boolean>
  onOpenReview: (sceneId: string, instruction: string) => void
  onSuggest: (sceneId: string) => Promise<string[]>
  onOpenInWrite: (sceneId: string) => void
  onOpenBeatInWrite: (sceneId: string, beatId: string) => void
  onOpenFact: (factId: string) => void
  onOpenLedger: () => void
}

/**
 * The 400px scene panel (spec §4.6; `data-testid="inspector"` kept for e2e and
 * the onboarding recipes). It scrolls on its own under a sticky header; every
 * section is derived in render from the props with story.ts. The panel is not
 * remounted per scene: drafts live in the Plan draft store, and focus stays on
 * ‹ › while stepping.
 */
export function ScenePanel({
  project,
  episode,
  scene,
  selectedBeatId,
  ledger,
  flags,
  pending,
  openingReview,
  notes,
  noteCount = 0,
  onBack,
  onSelectScene,
  onSelectBeat,
  onToggleSceneLock,
  onToggleBeatLock,
  onToggleBeatScriptLock,
  onSaveSceneField,
  onSaveBeatField,
  onOpenReview,
  onSuggest,
  onOpenInWrite,
  onOpenBeatInWrite,
  onOpenFact,
  onOpenLedger,
}: ScenePanelProps) {
  const drafts = usePlanDrafts()
  const { open, setOpen } = useSectionOpenState()
  const asideRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  // Scroll-spy result, tied to the scene it was measured on.
  const [spied, setSpied] = useState<{
    sceneId: string
    target: JumpTarget
  } | null>(null)

  // A new scene starts at the top, unless a beat was selected with it (notes
  // "Show beat", landmark links): BeatLadder scrolls that row into view.
  useEffect(() => {
    if (!selectedBeatId) asideRef.current?.scrollTo({ top: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per scene, not per beat
  }, [scene.id])

  // A beat selected from outside the ladder (a landmark link, a note's
  // "Show beat") must be visible even when the viewer left Beats closed.
  useEffect(() => {
    if (selectedBeatId) setOpen('beats', true)
  }, [selectedBeatId, setOpen])

  const locked = scene.locked || episode.locked
  const characters = project.seriesBible.characters
  const order = boardOrder(episode.scenes)
  const at = order.findIndex((s) => s.id === scene.id)
  const planNotes = notesForScene(flags, scene)
  const landmarks = landmarksForScene(episode, scene)
  const wantIds = new Set(scene.motivations.map((m) => m.characterId))
  const cast = castFromDialogue(scene, characters)
  const present = new Set([...wantIds, ...cast.map((c) => c.id)])
  const threads = threadsForScene(episode, scene.id)
  const secrets = secretsForScene(episode, scene.id, present)
  const facts = factsForScene(ledger, scene.id)
  const moments = (episode.relationshipStates ?? []).filter(
    (r) => r.sceneId === scene.id,
  )
  const timeJump =
    (episode.timelineAnchors ?? []).find((a) => a.afterSceneId === scene.id) ??
    null
  const active: JumpTarget =
    spied?.sceneId === scene.id
      ? spied.target
      : noteCount > 0
        ? 'notes'
        : 'scene'

  function sections(): HTMLElement[] {
    return Array.from(
      asideRef.current?.querySelectorAll<HTMLElement>('[data-plan-section]') ??
        [],
    )
  }

  function spy() {
    const aside = asideRef.current
    if (!aside) return
    const line = aside.scrollTop + (headerRef.current?.offsetHeight ?? 0) + 1
    const all = sections()
    // Scrolled to the bottom: the last section can't reach the top line.
    const atBottom =
      aside.scrollTop + aside.clientHeight >= aside.scrollHeight - 1
    const current = atBottom
      ? all[all.length - 1]
      : (all.filter((el) => el.offsetTop <= line).pop() ?? all[0])
    if (current) {
      setSpied({
        sceneId: scene.id,
        target: current.dataset.planSection as JumpTarget,
      })
    }
  }

  function jump(target: JumpTarget) {
    if (target !== 'notes') setOpen(target, true)
    setSpied({ sceneId: scene.id, target })
    // Next frame: the section may have just opened.
    requestAnimationFrame(() => {
      const el = sections().find((s) => s.dataset.planSection === target)
      if (!el) return
      asideRef.current?.scrollTo({
        top: el.offsetTop - (headerRef.current?.offsetHeight ?? 0),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
    })
  }

  return (
    <aside
      ref={asideRef}
      data-testid="inspector"
      aria-label="Inspector"
      onScroll={spy}
      className="relative w-panel-plan shrink-0 overflow-y-auto bg-tr-surface-raised"
    >
      <div
        ref={headerRef}
        data-testid="panel-header"
        className="sticky top-0 z-10 bg-tr-surface-raised"
      >
        <PanelHeader
          scene={scene}
          total={episode.scenes.length}
          prevSceneId={order[at - 1]?.id ?? null}
          nextSceneId={order[at + 1]?.id ?? null}
          locked={locked}
          unsaved={drafts.dirtySceneIds.has(scene.id)}
          counts={{
            notes: noteCount,
            wants: scene.motivations.length,
            touches:
              threads.length +
              secrets.length +
              facts.shown.length +
              moments.length,
            beats: scene.beats.length,
          }}
          active={active}
          onBack={onBack}
          onSelectScene={onSelectScene}
          onJump={jump}
        />
      </div>
      <div className="flex flex-col gap-4 p-4">
        <p className="font-script text-13 text-tr-text-secondary">
          {scene.location}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="plan-act-select"
            aria-label="Act"
            value={scene.act}
            disabled={locked || pending}
            onChange={(e) =>
              void onSaveSceneField(scene.id, 'act', Number(e.target.value))
            }
            className="rounded-card border border-tr-border bg-tr-surface-page px-2 py-1 text-13 text-tr-text-primary disabled:opacity-50"
          >
            {actNumbersForFormat(project.format).map((act) => (
              <option key={act} value={act}>
                {actLabel(act, project.format)}
              </option>
            ))}
          </select>
          <LockToggle
            locked={scene.locked}
            label="Scene"
            disabled={pending}
            onChange={(next) => onToggleSceneLock(scene.id, next)}
          />
          <button
            type="button"
            onClick={() => onOpenInWrite(scene.id)}
            className="ml-auto text-13 text-tr-sky underline"
          >
            Open in Write ↗
          </button>
        </div>
        {locked && (
          <p
            role="status"
            className="rounded-card border border-tr-border bg-tr-amber-soft px-3 py-2 text-13 text-tr-text-primary"
          >
            Locked — unlock to edit. Review will never change this scene.
          </p>
        )}
        {notes}
        <PanelSection
          id="scene"
          title="What the scene does"
          steersNextBeat
          open={open.scene}
          onToggle={(next) => setOpen('scene', next)}
        >
          <WhatTheSceneDoes
            scene={scene}
            landmarks={landmarks}
            locked={locked}
            saving={pending}
            openingReview={openingReview}
            onSaveField={(field, value) =>
              onSaveSceneField(scene.id, field, value)
            }
            onOpenReview={(instruction) => onOpenReview(scene.id, instruction)}
            onSuggest={() => onSuggest(scene.id)}
            onShowBeat={(beatId) => onSelectBeat(scene.id, beatId)}
          />
        </PanelSection>
        <PanelSection
          id="wants"
          title="Who wants what"
          count={scene.motivations.length}
          steersNextBeat
          open={open.wants}
          onToggle={(next) => setOpen('wants', next)}
        >
          <WhoWantsWhat
            motivations={scene.motivations}
            characters={characters}
            alsoInScene={cast.filter((c) => !wantIds.has(c.id))}
          />
        </PanelSection>
        <PanelSection
          id="touches"
          title="What it touches"
          open={open.touches}
          onToggle={(next) => setOpen('touches', next)}
        >
          <WhatItTouches
            scenes={episode.scenes}
            threads={threads}
            secrets={secrets}
            facts={facts}
            relationshipMoments={moments}
            characters={characters}
            onSelectScene={onSelectScene}
            onOpenFact={onOpenFact}
            onOpenLedger={onOpenLedger}
          />
        </PanelSection>
        <PanelSection
          id="beats"
          title="Beats"
          count={scene.beats.length}
          open={open.beats}
          onToggle={(next) => setOpen('beats', next)}
        >
          <BeatLadder
            scene={scene}
            episodeLocked={episode.locked}
            selectedBeatId={selectedBeatId}
            notes={planNotes}
            landmarks={landmarks}
            timeJump={timeJump}
            pending={pending}
            onSelectBeat={(beatId) => onSelectBeat(scene.id, beatId)}
            onToggleBeatLock={(beatId, next) =>
              onToggleBeatLock(scene.id, beatId, next)
            }
            onToggleBeatScriptLock={(beatId, next) =>
              onToggleBeatScriptLock(scene.id, beatId, next)
            }
            onSaveBeatField={(beatId, field, value) =>
              onSaveBeatField(scene.id, beatId, field, value)
            }
            onOpenBeatInWrite={(beatId) => onOpenBeatInWrite(scene.id, beatId)}
          />
        </PanelSection>
        <PanelSection
          id="details"
          title="Details"
          open={open.details}
          onToggle={(next) => setOpen('details', next)}
        >
          <DetailsSection
            scene={scene}
            showStoryline={episode.storylines.length > 0}
            locked={locked}
            saving={pending}
            onSaveField={(field, value) =>
              onSaveSceneField(scene.id, field, value)
            }
          />
        </PanelSection>
      </div>
    </aside>
  )
}
```

Create `apps/web/src/plan/panel/EpisodePanel.tsx`:

```tsx
import type { Episode, Project } from 'contract'
import { PlanField } from './PlanField'
import { draftKey } from './usePlanDrafts'

export interface EpisodePanelProps {
  project: Project
  episode: Episode
  pending: boolean
  openingReview: boolean
  onSaveEpisodePremise: (value: string) => Promise<boolean>
  onSaveSeriesPremise: (value: string) => Promise<boolean>
}

/**
 * The nothing-selected panel: today's episode and series premises, in the
 * new panel shell. T3.6's Episode view replaces it. Both premises are
 * structural; Open Review stays disabled because Change Set create can't
 * target a premise yet.
 */
export function EpisodePanel({
  project,
  episode,
  pending,
  openingReview,
  onSaveEpisodePremise,
  onSaveSeriesPremise,
}: EpisodePanelProps) {
  return (
    <aside
      data-testid="inspector"
      aria-label="Inspector"
      className="w-panel-plan shrink-0 overflow-y-auto bg-tr-surface-raised p-4"
    >
      <h2 className="font-display text-17 text-tr-text-primary">
        Episode {episode.index + 1}: {episode.title}
      </h2>
      <div className="mt-3 flex flex-col gap-4">
        <PlanField
          label="Episode premise"
          draftKey={draftKey(episode.id, 'premise')}
          sceneId={null}
          value={episode.premise}
          multiline
          structural
          locked={episode.locked}
          saving={pending}
          openingReview={openingReview}
          onSave={onSaveEpisodePremise}
        />
        <PlanField
          label="Series premise"
          draftKey={draftKey('project', 'premise')}
          sceneId={null}
          value={project.premise}
          multiline
          structural
          locked={false}
          saving={pending}
          openingReview={openingReview}
          onSave={onSaveSeriesPremise}
        />
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
(cd apps/web && npx vitest run src/plan/panel)
```
```bash
(cd apps/web && npx tsc -b)
(cd apps/web && npx eslint .)
(cd apps/web && npx prettier --check .)
```

Expected: every panel test passes, including the 21 ScenePanel and 3 EpisodePanel tests.
- If "keeps exactly one lock-toggle test id" fails, Task 8 is not passing `testId` to its two beat `LockToggle`s.
- If "missing story keys…" fails on "No beats yet.", Task 8's empty copy drifted (it must read exactly "No beats yet.").

Nothing renders ScenePanel or EpisodePanel yet; Task 10 swaps them in for `Inspector` in `PlanScreen`.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/plan/panel/PanelHeader.tsx apps/web/src/plan/panel/ScenePanel.tsx apps/web/src/plan/panel/ScenePanel.test.tsx apps/web/src/plan/panel/EpisodePanel.tsx apps/web/src/plan/panel/EpisodePanel.test.tsx
git commit -F - <<'EOF'
plan: add the scene panel shell, sticky header and jump bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Swap the inspector for the scene panel (T3.3 integration)

**PR:** T3.3 · **Depends on:** Task 9

**Files:**
- Modify: `apps/web/src/plan/PlanScreen.tsx` (whole file below; keeps Task 3's wrapper class)
- Modify: `apps/web/src/plan/SceneCard.tsx` (whole file below)
- Modify: `apps/web/src/plan/Board.tsx` (delete the six `onSelectBeat` lines: 24, 45, 77, 109, 133, 169)
- Modify: `apps/web/src/plan/Board.test.tsx` (drop three chevron/beat tests and every `onSelectBeat={noop}`; add two tests)
- Modify: `apps/web/src/plan/PlanScreen.test.tsx` (whole file below; keeps Task 3's scrolling test)
- Modify: `apps/web/src/plan/planTree.test.ts` (line 10 import; line 306 type and stub)
- Modify: `apps/web/e2e/plan.spec.ts` (header note; three tests updated; one test added)
- Delete: `apps/web/src/plan/Inspector.tsx`, `apps/web/src/plan/Inspector.test.tsx`, `apps/web/src/plan/BeatCard.tsx`
- Check unchanged: `apps/web/e2e/review.spec.ts`, `recipes.spec.ts`, `newproject-resume.spec.ts`

**Interfaces:**
- Consumes: `ScenePanel`, `ScenePanelProps` and `EpisodePanel`, `EpisodePanelProps` (Task 9); `PlanDraftsContext`, `usePlanDraftStore` (Task 2); `BeatTextField` (Task 4); `suggestInstructions`, `navigateToMode`, `navigateToWriteBeat`, `navigateToWriteScene`, `Toast`, and the `planTree` builders (existing).
- Produces:
  - `PlanScreen` owns one draft store (`<PlanDraftsContext.Provider>` around the AppShell). It renders `ScenePanel` when the selection resolves to a scene and `EpisodePanel` otherwise. Every field save returns `Promise<boolean>`. Lock flips, including the new `beat.locked`, go through the same `saveSceneField` / `saveBeatField`. A failed Open Review shows a danger `Toast`.
  - `BoardProps` and `SceneCardProps` without `onSelectBeat`. `SceneCard` `selected` = `selection?.sceneId === scene.id`, so a beat selection marks its card. No chevron, no ⌥-click and no BeatCard on the board.
  - e2e: `beat-lock-toggle-beat-4-1` persists across a reload and is switched back off.

- [ ] **Step 1: Write the failing tests**

(a) `apps/web/src/plan/Board.test.tsx`:
1. Delete these three `it(...)` blocks entirely, each from its `it(` line through its closing `  })`:
   - `it('the chevron expands the card to reveal nested beat cards; the locked beat shows a lock chip', …`
   - `it('clicking a nested beat card selects the beat, not the parent scene', …`
   - `it('Enter on the nested chevron button does not also select the scene (bubbled keydown ignored)', …`
2. Remove every remaining `onSelectBeat={noop}` line:
   ```bash
   sed -i '' '/onSelectBeat={noop}/d' apps/web/src/plan/Board.test.tsx
   grep -c onSelectBeat apps/web/src/plan/Board.test.tsx   # expect 0
   ```
3. Rename `describe('Board / SceneCard / BeatCard', () => {` to `describe('Board / SceneCard', () => {`. Add these two tests right after the `'a selected scene card uses the Quiet Tool soft accent fill'` test:

```tsx
  it('a beat selection keeps its scene card selected (the panel is showing that scene)', () => {
    const ep = episode([scene({ beats: [beat1_1()] })])
    renderBoard({
      project: project(ep),
      episode: ep,
      selection: { type: 'beat', sceneId: 'scene-1', beatId: 'beat-1-1' },
    })
    expect(screen.getByTestId('scene-card-scene-1').className).toContain(
      'bg-tr-coral-soft',
    )
  })

  it('beats are not on the board: no expand control and no beat cards', () => {
    const ep = episode([scene({ beats: [beat1_1(), beat1_2Locked()] })])
    renderBoard({ project: project(ep), episode: ep })
    expect(screen.queryByRole('button', { name: 'Expand beats' })).toBeNull()
    expect(screen.queryByTestId('beat-card-beat-1-1')).toBeNull()
  })
```

(b) Replace `apps/web/src/plan/PlanScreen.test.tsx` with:

```tsx
// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Episode, Project, Scene } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadResume, saveResume } from '../projects/resumeContext'
import { PlanScreen } from './PlanScreen'
import { withBeatField } from './planTree'

const {
  createChangeSetMock,
  getConsistencyFlagsMock,
  getLedgerMock,
  getProjectMock,
  patchProjectMock,
  suggestInstructionsMock,
} = vi.hoisted(() => ({
  createChangeSetMock: vi.fn(),
  getConsistencyFlagsMock: vi.fn(),
  getLedgerMock: vi.fn(),
  getProjectMock: vi.fn(),
  patchProjectMock: vi.fn(),
  suggestInstructionsMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  createChangeSet: createChangeSetMock,
  exportFountain: vi.fn(),
  getConsistencyFlags: getConsistencyFlagsMock,
  getLedger: getLedgerMock,
  getProject: getProjectMock,
  patchProject: patchProjectMock,
  suggestInstructions: suggestInstructionsMock,
  undoProject: vi.fn(),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.resetAllMocks()
  window.history.pushState(null, '', '/')
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: '',
    whatHappens: 'Marta walks back into the bar.',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    // A usable scene skeleton needs at least one beat (data contract §9.1
    // setupState) — this fixture represents an already-planned project, not
    // one that should show Guided setup.
    beats: [
      {
        id: 'beat-1-1',
        index: 0,
        locked: false,
        whatHappens: '',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: false,
      },
    ],
    ...overrides,
  }
}

function episode(scenes: Scene[]): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: '',
    seasonFunction: '',
    storylines: [],
    scenes,
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads: [],
    secrets: [],
    storyOverview: null,
    narrativeMap: null,
    structureChecks: [],
  }
}

function project(): Project {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: false,
      serialization: 0.8,
    },
    enabledComponents: [],
    premise: '',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters: [],
      relationships: [],
      audienceGoals: [],
      narratorGoals: [],
      worldQA: [],
    },
    seasons: [
      {
        id: 'season-1',
        index: 0,
        locked: false,
        seasonArc: '',
        characterArcs: [],
        episodes: [
          episode([
            scene(),
            scene({ id: 'scene-2', index: 1, location: 'INT. BACK ROOM' }),
          ]),
        ],
      },
    ],
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
  }
}

/** Loads Plan on scene-1 (no resume stored) and resolves to the panel. */
function loadPlan(p: Project = project()) {
  getProjectMock.mockResolvedValue(p)
  getLedgerMock.mockResolvedValue([])
  getConsistencyFlagsMock.mockResolvedValue([])
  window.history.pushState(null, '', '/plan?project=proj-longpour')
  render(<PlanScreen />)
  return screen.findByTestId('inspector')
}

describe('PlanScreen', () => {
  it('preserves a stored Plan scene while project loading is still pending', () => {
    const request = deferred<Project>()
    getProjectMock.mockReturnValue(request.promise)
    getLedgerMock.mockResolvedValue([])
    getConsistencyFlagsMock.mockResolvedValue([])
    window.history.pushState(null, '', '/plan?project=proj-longpour')
    saveResume('proj-longpour', { mode: 'Plan', sceneId: 'scene-2' })

    render(<PlanScreen />)

    expect(screen.getByText('Loading…')).not.toBeNull()
    expect(loadResume('proj-longpour').sceneId).toBe('scene-2')
  })

  it('keeps the selected scene in Plan resume after project load completes', async () => {
    getProjectMock.mockResolvedValue(project())
    getLedgerMock.mockResolvedValue([])
    getConsistencyFlagsMock.mockResolvedValue([])
    window.history.pushState(null, '', '/plan?project=proj-longpour')
    saveResume('proj-longpour', { mode: 'Plan', sceneId: 'scene-2' })

    render(<PlanScreen />)

    expect(await screen.findByTestId('scene-card-scene-2')).not.toBeNull()
    expect(loadResume('proj-longpour').sceneId).toBe('scene-2')
  })

  it('shows the selected scene in the panel with its beats in the ladder, and never asks for suggestions on its own', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()

    expect(within(panel).getByTestId('lock-toggle')).not.toBeNull()
    expect(within(panel).getByTestId('beat-card-beat-1-1')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand beats' })).toBeNull()

    await user.click(within(panel).getByLabelText('What happens'))
    expect(suggestInstructionsMock).not.toHaveBeenCalled()
  })

  it('the Beat lock in the ladder sends one PATCH for beat.locked', async () => {
    const user = userEvent.setup()
    const p = project()
    patchProjectMock.mockResolvedValue({
      project: withBeatField(p, 'scene-1', 'beat-1-1', 'locked', true),
      consistencyFlags: [],
    })
    const panel = await loadPlan(p)

    await user.click(within(panel).getByTestId('beat-card-beat-1-1'))
    await user.click(within(panel).getByTestId('beat-lock-toggle-beat-1-1'))

    expect(patchProjectMock).toHaveBeenCalledTimes(1)
    expect(patchProjectMock).toHaveBeenCalledWith(
      'proj-longpour',
      [
        {
          op: 'replace',
          path: '/seasons/0/episodes/0/scenes/0/beats/0/locked',
          value: true,
        },
      ],
      { expectedHeadSnapshotId: 'snap-root' },
    )
    await waitFor(() =>
      expect(
        within(panel).getByTestId('beat-card-beat-1-1').textContent,
      ).toContain('Locked'),
    )
  })

  it('a failed save keeps what the writer typed (the draft survives the rollback)', async () => {
    const user = userEvent.setup()
    patchProjectMock.mockRejectedValue(new Error('network down'))
    const panel = await loadPlan()

    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'She is not staying.',
    )
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('save failed')).not.toBeNull()
    expect(
      (within(panel).getByLabelText('Audience learns') as HTMLTextAreaElement)
        .value,
    ).toBe('She is not staying.')
    expect(within(panel).getByRole('button', { name: 'Save' })).not.toBeNull()
  })

  it('a failed Open Review shows a danger toast, not a line above the board', async () => {
    const user = userEvent.setup()
    createChangeSetMock.mockRejectedValue(new Error('review is down'))
    const panel = await loadPlan()

    await user.type(within(panel).getByLabelText('What happens'), ' Again.')
    await user.click(within(panel).getByRole('button', { name: 'Open Review' }))

    const message = await screen.findByText('review is down')
    expect(message.closest('[data-testid="toast"]')).not.toBeNull()
  })

  it('← Episode switches the panel to the episode view and clears the card selection', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()

    await user.click(within(panel).getByRole('button', { name: '← Episode' }))

    expect(
      within(screen.getByTestId('inspector')).queryByTestId('lock-toggle'),
    ).toBeNull()
    expect(screen.getByTestId('scene-card-scene-1').className).not.toContain(
      'bg-tr-coral-soft',
    )
  })

  // Task 3's test, carried over unchanged.
  it('scrolls the board and both side panels on their own inside a fixed-height row', async () => {
    getProjectMock.mockResolvedValue(project())
    getLedgerMock.mockResolvedValue([])
    getConsistencyFlagsMock.mockResolvedValue([])
    window.history.pushState(null, '', '/plan?project=proj-longpour')

    render(<PlanScreen />)

    const board = await screen.findByLabelText('Plan board')
    expect(board.className).toContain('overflow-y-auto')
    expect(board.className).toContain('min-w-0')
    const row = board.parentElement as HTMLElement
    expect(row.className).toContain('h-[calc(100vh-var(--tr-shell-height))]')
    expect(row.className).toContain('overflow-hidden')
    expect(screen.getByTestId('story-layers-panel').className).toContain(
      'overflow-y-auto',
    )
    expect(screen.getByTestId('inspector').className).toContain(
      'overflow-y-auto',
    )
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
(cd apps/web && npx vitest run src/plan/Board.test.tsx src/plan/PlanScreen.test.tsx)
```

Expected failures:
- Board: "a beat selection keeps its scene card selected", because the className lacks `bg-tr-coral-soft` (today `selected` only covers `type === 'scene'`).
- Board: "beats are not on the board", because the "Expand beats" button is still found.
- PlanScreen: the new tests fail. The old `Inspector` has no `beat-card-beat-1-1` (`Unable to find an element by: [data-testid="beat-card-beat-1-1"]`), and it has no "← Episode" button. The review error is a `<p role="alert">` outside any `[data-testid="toast"]`.
- The three carried-over PlanScreen tests (the two resume tests and Task 3's scrolling test) still pass.

- [ ] **Step 3: Minimal implementation**

(a) Before deleting, confirm every `Inspector.test.tsx` case has a home:
- Premises: Task 9 EpisodePanel.
- Motivations with a resolved name: Task 5 WhoWantsWhat.
- Facts from another scene: Task 7.
- Locked banner, read-only field and disabled Act: Task 9.
- Act disabled when the episode is locked or a save is pending: Task 9.
- Format act options and immediate save: Task 9.
- Scene lock callback: Task 9.
- Locked pill classes: Task 8.
- Structural footer and Save field only: Task 4/Task 5.
- Open Review with the draft: Task 4/Task 5.
- Location is a plain Save: Task 6.
- Beat fields and the scriptLocked switch: Task 8.
- scriptLocked callback: Task 8.

Then:

```bash
git rm apps/web/src/plan/Inspector.tsx apps/web/src/plan/Inspector.test.tsx apps/web/src/plan/BeatCard.tsx
sed -i '' '/onSelectBeat/d' apps/web/src/plan/Board.tsx
grep -c onSelectBeat apps/web/src/plan/Board.tsx   # expect 0
```

(The six deleted Board.tsx lines are exactly the `ActFrameProps` member, the `ActFrame` destructure, the `SceneCard` prop, the `BoardProps` member, the `Board` destructure and the `ActFrame` prop. Each is a single line, and nothing else in the file mentions `onSelectBeat`.)

(b) Replace `apps/web/src/plan/SceneCard.tsx` with:

```tsx
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import type { Scene } from 'contract'
import { Card } from './Card'
import { Chip } from './Chip'

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export type PlanSelection =
  | { type: 'scene'; sceneId: string }
  | { type: 'beat'; sceneId: string; beatId: string }
  | null

export interface SceneCardProps {
  scene: Scene
  episodeLocked: boolean
  /** A beat selection also marks its scene's card: the panel is showing
   * that scene, with the beat open in its ladder. */
  selection: PlanSelection
  /** A PATCH is in flight (useProjectPatch). Drag initiation is refused
   * while true — starting a second reorder mid-flight would let the first
   * one's rollback (which restores the exact pre-patch doc) silently erase
   * the second one's optimistic change. Same guard LockToggle and the
   * panel's save buttons already apply via `disabled`. */
  pending: boolean
  /** True when this scene (or one of its beats) has an open consistency
   * flag — UI spec §5 amber dot on Plan scene cards. */
  hasOpenConsistencyFlag: boolean
  onSelectScene: (sceneId: string) => void
  /** Double-click opens Write on this scene (script-home deep link). */
  onOpenInWrite: (sceneId: string) => void
  dragging: boolean
  dropTarget: boolean
  onDragStartScene: (sceneId: string) => void
  onDragEndScene: () => void
  onDragOverScene: (sceneId: string) => void
  onDragLeaveScene: () => void
  onDropScene: (targetSceneId: string) => void
}

/**
 * A scene card on the Plan board (UI spec §5). Draggable for reorder unless
 * the scene is locked — brief obligation 3: "do not build UI that lets a
 * user drag a locked scene" — or a mutation is in flight (`pending`; see
 * the prop doc above). Locked scenes are also refused as *drop* targets:
 * swapping another scene into a locked scene's slot would still change the
 * locked scene's `index`.
 *
 * Beats are not on the board: they live in the scene panel's beat ladder
 * (T3.3, plan redesign spec §4.6). Keyboard: the card is a focusable button
 * — Enter/Space selects the scene (UI spec §8). Double-click opens Write on
 * this scene (UI spec §5).
 */
export function SceneCard({
  scene,
  episodeLocked,
  selection,
  pending,
  hasOpenConsistencyFlag,
  onSelectScene,
  onOpenInWrite,
  dragging,
  dropTarget,
  onDragStartScene,
  onDragEndScene,
  onDragOverScene,
  onDragLeaveScene,
  onDropScene,
}: SceneCardProps) {
  const locked = scene.locked || episodeLocked
  const draggable = !locked && !pending
  const selected = selection?.sceneId === scene.id

  function handleDoubleClick(event: MouseEvent) {
    event.preventDefault()
    onOpenInWrite(scene.id)
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Only when the card itself is focused, not a control nested inside it.
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectScene(scene.id)
    }
  }

  function handleDragStart(event: DragEvent) {
    if (!draggable) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData('text/plain', scene.id)
    event.dataTransfer.effectAllowed = 'move'
    onDragStartScene(scene.id)
  }

  function handleDragOver(event: DragEvent) {
    if (locked) return // no preventDefault: browser shows "not allowed", drop never fires
    event.preventDefault()
    onDragOverScene(scene.id)
  }

  function handleDrop(event: DragEvent) {
    if (locked) return
    event.preventDefault()
    onDropScene(scene.id)
  }

  return (
    <Card
      variant="raised"
      selected={selected}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={onDragEndScene}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeaveScene}
      onDrop={handleDrop}
      onClick={() => onSelectScene(scene.id)}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      data-testid={`scene-card-${scene.id}`}
      data-locked={locked}
      title="Double-click to open in Write"
      className={
        'w-card-scene shrink-0 cursor-pointer select-none transition-shadow motion-reduce:transition-none' +
        (dragging ? ' shadow-lift opacity-60' : '') +
        (dropTarget ? ' bg-tr-surface-clay' : '')
      }
    >
      <div className="flex items-center gap-2">
        <p className="text-13 font-semibold text-tr-text-primary">
          {scene.index + 1} · {scene.location}
        </p>
        {hasOpenConsistencyFlag && (
          <span
            data-testid="consistency-flag-badge"
            aria-label="Open consistency flag"
            title="Open consistency flag"
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-tr-amber"
          />
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-13 text-tr-text-secondary">
        {scene.whatHappens}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip hue="neutral">
          {scene.beats.length} beat{scene.beats.length === 1 ? '' : 's'}
        </Chip>
        {locked && (
          <Chip hue="amber">
            <LockGlyph /> Locked
          </Chip>
        )}
      </div>
    </Card>
  )
}
```

(c) Replace `apps/web/src/plan/PlanScreen.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Beat,
  ConsistencyFlag,
  LedgerFact,
  Project,
  Scene,
} from 'contract'
import {
  createChangeSet,
  getConsistencyFlags,
  getLedger,
  getProject,
  suggestInstructions,
} from '../api/client'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { navigateToReview, stashChangeSet } from '../review/changeSetSession'
import { AppShell } from '../shell/AppShell'
import {
  navigateToMode,
  navigateToWriteBeat,
  navigateToWriteScene,
} from '../shell/modeNavigation'
import { Toast } from '../shell/Toast'
import { lockedObjectMessage, staleHeadMessage } from '../shell/toastCopy'
import { Board } from './Board'
import { GuidedSetup } from './GuidedSetup'
import { needsGuidedSetup } from './needsGuidedSetup'
import { EpisodePanel } from './panel/EpisodePanel'
import { ScenePanel } from './panel/ScenePanel'
import { PlanDraftsContext, usePlanDraftStore } from './panel/usePlanDrafts'
import type { PlanSelection } from './SceneCard'
import { StoryLayersPanel } from './StoryLayersPanel'
import { sceneIdsWithOpenFlags } from './flaggedScenes'
import {
  buildBeatPatch,
  buildEpisodePatch,
  buildProjectFieldPatch,
  buildSceneSwapPatch,
  buildScenePatch,
  swapScenesLocally,
  withBeatField,
  withEpisodeField,
  withProjectField,
  withSceneField,
} from './planTree'
import { useProjectPatch } from './useProjectPatch'
import { allScenes, findScene } from '../write/projectTree'

function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

export function PlanScreen() {
  const projectId = requireProjectId()
  const focusSceneId = useUrlParam('scene')
  const activeProjectId = projectId ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [skippedGuidedSetup, setSkippedGuidedSetup] = useState(false)
  const [ledger, setLedger] = useState<LedgerFact[]>([])
  const [openFlags, setOpenFlags] = useState<ConsistencyFlag[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState<PlanSelection | undefined>(
    focusSceneId ? { type: 'scene', sceneId: focusSceneId } : undefined,
  )
  const [collapsedActs, setCollapsedActs] = useState<Set<number>>(new Set())
  const [openingReview, setOpeningReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  // One draft per field for the whole screen (spec §4.9): survives scene
  // switches and failed saves. In memory only.
  const drafts = usePlanDraftStore()

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([
      getProject(projectId),
      getLedger(projectId),
      getConsistencyFlags(projectId, 'open'),
    ])
      .then(([loadedProject, loadedLedger, loadedFlags]) => {
        if (cancelled) return
        setProject(loadedProject)
        setLedger(loadedLedger)
        setOpenFlags(loadedFlags)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(
          err instanceof Error ? err.message : 'failed to load project',
        )
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const effectiveSelection = useMemo<PlanSelection>(() => {
    if (selection !== undefined) return selection
    if (!projectId || !project) return null
    const scenes = allScenes(project)
    const sceneIds = scenes.map((s) => s.id)
    const sceneId = focusSceneId ?? loadResume(projectId, sceneIds).sceneId
    const validScene = sceneId ? findScene(project, sceneId) : null
    const fallbackSceneId = validScene?.id ?? scenes[0]?.id
    return fallbackSceneId ? { type: 'scene', sceneId: fallbackSceneId } : null
  }, [focusSceneId, project, projectId, selection])

  useEffect(() => {
    if (!projectId || !project) return
    const sceneId = effectiveSelection?.sceneId
    saveResume(projectId, { mode: 'Plan', sceneId })
  }, [effectiveSelection, project, projectId])

  // Deep-link from Review "Go to scene" / consistency flags: scroll + brief
  // highlight once the board mounts (selection already seeded from ?scene=).
  useEffect(() => {
    if (!focusSceneId || !project) return
    const el = document.querySelector(
      `[data-testid="scene-card-${focusSceneId}"]`,
    )
    if (!(el instanceof HTMLElement)) return
    el.scrollIntoView({ block: 'nearest' })
    el.classList.add('outline', 'outline-selected', 'outline-tr-coral')
    const t = window.setTimeout(() => {
      el.classList.remove('outline', 'outline-selected', 'outline-tr-coral')
    }, 2000)
    return () => window.clearTimeout(t)
  }, [focusSceneId, project])

  const mergeNewFlags = useCallback((newFlags: ConsistencyFlag[]) => {
    if (newFlags.length === 0) return
    setOpenFlags((prev) => {
      const byId = new Map(prev.map((f) => [f.id, f]))
      for (const flag of newFlags) byId.set(flag.id, flag)
      return [...byId.values()]
    })
  }, [])

  const patcher = useProjectPatch(
    activeProjectId,
    project,
    setProject,
    mergeNewFlags,
  )

  const flaggedSceneIds = useMemo(
    () =>
      project ? sceneIdsWithOpenFlags(openFlags, project) : new Set<string>(),
    [openFlags, project],
  )

  function toggleActCollapse(act: number) {
    setCollapsedActs((prev) => {
      const next = new Set(prev)
      if (next.has(act)) next.delete(act)
      else next.add(act)
      return next
    })
  }

  function handleReorder(draggedId: string, targetId: string) {
    if (!project) return
    const ops = buildSceneSwapPatch(project, draggedId, targetId)
    if (!ops) return
    void patcher.patch(ops, swapScenesLocally(project, draggedId, targetId))
  }

  // Every Plan save and lock flip is one direct-edit PATCH and one snapshot
  // (rule 4). Each resolves `true` only when the server accepted it, so a
  // field drops its draft only then.
  function saveSceneField<K extends keyof Scene>(
    sceneId: string,
    field: K,
    value: Scene[K],
  ): Promise<boolean> {
    if (!project) return Promise.resolve(false)
    const ops = buildScenePatch(project, sceneId, field, value)
    if (!ops) return Promise.resolve(false)
    return patcher.patch(ops, withSceneField(project, sceneId, field, value))
  }

  function saveBeatField<K extends keyof Beat>(
    sceneId: string,
    beatId: string,
    field: K,
    value: Beat[K],
  ): Promise<boolean> {
    if (!project) return Promise.resolve(false)
    const ops = buildBeatPatch(project, sceneId, beatId, field, value)
    if (!ops) return Promise.resolve(false)
    return patcher.patch(
      ops,
      withBeatField(project, sceneId, beatId, field, value),
    )
  }

  function saveEpisodePremise(
    episodeId: string,
    value: string,
  ): Promise<boolean> {
    if (!project) return Promise.resolve(false)
    const ops = buildEpisodePatch(project, episodeId, 'premise', value)
    if (!ops) return Promise.resolve(false)
    return patcher.patch(
      ops,
      withEpisodeField(project, episodeId, 'premise', value),
    )
  }

  function saveSeriesPremise(value: string): Promise<boolean> {
    if (!project) return Promise.resolve(false)
    return patcher.patch(
      buildProjectFieldPatch('premise', value),
      withProjectField(project, 'premise', value),
    )
  }

  function openInWrite(sceneId: string, beatId?: string) {
    saveResume(activeProjectId, { mode: 'Write', sceneId })
    if (beatId) navigateToWriteBeat(sceneId, beatId)
    else navigateToWriteScene(sceneId)
  }

  /** Ledger deep link to one fact (moved from the old inspector's
   * AffectedFacts; T3.4 swaps it for navigateToLedgerFact). */
  function openFact(factId: string) {
    const url = new URL(window.location.href)
    url.pathname = '/ledger'
    url.searchParams.set('fact', factId)
    window.location.assign(url.toString())
  }

  /** A4 chips for an empty What happens — only on the writer's explicit
   * Suggest… click (rule 8, owner decision 5), never on focus. */
  function suggest(sceneId: string): Promise<string[]> {
    return suggestInstructions(activeProjectId, {
      context: 'scene',
      targetId: sceneId,
      surface: 'scene_premise',
      draftScript: null,
    }).then((result) => result.suggestions)
  }

  async function handleOpenReview(targetObjectId: string, instruction: string) {
    setOpeningReview(true)
    setReviewError(null)
    try {
      const changeSet = await createChangeSet(activeProjectId, {
        targetObjectId,
        instruction,
      })
      stashChangeSet(changeSet)
      navigateToReview(activeProjectId, changeSet.id)
    } catch (err: unknown) {
      setReviewError(
        err instanceof Error ? err.message : 'failed to open Review',
      )
      setOpeningReview(false)
    }
  }

  if (loadError) {
    return (
      <AppShell
        projectTitle="Table Read"
        activeMode="Plan"
        ledgerCount={0}
        projectId={projectId ?? undefined}
      >
        <p className="p-8 text-15 text-tr-danger">
          Couldn&apos;t load this project: {loadError}
        </p>
      </AppShell>
    )
  }

  if (!projectId) return null

  if (!project) {
    return (
      <AppShell
        projectTitle="Table Read"
        activeMode="Plan"
        ledgerCount={0}
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-text-secondary">Loading…</p>
      </AppShell>
    )
  }

  // Guided Plan setup (design spec §6/§9.4): shown while the project has no
  // usable scene skeleton (no season/episode yet, or an episode with no
  // scene containing a beat) — before the (otherwise empty) board. Skip is
  // local only: the writer can leave and build by hand without a server write.
  if (needsGuidedSetup(project) && !skippedGuidedSetup) {
    const characters = project.seriesBible.characters.map((c) => ({
      id: c.id,
      name: c.name,
    }))
    return (
      <AppShell
        projectTitle={project.title}
        activeMode="Plan"
        ledgerCount={ledger.filter((f) => f.status === 'pending_review').length}
        projectId={projectId}
      >
        <GuidedSetup
          projectId={activeProjectId}
          premise={project.premise}
          theme={project.seriesBible.existentialQuestion.text}
          characters={characters}
          onSkip={() => setSkippedGuidedSetup(true)}
        />
      </AppShell>
    )
  }

  // MVP: exactly one season, one episode (data contract §1).
  const episode = project.seasons[0]?.episodes[0]
  if (!episode) {
    return (
      <AppShell
        projectTitle={project.title}
        activeMode="Plan"
        ledgerCount={ledger.filter((f) => f.status === 'pending_review').length}
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-text-secondary">
          This project has no episode yet.
        </p>
      </AppShell>
    )
  }

  const selectScene = (sceneId: string) =>
    setSelection({ type: 'scene', sceneId })
  // A stale ?scene= id resolves to no scene: show the episode view.
  const selectedScene = effectiveSelection
    ? findScene(project, effectiveSelection.sceneId)
    : null

  return (
    <PlanDraftsContext.Provider value={drafts}>
      <AppShell
        projectTitle={project.title}
        activeMode="Plan"
        ledgerCount={ledger.filter((f) => f.status === 'pending_review').length}
        projectId={projectId}
      >
        {reviewError && (
          <Toast tone="danger" onDismiss={() => setReviewError(null)}>
            {reviewError}
          </Toast>
        )}
        {patcher.error && (
          <Toast tone="danger" onDismiss={patcher.dismissError}>
            {patcher.error.code === 'LOCKED_OBJECT'
              ? lockedObjectMessage
              : patcher.error.code === 'CONFLICT_STALE_HEAD'
                ? staleHeadMessage
                : patcher.error.message}
          </Toast>
        )}
        <div className="flex h-[calc(100vh-var(--tr-shell-height))] min-h-0 overflow-hidden">
          <StoryLayersPanel
            project={project}
            episode={episode}
            selection={effectiveSelection}
            collapsedActs={collapsedActs}
            onSelectNothing={() => setSelection(null)}
            onSelectScene={selectScene}
            onToggleActCollapse={toggleActCollapse}
          />
          <Board
            project={project}
            episode={episode}
            selection={effectiveSelection}
            collapsedActs={collapsedActs}
            pending={patcher.pending}
            flaggedSceneIds={flaggedSceneIds}
            onSelectScene={selectScene}
            onOpenInWrite={(sceneId) => openInWrite(sceneId)}
            onReorder={handleReorder}
          />
          {selectedScene ? (
            <ScenePanel
              project={project}
              episode={episode}
              scene={selectedScene}
              selectedBeatId={
                effectiveSelection?.type === 'beat'
                  ? effectiveSelection.beatId
                  : null
              }
              ledger={ledger}
              flags={openFlags}
              pending={patcher.pending}
              openingReview={openingReview}
              onBack={() => setSelection(null)}
              onSelectScene={selectScene}
              onSelectBeat={(sceneId, beatId) =>
                setSelection(
                  beatId
                    ? { type: 'beat', sceneId, beatId }
                    : { type: 'scene', sceneId },
                )
              }
              onToggleSceneLock={(sceneId, locked) =>
                void saveSceneField(sceneId, 'locked', locked)
              }
              onToggleBeatLock={(sceneId, beatId, locked) =>
                void saveBeatField(sceneId, beatId, 'locked', locked)
              }
              onToggleBeatScriptLock={(sceneId, beatId, scriptLocked) =>
                void saveBeatField(
                  sceneId,
                  beatId,
                  'scriptLocked',
                  scriptLocked,
                )
              }
              onSaveSceneField={saveSceneField}
              onSaveBeatField={(sceneId, beatId, field, value) =>
                saveBeatField(sceneId, beatId, field, value)
              }
              onOpenReview={(sceneId, instruction) =>
                void handleOpenReview(sceneId, instruction)
              }
              onSuggest={suggest}
              onOpenInWrite={(sceneId) => openInWrite(sceneId)}
              onOpenBeatInWrite={openInWrite}
              onOpenFact={openFact}
              onOpenLedger={() => navigateToMode('Ledger')}
            />
          ) : (
            <EpisodePanel
              project={project}
              episode={episode}
              pending={patcher.pending}
              openingReview={openingReview}
              onSaveEpisodePremise={(value) =>
                saveEpisodePremise(episode.id, value)
              }
              onSaveSeriesPremise={saveSeriesPremise}
            />
          )}
        </div>
      </AppShell>
    </PlanDraftsContext.Provider>
  )
}
```

(d) `apps/web/e2e/plan.spec.ts`:

1. In the header comment, replace the five lines from `// mutations (the scene-3/scene-4 swap, the scene-6 lock toggle) are chosen` through `// write/error-states' assertions, in either run order.` with:
   ```ts
   // mutations (the scene-3/scene-4 swap, the scene-6 lock toggle, and a
   // beat-4-1 Beat lock that the test switches back off) are chosen
   // to be inert for every other spec — Write mode never reads `scene.act`,
   // `scene.index`, or `scene.locked` (only `beat.locked`/`scriptLocked`
   // gate its rendering, which is why the beat-4-1 lock is undone), so
   // nothing here can break locked-beat/quiet-ai/write/error-states'
   // assertions, in either run order.
   ```
   Keep the lines above it (`// Shared-DB note … one`, `// worker, one seeded project for the whole \`make e2e\` run. This file's`).

2. Replace the whole `test('lock icon renders on beat-1-2 (locked in fixture); beat-1-1 has none', …)` block with:

```ts
test('lock icon renders on beat-1-2 (locked in fixture); beat-1-1 has none', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')

  // Beats live in the scene panel's beat ladder (T3.3), not on the board.
  await page.getByTestId('scene-card-scene-1').click()
  const inspector = page.getByTestId('inspector')

  const beat12 = inspector.getByTestId('beat-card-beat-1-2')
  await expect(beat12).toBeVisible()
  await expect(beat12).toContainText('Locked')

  const beat11 = inspector.getByTestId('beat-card-beat-1-1')
  await expect(beat11).toBeVisible()
  await expect(beat11).not.toContainText('Locked')
})
```

3. In `test('locking a scene via the inspector disables drag and shows the read-only banner', …)`, replace:

```ts
  await expect(inspector.getByRole('switch')).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await inspector.getByRole('switch').click()

  await expect(inspector.getByText('Locked — unlock to edit')).toBeVisible()
```

with:

```ts
  // The scene toggle keeps `lock-toggle`; an open beat adds its own switches.
  const lockToggle = inspector.getByTestId('lock-toggle')
  await expect(lockToggle).toHaveAttribute('aria-checked', 'false')
  await lockToggle.click()

  await expect(
    inspector.getByText(
      'Locked — unlock to edit. Review will never change this scene.',
    ),
  ).toBeVisible()
```

4. In `test('editing location is silent; editing whatHappens offers the Review path; both persist (T3.2)', …)`, replace:

```ts
  // 1) Non-structural: editing location shows a plain Save — no footer bar.
  const location = inspector.getByLabel('Location')
```

with:

```ts
  // 1) Non-structural: editing location shows a plain Save — no footer bar.
  // Location lives in the Details section, closed by default (T3.3).
  await inspector.locator('#plan-section-details > summary').click()
  const location = inspector.getByLabel('Location')
```

5. Append at the end of the file:

```ts
test('a Beat lock set in the panel persists after reload (T3.3)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-4').click()
  const inspector = page.getByTestId('inspector')

  await inspector.getByTestId('beat-card-beat-4-1').click()
  const beatLock = inspector.getByTestId('beat-lock-toggle-beat-4-1')
  await expect(beatLock).toHaveAttribute('aria-checked', 'false')
  await beatLock.click()
  await expect(beatLock).toHaveAttribute('aria-checked', 'true')
  await expect(beatLock).toBeEnabled() // the PATCH has settled
  await expect(inspector.getByTestId('beat-card-beat-4-1')).toContainText(
    'Locked',
  )

  await page.reload()
  await page.getByTestId('scene-card-scene-4').click()
  const reloaded = page.getByTestId('inspector')
  await reloaded.getByTestId('beat-card-beat-4-1').click()
  const reloadedLock = reloaded.getByTestId('beat-lock-toggle-beat-4-1')
  await expect(reloadedLock).toHaveAttribute('aria-checked', 'true')

  // Shared DB: other specs key off beat locks, so put this one back.
  await reloadedLock.click()
  await expect(reloadedLock).toHaveAttribute('aria-checked', 'false')
  await expect(reloadedLock).toBeEnabled()
})
```

(e) `apps/web/src/plan/planTree.test.ts` still imports the deleted inspector's props type (line 10) and uses it at line 306, which breaks `npx tsc -b`. Retarget both to `ScenePanel`, whose save callback returns a promise. Line 10 becomes:

```ts
import type { ScenePanelProps } from './panel/ScenePanel'
```

and line 306 becomes:

```ts
    const saveSceneField: ScenePanelProps['onSaveSceneField'] = () =>
      Promise.resolve(true)
```

Keep the three `@ts-expect-error` lines below it: `saveSceneField('scene-1', 'act', '2')` still fails to typecheck because `'2'` is not a number.

- [ ] **Step 4: Run tests to verify they pass**

Unit, types, lint, format:

```bash
(cd apps/web && npx vitest run src/plan/Board.test.tsx src/plan/PlanScreen.test.tsx)
(cd apps/web && npx prettier --write src/plan/PlanScreen.tsx src/plan/PlanScreen.test.tsx src/plan/SceneCard.tsx src/plan/Board.tsx src/plan/Board.test.tsx src/plan/planTree.test.ts e2e/plan.spec.ts)
(cd apps/web && npx vitest run)
(cd apps/web && npx tsc -b && npx eslint . && npx prettier --check .)
grep -n "onSelectBeat\|BeatCard" apps/web/src/plan/Board.tsx apps/web/src/plan/SceneCard.tsx apps/web/src/plan/Board.test.tsx
grep -rn "from './Inspector'\|from './BeatCard'" apps/web/src
```

Expected:
- Board.test passes: the two new tests, with three removed.
- PlanScreen.test passes, all 8 tests.
- The full vitest run is green.
- tsc, eslint and prettier are clean.
- Both greps print nothing. `onSelectBeat` legitimately remains only on ScenePanel and BeatLadder, and in PlanScreen's ScenePanel prop.

E2E. Use a temporary config and a temporary venv symlink, and delete both before committing. Run each line from the worktree root:

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
(cd apps/web && E2E_API_PORT=8100 E2E_WEB_PORT=5180 npx playwright test --config=e2e/playwright.local.config.ts e2e/plan.spec.ts e2e/review.spec.ts e2e/recipes.spec.ts e2e/newproject-resume.spec.ts)
rm apps/web/e2e/playwright.local.config.ts apps/api/.venv
git status --short   # neither temporary path may appear
```

Expected: `plan.spec.ts` (7 tests), `review.spec.ts`, `recipes.spec.ts` and `newproject-resume.spec.ts` all pass. `review.spec.ts` is unchanged: with no beat open, the scene's "What happens" is the panel's only field with that label.

If any spec fails, run the same spec against `origin/main` first. Use a separate `git worktree add <scratch>/wt-baseline origin/main` with the same temporary config and symlink, then `git worktree remove` it. Never `git stash`. Only failures that are new against that baseline belong to this change.

- [ ] **Step 5: Commit**

The three deletions are already staged by `git rm` in Step 3.

```bash
git add apps/web/src/plan/PlanScreen.tsx apps/web/src/plan/PlanScreen.test.tsx apps/web/src/plan/SceneCard.tsx apps/web/src/plan/Board.tsx apps/web/src/plan/Board.test.tsx apps/web/src/plan/planTree.test.ts apps/web/e2e/plan.spec.ts
git status --short   # expect M on those seven, D on Inspector.tsx, Inspector.test.tsx, BeatCard.tsx, nothing else
git commit -F - <<'EOF'
plan: swap the inspector for the scene panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Phase 1 docs (UI spec, build plan, test plan, handoff)

**PR:** T3.3 · **Depends on:** Task 10

**Files:**
- Modify: `docs/tableread-ui-spec.md` (§1 layout comment, line 92; §5 from `## 5. Plan mode (MVP: simplified board)` up to `### 5a. Guided Plan setup`)
- Modify: `docs/tableread-build-plan.md` (Milestone 3: after the T3.2 `_Accept:_` line, before `## Milestone 4`)
- Modify: `docs/tableread-test-plan.md` (end of the **Frontend unit** paragraph; end of the **E2E (Playwright, mock API, fixture-seeded)** paragraph)
- Modify: `docs/tableread-handoff.md` (§4 decision log: a new last row)

**Interfaces:**
- Consumes: the behaviour shipped in Tasks 3–10, plus the T3.4 behaviour planned in Tasks 12–14. All Phase 1 docs land here, so Tasks 12–14 touch no docs.
- Produces: UI spec §5 describes the Phase 1 panel; build-plan entries T3.3–T3.9, each with an `_Accept:_` line; test-plan sentences; a handoff decision-log row.

- [ ] **Step 1: Write the failing check**

```bash
grep -c "import board's reading view" docs/tableread-ui-spec.md
grep -c "^\*\*T3.3 " docs/tableread-build-plan.md
grep -c "Plan panel (T3.3" docs/tableread-test-plan.md
grep -c "Plan redesign (Story Health)" docs/tableread-handoff.md
```

- [ ] **Step 2: Run it to verify it fails**

Expected: each `grep -c` prints `0` (exit status 1). The docs do not yet describe the Phase 1 panel.

- [ ] **Step 3: Edit the docs**

(a) `docs/tableread-ui-spec.md` §1, in the `/* Layout: … */` comment line, replace the phrase Task 3 wrote, `Plan panels 232/296/214px; Plan scene panel 400px (--tr-panel-plan, redesign 2026-10-13);`, with:

```
Plan: Story Layers 232px, scene cards 214px, scene panel 400px (--tr-panel-plan, owner-approved 2026-10-13); --tr-panel-inspector 296px is the import board's reading view;
```

(b) `docs/tableread-ui-spec.md` §5. Replace everything from the line `## 5. Plan mode (MVP: simplified board)` up to the blank line before `### 5a. Guided Plan setup` with:

```markdown
## 5. Plan mode (MVP: simplified board)

Layout (Plan redesign Phase 1, `docs/superpowers/specs/2026-10-13-plan-redesign-design.md`): a fixed-height screen (the viewport minus the shell) with three columns that each scroll on their own — left Story Layers panel (232px, sunken; retired in T3.6) · center board (page surface, pannable, not yet infinite/zoomable) · right **scene panel** (`--tr-panel-plan` 400px, raised, `data-testid="inspector"`). Clicking a card anywhere updates a panel that is already on screen. The board bullets below change in T3.5–T3.7.

- **Story Layers panel:** tree — Bible (premise, characters, theme) / Episode / Acts / Scenes. Selecting focuses the board; eye toggles collapse acts. MVP has no free placement — the "canvas" is a structured board whose grammar (frames, cards, selection, panel) upgrades to the real canvas in v2 without relearning.
- **Acts as frames:** horizontal bands in `--tr-surface-clay` with act labels ("COLD OPEN", "ACT ONE"…) in display font.
- **Scene cards** (raised, 12px radius, 214px): index + location (13px strong) · whatHappens (2-line clamp) · chips: storyline letter (v2, hidden), beat count, lock; amber dot when the scene or one of its beats has an open note; coral dot when it holds unsaved edits (T3.4). Selected = `--tr-coral-soft` fill with accent ink, also while one of its beats is open in the panel. Drag to reorder within/between acts; drop targets highlight clay. Beats are not on the board: they live in the scene panel's beat ladder. **Double-click** opens Write mode on that scene (`/?project=…&scene=…`) — single-click only selects.
- **Connector lines:** v2. Reserve a toggle row in the panel footer, disabled with tooltip "Setup/payoff threads — v2".
- **Scene panel (right):**
  - **Sticky header:** "← Episode" (back to the nothing-selected view) · "Scene n of N" with ‹ › in board order · title "n · Place" (the slug without INT./EXT. and the time) with a lock glyph and an _unsaved_ chip when they apply · jump bar Notes n (only when there are notes) · Scene · Wants n · Touches n · Beats n · Details, with the section in view underlined (scroll-spy).
  - **Top of body:** the full slug in Courier · controls row: **Act** selector · **Lock** switch (`lock-toggle`, a pill, accent when locked; locks children, per data contract) · **Open in Write ↗**. The Act selector lists exactly the project's format-valid labels (`COLD OPEN` plus numbered acts when `coldOpen` is true; numbered acts beginning at `ACT ONE` otherwise), including empty destination acts that have no drag target. It is disabled for effectively locked scenes/episodes and while a save is pending. A change uses the normal optimistic scene-field PATCH, moves the card to the selected act frame, persists after reload, and rolls back on failure; it creates one snapshot and no LLM or consistency call. A locked scene or episode shows the banner "Locked — unlock to edit. Review will never change this scene."
  - **Notes strip (T3.4):** only when the scene has open notes. Collapsed: "⚑ n notes · m from the import", a two-line peek at the first story note, **Show**. Expanded, one card per story note: a continuity note shows its full explanation — "Scene n" references link to that scene (by id; a scene that no longer exists stays plain text), fact ids read as "a Ledger fact" links, and the linked fact is quoted — with **Show beat** · **Open in Write** · **Dismiss**; an act-split note offers **Change the act** · **Looks right — dismiss**. **From the import · m** is a closed group of plain-language notes ("The import couldn't place script lines a–b and kept them in beat n.m", never the raw `[code]`) with **Open beat in Write** · **Looks right — dismiss**. Dismiss makes a snapshot; Plan refetches the project and notes, and a toast offers **Undo** while nothing else has changed.
  - **Sections**, each a native `<details>` whose open state is remembered per viewer (`localStorage` `tr.plan.sections.v1`):
    1. **What the scene does** (steers Next Beat): What happens (15px, structural, auto-grow) with an explicit **Suggest…** button for the A4 chips; the beat-sheet landmark callout where one exists; **The audience** — Learns / Feels, each editable in place.
    2. **Who wants what (n)** (steers Next Beat): one read-only card per motivation — Wants · Says (`statedObjective`, italic, only when it differs) · Up against · At stake · **◆ Hidden agenda** when `concealed`; "Also in the scene: … · from dialogue cues"; one quiet line when nothing is recorded.
    3. **What it touches:** threads (↗ sets up / ↘ pays off, summary, "Pays off in n →" or "Never paid off"); the secret as a dramatic-irony callout (who doesn't know, who in this scene is in the dark, Set in n / Out in n); facts established here — active and pending only, type chip, _Unconfirmed_, ◆ hidden from the audience, Known by, "Show n retired", "Open in Ledger →" (a fact opens Ledger at that fact); relationship moments. Each empty group shows one quiet line.
    4. **Beats (n):** the beat ladder — rows "n.m" show `beat.whatHappens` (never the first script line), a ⚑ story-note or ⚐ import-note marker, "Locked" when effectively locked (cascaded from scene and episode), the landmark tag, "lands" on the last beat, and a "↷ Then a time jump: …" divider from `timelineAnchors`. Opening a row (one at a time; it scrolls into view) shows What happens / Audience learns / Audience feels, a **Beat** lock (`beat.locked`) and a **Script** lock (`scriptLocked`), a closed **Script text** disclosure and **Open beat in Write ↗**.
    5. **Details** (closed by default): Location, Time, Social situation (auto-grow); a disabled Storyline select only when `episode.storylines` is non-empty.
  - **Editing:** every field keeps its own in-memory draft, so an edit survives switching scenes and a failed save; typing back to the saved value is not a draft. A dirty plain field shows **Save** · **Discard**. A dirty structural field (scene `whatHappens`, premises) shows the footer bar _"Structural change — review impact?"_ → **Open Review** (coral) / _Save field only_ (text) / Discard. **Save field only** means exactly that: the field is written as a direct PATCH with **no regeneration of anything else** — but the post-save consistency scan still runs (the flagging promise holds even when the writer skips Review), so any contradictions it creates surface as notes rather than silently persisting. Every save is one direct-edit PATCH and one snapshot. **Suggest…** shows only on an empty, unlocked What happens and calls `suggest` only when clicked — nothing in Plan calls a model on mount, select, hover or focus.
  - **Leaving Plan with drafts (T3.4):** mode tabs, ⌘1–4, Open in Write, Ledger links, shell Undo/restore and Open Review (for other fields) open a native `<dialog>` — **Stay in Plan** / **Discard and leave**; closing the tab arms `beforeunload`. No blocking guard inside Plan, no silent discard.

**States:** _Nothing selected_ ("← Episode", or a stale `?scene=`) — the panel shows the episode title, Episode premise and Series premise (structural fields; replaced by the Episode view in T3.6). _Drag_ — card lifts (shadow token), siblings gap-animate. _Locked selection_ — every field read-only (no Save, Discard, footer or Suggest…), Act selector disabled, the banner, beat rows show the cascaded Locked; the Scene, Beat and Script locks, notes, Open in Write and the section toggles still work. _Missing story data_ (idea-born projects, older docs without threads, secret, overview or anchors) — each empty group shows one quiet line and jump counts read 0.
```

(c) `docs/tableread-build-plan.md`: insert after the line `_Accept:_ editing location is silent; editing scene premise offers the Review path; both snapshot.` (the T3.2 accept line) and before `## Milestone 4 — …`:

```markdown

**T3.3 Plan panel restructure (Plan redesign Phase 1; spec `docs/superpowers/specs/2026-10-13-plan-redesign-design.md` §4.6, §4.11–4.13, §7).** Plan becomes a fixed-height screen whose Story Layers, board and a 400px scene panel (`--tr-panel-plan`, the one new token; `data-testid="inspector"`) scroll on their own. The panel: sticky header (← Episode, Scene n of N ‹ › in board order, title with lock glyph and unsaved chip, jump bar with counts and scroll-spy), slug, controls row (Act, Lock, Open in Write ↗), the locked banner, then persisted native `<details>` sections — What the scene does (What happens with **Suggest…**, landmark callout, The audience), Who wants what, What it touches (threads, secret irony callout, active and pending facts with Show n retired, relationship moments), Beats (the beat ladder replaces beat cards on the board; new `beat.locked` toggle; Script disclosure) and Details (closed). Fields auto-grow and keep a per-field draft across scene switches and failed saves. All derivations live in `apps/web/src/plan/story.ts`. Story Layers stays. No contract, endpoint, LLM operation or PROMPT_VERSION change.
_Accept:_ Vitest — `story.ts` (flag kind for every `[snake_case]` import code, the act-split and continuity samples, linkify by id with a missing scene or fact as plain text, import note text, place title, board order, landmarks, cast from dialogue cues with sluglines, transitions and unmatched cues dropped, threads, secrets, facts split, an episode missing its defaulted keys); drafts survive a scene switch and a failed save, and typing back to the saved value is clean; PlanField structural footer with Discard, plain Save/Discard, read-only when locked; Suggest… makes zero requests on mount, select, focus or typing and drops a late reply for another scene; section open state persists and still toggles with storage blocked; the panel renders its sections in order with jump counts, the new locked banner and read-only fields with working Scene/Beat/Script locks, and exactly one `lock-toggle`; the beat ladder shows `whatHappens`, the cascaded Locked, story vs import markers, the landmark tag, lands and the time jump; What it touches hides retired facts behind Show n retired and marks pending ones Unconfirmed; a beat selection marks its card; a failed save keeps the typed text. E2E `plan.spec.ts` — beat-1-2 reads Locked in the panel's ladder and beat-1-1 doesn't; motivations and facts; the Act combobox; locking through `lock-toggle` shows the banner; Location edits through Details; a Beat lock persists after reload; `review.spec.ts`, `recipes.spec.ts` and `newproject-resume.spec.ts` pass unchanged.

**T3.4 Notes and drafts (Plan redesign Phase 1; spec §4.6 notes strip, §4.9).** The notes strip: flag text with "Scene n" and fact references linkified by id (missing targets stay plain text, never a raw id), the quoted Ledger fact, Dismiss with Undo (`dismissConsistencyFlag`, then refetch the project and open flags because a dismiss moves the head; Undo = `POST /undo` with If-Match = the head after the dismiss), the flag-kind helper and the collapsed From the import group (plain-language text, never the `[code]`). Drafts: the coral unsaved dot on cards, and the leave-Plan native `<dialog>` (Stay in Plan / Discard and leave) on every way out of Plan, plus `beforeunload`.
_Accept:_ Vitest — strip collapsed/expanded, verbs per kind, Dismiss disabled while busy, nothing rendered without notes; a dismiss refetches the head and flags so the next field save does not 409, Undo restores the note without a reload and fails safely ("Plan changed since") after another edit, a dismiss 409 shows the stale-head copy; the leave guard never prompts without drafts, Stay keeps the drafts, Discard leaves with no second prompt, every way out is guarded (mode tabs, ⌘1–4, Open in Write, card double-click, Open beat in Write, Ledger links, shell Undo/restore, Open Review excluding its own field). E2E `plan-notes.spec.ts` — Save field only on scene-2 creates the scene-5 note → Show → Dismiss → Undo brings it back → a field save then succeeds; type in scene-2 → select scene-3 → coral dot → back → text restored → Write tab → Stay → Write tab → Discard and leave reaches Write with no prompt.

**T3.5 Index cards and act headers (Plan redesign Phase 2; spec §4.2, §4.3, §4.10).** The import board's index card in Plan (`--tr-card-board-w/h`, cleaned place title, 4-line reading, beat ticks, ↗/↘ counts, ◆, TURN / ACT OUT tags, ⚑n or import chip, lock, unsaved dot, at most one tape); act headers (scene count, ≈ share bar with an even-share tick, set-up/paid-off counts, marked landmark chips only, act-split note with Open scene n, persisted collapse chevron); an empty act as a drop target (an act change); roving tabindex, focus ring and a live region.
_Accept:_ Vitest — roving tabindex (← → ↑ ↓ Home End, Enter to the panel heading, Esc back to the card), share and count derivations in `story.ts`, an empty-act drop sends the act PATCH, the live region announces the selection; e2e keeps `act-frame-{n}`, `scene-card-{id}` (+ `data-locked`), `consistency-flag-badge` and the lock-and-regenerate recipe target.

**T3.6 Highlights, Episode view and Story Layers retirement (Plan redesign Phase 2; spec §4.5, §4.7).** The highlight bar (None, Setups & payoffs, The secret, Continuity, Act shape, Who's in it) with rings and tapes at full contrast, Fold the rest, N / Shift+N, J/K, Esc and ⌘↵; the Episode view replaces the nothing-selected panel; Story Layers, `--tr-panel-story-layers` and `--tr-card-scene` are removed.
_Accept:_ Vitest — highlight matchers and counts, highlight announcements, the Episode view sections; e2e — a highlight plus N reaches the next match; `plan.spec.ts` and the recipes pass without `story-layers-panel`.

**T3.7 Episode chart and live order check (Plan redesign Phase 3; spec §4.4, §4.8).** The sticky SVG chart (blocks by script share, thread arcs, secret lane, note rule, unsaved dot, `aria-hidden` with a one-sentence summary), the client-side order check after a reorder or act change and as a drag prediction, Order notes with Undo the move, visible drop targets and "Locked — can't swap". No AI.
_Accept:_ Vitest — order issues for all three cases, including the drag prediction, and script share; e2e — an act change that breaks an order shows the Order note, and Undo the move clears it.

**T3.8 Insert reorder (Plan redesign Phase 4; owner decision 2).** A drop inserts where dropped, ⌥←/⌥→ move a scene; the client refuses any move that would shift a locked scene, and the server's 409 `LOCKED_OBJECT` stays the backstop; confirm the patch applier accepts multiple `/index` replaces in one PATCH.
_Accept:_ the lock-violation test lands first and passes (a move that would shift a locked scene sends nothing; a forged PATCH gets 409); then the insert e2e.

**T3.9 Draft a fix in Review (Plan redesign Phase 4; owner decision 3).** "Draft a fix in Review…" on story notes goes through the existing Change Set path (and so the lock filter), hidden on locked scenes.
_Accept:_ the lock-violation test lands first (a Change Set drafted from a note never regenerates a locked object); the verb is hidden on locked scenes; e2e opens Review with the note as the instruction.
```

(d) `docs/tableread-test-plan.md`:

- In the **Frontend unit (Vitest)** paragraph, replace this exact text (it occurs once in the file):

```markdown
`navigateToWriteBeat` keeps `highlightBeat`.
```

  with:

```markdown
`navigateToWriteBeat` keeps `highlightBeat`. Plan panel (T3.3): `story.ts` covers flag kind for every `[snake_case]` import code, the act-split and continuity samples, linkify by id (a missing scene or fact is plain text, never a raw id), import note text, place title, board order, landmarks, cast from dialogue cues (sluglines, transitions, `(CONT'D)` and unmatched cues dropped; aliases and first names matched), threads, secrets and the facts split, plus an episode missing its defaulted keys; the draft store keeps a draft across a scene switch and a failed save and treats typing back to the saved value as clean; `PlanField` shows the structural footer with Discard, plain Save/Discard and read-only when locked, and Suggest… makes zero `suggest` requests on mount, select, focus or typing and ignores a reply for another scene; section open state persists per viewer and still toggles when storage throws; the panel keeps section order, jump counts, the locked banner and read-only fields with working Scene/Beat/Script locks and exactly one `lock-toggle`; the beat ladder rows show `whatHappens`, cascaded Locked, story vs import markers, the landmark tag, lands and the time jump; What it touches hides retired facts behind Show n retired and marks pending facts Unconfirmed; a beat selection marks its scene card; a failed save in Plan keeps the typed text. Notes and drafts (T3.4): the notes strip collapsed and expanded, verbs per kind, Dismiss disabled while busy; a dismiss refetches the project and flags (so the next save doesn't 409), Undo restores the note with If-Match = the head after the dismiss and fails safely after another edit; the leave guard prompts on every way out of Plan only when drafts exist, Stay keeps them and Discard leaves with no `beforeunload` prompt.
```

- In the **E2E (Playwright, mock API, fixture-seeded)** paragraph, replace this exact text (it occurs once in the file):

```markdown
its Hit row opens Write at `highlightBeat`.
```

  with:

```markdown
its Hit row opens Write at `highlightBeat`. Plan panel (T3.3, `plan.spec.ts`): beat rows live in the panel (beat-1-2 reads Locked, beat-1-1 doesn't), motivations and facts, the Act combobox, `lock-toggle` and its banner, Location edited through the Details section, and a Beat lock that persists after reload and is switched back off (shared DB). Notes and drafts (T3.4, `plan-notes.spec.ts`): Save field only creates the scene-5 note → Show → Dismiss → Undo brings it back → a field save succeeds; a draft in scene-2 survives selecting scene-3 (card dot), Stay in Plan keeps it, Discard and leave reaches Write with no prompt.
```

(e) `docs/tableread-handoff.md` §4: insert a new line directly after the row that ends `imports that cost ~$2.64 |` (the last decision-log row, before the blank line and `## 5. Environment bootstrap`):

```markdown
| 2026-10-13: Plan redesign (Story Health) owner-approved: 400px panel token (`--tr-panel-plan`, the only new token), Suggest… button (A4 chips no longer load on focus), Story Layers retired in Phase 2, insert drag and Draft a fix in Phase 4. Phase 1 = T3.3 panel restructure + T3.4 notes and drafts; all derivations are pure client functions in `apps/web/src/plan/story.ts`; no contract, endpoint, LLM or PROMPT_VERSION change. Spec: `docs/superpowers/specs/2026-10-13-plan-redesign-design.md` | With a scene selected the inspector ran ~5,000px tall, so who wants what and the facts sat far below the fold, while Plan already held threads, the secret, flag text and beat plans it never showed |
```

- [ ] **Step 4: Run the check to verify it passes**

```bash
grep -c "tr-panel-plan" docs/tableread-ui-spec.md            # ≥ 2
grep -c "import board's reading view" docs/tableread-ui-spec.md   # 1
grep -c "^\*\*T3.[3-9] " docs/tableread-build-plan.md        # 7
grep -c "Plan panel (T3.3" docs/tableread-test-plan.md       # 2
grep -c "Plan redesign (Story Health)" docs/tableread-handoff.md   # 1
grep -n "Expand (⌥click or chevron)\|Locked — unlock to edit\"" docs/tableread-ui-spec.md   # no output
git diff --stat docs/
```

Expected: the counts shown, and no stale chevron or old-banner text in UI spec §5. Only the four docs change.

- [ ] **Step 5: Commit**

```bash
git add docs/tableread-ui-spec.md docs/tableread-build-plan.md docs/tableread-test-plan.md docs/tableread-handoff.md
git commit -F - <<'EOF'
docs: describe the Plan scene panel and add T3.3–T3.9

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## T3.4 PR: Notes and drafts (Tasks 12–14)

### Task 12: Ask before leaving Plan with drafts

**PR:** T3.4 · **Depends on:** Task 2 (can run in parallel with Tasks 3–11)

**Files:**
- Modify `apps/web/src/shell/modeNavigation.ts` (whole file below; adds `leaveGuard`, `setLeaveGuard`, `leave()`, `navigateToLedgerFact`, and guards `navigateToMode`, `navigateToWriteScene`, `navigateToWriteBeat`)
- Modify `apps/web/src/shell/modeNavigation.test.ts` (lines 3–9 import block; new tests appended at the end)
- Create `apps/web/src/plan/panel/useLeaveGuard.ts`
- Create `apps/web/src/plan/panel/LeavePlanDialog.tsx`
- Test `apps/web/src/plan/panel/useLeaveGuard.test.tsx` (new)
- Test `apps/web/src/plan/panel/LeavePlanDialog.test.tsx` (new)

**Interfaces:**
- Consumes: `PlanDrafts` (Task 2), `WithDrafts` (Task 2, tests).
- Produces:
  - `setLeaveGuard(fn: (() => Promise<boolean>) | null): void`
  - `navigateToLedgerFact(factId: string): void`
  - `navigateToMode`, `navigateToWriteScene` and `navigateToWriteBeat`: unchanged signatures. With a guard set they navigate only after it resolves `true`; with none they navigate synchronously, as today.
  - `useLeaveGuard(drafts: PlanDrafts): { confirmLeave: () => Promise<boolean>; dialog: LeavePlanDialogProps }`
  - `interface LeavePlanDialogProps { open: boolean; draftCount: number; onStay: () => void; onDiscard: () => void }`
  - `LeavePlanDialog(props: LeavePlanDialogProps): JSX.Element` (`data-testid="leave-plan-dialog"`)

- [ ] **Step 1: Write the failing tests.**

In `apps/web/src/shell/modeNavigation.test.ts`, replace the import block (lines 3–9) with:

```ts
import {
  navigateToLedgerFact,
  navigateToMode,
  navigateToWriteBeat,
  navigateToWriteScene,
  MODE_SWITCH_SAVE_WAIT_MS,
  setBeforeModeSwitch,
  setLeaveGuard,
} from './modeNavigation'
```

and append at the end of the file:

```ts
function stubLocation(href: string) {
  const assignSpy = vi.fn()
  const original = window.location
  Object.defineProperty(window, 'location', {
    value: { ...original, href, assign: assignSpy },
    writable: true,
  })
  return {
    assignSpy,
    restore: () =>
      Object.defineProperty(window, 'location', {
        value: original,
        writable: true,
      }),
  }
}

describe('navigateToLedgerFact', () => {
  it('opens the fact in Ledger, keeping the project', () => {
    const { assignSpy, restore } = stubLocation(
      'http://localhost/plan?project=proj-1&scene=scene-2',
    )
    try {
      navigateToLedgerFact('fact-02')
      expect(assignSpy).toHaveBeenCalledOnce()
      const url = new URL(String(assignSpy.mock.calls[0][0]))
      expect(url.pathname).toBe('/ledger')
      expect(url.searchParams.get('fact')).toBe('fact-02')
      expect(url.searchParams.get('project')).toBe('proj-1')
    } finally {
      restore()
    }
  })
})

describe('leave guard (Plan drafts)', () => {
  afterEach(() => setLeaveGuard(null))

  it('a guard that answers no stops every way out', async () => {
    const { assignSpy, restore } = stubLocation(
      'http://localhost/plan?project=proj-1',
    )
    const guard = vi.fn(() => Promise.resolve(false))
    setLeaveGuard(guard)
    try {
      navigateToMode('Write')
      navigateToWriteScene('scene-3')
      navigateToWriteBeat('scene-2', 'beat-2-1')
      navigateToLedgerFact('fact-02')
      expect(guard).toHaveBeenCalledTimes(4)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(assignSpy).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('a guard that answers yes navigates once it resolves', async () => {
    const { assignSpy, restore } = stubLocation(
      'http://localhost/plan?project=proj-1',
    )
    let answer!: (ok: boolean) => void
    setLeaveGuard(() => new Promise<boolean>((resolve) => (answer = resolve)))
    try {
      navigateToWriteScene('scene-3')
      expect(assignSpy).not.toHaveBeenCalled()
      answer(true)
      await vi.waitFor(() => expect(assignSpy).toHaveBeenCalledOnce())
      const url = new URL(String(assignSpy.mock.calls[0][0]))
      expect(url.pathname).toBe('/')
      expect(url.searchParams.get('scene')).toBe('scene-3')
    } finally {
      restore()
    }
  })
})
```

Create `apps/web/src/plan/panel/useLeaveGuard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WithDrafts } from './testDrafts'
import { useLeaveGuard } from './useLeaveGuard'
import { usePlanDrafts } from './usePlanDrafts'

const { setLeaveGuardMock } = vi.hoisted(() => ({
  setLeaveGuardMock: vi.fn(),
}))
vi.mock('../../shell/modeNavigation', () => ({
  setLeaveGuard: setLeaveGuardMock,
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const KEY = 'scene-2:audienceLearns'

function setup() {
  return renderHook(
    () => {
      const drafts = usePlanDrafts()
      return { drafts, ...useLeaveGuard(drafts) }
    },
    { wrapper: WithDrafts },
  )
}

function unloadPrevented(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useLeaveGuard', () => {
  it('with no drafts, leaving is allowed at once and nothing is armed', async () => {
    const { result } = setup()
    await expect(result.current.confirmLeave()).resolves.toBe(true)
    expect(result.current.dialog.open).toBe(false)
    expect(unloadPrevented()).toBe(false)
  })

  it('with a draft, the dialog opens; Stay answers no and keeps the draft', async () => {
    const { result } = setup()
    act(() => result.current.drafts.set(KEY, 'scene-2', 'Dan has a key.'))
    expect(unloadPrevented()).toBe(true)

    let leaving!: Promise<boolean>
    act(() => {
      leaving = result.current.confirmLeave()
    })
    expect(result.current.dialog).toMatchObject({ open: true, draftCount: 1 })

    act(() => result.current.dialog.onStay())
    await expect(leaving).resolves.toBe(false)
    expect(result.current.dialog.open).toBe(false)
    expect(result.current.drafts.get(KEY)).toBe('Dan has a key.')
  })

  it('Discard and leave clears every draft before answering yes, so beforeunload stays quiet', async () => {
    const { result } = setup()
    act(() => {
      result.current.drafts.set(KEY, 'scene-2', 'Dan has a key.')
      result.current.drafts.set('ep-1:premise', null, 'A bar on the edge.')
    })

    let leaving!: Promise<{ ok: boolean; size: number; prevented: boolean }>
    act(() => {
      leaving = result.current.confirmLeave().then((ok) => ({
        ok,
        size: result.current.drafts.size,
        prevented: unloadPrevented(),
      }))
    })
    act(() => result.current.dialog.onDiscard())
    await expect(leaving).resolves.toEqual({
      ok: true,
      size: 0,
      prevented: false,
    })
  })

  it('is the navigation guard while mounted, and stops being one on unmount', async () => {
    const { result, unmount } = setup()
    const guard = setLeaveGuardMock.mock.lastCall?.[0] as () => Promise<boolean>
    await expect(guard()).resolves.toBe(true)

    act(() => result.current.drafts.set(KEY, 'scene-2', 'Dan has a key.'))
    const latest = setLeaveGuardMock.mock
      .lastCall?.[0] as () => Promise<boolean>
    act(() => {
      void latest()
    })
    expect(result.current.dialog.open).toBe(true)

    unmount()
    expect(setLeaveGuardMock).toHaveBeenLastCalledWith(null)
  })
})
```

Create `apps/web/src/plan/panel/LeavePlanDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeavePlanDialog } from './LeavePlanDialog'

// jsdom 29 has no showModal/close.
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.open = true
})
const close = vi.fn(function (this: HTMLDialogElement) {
  this.open = false
})

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = showModal
  HTMLDialogElement.prototype.close = close
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const noop = () => {}

describe('LeavePlanDialog', () => {
  it('opens as a modal when open and closes when not', () => {
    const { rerender } = render(
      <LeavePlanDialog
        open={false}
        draftCount={2}
        onStay={noop}
        onDiscard={noop}
      />,
    )
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    expect(showModal).not.toHaveBeenCalled()
    expect(dialog.open).toBe(false)

    rerender(
      <LeavePlanDialog open draftCount={2} onStay={noop} onDiscard={noop} />,
    )
    expect(showModal).toHaveBeenCalledOnce()
    expect(dialog.open).toBe(true)
    expect(screen.getByText('You have unsaved edits in Plan.')).not.toBeNull()
    expect(dialog.textContent).toContain('2 fields have changes')

    rerender(
      <LeavePlanDialog
        open={false}
        draftCount={2}
        onStay={noop}
        onDiscard={noop}
      />,
    )
    expect(close).toHaveBeenCalledOnce()
    expect(dialog.open).toBe(false)
  })

  it('Stay, Discard and Esc answer through the callbacks', async () => {
    const user = userEvent.setup()
    const onStay = vi.fn()
    const onDiscard = vi.fn()
    render(
      <LeavePlanDialog
        open
        draftCount={1}
        onStay={onStay}
        onDiscard={onDiscard}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Stay in Plan' }))
    expect(onStay).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Discard and leave' }))
    expect(onDiscard).toHaveBeenCalledOnce()

    fireEvent(
      screen.getByTestId('leave-plan-dialog'),
      new Event('cancel', { cancelable: true }),
    )
    expect(onStay).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run them to verify they fail.**
  `cd apps/web && npx vitest run src/shell/modeNavigation.test.ts src/plan/panel/useLeaveGuard.test.tsx src/plan/panel/LeavePlanDialog.test.tsx`
  Expected:
  - The two new panel files fail with `Cannot find module './useLeaveGuard'` and `'./LeavePlanDialog'`.
  - In `modeNavigation.test.ts`, the five existing tests still pass and the three new ones fail with `TypeError: navigateToLedgerFact is not a function` / `setLeaveGuard is not a function`.

- [ ] **Step 3: Minimal implementation.**

Replace `apps/web/src/shell/modeNavigation.ts` with:

```ts
import type { Mode } from './ModeSwitcher'

// Path each mode navigates to; `null` means "not built yet". No router in
// this app (T0.1 scaffold, same "a single dev route doesn't justify one"
// call as main.tsx's /tokens switch) — mode switching is a full navigation,
// preserving the query string (`?project=`, etc.) so switching modes
// mid-session keeps context.
//
// Kept in its own module (not ModeSwitcher.tsx) so that file stays a
// component-only export — the repo's `react-refresh/only-export-components`
// lint rule warns on mixing a component export with a plain function/const.
const MODE_PATHS: Record<Mode, string | null> = {
  Write: '/',
  Plan: '/plan',
  Review: '/review',
  Ledger: '/ledger',
}

export function isModeBuilt(mode: Mode): boolean {
  return MODE_PATHS[mode] !== null
}

let beforeModeSwitch: (() => Promise<unknown> | null) | null = null
let leaveGuard: (() => Promise<boolean>) | null = null

/** How long a mode switch waits for Write's save before leaving anyway (the
 * beforeunload prompt then covers whatever is still unsaved). */
export const MODE_SWITCH_SAVE_WAIT_MS = 1500

/** Write registers its autosave flush here (write/useWriteQueue.ts): a mode
 * switch is a full navigation, so it waits briefly for the save instead of
 * leaving mid-flight and tripping the beforeunload prompt. The flush returns
 * `null` when nothing is pending, and the switch is then immediate. */
export function setBeforeModeSwitch(
  fn: (() => Promise<unknown> | null) | null,
) {
  beforeModeSwitch = fn
}

/** Plan registers its unsaved-edits confirmation here
 * (plan/panel/useLeaveGuard.ts). Every navigation below asks it first and
 * goes only on `true`; with no guard set they navigate synchronously, exactly
 * as before. */
export function setLeaveGuard(fn: (() => Promise<boolean>) | null) {
  leaveGuard = fn
}

function leave(go: () => void) {
  if (!leaveGuard) return go()
  void leaveGuard().then((ok) => {
    if (ok) go()
  })
}

/** Navigates to `mode` if it's built; a no-op for unbuilt modes. Shared by
 * ModeSwitcher's tab buttons and AppShell's ⌘1-4 shortcut (UI spec §2). */
export function navigateToMode(mode: Mode) {
  const path = MODE_PATHS[mode]
  if (path === null) return
  const url = new URL(window.location.href)
  url.pathname = path
  // Mode-switcher entry to Review lists drafts (UI spec §5). Drop a leftover
  // `changeSet` from a prior Review visit so we don't skip the picker.
  if (mode === 'Review') {
    url.searchParams.delete('changeSet')
  }
  const go = () => window.location.assign(url.toString())
  leave(() => {
    const saving = beforeModeSwitch?.()
    if (!saving) return go()
    void Promise.race([
      saving,
      new Promise((resolve) => setTimeout(resolve, MODE_SWITCH_SAVE_WAIT_MS)),
    ]).then(go)
  })
}

/** Open Write on a specific scene (Plan scene-card double-click / deep link).
 * Preserves `?project=` and sets `?scene=`; drops Review-only `changeSet`. */
export function navigateToWriteScene(sceneId: string) {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.searchParams.set('scene', sceneId)
  url.searchParams.delete('changeSet')
  url.searchParams.delete('highlightBeat')
  leave(() => window.location.assign(url.toString()))
}

/** Open Write at a specific beat (Ledger Structure row). Same as
 * `navigateToWriteScene`, but keeps the beat as `?highlightBeat=`. */
export function navigateToWriteBeat(sceneId: string, beatId: string) {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.searchParams.set('scene', sceneId)
  url.searchParams.set('highlightBeat', beatId)
  url.searchParams.delete('changeSet')
  leave(() => window.location.assign(url.toString()))
}

/** Open one fact in Ledger (Plan's fact links). Keeps `?project=`. */
export function navigateToLedgerFact(factId: string) {
  const url = new URL(window.location.href)
  url.pathname = '/ledger'
  url.searchParams.set('fact', factId)
  leave(() => window.location.assign(url.toString()))
}
```

Create `apps/web/src/plan/panel/LeavePlanDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react'

export interface LeavePlanDialogProps {
  open: boolean
  draftCount: number
  onStay: () => void
  onDiscard: () => void
}

const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'

/** Leaving Plan with unsaved edits (redesign spec §4.9): a native modal
 * dialog. Esc means Stay. "Stay in Plan" is the first control, so
 * showModal() focuses it. */
export function LeavePlanDialog({
  open,
  draftCount,
  onStay,
  onDiscard,
}: LeavePlanDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      data-testid="leave-plan-dialog"
      aria-labelledby="leave-plan-title"
      onCancel={(event) => {
        event.preventDefault()
        onStay()
      }}
      className="w-96 max-w-full rounded-card border border-tr-border bg-tr-surface-raised p-6 text-tr-text-primary shadow-lift"
    >
      <h2 id="leave-plan-title" className="font-display text-17">
        You have unsaved edits in Plan.
      </h2>
      <p className="mt-2 text-13">
        {draftCount === 1 ? 'One field has' : `${draftCount} fields have`}{' '}
        changes that aren&apos;t saved. Leaving discards them.
      </p>
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onStay}
          className={`rounded-card bg-tr-coral px-3 py-1.5 text-13 text-tr-surface-raised hover:bg-tr-coral-hover ${FOCUS}`}
        >
          Stay in Plan
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className={`rounded-card px-3 py-1.5 text-13 text-tr-danger hover:bg-tr-surface-clay ${FOCUS}`}
        >
          Discard and leave
        </button>
      </div>
    </dialog>
  )
}
```

Create `apps/web/src/plan/panel/useLeaveGuard.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { setLeaveGuard } from '../../shell/modeNavigation'
import type { LeavePlanDialogProps } from './LeavePlanDialog'
import type { PlanDrafts } from './usePlanDrafts'

/** Asks before Plan is left with drafts (redesign spec §4.9). Registers
 * `confirmLeave` as the navigation guard for mode tabs, ⌘1–4, Open in Write
 * and Ledger links, and arms `beforeunload` (tab close, the project-title
 * link, browser back) only while a draft exists. Nothing inside Plan is
 * blocked. */
export function useLeaveGuard(drafts: PlanDrafts): {
  confirmLeave: () => Promise<boolean>
  dialog: LeavePlanDialogProps
} {
  const [answer, setAnswer] = useState<((ok: boolean) => void) | null>(null)

  const confirmLeave = useCallback((): Promise<boolean> => {
    if (drafts.size === 0) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => setAnswer(() => resolve))
  }, [drafts])

  useEffect(() => {
    setLeaveGuard(confirmLeave)
    return () => setLeaveGuard(null)
  }, [confirmLeave])

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (drafts.size === 0) return
      event.preventDefault()
      event.returnValue = '' // legacy Chrome needs it set
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [drafts])

  function finish(ok: boolean) {
    // Clear before resolving: the navigation that follows must not trip
    // beforeunload as well.
    if (ok) drafts.clearAll()
    answer?.(ok)
    setAnswer(null)
  }

  return {
    confirmLeave,
    dialog: {
      open: answer !== null,
      draftCount: drafts.size,
      onStay: () => finish(false),
      onDiscard: () => finish(true),
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass.**
  `cd apps/web && npx vitest run src/shell/modeNavigation.test.ts src/plan/panel/useLeaveGuard.test.tsx src/plan/panel/LeavePlanDialog.test.tsx` → `14 passed`.
  Write and Ledger still pass unchanged (no guard set means navigation stays synchronous): `cd apps/web && npx vitest run src/write src/ledger src/shell`.
  Then: `cd apps/web && npx prettier --write src/shell/modeNavigation.ts src/shell/modeNavigation.test.ts src/plan/panel && npx prettier --check . && npx eslint . && npx tsc -b` → clean.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/shell/modeNavigation.ts apps/web/src/shell/modeNavigation.test.ts apps/web/src/plan/panel/useLeaveGuard.ts apps/web/src/plan/panel/useLeaveGuard.test.tsx apps/web/src/plan/panel/LeavePlanDialog.tsx apps/web/src/plan/panel/LeavePlanDialog.test.tsx
git commit -m "plan: ask before leaving Plan with unsaved edits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Notes strip and dismiss-with-undo hook

**PR:** T3.4 · **Depends on:** Task 1 (can run in parallel with Tasks 3–11)

**Files:**
- Create `apps/web/src/plan/panel/NotesStrip.tsx`
- Create `apps/web/src/plan/panel/useDismissNote.ts`
- Test `apps/web/src/plan/panel/NotesStrip.test.tsx` (new)
- Test `apps/web/src/plan/panel/useDismissNote.test.ts` (new)

**Interfaces:**
- Consumes:
  - From Task 1: `PlanNote`, `notesForScene`, `importNoteText`, `linkifyNote`.
  - `plural(count, noun)` from `projects/wizard/board/boardText.ts`.
  - From `api/client`: `dismissConsistencyFlag(flagId, { expectedHeadSnapshotId })`, `getProject(pid)`, `getConsistencyFlags(pid, 'open')`, `undoProject(pid, { expectedHeadSnapshotId })`.
  - `ApiError` and `staleHeadMessage`.
- Produces:
  - `interface NotesStripProps { scene; notes: PlanNote[]; scenes: Scene[]; ledger: LedgerFact[]; busy; actLocked; onSelectScene(sceneId); onShowBeat(beatId); onOpenInWrite(beatId | null); onOpenFact(factId); onDismiss(flagId); onChangeAct() }`
  - `NotesStrip(props): JSX.Element | null`. Its DOM contract: `<section id="plan-section-notes" data-plan-section="notes" data-testid="notes-strip">`, with testids `notes-peek`, `note-{flag.id}` and `notes-import-group`.
  - `useDismissNote({ projectId, headSnapshotId: string | null, onProject(project), onFlags(flags) }): { busy; undoable; error: string | null; dismiss(flagId): Promise<void>; undo(): Promise<void>; clearUndo(); clearError() }`

- [ ] **Step 1: Write the failing tests.** Create `apps/web/src/plan/panel/NotesStrip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Beat, ConsistencyFlag, LedgerFact, Scene } from 'contract'
import { notesForScene } from '../story'
import { NotesStrip } from './NotesStrip'

afterEach(cleanup)

function beat(id: string, index: number): Beat {
  return {
    id,
    index,
    locked: false,
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    scriptText: '',
    scriptLocked: false,
  }
}

function scene(id: string, index: number, beats: Beat[] = []): Scene {
  return {
    id,
    index,
    act: 3,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - KITCHEN - NIGHT',
    time: 'Minutes later',
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats,
  }
}

const SCENE_5 = scene('scene-5', 4, [beat('beat-5-1', 0)])
const SCENES = [scene('scene-2', 1), SCENE_5]

const FACT_02: LedgerFact = {
  id: 'fact-02',
  fact: "The stolen $40,000 is hidden inside the bar's basement ice machine",
  factType: 'state',
  sourceSpan: {
    episodeId: 'ep-1',
    sceneId: 'scene-2',
    beatId: 'beat-2-1',
    startLine: null,
    endLine: null,
    charStart: null,
    charEnd: null,
  },
  sourceText: '',
  knownBy: ['char-dan'],
  knowledgeEvents: [],
  audienceKnows: true,
  provenance: 'writer_confirmed',
  confidence: 0.94,
  status: 'active',
  supersedes: null,
  supersededBy: null,
  knownByAsOf: null,
}

function flag(
  id: string,
  overrides: Partial<ConsistencyFlag> = {},
): ConsistencyFlag {
  return {
    id,
    objectType: 'scene',
    objectId: 'scene-5',
    factId: null,
    explanation: '',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-1',
    ...overrides,
  }
}

const FLAGS = [
  flag('flag-scene', {
    explanation:
      'Scene 2 moved the money, so the stakes here rest on fact-02, which is no longer true.',
    factId: 'fact-02',
  }),
  flag('flag-beat', {
    objectType: 'beat',
    objectId: 'beat-5-1',
    explanation: 'The cover story in this beat contradicts fact-zz9.',
  }),
  flag('flag-act', {
    explanation:
      'This scene plays like an act out, but the episode has no ACT THREE break before it.',
  }),
  flag('flag-import-beat', {
    objectType: 'beat',
    objectId: 'beat-5-1',
    explanation:
      '[model_unassigned] The model marked source lines 680-688 as unassigned; the server preserved them in this beat. Review the boundary.',
  }),
  flag('flag-import-scene', {
    explanation:
      '[extraction_failed] Fact extraction for this scene failed validation twice, so no continuity facts were recorded from it.',
  }),
]

function renderStrip(
  overrides: Partial<ComponentProps<typeof NotesStrip>> = {},
) {
  const props = {
    scene: SCENE_5,
    notes: notesForScene(FLAGS, SCENE_5),
    scenes: SCENES,
    ledger: [FACT_02],
    busy: false,
    actLocked: false,
    onSelectScene: vi.fn(),
    onShowBeat: vi.fn(),
    onOpenInWrite: vi.fn(),
    onOpenFact: vi.fn(),
    onDismiss: vi.fn(),
    onChangeAct: vi.fn(),
    ...overrides,
  }
  return { ...props, ...render(<NotesStrip {...props} />) }
}

describe('NotesStrip', () => {
  it('renders nothing when the scene has no notes', () => {
    const { container } = renderStrip({ notes: [] })
    expect(container.innerHTML).toBe('')
  })

  it('collapsed: counts story and import notes and peeks at the first story note, with no raw ids', () => {
    renderStrip()
    const strip = screen.getByTestId('notes-strip')
    expect(strip.id).toBe('plan-section-notes')
    expect(strip.getAttribute('data-plan-section')).toBe('notes')
    expect(
      within(strip).getByText('⚑ 3 notes · 2 from the import'),
    ).not.toBeNull()
    expect(screen.getByTestId('notes-peek').textContent).toBe(
      'Scene 2 moved the money, so the stakes here rest on a Ledger fact, which is no longer true.',
    )
    expect(strip.textContent).not.toContain('fact-02')
    expect(screen.queryByTestId('note-flag-scene')).toBeNull()
  })

  it('Show expands into note cards with linked scenes and facts and the quoted fact; Hide collapses', async () => {
    const user = userEvent.setup()
    const props = renderStrip()
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const card = screen.getByTestId('note-flag-scene')
    await user.click(within(card).getByRole('button', { name: 'Scene 2' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-2')
    await user.click(
      within(card).getByRole('button', { name: 'a Ledger fact' }),
    )
    expect(props.onOpenFact).toHaveBeenCalledWith('fact-02')
    expect(within(card).getByText(FACT_02.fact)).not.toBeNull()
    await user.click(
      within(card).getByRole('button', { name: 'Open in Ledger →' }),
    )
    expect(props.onOpenFact).toHaveBeenCalledTimes(2)
    expect(card.textContent).not.toContain('fact-02')

    // A fact id the ledger doesn't have: plain words, no link, no raw id.
    const beatCard = screen.getByTestId('note-flag-beat')
    expect(beatCard.textContent).toContain('contradicts a Ledger fact.')
    expect(
      within(beatCard).queryByRole('button', { name: 'a Ledger fact' }),
    ).toBeNull()
    expect(beatCard.textContent).not.toContain('fact-zz9')

    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByTestId('note-flag-scene')).toBeNull()
  })

  it('continuity notes: Show beat only on beat notes, Open in Write, Dismiss', async () => {
    const user = userEvent.setup()
    const props = renderStrip()
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const sceneCard = screen.getByTestId('note-flag-scene')
    expect(
      within(sceneCard).queryByRole('button', { name: 'Show beat' }),
    ).toBeNull()
    await user.click(
      within(sceneCard).getByRole('button', { name: 'Open in Write' }),
    )
    expect(props.onOpenInWrite).toHaveBeenCalledWith(null)
    await user.click(within(sceneCard).getByRole('button', { name: 'Dismiss' }))
    expect(props.onDismiss).toHaveBeenCalledWith('flag-scene')

    const beatCard = screen.getByTestId('note-flag-beat')
    expect(within(beatCard).getByText('Beat 5.1')).not.toBeNull()
    await user.click(
      within(beatCard).getByRole('button', { name: 'Show beat' }),
    )
    expect(props.onShowBeat).toHaveBeenCalledWith('beat-5-1')
    await user.click(
      within(beatCard).getByRole('button', { name: 'Open in Write' }),
    )
    expect(props.onOpenInWrite).toHaveBeenLastCalledWith('beat-5-1')
  })

  it('act-split notes: Change the act and Looks right — dismiss', async () => {
    const user = userEvent.setup()
    const props = renderStrip()
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const actCard = screen.getByTestId('note-flag-act')
    expect(
      within(actCard).queryByRole('button', { name: 'Dismiss' }),
    ).toBeNull()
    await user.click(
      within(actCard).getByRole('button', { name: 'Change the act' }),
    )
    expect(props.onChangeAct).toHaveBeenCalledOnce()
    await user.click(
      within(actCard).getByRole('button', { name: 'Looks right — dismiss' }),
    )
    expect(props.onDismiss).toHaveBeenCalledWith('flag-act')
  })

  it('import notes sit in a closed "From the import" group, in plain language', async () => {
    const user = userEvent.setup()
    const props = renderStrip()
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const group = screen.getByTestId('notes-import-group') as HTMLDetailsElement
    expect(group.open).toBe(false)
    expect(screen.getByTestId('notes-strip').textContent).not.toMatch(
      /\[[a-z_]+\]/,
    )
    await user.click(within(group).getByText('From the import · 2'))
    expect(group.open).toBe(true)

    const beatNote = within(group).getByTestId('note-flag-import-beat')
    expect(beatNote.textContent).toContain(
      "The import couldn't place script lines 680–688 and kept them in beat 5.1.",
    )
    await user.click(
      within(beatNote).getByRole('button', { name: 'Open beat in Write' }),
    )
    expect(props.onOpenInWrite).toHaveBeenCalledWith('beat-5-1')

    const sceneNote = within(group).getByTestId('note-flag-import-scene')
    expect(sceneNote.textContent).toContain(
      'Fact extraction for this scene failed validation twice',
    )
    await user.click(
      within(sceneNote).getByRole('button', { name: 'Open in Write' }),
    )
    expect(props.onOpenInWrite).toHaveBeenLastCalledWith(null)
    await user.click(
      within(sceneNote).getByRole('button', { name: 'Looks right — dismiss' }),
    )
    expect(props.onDismiss).toHaveBeenCalledWith('flag-import-scene')
  })

  it('reads "n notes from the import" when there are only import notes', () => {
    renderStrip({
      notes: notesForScene(
        FLAGS.filter((f) => f.explanation.startsWith('[')),
        SCENE_5,
      ),
    })
    expect(screen.getByText('2 notes from the import')).not.toBeNull()
    expect(screen.queryByTestId('notes-peek')).toBeNull()
  })

  it('Dismiss is disabled while a write is in flight; Change the act while the act is locked', async () => {
    const user = userEvent.setup()
    renderStrip({ busy: true, actLocked: true })
    await user.click(screen.getByRole('button', { name: 'Show' }))
    for (const name of ['Dismiss', 'Looks right — dismiss']) {
      for (const button of screen.getAllByRole('button', { name })) {
        expect((button as HTMLButtonElement).disabled).toBe(true)
      }
    }
    expect(
      (
        screen.getByRole('button', {
          name: 'Change the act',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})
```

Create `apps/web/src/plan/panel/useDismissNote.test.ts`:

```ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsistencyFlag, Project } from 'contract'
import { ApiError } from '../../api/errors'
import { staleHeadMessage } from '../../shell/toastCopy'
import { useDismissNote } from './useDismissNote'

const { dismissMock, getFlagsMock, getProjectMock, undoMock } = vi.hoisted(
  () => ({
    dismissMock: vi.fn(),
    getFlagsMock: vi.fn(),
    getProjectMock: vi.fn(),
    undoMock: vi.fn(),
  }),
)
vi.mock('../../api/client', () => ({
  dismissConsistencyFlag: dismissMock,
  getConsistencyFlags: getFlagsMock,
  getProject: getProjectMock,
  undoProject: undoMock,
}))

function project(headSnapshotId: string): Project {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: false,
      serialization: 0.8,
    },
    enabledComponents: [],
    premise: '',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters: [],
      relationships: [],
      audienceGoals: [],
      narratorGoals: [],
      worldQA: [],
    },
    seasons: [],
    headSnapshotId,
    defaultCraftLevel: 'standard',
  }
}

const FLAG: ConsistencyFlag = {
  id: 'flag-1',
  objectType: 'scene',
  objectId: 'scene-5',
  factId: null,
  explanation:
    "The argument's stakes reference the bar as the money's hiding place, which is no longer true.",
  severity: 'tension',
  status: 'open',
  sourceChange: 'snap-0',
}

const STALE = () =>
  new ApiError(409, { code: 'CONFLICT_STALE_HEAD', message: 'head moved' })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function setup() {
  const onProject = vi.fn()
  const onFlags = vi.fn()
  const hook = renderHook(() =>
    useDismissNote({
      projectId: 'proj-longpour',
      headSnapshotId: 'snap-1',
      onProject,
      onFlags,
    }),
  )
  return { ...hook, onProject, onFlags }
}

function dismissSucceeds() {
  dismissMock.mockResolvedValue({ ...FLAG, status: 'dismissed' })
  getProjectMock.mockResolvedValue(project('snap-2'))
  getFlagsMock.mockResolvedValue([])
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useDismissNote', () => {
  it('dismisses with If-Match, then refetches the project (new head) and the open flags', async () => {
    dismissSucceeds()
    const { result, onProject, onFlags } = setup()

    await act(() => result.current.dismiss('flag-1'))

    expect(dismissMock).toHaveBeenCalledWith('flag-1', {
      expectedHeadSnapshotId: 'snap-1',
    })
    expect(getProjectMock).toHaveBeenCalledWith('proj-longpour')
    expect(getFlagsMock).toHaveBeenCalledWith('proj-longpour', 'open')
    expect(onProject).toHaveBeenCalledWith(project('snap-2'))
    expect(onFlags).toHaveBeenCalledWith([])
    expect(result.current).toMatchObject({
      undoable: true,
      busy: false,
      error: null,
    })
  })

  it('is busy while the dismiss is in flight', async () => {
    const request = deferred<ConsistencyFlag>()
    dismissMock.mockReturnValue(request.promise)
    getProjectMock.mockResolvedValue(project('snap-2'))
    getFlagsMock.mockResolvedValue([])
    const { result } = setup()

    let done!: Promise<void>
    act(() => {
      done = result.current.dismiss('flag-1')
    })
    expect(result.current.busy).toBe(true)

    request.resolve({ ...FLAG, status: 'dismissed' })
    await act(() => done)
    expect(result.current.busy).toBe(false)
  })

  it('undo sends If-Match = the head after the dismiss and brings the note back', async () => {
    dismissSucceeds()
    const { result, onProject, onFlags } = setup()
    await act(() => result.current.dismiss('flag-1'))

    undoMock.mockResolvedValue(project('snap-1'))
    getFlagsMock.mockResolvedValue([FLAG])
    await act(() => result.current.undo())

    expect(undoMock).toHaveBeenCalledWith('proj-longpour', {
      expectedHeadSnapshotId: 'snap-2',
    })
    expect(onProject).toHaveBeenLastCalledWith(project('snap-1'))
    expect(onFlags).toHaveBeenLastCalledWith([FLAG])
    expect(result.current.undoable).toBe(false)
  })

  it('a stale head on dismiss shows the shared stale-head copy and changes nothing', async () => {
    dismissMock.mockRejectedValue(STALE())
    const { result, onProject } = setup()

    await act(() => result.current.dismiss('flag-1'))

    expect(result.current.error).toBe(staleHeadMessage)
    expect(getProjectMock).not.toHaveBeenCalled()
    expect(onProject).not.toHaveBeenCalled()
    expect(result.current.undoable).toBe(false)
  })

  it('undo after another edit fails safely with the Plan-changed copy', async () => {
    dismissSucceeds()
    const { result, onProject } = setup()
    await act(() => result.current.dismiss('flag-1'))

    undoMock.mockRejectedValue(STALE())
    await act(() => result.current.undo())

    expect(result.current.error).toBe(
      "Can't undo the dismiss — Plan changed since. Use Undo in the top bar.",
    )
    expect(onProject).toHaveBeenCalledTimes(1)
    expect(result.current.undoable).toBe(false)
  })

  it('clearUndo and clearError reset the toast state', async () => {
    dismissSucceeds()
    const { result } = setup()
    await act(() => result.current.dismiss('flag-1'))
    act(() => result.current.clearUndo())
    expect(result.current.undoable).toBe(false)

    dismissMock.mockRejectedValue(new Error('network down'))
    await act(() => result.current.dismiss('flag-1'))
    expect(result.current.error).toBe('network down')
    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail.**
  `cd apps/web && npx vitest run src/plan/panel/NotesStrip.test.tsx src/plan/panel/useDismissNote.test.ts`
  Expected: both files `FAIL` with `Cannot find module './NotesStrip'` / `'./useDismissNote'`.

- [ ] **Step 3: Minimal implementation.** Create `apps/web/src/plan/panel/NotesStrip.tsx`:

```tsx
import { useState } from 'react'
import type { LedgerFact, Scene } from 'contract'
import { plural } from '../../projects/wizard/board/boardText'
import { importNoteText, linkifyNote, type PlanNote } from '../story'

export interface NotesStripProps {
  scene: Scene
  /** notesForScene(openFlags, scene); the strip renders nothing when empty */
  notes: PlanNote[]
  /** for linkified "Scene n" references */
  scenes: Scene[]
  /** for linkified fact ids and the quoted fact */
  ledger: LedgerFact[]
  /** a write is in flight: Dismiss is disabled */
  busy: boolean
  /** the Act select is disabled, so "Change the act" is too */
  actLocked: boolean
  onSelectScene: (sceneId: string) => void
  onShowBeat: (beatId: string) => void
  /** null = the scene */
  onOpenInWrite: (beatId: string | null) => void
  onOpenFact: (factId: string) => void
  onDismiss: (flagId: string) => void
  onChangeAct: () => void
}

const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'
const LINK = `text-tr-sky underline ${FOCUS}`
const VERB = `rounded-card px-2 py-1 text-13 text-tr-text-primary hover:bg-tr-surface-clay disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

function beatLabel(scene: Scene, note: PlanNote): string | null {
  return note.beat ? `${scene.index + 1}.${note.beat.index + 1}` : null
}

/** The scene's notes (redesign spec §4.6): collapsed to a count and a peek
 * at the first story note; expanded to one card per story note with its
 * verbs, then the import notes in a closed "From the import" group. Severity
 * is not shown: all live flags are 'tension'. PlanScreen keys the strip by
 * scene id, so it starts collapsed on every scene. */
export function NotesStrip({
  scene,
  notes,
  scenes,
  ledger,
  busy,
  actLocked,
  onSelectScene,
  onShowBeat,
  onOpenInWrite,
  onOpenFact,
  onDismiss,
  onChangeAct,
}: NotesStripProps) {
  const [expanded, setExpanded] = useState(false)
  if (notes.length === 0) return null

  const story = notes.filter((note) => note.kind !== 'import')
  const imported = notes.filter((note) => note.kind === 'import')
  const summary =
    story.length > 0
      ? `⚑ ${plural(story.length, 'note')}${imported.length > 0 ? ` · ${imported.length} from the import` : ''}`
      : `${plural(imported.length, 'note')} from the import`
  const linkify = (text: string) => linkifyNote(text, scenes, ledger)
  const dismissButton = (note: PlanNote, label: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onDismiss(note.flag.id)}
      className={VERB}
    >
      {label}
    </button>
  )

  return (
    <section
      id="plan-section-notes"
      data-plan-section="notes"
      data-testid="notes-strip"
      aria-label="Notes"
      className="border-b border-tr-border bg-tr-amber-soft px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <p className="text-13 font-medium text-tr-text-primary">{summary}</p>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className={`ml-auto text-13 ${LINK}`}
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>

      {!expanded && story.length > 0 && (
        <p
          data-testid="notes-peek"
          className="mt-1 line-clamp-2 text-13 text-tr-text-primary"
        >
          {linkify(story[0].flag.explanation)
            .map((segment) => segment.text)
            .join('')}
        </p>
      )}

      {expanded && (
        <div className="mt-3 flex flex-col gap-2">
          {story.map((note) => {
            const label = beatLabel(scene, note)
            const beatId = note.beat?.id ?? null
            const fact = note.flag.factId
              ? ledger.find((f) => f.id === note.flag.factId)
              : undefined
            return (
              <article
                key={note.flag.id}
                data-testid={`note-${note.flag.id}`}
                className="rounded-card border border-tr-border bg-tr-surface-raised p-3 text-13 text-tr-text-primary"
              >
                {label && (
                  <p className="mb-1 text-12 font-medium">Beat {label}</p>
                )}
                <p>
                  {linkify(note.flag.explanation).map((segment, i) =>
                    segment.type === 'scene' ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onSelectScene(segment.sceneId)}
                        className={LINK}
                      >
                        {segment.text}
                      </button>
                    ) : segment.type === 'fact' ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onOpenFact(segment.factId)}
                        className={LINK}
                      >
                        {segment.text}
                      </button>
                    ) : (
                      <span key={i}>{segment.text}</span>
                    ),
                  )}
                </p>
                {fact && (
                  <blockquote className="mt-2 border-l-2 border-tr-border-strong pl-3">
                    <p>{fact.fact}</p>
                    <button
                      type="button"
                      onClick={() => onOpenFact(fact.id)}
                      className={`mt-1 text-12 ${LINK}`}
                    >
                      Open in Ledger →
                    </button>
                  </blockquote>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {note.kind === 'act_split' ? (
                    <>
                      <button
                        type="button"
                        disabled={actLocked}
                        onClick={onChangeAct}
                        className={VERB}
                      >
                        Change the act
                      </button>
                      {dismissButton(note, 'Looks right — dismiss')}
                    </>
                  ) : (
                    <>
                      {beatId && (
                        <button
                          type="button"
                          onClick={() => onShowBeat(beatId)}
                          className={VERB}
                        >
                          Show beat
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenInWrite(beatId)}
                        className={VERB}
                      >
                        Open in Write
                      </button>
                      {dismissButton(note, 'Dismiss')}
                    </>
                  )}
                </div>
              </article>
            )
          })}

          {imported.length > 0 && (
            <details
              data-testid="notes-import-group"
              className="rounded-card border border-tr-border bg-tr-surface-raised p-3"
            >
              <summary
                className={`cursor-pointer text-13 font-medium text-tr-text-primary ${FOCUS}`}
              >
                From the import · {imported.length}
              </summary>
              <ul className="mt-2 flex flex-col gap-3">
                {imported.map((note) => {
                  const beatId = note.beat?.id ?? null
                  return (
                    <li
                      key={note.flag.id}
                      data-testid={`note-${note.flag.id}`}
                      className="text-13 text-tr-text-primary"
                    >
                      <p>{importNoteText(note.flag, beatLabel(scene, note))}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => onOpenInWrite(beatId)}
                          className={VERB}
                        >
                          {beatId ? 'Open beat in Write' : 'Open in Write'}
                        </button>
                        {dismissButton(note, 'Looks right — dismiss')}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
```

Create `apps/web/src/plan/panel/useDismissNote.ts`:

```ts
import { useState } from 'react'
import type { ConsistencyFlag, Project } from 'contract'
import {
  dismissConsistencyFlag,
  getConsistencyFlags,
  getProject,
  undoProject,
} from '../../api/client'
import { ApiError } from '../../api/errors'
import { staleHeadMessage } from '../../shell/toastCopy'

const UNDO_STALE =
  "Can't undo the dismiss — Plan changed since. Use Undo in the top bar."

function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_HEAD')
    return staleHeadMessage
  return err instanceof Error ? err.message : 'Something went wrong'
}

/** Dismiss a note, with Undo. Not optimistic: `busy` covers the round trip
 * and PlanScreen folds it into `pending`, so no other write overlaps. */
export function useDismissNote({
  projectId,
  headSnapshotId,
  onProject,
  onFlags,
}: {
  projectId: string
  headSnapshotId: string | null
  onProject: (project: Project) => void
  onFlags: (flags: ConsistencyFlag[]) => void
}) {
  const [busy, setBusy] = useState(false)
  // The head the dismiss left behind; set = "Undo" is on offer.
  const [headAfter, setHeadAfter] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function dismiss(flagId: string) {
    setBusy(true)
    setError(null)
    setHeadAfter(null)
    try {
      await dismissConsistencyFlag(flagId, {
        expectedHeadSnapshotId: headSnapshotId,
      })
      // The dismiss made a snapshot and moved the head but returns only the
      // flag: refetch, or the next field save 409s on a stale If-Match.
      const [next, flags] = await Promise.all([
        getProject(projectId),
        getConsistencyFlags(projectId, 'open'),
      ])
      onProject(next)
      onFlags(flags)
      setHeadAfter(next.headSnapshotId)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!headAfter) return
    setBusy(true)
    setError(null)
    try {
      // If-Match = the head the dismiss left: after any later edit this
      // fails safely instead of undoing that edit.
      const restored = await undoProject(projectId, {
        expectedHeadSnapshotId: headAfter,
      })
      onProject(restored)
      onFlags(await getConsistencyFlags(projectId, 'open'))
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CONFLICT_STALE_HEAD'
          ? UNDO_STALE
          : messageFor(err),
      )
    } finally {
      setHeadAfter(null)
      setBusy(false)
    }
  }

  return {
    busy,
    undoable: headAfter !== null,
    error,
    dismiss,
    undo,
    clearUndo: () => setHeadAfter(null),
    clearError: () => setError(null),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass.**
  `cd apps/web && npx vitest run src/plan/panel/NotesStrip.test.tsx src/plan/panel/useDismissNote.test.ts` → `14 passed`.
  Then: `cd apps/web && npx prettier --write src/plan/panel && npx prettier --check . && npx eslint . && npx tsc -b` → clean.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/plan/panel/NotesStrip.tsx apps/web/src/plan/panel/NotesStrip.test.tsx apps/web/src/plan/panel/useDismissNote.ts apps/web/src/plan/panel/useDismissNote.test.ts
git commit -m "plan: add the notes strip and dismiss-with-undo hook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: T3.4 integration: notes, unsaved dots, leave dialog

**PR:** T3.4 · **Depends on:** Tasks 10, 12, 13

**Files:**
- Modify `apps/web/src/plan/SceneCard.tsx` (post-Task 10): an optional `unsaved` prop and the coral dot after the `consistency-flag-badge` span.
- Modify `apps/web/src/plan/Board.tsx`: `draftSceneIds` on `BoardProps` and `ActFrameProps`, passed through to `SceneCard`.
- Modify `apps/web/src/plan/PlanScreen.tsx` (post-Task 10): imports, hooks after `patcher`, a guarded `openInWrite`, `openFact` deleted, `handleOpenReview`, `sceneNotes`, `AppShell.runHistoryChange`, toasts and dialog, and the props on Board, ScenePanel and EpisodePanel.
- Modify `apps/web/src/plan/Board.test.tsx`: one new test.
- Modify `apps/web/src/plan/PlanScreen.test.tsx`: the mock block and eight new tests.
- Create `apps/web/e2e/plan-notes.spec.ts`.

**Interfaces:**
- Consumes:
  - From Task 1: `notesForScene`.
  - From Task 2: `draftKey` and `PlanDrafts` (through Task 10's `drafts`).
  - From Task 12: `useLeaveGuard`, `LeavePlanDialog`, `navigateToLedgerFact`.
  - From Task 13: `NotesStrip`, `useDismissNote`.
  - From Task 10's `PlanScreen.tsx`: `drafts`, `selectedScene`, `selectScene`, `setSelection`, `openInWrite(sceneId, beatId?)`, `openFact` (deleted here), `handleOpenReview` and `patcher`; `ScenePanel` (`notes?`, `noteCount?`, `pending`, `onOpenFact`); `EpisodePanel` (`pending`).
  - From Task 10's `PlanScreen.test.tsx`: `loadPlan()`, `project()` and the hoisted mocks.
  - From Task 5: the What happens draft key and the field accessible names.
  - From Task 9: `unsaved-chip`.
- Produces:
  - `SceneCardProps.unsaved?: boolean`, rendered as `<span data-testid="unsaved-dot" role="img" aria-label="Unsaved edits">`.
  - `BoardProps.draftSceneIds?: ReadonlySet<string>` (defaults to empty).
  - PlanScreen behaviour:
    - Every way out of Plan with drafts asks first: mode tabs, ⌘1–4, Open in Write, card double-click, Open beat in Write, Ledger links, shell Undo and history restore, and Open Review (which excludes its own field).
    - "Discard and leave" navigates with no `beforeunload` prompt.
    - Dismiss shows a "Note dismissed." toast with Undo.
    - `pending = patcher.pending || dismissal.busy` everywhere.

- [ ] **Step 1: Write the failing tests.**

In `apps/web/src/plan/Board.test.tsx`, add this test inside the top `describe(…)`, directly before `it('clicking a scene card selects it', …)`:

```tsx
  it('shows the coral unsaved dot only on cards with unsaved edits', () => {
    const ep = episode([
      scene({ id: 'scene-1' }),
      scene({ id: 'scene-2', index: 1, location: 'INT. BACK ROOM' }),
    ])
    renderBoard({
      project: project(ep),
      episode: ep,
      draftSceneIds: new Set(['scene-2']),
    })
    const dot = screen
      .getByTestId('scene-card-scene-2')
      .querySelector('[data-testid="unsaved-dot"]')
    expect(dot?.getAttribute('aria-label')).toBe('Unsaved edits')
    expect(
      screen
        .getByTestId('scene-card-scene-1')
        .querySelector('[data-testid="unsaved-dot"]'),
    ).toBeNull()
  })
```

In `apps/web/src/plan/PlanScreen.test.tsx`, as Task 10 leaves it (Task 10 Step 1 (b)):

(i) Change two imports to:

```tsx
import type { ConsistencyFlag, Episode, Project, Scene } from 'contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
```

(ii) Replace Task 10's `const { … } = vi.hoisted(…)` statement and its `vi.mock('../api/client', …)` block with the block below. It keeps Task 10's mocks (`createChangeSetMock`, `patchProjectMock`, `suggestInstructionsMock`); adds `dismissConsistencyFlagMock`, `undoProjectMock` and `navigateToReviewMock`; adds a partial mock of `review/changeSetSession`; and stubs the dialog methods jsdom lacks.

```tsx
const {
  createChangeSetMock,
  dismissConsistencyFlagMock,
  getConsistencyFlagsMock,
  getLedgerMock,
  getProjectMock,
  navigateToReviewMock,
  patchProjectMock,
  suggestInstructionsMock,
  undoProjectMock,
} = vi.hoisted(() => ({
  createChangeSetMock: vi.fn(),
  dismissConsistencyFlagMock: vi.fn(),
  getConsistencyFlagsMock: vi.fn(),
  getLedgerMock: vi.fn(),
  getProjectMock: vi.fn(),
  navigateToReviewMock: vi.fn(),
  patchProjectMock: vi.fn(),
  suggestInstructionsMock: vi.fn(),
  undoProjectMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  createChangeSet: createChangeSetMock,
  dismissConsistencyFlag: dismissConsistencyFlagMock,
  exportFountain: vi.fn(),
  getConsistencyFlags: getConsistencyFlagsMock,
  getLedger: getLedgerMock,
  getProject: getProjectMock,
  patchProject: patchProjectMock,
  suggestInstructions: suggestInstructionsMock,
  undoProject: undoProjectMock,
}))

vi.mock('../review/changeSetSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../review/changeSetSession')>()),
  navigateToReview: navigateToReviewMock,
  stashChangeSet: vi.fn(),
}))

// jsdom 29 has no showModal/close (LeavePlanDialog).
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(
    this: HTMLDialogElement,
  ) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
  }
})
```

(iii) Add these inside `describe('PlanScreen', () => { … })`, after Task 10's last test. They use Task 10's top-level `loadPlan()` and `project()` helpers.

```tsx
  const OPEN_FLAG: ConsistencyFlag = {
    id: 'flag-1',
    objectType: 'scene',
    objectId: 'scene-1',
    factId: null,
    explanation: 'Scene 2 still has the money in the bar.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-root',
  }

  function unloadPrevented(): boolean {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('shows the scene note; Dismiss refetches the head and flags, and Undo brings the note back', async () => {
    const user = userEvent.setup()
    // Queued replies win over loadPlan's defaults: load, then the dismiss
    // refetch, then the undo refetch.
    getProjectMock
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce({ ...project(), headSnapshotId: 'snap-dismiss' })
    getConsistencyFlagsMock
      .mockResolvedValueOnce([OPEN_FLAG])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([OPEN_FLAG])
    dismissConsistencyFlagMock.mockResolvedValue({
      ...OPEN_FLAG,
      status: 'dismissed',
    })
    undoProjectMock.mockResolvedValue(project())
    await loadPlan()

    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    await user.click(
      within(screen.getByTestId('note-flag-1')).getByRole('button', {
        name: 'Dismiss',
      }),
    )

    expect(dismissConsistencyFlagMock).toHaveBeenCalledWith('flag-1', {
      expectedHeadSnapshotId: 'snap-root',
    })
    expect(await screen.findByText('Note dismissed.')).not.toBeNull()
    expect(screen.queryByTestId('notes-strip')).toBeNull()

    await user.click(
      within(screen.getByTestId('toast')).getByRole('button', {
        name: 'Undo',
      }),
    )
    expect(undoProjectMock).toHaveBeenCalledWith('proj-longpour', {
      expectedHeadSnapshotId: 'snap-dismiss',
    })
    expect(await screen.findByTestId('notes-strip')).not.toBeNull()
    expect(screen.queryByText('Note dismissed.')).toBeNull()
  })

  it('leaving Plan with an unsaved edit asks first, and Stay keeps the edit', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    await user.click(screen.getByRole('tab', { name: 'Write' }))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(unloadPrevented()).toBe(true)

    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )
    expect(dialog.open).toBe(false)
    expect(window.location.pathname).toBe('/plan')
    expect(
      (within(panel).getByLabelText('Audience learns') as HTMLTextAreaElement)
        .value,
    ).toBe('Dan has a second key.')
  })

  it('Open Review sends its own draft without asking and leaves no unload prompt behind', async () => {
    const user = userEvent.setup()
    createChangeSetMock.mockResolvedValue({ id: 'cs-1' })
    const panel = await loadPlan()
    const whatHappens = within(panel).getByLabelText('What happens')
    await user.clear(whatHappens)
    await user.type(whatHappens, 'Marta comes home for good.')

    await user.click(within(panel).getByRole('button', { name: 'Open Review' }))

    await waitFor(() =>
      expect(navigateToReviewMock).toHaveBeenCalledWith(
        'proj-longpour',
        'cs-1',
      ),
    )
    expect(createChangeSetMock).toHaveBeenCalledWith('proj-longpour', {
      targetObjectId: 'scene-1',
      instruction: 'Marta comes home for good.',
    })
    expect(
      (screen.getByTestId('leave-plan-dialog') as HTMLDialogElement).open,
    ).toBe(false)
    expect(unloadPrevented()).toBe(false)
  })

  it('Open Review with another unsaved field asks first; Stay sends nothing', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )
    const whatHappens = within(panel).getByLabelText('What happens')
    await user.clear(whatHappens)
    await user.type(whatHappens, 'Marta comes home for good.')

    await user.click(within(panel).getByRole('button', { name: 'Open Review' }))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )

    expect(createChangeSetMock).not.toHaveBeenCalled()
    expect(
      (within(panel).getByLabelText('What happens') as HTMLTextAreaElement)
        .value,
    ).toBe('Marta comes home for good.')
  })

  it('a field save right after a dismiss sends the head the dismiss left, not the stale one', async () => {
    const user = userEvent.setup()
    getProjectMock
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce({ ...project(), headSnapshotId: 'snap-dismiss' })
    getConsistencyFlagsMock
      .mockResolvedValueOnce([OPEN_FLAG])
      .mockResolvedValueOnce([])
    dismissConsistencyFlagMock.mockResolvedValue({
      ...OPEN_FLAG,
      status: 'dismissed',
    })
    patchProjectMock.mockResolvedValue({
      project: { ...project(), headSnapshotId: 'snap-save' },
      consistencyFlags: [],
    })
    const panel = await loadPlan()

    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    await user.click(
      within(screen.getByTestId('note-flag-1')).getByRole('button', {
        name: 'Dismiss',
      }),
    )
    expect(await screen.findByText('Note dismissed.')).not.toBeNull()

    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(patchProjectMock).toHaveBeenCalledWith(
        'proj-longpour',
        expect.any(Array),
        { expectedHeadSnapshotId: 'snap-dismiss' },
      ),
    )
  })

  it('a locked scene still shows its notes, and Dismiss stays available', async () => {
    const user = userEvent.setup()
    const p = project()
    p.seasons[0].episodes[0].scenes[0].locked = true
    getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
    const panel = await loadPlan(p)

    expect(
      within(panel).getByText(
        'Locked — unlock to edit. Review will never change this scene.',
      ),
    ).not.toBeNull()
    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    const dismiss = within(screen.getByTestId('note-flag-1')).getByRole(
      'button',
      { name: 'Dismiss' },
    ) as HTMLButtonElement
    expect(dismiss.disabled).toBe(false)
  })

  it('double-clicking a card with an unsaved edit asks before opening Write', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    await user.dblClick(screen.getByTestId('scene-card-scene-2'))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )

    expect(dialog.open).toBe(false)
    expect(loadResume('proj-longpour').mode).toBe('Plan')
  })

  it('shell Undo with an unsaved edit asks first; Stay sends no undo', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    await user.click(screen.getByTestId('undo-button'))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )

    expect(undoProjectMock).not.toHaveBeenCalled()
    expect(
      (within(panel).getByLabelText('Audience learns') as HTMLTextAreaElement)
        .value,
    ).toBe('Dan has a second key.')
  })
```

Create `apps/web/e2e/plan-notes.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

// T3.4 notes and drafts journeys (redesign spec §4.6 notes strip, §4.9
// drafts). Real api + seeded fixture + MockLlmClient (e2e/start-api.sh), no
// route interception.
//
// MockLlmClient.scan_consistency always returns one tension note on scene-5,
// so a "Save field only" on any What happens creates one. Shared DB: earlier
// specs can leave more scene-5 notes behind, so note counts are relative.
// This file writes scene-2 whatHappens (plan.spec rewrites it anyway) and
// scene-5 audienceFeels; review.spec reads whatHappens fresh from the API and
// no other spec reads audienceFeels.

test('a story note can be read, dismissed and brought back with Undo; saving still works after', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-2').click()
  const inspector = page.getByTestId('inspector')
  await inspector
    .getByLabel('What happens', { exact: true })
    .fill('Dan moves the money before dawn.')
  await inspector.getByRole('button', { name: 'Save field only' }).click()
  await expect(
    inspector.getByText('Structural change — review impact?'),
  ).toHaveCount(0)

  await page.getByTestId('scene-card-scene-5').click()
  const strip = inspector.getByTestId('notes-strip')
  await expect(strip).toContainText('⚑')
  await strip.getByRole('button', { name: 'Show', exact: true }).click()
  const notes = strip.locator('[data-testid^="note-"]')
  await expect(notes.first()).toContainText('stakes reference the bar')
  const before = await notes.count()

  await notes
    .first()
    .getByRole('button', { name: 'Dismiss', exact: true })
    .click()
  const toast = page.getByTestId('toast')
  await expect(toast).toContainText('Note dismissed.')
  await expect(notes).toHaveCount(before - 1)

  await toast.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(toast).toHaveCount(0)
  await expect(inspector.getByTestId('notes-strip')).toContainText(
    `⚑ ${before} note`,
  )

  // The dismiss and its undo each moved the head; a save now must not 409.
  const feels = inspector.getByLabel('Audience feels', { exact: true })
  await feels.fill('Dread, then a flash of relief.')
  await inspector.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    inspector.getByRole('button', { name: 'Save', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByTestId('toast')).toHaveCount(0)

  await page.reload()
  await page.getByTestId('scene-card-scene-5').click()
  await expect(
    page.getByTestId('inspector').getByLabel('Audience feels', { exact: true }),
  ).toHaveValue('Dread, then a flash of relief.')
})

test('drafts survive scene switches, and leaving Plan asks first', async ({
  page,
}) => {
  // A native beforeunload prompt here is a bug: record it and dismiss it
  // (which also cancels the navigation, so the URL check fails loudly).
  const nativeDialogs: string[] = []
  page.on('dialog', (dialog) => {
    nativeDialogs.push(dialog.type())
    void dialog.dismiss()
  })

  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-2').click()
  const inspector = page.getByTestId('inspector')
  const learns = inspector.getByLabel('Audience learns', { exact: true })
  await learns.fill('Dan has a second key to the basement.')

  await page.getByTestId('scene-card-scene-3').click()
  await expect(
    page.getByTestId('scene-card-scene-2').getByTestId('unsaved-dot'),
  ).toBeVisible()
  await expect(inspector.getByTestId('unsaved-chip')).toHaveCount(0)

  await page.getByTestId('scene-card-scene-2').click()
  await expect(learns).toHaveValue('Dan has a second key to the basement.')
  await expect(inspector.getByTestId('unsaved-chip')).toBeVisible()

  const writeTab = page
    .getByTestId('mode-switcher')
    .getByRole('tab', { name: 'Write' })
  const dialog = page.getByTestId('leave-plan-dialog')
  await writeTab.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Stay in Plan' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/plan\?/)
  await expect(learns).toHaveValue('Dan has a second key to the basement.')

  await writeTab.click()
  await dialog.getByRole('button', { name: 'Discard and leave' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  expect(nativeDialogs).toEqual([])
})
```

- [ ] **Step 2: Run them to verify they fail.**
  `cd apps/web && npx vitest run src/plan/Board.test.tsx src/plan/PlanScreen.test.tsx`
  Expected:
  - Board: `shows the coral unsaved dot …` fails (`expected undefined to be 'Unsaved edits'`).
  - PlanScreen: the dismiss test fails on `findByTestId('notes-strip')` (`Unable to find an element by: [data-testid="notes-strip"]`).
  - PlanScreen: the leave test fails on `getByTestId('leave-plan-dialog')`.
  - PlanScreen: the Open Review tests fail on the dialog lookup or on `navigateToReviewMock`.
  - PlanScreen: the post-dismiss save, locked-scene notes, card double-click and shell Undo tests fail on the missing strip or dialog.
  - The existing tests still pass.

- [ ] **Step 3: Minimal implementation.**

**3a. `apps/web/src/plan/SceneCard.tsx`.** In `SceneCardProps`, after `hasOpenConsistencyFlag: boolean`, add:

```tsx
  /** Unsaved Plan edits on this scene (redesign spec §4.9): coral dot. */
  unsaved?: boolean
```

In the `SceneCard({ … })` parameter list, after `hasOpenConsistencyFlag,`, add `unsaved = false,`. Directly after the `{hasOpenConsistencyFlag && ( <span data-testid="consistency-flag-badge" … /> )}` block, add:

```tsx
        {unsaved && (
          <span
            data-testid="unsaved-dot"
            role="img"
            aria-label="Unsaved edits"
            title="Unsaved edits"
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-tr-coral"
          />
        )}
```

**3b. `apps/web/src/plan/Board.tsx`.**
- Directly above `export interface BoardProps {`, add `const NO_DRAFTS: ReadonlySet<string> = new Set()`.
- In `ActFrameProps`, after `flaggedSceneIds: Set<string>`, add `draftSceneIds: ReadonlySet<string>`.
- In `ActFrame({ … })`'s parameter list, after `flaggedSceneIds,`, add `draftSceneIds,`.
- On its `<SceneCard … />`, after `hasOpenConsistencyFlag={flaggedSceneIds.has(scene.id)}`, add `unsaved={draftSceneIds.has(scene.id)}`.
- In `BoardProps`, after `flaggedSceneIds: Set<string>`, add:

```tsx
  /** Scenes with unsaved Plan edits (drafts.dirtySceneIds): coral dot. */
  draftSceneIds?: ReadonlySet<string>
```

- In `Board({ … })`'s parameter list, after `flaggedSceneIds,`, add `draftSceneIds = NO_DRAFTS,`.
- On `<ActFrame … />`, after `flaggedSceneIds={flaggedSceneIds}`, add `draftSceneIds={draftSceneIds}`.

**3c. `apps/web/src/plan/PlanScreen.tsx`**, as Task 10 leaves it (Task 10 Step 3 (c)). Every anchor below is quoted from that file.

(1) Imports. Replace Task 10's `../shell/modeNavigation` import and its `./panel/EpisodePanel` … `./panel/usePlanDrafts` imports with the following, and add the `./story` import directly above `import { useProjectPatch } from './useProjectPatch'`:

```tsx
import {
  navigateToLedgerFact,
  navigateToMode,
  navigateToWriteBeat,
  navigateToWriteScene,
} from '../shell/modeNavigation'
```

```tsx
import { EpisodePanel } from './panel/EpisodePanel'
import { LeavePlanDialog } from './panel/LeavePlanDialog'
import { NotesStrip } from './panel/NotesStrip'
import { ScenePanel } from './panel/ScenePanel'
import { useDismissNote } from './panel/useDismissNote'
import { useLeaveGuard } from './panel/useLeaveGuard'
import {
  draftKey,
  PlanDraftsContext,
  usePlanDraftStore,
} from './panel/usePlanDrafts'
```

```tsx
import { notesForScene } from './story'
```

(2) Directly after

```tsx
  const patcher = useProjectPatch(
    activeProjectId,
    project,
    setProject,
    mergeNewFlags,
  )
```

add:

```tsx
  const dismissal = useDismissNote({
    projectId: activeProjectId,
    headSnapshotId: project?.headSnapshotId ?? null,
    onProject: setProject,
    onFlags: setOpenFlags,
  })
  const leave = useLeaveGuard(drafts)
  // One "a write is in flight" flag for every control: a field save, a lock,
  // a reorder, a dismiss or its undo.
  const busy = patcher.pending || dismissal.busy
```

(3) Replace Task 10's `openInWrite` and `openFact` functions, from `function openInWrite(sceneId: string, beatId?: string) {` through the closing `}` of `openFact`, including `openFact`'s doc comment. The guarded `openInWrite` below keeps the same name and signature, so the Board, ScenePanel and beat-ladder callers stay as they are. `openFact` is deleted: `navigateToLedgerFact` takes its place.

```tsx
  // Ask before saving the Write resume point, so "Stay in Plan" leaves
  // Plan's resume untouched; the navigation then passes the (now empty) guard.
  function openInWrite(sceneId: string, beatId?: string) {
    void leave.confirmLeave().then((ok) => {
      if (!ok) return
      saveResume(activeProjectId, { mode: 'Write', sceneId })
      if (beatId) navigateToWriteBeat(sceneId, beatId)
      else navigateToWriteScene(sceneId)
    })
  }
```

(4) Replace `handleOpenReview` with:

```tsx
  async function handleOpenReview(targetObjectId: string, instruction: string) {
    // The field being sent travels in the Change Set; any other draft would
    // be lost on the way to Review, so ask first.
    const key = draftKey(targetObjectId, 'whatHappens')
    const others = drafts.size - (drafts.get(key) !== undefined ? 1 : 0)
    if (others > 0 && !(await leave.confirmLeave())) return
    setOpeningReview(true)
    setReviewError(null)
    try {
      const changeSet = await createChangeSet(activeProjectId, {
        targetObjectId,
        instruction,
      })
      stashChangeSet(changeSet)
      // Its text now lives in the Change Set: clear it so beforeunload does
      // not stop the navigation.
      drafts.clear(key)
      navigateToReview(activeProjectId, changeSet.id)
    } catch (err: unknown) {
      // "Discard and leave" may have cleared it: give the writer the text back.
      drafts.set(key, targetObjectId, instruction)
      setReviewError(
        err instanceof Error ? err.message : 'failed to open Review',
      )
      setOpeningReview(false)
    }
  }
```

(5) Directly after

```tsx
  const selectedScene = effectiveSelection
    ? findScene(project, effectiveSelection.sceneId)
    : null
```

add:

```tsx
  const sceneNotes = selectedScene
    ? notesForScene(openFlags, selectedScene)
    : []
```

(6) On the `<AppShell …>` inside `<PlanDraftsContext.Provider value={drafts}>`, after `projectId={projectId}`, add:

```tsx
        runHistoryChange={(request) =>
          leave
            .confirmLeave()
            .then((ok) => (ok ? request().then(() => true) : false))
        }
```

(7) Directly after the `{patcher.error && ( <Toast tone="danger" onDismiss={patcher.dismissError}> … </Toast> )}` block, add:

```tsx
        {dismissal.error && (
          <Toast tone="danger" onDismiss={dismissal.clearError}>
            {dismissal.error}
          </Toast>
        )}
        {dismissal.undoable && !dismissal.error && !patcher.error && (
          <Toast onDismiss={dismissal.clearUndo}>
            Note dismissed.{' '}
            <button
              type="button"
              disabled={busy}
              onClick={() => void dismissal.undo()}
              className="font-medium text-tr-sky underline disabled:opacity-50"
            >
              Undo
            </button>
          </Toast>
        )}
        <LeavePlanDialog {...leave.dialog} />
```

(8) Props:
- The three `pending={patcher.pending}` (Board, ScenePanel, EpisodePanel) become `pending={busy}`.
- `<Board …>`: after `flaggedSceneIds={flaggedSceneIds}`, add `draftSceneIds={drafts.dirtySceneIds}`.
- `<ScenePanel …>`: replace `onOpenFact={openFact}` with:

```tsx
              onOpenFact={navigateToLedgerFact}
              noteCount={sceneNotes.length}
              notes={
                <NotesStrip
                  key={selectedScene.id}
                  scene={selectedScene}
                  notes={sceneNotes}
                  scenes={episode.scenes}
                  ledger={ledger}
                  busy={busy}
                  actLocked={episode.locked || selectedScene.locked || busy}
                  onSelectScene={selectScene}
                  onShowBeat={(beatId) =>
                    setSelection({
                      type: 'beat',
                      sceneId: selectedScene.id,
                      beatId,
                    })
                  }
                  onOpenInWrite={(beatId) =>
                    openInWrite(selectedScene.id, beatId ?? undefined)
                  }
                  onOpenFact={navigateToLedgerFact}
                  onDismiss={(flagId) => void dismissal.dismiss(flagId)}
                  onChangeAct={() =>
                    document.getElementById('plan-act-select')?.focus()
                  }
                />
              }
```

Self-check:
- `grep -n "patcher.pending" apps/web/src/plan/PlanScreen.tsx` prints only the `const busy = …` line.
- `grep -n "location.assign" apps/web/src/plan/PlanScreen.tsx` prints nothing: every way out goes through `modeNavigation` (guarded) or `navigateToReview` (handled above).

- [ ] **Step 4: Run the tests to verify they pass.**
  - Unit: `cd apps/web && npx vitest run src/plan/Board.test.tsx src/plan/PlanScreen.test.tsx`, then the whole suite with `cd apps/web && npx vitest run`. Everything passes.
  - Format, lint, typecheck: `cd apps/web && npx prettier --write src/plan/SceneCard.tsx src/plan/Board.tsx src/plan/PlanScreen.tsx src/plan/Board.test.tsx src/plan/PlanScreen.test.tsx e2e/plan-notes.spec.ts && npx prettier --check . && npx eslint . && npx tsc -b`. All clean.
  - E2E, with temporary files that are deleted before committing. From the worktree root (the second run is the whole e2e suite):

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
(cd apps/web && E2E_API_PORT=8100 E2E_WEB_PORT=5180 npx playwright test --config=e2e/playwright.local.config.ts e2e/plan-notes.spec.ts e2e/plan.spec.ts e2e/review.spec.ts e2e/recipes.spec.ts e2e/newproject-resume.spec.ts)
(cd apps/web && E2E_API_PORT=8100 E2E_WEB_PORT=5180 npx playwright test --config=e2e/playwright.local.config.ts)
rm apps/web/e2e/playwright.local.config.ts apps/api/.venv
git status --short   # neither temporary path may appear
```

    Expected: `plan-notes.spec.ts` passes both tests. `plan.spec`, `review.spec` (Open Review navigates with no unload prompt), `recipes.spec` and `newproject-resume.spec` pass. If a spec this task did not touch fails, compare it with the origin/main e2e baseline before changing any code; only failures that baseline doesn't have are Task 14's. Run order is alphabetical, so `plan-notes` runs just before `plan.spec`; its writes (scene-2 whatHappens, scene-5 audienceFeels, one scene-5 note left open after Undo) are inert for the specs that follow.


- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/plan/SceneCard.tsx apps/web/src/plan/Board.tsx apps/web/src/plan/PlanScreen.tsx apps/web/src/plan/Board.test.tsx apps/web/src/plan/PlanScreen.test.tsx apps/web/e2e/plan-notes.spec.ts
git commit -m "plan: wire notes, unsaved dots and the leave dialog into Plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (Phase 1)

Every spec rule that Phase 1 owns, and the task that ships it and pins it with a test. "Later" rows name the build-plan task that owns them.

| Spec | Requirement | Task(s) |
|---|---|---|
| §4.1 | Board and panel scroll independently in a fixed-height Plan screen; clicking a card updates a panel already on screen | 3 |
| §4.6 | Panel `data-testid="inspector"`, 400px (`--tr-panel-plan`) | 3, 9 |
| §4.6 | Sticky header: ← Episode, "Scene n of N" ‹ › (board order), "n · Place" with lock glyph and unsaved chip, jump bar with counts and scroll-spy | 1 (`placeTitle`, `boardOrder`), 2, 9 |
| §4.6 | Full slug (Courier); Act select (combobox "Act", all format acts, immediate PATCH, one snapshot, no AI); Lock switch (`lock-toggle`); Open in Write ↗ | 9, 10 |
| §4.6 | Locked banner "Locked — unlock to edit. Review will never change this scene." | 9 |
| §4.6 | Notes strip only when notes exist: collapsed "⚑ n notes · m from the import" + two-line peek + Show | 13, 14 |
| §4.6 | Continuity card: full text, "Scene n" links select the scene (by id), fact ids as "a Ledger fact" links, quoted fact; Show beat · Open in Write · Dismiss with Undo | 1 (`linkifyNote`), 13, 14 |
| §4.6 | Act split card: Change the act · Looks right — dismiss | 1 (`flagKind`), 13 |
| §4.6 | From the import · n (closed): plain-language text, never the `[code]`; Open beat in Write · Looks right — dismiss | 1 (`importNoteText`), 13 |
| §4.6 | Sections are native `<details>`, open/closed persisted per viewer, Details closed by default | 6 |
| §4.6 | What the scene does: What happens 15px, structural, auto-grow, footer Open Review / Save field only / Discard, explicit Suggest…; landmark callout; The audience Learns / Feels grid | 1 (`landmarksForScene`), 4, 5 |
| §4.6 | Who wants what (n): card per character (Wants · Says only when it differs · Up against · At stake · ◆ Hidden agenda); "Also in the scene: … · from dialogue cues"; one quiet line when empty; read-only | 1 (`castFromDialogue`), 5 |
| §4.6 | What it touches: threads (↗/↘, "Pays off in n →" / "Never paid off"); secret irony callout with who is in the dark and Set in / Out in links; facts active + pending only, type chip, Unconfirmed, ◆ hidden from the audience, Known by, "Show n retired", "Open in Ledger →"; relationship moments | 1 (`threadsForScene`, `secretsForScene`, `factsForScene`), 7 |
| §4.6 | Beats (n): rows show `beat.whatHappens`, ⚑ / import marker, lock, landmark tag, "lands"; "↷ time jump" divider; expanded row: learns/feels, Beat lock (`beat.locked`, new), Script lock, Script text disclosure, Open beat in Write ↗ | 8, 10 (handlers) |
| §4.6 | Details: Location, Time, Social situation (auto-grow); Storyline hidden while `episode.storylines` is empty | 6 |
| §4.6 | Order notes (computed) | Later: T3.7 |
| §4.9 | Edits persist per scene while browsing; editor restored on return | 2, 4, 9; e2e 14 |
| §4.9 | Coral dot on the card | 14 (chart block: later, T3.7) |
| §4.9 | Leaving Plan with drafts opens a native `<dialog>` (Stay in Plan / Discard and leave); no blocking guard inside Plan; no silent discard | 12, 14 |
| §4.11 | Locked scene: panel read-only with banner, Act disabled, cascaded beat locks; Open in Write and notes still work | 4, 5, 6, 8, 9, 14 |
| §4.11 | Idea-born project / missing story data: one quiet line per empty section | 1, 5, 7, 8, 9 |
| §4.11 | Hundreds of import flags: the import group stays collapsed | 13 |
| §4.12 | Scene lock toggle / LockBanner → controls row / banner | 9 |
| §4.12 | Location, Time, Social situation → Details; cleaned place as the panel title | 6, 9 |
| §4.12 | Act select → controls row | 9 (drop onto an empty act: later, T3.5) |
| §4.12 | Storyline → hidden while empty | 6 |
| §4.12 | What happens / Audience learns / feels → What the scene does (first) | 5 |
| §4.12 | Motivations table → Who wants what cards (+ `statedObjective`, `concealed`) | 5 |
| §4.12 | Affected facts → What it touches → Facts (status-filtered, "Show n retired") | 7 |
| §4.12 | Episode / series premise | 9 (`EpisodePanel`; Episode view → Premise: later, T3.6) |
| §4.12 | Beat inspector → beat ladder row (+ `beat.locked`; Script stays a disclosure) | 8 |
| §4.12 | Flag dot → notes strip with the flag text | 13, 14 (⚑ chip, beat ticks: T3.5; chart rule: T3.7) |
| §4.12 | Story Layers | Stays in Phase 1 (later, T3.6) |
| §4.13 | Kept ids; `beat-card-{id}` on the panel's beat row; `plan.spec.ts` selects the scene first; lock-and-regenerate recipe unchanged | 8, 9, 10 |
| §6 | No contract change, no new endpoint, no new LLM operation, no PROMPT_VERSION bump | All (no file under `packages/contract` or `apps/api` is touched) |
| §6 | Derivations are pure functions in `apps/web/src/plan/story.ts`, unit-tested | 1 |
| §6 | Rule 2 (locks): Phase 1 adds no generation path; Open Review keeps the existing Change Set path | 10 (unchanged `handleOpenReview` call), 14 |
| §6 | Rule 4: one direct-edit PATCH, one snapshot per edit | 9 (Act), 10 (Beat lock sends one PATCH) |
| §6 | Rule 6: one new token `--tr-panel-plan: 400px`; `--tr-panel-inspector` stays | 3 |
| §6 | Rule 8 / decision 5: no model call without a verb-labelled click (Suggest…) | 4, 5, 9, 10 |
| §6 | Heuristics labelled (`from dialogue cues`; `ponytail:` on the flag-kind match) | 1, 5 |
| §6 | No new dependencies | All |
| §8 | Unit `story.ts`: flag kind, linkify, cast noise filtering; facts status filter; draft persistence | 1, 2, 7 |
| §8 | Component: section order and jump bar; notes strip collapsed/expanded and Dismiss with Undo; locked scene read-only; Suggest… makes no request until clicked | 9; 13, 14; 4, 5, 6, 8, 9; 4, 5, 9, 10 |
| §8 | E2E: `plan.spec.ts` updated (select a scene, beat rows in the panel, motivations, facts, lock banner, Act combobox); lock-and-regenerate recipe unchanged | 10 |
| §8 | Docs: UI spec §5 (inspector part), build-plan T3.3–T3.9, test-plan entries, handoff decision-log row | 3 (§1 token line), 11 |
| §8 | Order issues, highlight matchers, script share, roving tabindex, highlight announcements, Episode view, empty-act drop target, highlight + N e2e, order-check e2e | Later: T3.5–T3.7 |
