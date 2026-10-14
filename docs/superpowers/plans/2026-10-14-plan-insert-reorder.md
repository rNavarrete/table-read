# Plan Redesign — Phase 4a (T3.8 Insert reorder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is deliberately lean: exact interfaces, test names with their key assertions, and code only where the logic is easy to get wrong. Write the rest in the style of the Phase 1–3 files it names.

**Goal:** A drop **inserts** the dragged card where it lands (left half of a card = before it, right half = after it) with a coral insertion bar; ⌥← / ⌥→ on a focused card moves it one slot in board order, crossing act breaks; the Act select and an empty-act drop become the same kind of move. Nothing may shift a locked scene: the client refuses with "Can't move past scene n: it's locked" (on the drop target, else a toast), and the server rejects it with 409 `LOCKED_OBJECT` and no snapshot. Folded in: the Act select no longer drops focus to `<body>` while its save runs, and any move into a collapsed act opens it and scrolls the card into view.

**Architecture:** Every move is one pure function, `applySceneMove(project, move)` in `apps/web/src/plan/planTree.ts`: it computes the new board order, sets `index` = board position (0…N-1) and the moved scene's `act`, and returns either `{ ops, next }` — **one** PATCH of `replace …/index` (and `…/act`) ops for exactly the scenes that changed, plus its optimistic twin — or `{ blockedBy }` when a changed scene is locked, or `null` when nothing would move. The drop prediction (`story.predictMove`), the drop target's tape and bar, the keyboard move, the Act select and the PATCH all derive from it, so they can never disagree. The server's PATCH applier already applies a multi-op patch atomically into one snapshot; the only server change is one guard line in `locks.assert_no_locked_writes`: a locked scene's own `index` is no longer exempt. Undo the move needs no change (one PATCH = one snapshot = one `POST /undo`).

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 4 (`--tr-*` tokens only), Vitest + Testing Library (jsdom), FastAPI + pytest (`TestClient`, seeded SQLite), Playwright e2e against the real API with a seeded temp DB and `MockLlmClient`.

**Spec:** `docs/superpowers/specs/2026-10-13-plan-redesign-design.md` — owner decision #2 (§3: insert where dropped, lock-violation test first), §4.2, §4.3, §4.8, §4.10, §4.11, §6 (rule 2), §7 Phase 4 (T3.8). Visual reference: `reports/Plan redesign/Plan redesign mockup.html` in the owner's checkout (read-only; built on a copyrighted script — **never copy its text into the repo**; use `docs/tableread-fixture.json` and generic wording). The mockup still shows swap semantics and only teases ⌥←/⌥→ ("later phase"), so it does not settle the drop side (see Defaults 1).

## Global Constraints

- **Rule 2, ordering:** Task 1 writes the lock-violation tests (server PATCH → 409 + no snapshot; builder refuses and returns no ops), runs them, sees them fail for the right reason, and commits them **before** any feature test. Task 5 writes its PlanScreen lock test ("sends no PATCH and says why") first, too.
- **No schema change** (Zod, Pydantic, data-contract types, tool schemas untouched; `check_contract.py` must stay green), no new endpoint, no LLM call, no prompt change, no PROMPT_VERSION bump. `index`/`act` are not structural fields, so a move never runs `scan_consistency`.
- **Rule 4:** a move is one `PATCH /projects/{pid}` (one snapshot) through `useProjectPatch`; a refused move sends nothing. Undo the move stays the existing `POST /undo` with `If-Match` = the move's head.
- **Rule 5:** server logs/messages carry ids only (`cannot move locked scene 'scene-3'`), never scene text.
- **Rule 6:** no new token, no hex. The insertion bar is `bg-tr-coral`; refusals use the existing amber tape/ring and the `danger` Toast.
- **Rule 8:** nothing here calls a model; no component imports `suggestInstructions` or `createChangeSet`.
- The scenes **array order never changes** (only `index`/`act` fields), so the locked-episode child-order guard and `review.spec.ts`'s array-path lock (`scenes/4/locked`) are unaffected.
- No new dependencies. No `DESIGN-GAP` comments expected; if one is needed it must name a task id (`// DESIGN-GAP(T3.8): …`).
- Commits: `area: imperative summary`, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tests beside code; e2e in `apps/web/e2e/`.
- Never edit the owner's checkout, never `git stash`, never push, never `make`, never call the Anthropic API, never run `make evals`.

## Review Focus

1. **Nothing shifts a locked scene** — the server rejects a PATCH that changes a locked scene's `index` (or any scene's in a locked episode) with 409 and no snapshot; the builder returns `{ blockedBy }` and no ops; a refused drop sends no PATCH and says why. *Pinned by:* Task 1 `test_patch_shifting_a_locked_scene_index_is_rejected_without_snapshot` and planTree "refuses a move that would shift a locked scene"; Task 5 "a drop that would shift a locked scene sends no PATCH and says why".
2. **One gesture = one PATCH = one snapshot, `index` = board position, only changed fields sent** — *Pinned by:* Task 1 `test_one_patch_of_index_replaces_and_an_act_is_one_snapshot`; Task 2 "an insert renumbers to board position and sends only what changed".
3. **The prediction is the save** — drop tape, bar and refusal come from the same `applySceneMove` the PATCH uses. *Pinned by:* Task 2 "predictMove equals the new problems of the saved insert"; Task 3 "over a card's right half: the coral bar after it and the insert's prediction".
4. **Keyboard move** — ⌥← / ⌥→ moves one slot, crosses an act break in place (empty acts included), keeps focus on the moved card, does nothing while a write is in flight. *Pinned by:* Task 2 "a step passes one neighbour, and at an act's edge crosses into the next act in place"; Task 3 "⌥← / ⌥→ ask for a step; never while pending"; Task 5 "⌥→ moves the focused card one slot and keeps focus on it".
5. **Focus and collapsed acts** — the Act select keeps focus through its save; a move into a collapsed act opens it and scrolls the card into view. *Pinned by:* Task 4 "the Act select stays focusable while its save is pending and ignores a second change"; Task 5 "a move into a collapsed act opens it and scrolls the card into view" and the e2e "the Act select keeps focus through its save…".

---

## How to run things in this worktree

Every command starts from the worktree root (`/private/tmp/claude-501/-Users-rolandonavarrete-Documents-tableread/e01f6f26-992e-40b8-b7ce-ce2105b26759/scratchpad/wt-insert`). Run each line as its own shell call, or keep the `( … )` subshells.

- Web unit tests: `(cd apps/web && npx vitest run <paths>)`; the whole suite: `(cd apps/web && npx vitest run)`
- Typecheck: `(cd apps/web && npx tsc -b)` · Lint: `(cd apps/web && npx eslint <files>)` · Format: `(cd apps/web && npx prettier --write <files>)` then `--check`
- API tests: `(cd apps/api && PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/pytest -p no:cacheprovider -q <paths>)`
- API lint: `/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/ruff check apps/api`
- Contract: `/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/python scripts/check_contract.py` (must be unchanged-green; this plan changes no schema)
- E2E (ports `E2E_API_PORT` / `E2E_WEB_PORT` as given by the orchestrator). Playwright 1.61.1 expects chromium 1228 but 1243 is installed, so use a TEMPORARY config and a TEMPORARY venv symlink, and delete both before any lint or commit:

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

- Six Write-mode e2e tests may already fail on `origin/main` (`error-states.spec.ts` ×2, `locked-beat.spec.ts`, `quiet-ai.spec.ts`, `write.spec.ts` ×2). Before blaming this work, run the same spec on a baseline worktree of `origin/main` (`git worktree add <scratchpad>/wt-baseline origin/main`, same temporary config and symlink, then `git worktree remove`). Never `git stash`.
- One e2e worker shares one seeded DB; files run in name order (`plan-notes` → `plan` → `quiet-ai` → `recipes` → `review` → `write*` → `zz-*`). Write mode reads array order, never `index`/`act`, so moves stay inert for later specs.

## Codebase facts the tasks rely on

- **Scene `index` is episode-wide** (fixture `scene-1…6` = 0…5 across acts 0…4; the import assigns it in script order; card number = `index + 1`). **Board order** = act, then index (`story.boardOrder`, `planTree.groupScenesByAct`). No uniqueness or contiguity is enforced (`schemas.py` `Scene.index: int = Field(ge=0)`).
- **PATCH applier** (`apps/api/storage/patching.py`): applies every op in order to one deep copy; `routes.patch_project` then validates the whole doc, runs `locks.assert_no_locked_writes(old, new)`, and calls `snapshots.mutate` **once**. A bad op anywhere → 400 with nothing persisted. So several `/index` replaces in one PATCH are already atomic and one snapshot (Task 1 pins it; no server change needed for that). `index`/`act` are not in `scan._structural_values`, so no LLM.
- **Lock guard today** (`apps/api/drama_manager/locks.py`): `_EXEMPT_ON_LOCKED = {"locked", "scriptLocked", "index"}` is applied to scenes too, and the module header says "Locked-scene drag-among-scenes (scene `index` among episode siblings) stays allowed server-side for MVP". So today a PATCH that shifts a locked scene's `index` (or one in a locked episode) is **accepted**; changing a locked scene's `act` is already rejected (`test_patch_locked_scene_act_is_rejected_without_snapshot`). Other callers of the guard (character merge, Change Set apply, scene-skeleton apply) never change an existing scene's `index` (skeleton apply appends at `len(scenes)`), and undo/restore bypasses it — so un-exempting a locked scene's own `index` touches nothing else.
- **Client today:** `SceneMove = swap | act`; `applySceneMove` → `{ ops, next } | null`; `predictMove(project, move): OrderIssue[]`; Board takes `onReorder(dragged, target)`, `onMoveToAct(sceneId, act)`, `predict(move) => OrderIssue[]`; BoardCard refuses dragover/drop on its own when `locked`; Board's `handleKey` returns early on `altKey` with the comment "⌥←/→ is Phase 4's insert move". `PlanScreen.applyMove` sets `undoMove.setMove({ issueIds, head: null })`, PATCHes through `patcher.patch(ops, next, onSaved)`, and scrolls the **selected** card into view in a rAF. `saveSceneField(sceneId, 'act', n)` routes to `applyMove({ type: 'act' … })` (the Act select and the empty-act drop).
- **Act select** (`panel/ScenePanel.tsx`, `id="plan-act-select"`): `disabled={locked || pending}` — in Chromium the focused select is blurred to `<body>` when it becomes disabled for the save.
- `useCollapsedActs(projectId).expand(act)` opens and persists; `selectScene` already calls it. `actLabel(act, format)` → "COLD OPEN", "ACT ONE"…; `actNumbersForBoard(format, scenes)` = the format's acts ∪ acts present (empty acts included).
- `story.ts` imports from `planTree.ts`; `planTree.ts` imports nothing from `story.ts` (keep it that way — move `boardOrder` into `planTree.ts` and re-export it from `story.ts`).
- e2e state when the appended `plan.spec.ts` tests run (after the existing ones, all re-traced under insert semantics): act 0 `[scene-1]` · act 1 `[scene-2, scene-4, scene-3]` · act 2 empty · act 3 `[scene-5]` · act 4 `[scene-6]` (**locked** by the lock test); numbers 1–6 in that board order.

## Defaults this plan takes (product calls the spec leaves open)

Built as written unless the owner says otherwise; the real product questions are also returned as decisions.

1. **Drop side by the pointer's half** (left half = before, right half = after), not always-before. The mockup is silent (it still swaps); halves is the only rule that reaches every slot by drag — always-before can never put a card after the last card of a non-empty act.
2. **`index` = board position after every move** (0…N-1), so card numbers, "Scene n of N", Ledger numbers and Write's scene numbers agree with the board. A move renumbers the scenes it passes. A project whose indices are not already in board order (e.g. after Phase 3's act-only changes) is normalised by its first move; if that would shift a locked scene, the move is refused with the usual reason until the writer unlocks it.
3. **The Act select and an empty-act drop are inserts at the chosen act's nearest edge** — the start of a later act, the end of an earlier one — which is where an act-only change landed before, now with numbers renumbered. Moving past a locked scene this way is refused like a drag.
4. **⌥← / ⌥→**: within an act, swap places with the neighbour; at an act's edge, step into the previous/next board act **in place** (only `act` changes; empty acts are steps too). At the first/last act's edge it does nothing. Nothing happens while a write is in flight.
5. **A locked card takes a drop that leaves it in place** (e.g. inserting just before it from the left). The spec's §4.11 "not a drop target" was written for swap, where a locked target always moved; the builder is the single authority.
6. **Wording:** sky drop tape "Move n here" (n = the dragged card's number; the coral bar shows the side); amber "Can't move past scene n: it's locked" (n = the first locked scene in board order the move would shift) or "Can't move scene n: it's locked" (the moved scene itself). Refusals from the keyboard or the Act select show as a `danger` Toast and in `plan-live`; a refused drag shows on the target and never drops. Every applied move announces "Moved to ACT TWO, scene 4 of 6." (+ " n new order problem(s).").
7. The insert tape may wrap to two lines (`line-clamp-2` instead of `truncate`), so the refusal reads whole on a 150px card.

## File Structure

`src/` = `apps/web/src/`.

| File | Status | Task | Responsibility |
|---|---|---|---|
| `apps/api/drama_manager/locks.py` | modify | 1 | A locked scene's own `index` is frozen (one check + docstrings) |
| `apps/api/routes.py` | modify | 1 | `patch_project` docstring wording only |
| `apps/api/tests/test_patch_locks.py` | modify | 1 | Route lock-violation tests; multi-op one-snapshot + atomicity |
| `apps/api/tests/test_locks.py` | modify | 1 | Guard unit tests |
| `src/plan/planTree.ts` (+ `.test.ts`) | modify | 1 (tests), 2 | `SceneMove` (insert/act/step), `AppliedMove`, `applySceneMove`, `boardOrder`; swap builders removed |
| `src/plan/story.ts` (+ `.test.ts`) | modify | 2 | `MovePrediction`, `predictMove`, `lockedMoveText`; re-export `boardOrder` |
| `src/api/client.ts` | modify | 2 | `JsonPatchOp` doc comment wording only |
| `src/plan/Board.tsx` (+ `.test.tsx`) | modify | 3 | Drop side, insertion bar, refusal on target, `onMove`, ⌥←/⌥→ |
| `src/plan/BoardCard.tsx` (+ `.test.tsx`) | modify | 3 | Pointer half, `insert` bar, Board-decided dragover/drop, two-line tape |
| `src/plan/panel/ScenePanel.tsx` (+ `.test.tsx`) | modify | 4 | Act select stays focusable while pending |
| `src/plan/PlanScreen.tsx` (+ `.test.tsx`) | modify | 5 | `applyMove` (refusal toast, expand, focus, announce), `onMove` wiring |
| `apps/web/e2e/plan.spec.ts` | modify | 5 | Updated drag/T3.7 tests; new insert, keyboard, lock-refusal, focus/collapse tests |
| `docs/tableread-ui-spec.md`, `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md`, `docs/tableread-data-contract.md` | modify | 6 | Per-PR docs |

Untouched: `useUndoMove.ts`, `useProjectPatch.ts`, `NotesStrip.tsx`, `EpisodeChart.tsx`, `ActHeader.tsx`, `usePlanKeys.ts` (it already ignores `altKey`), `storage/patching.py`, `schemas.py`, `packages/contract`, `config/tool_schemas/`, `tokens.css`.

Out of scope (noticed, not fixed here): `LockToggle` is also `disabled={pending}` and so drops focus to `<body>` during its own save — same cure as Task 4, separate change.

## PR boundary and order

One PR, **T3.8 Insert reorder**, on `feat/plan-insert` (this worktree, cut from `main`).

```
1 (lock tests + server guard) ─► 2 (move model) ─► 3 (Board, BoardCard) ─┐
4 (ScenePanel Act select focus) ─────────────────────────────────────────┼─► 5 (PlanScreen + e2e)
6 (docs) — independent, any time                                          │
```

- Tasks 1→2→3→5 are sequential (shared types/files). Task 4 and Task 6 run in parallel with anything (disjoint files).
- **Expected transient red:** after Task 2, `npx tsc -b` fails only in `Board.tsx`, `Board.test.tsx`, `PlanScreen.tsx` (they still build `swap` moves / read `OrderIssue[]` predictions) and `PlanScreen.test.tsx`'s drag tests fail at runtime; after Task 3, only `PlanScreen.tsx`/`PlanScreen.test.tsx`. Task 5 makes everything green. Each of Tasks 2–3 runs only its own test files plus `tsc -b`, and checks that the errors are confined to those files.
- Every file has exactly one owning task (`planTree.test.ts`: Task 1 adds the lock tests, Task 2 owns the rest — sequential).

---

### Task 1: Lock-violation tests first, then the server guard

**Files:** `apps/api/tests/test_patch_locks.py`, `apps/api/tests/test_locks.py`, `src/plan/planTree.test.ts` (lock tests only), `apps/api/drama_manager/locks.py`, `apps/api/routes.py` (docstring).

**Interfaces:** none new. `locks.assert_no_locked_writes(old_doc, new_doc)` additionally raises `LockViolation(f"cannot move locked scene {scene_id!r}")` when a scene locked in `old_doc` (own `locked` or its episode's) has a different `index` in `new_doc`.

- [ ] **Step 1 — server lock-violation tests (`test_patch_locks.py`, in the "rejected" block).** Add pointers `SCENE_2 = "/seasons/0/episodes/0/scenes/1"`, `EPISODE = "/seasons/0/episodes/0"`.

```python
def test_patch_shifting_a_locked_scene_index_is_rejected_without_snapshot(
    seeded_project, db_session
):
    # Insert scene-2 after scene-3: locked scene-3 would shift from index 2 to 1.
    lock = _patch([{"op": "replace", "path": f"{SCENE_3}/locked", "value": True}])
    assert lock.status_code == 200
    before = client.get(f"/api/v1/projects/{PROJECT_ID}").json()
    snaps = _snap_count(db_session)

    resp = _patch(
        [
            {"op": "replace", "path": f"{SCENE_2}/index", "value": 2},
            {"op": "replace", "path": f"{SCENE_3}/index", "value": 1},
        ]
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert client.get(f"/api/v1/projects/{PROJECT_ID}").json() == before
    assert _snap_count(db_session) == snaps


def test_patch_shifting_a_scene_index_in_a_locked_episode_is_rejected(
    seeded_project, db_session
):
    lock = _patch([{"op": "replace", "path": f"{EPISODE}/locked", "value": True}])
    assert lock.status_code == 200
    snaps = _snap_count(db_session)

    resp = _patch(
        [
            {"op": "replace", "path": f"{SCENE_1}/index", "value": 1},
            {"op": "replace", "path": f"{SCENE_2}/index", "value": 0},
        ]
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _snap_count(db_session) == snaps
```

- [ ] **Step 2 — guard unit tests (`test_locks.py`, beside the `no_locked_writes` tests; use `_doc()` and `pytest.raises(locks.LockViolation, match="scene-3")`):**
  - `test_no_locked_writes_rejects_moving_a_locked_scene_index` — scene-3 `locked`; new doc swaps scene-2/scene-3 `index` → raises, message names `scene-3`.
  - `test_no_locked_writes_rejects_moving_a_scene_index_in_a_locked_episode` — episode `locked`; scene-1/scene-2 swap `index` → raises.
  - `test_no_locked_writes_allows_reindexing_unlocked_scenes_beside_a_locked_one` — scene-3 `locked`; scene-1/scene-2 swap `index` → no raise (guards against an over-broad fix; passes today, keep it).

- [ ] **Step 3 — client lock-violation tests (`planTree.test.ts`, new `describe('applySceneMove refuses moves that shift a locked scene (rule 2)')`, using the file's `project(fixtureLikeScenes())` — acts 0,1,1,2,3,4, indices 0…5):**

```ts
describe('applySceneMove refuses moves that shift a locked scene (rule 2)', () => {
  const locked = (...ids: string[]) =>
    fixtureLikeScenes().map((s) => ({ ...s, locked: ids.includes(s.id) }))

  it('refuses an insert that would shift a locked scene: blockedBy, no ops', () => {
    // scene-2 after scene-4: locked scene-3 would move from index 2 to 1.
    const p = project(locked('scene-3'))
    expect(
      applySceneMove(p, {
        type: 'insert',
        sceneId: 'scene-2',
        targetSceneId: 'scene-4',
        after: true,
      }),
    ).toEqual({ blockedBy: 'scene-3' })
  })

  it('refuses an Act move past a locked scene', () => {
    // scene-2 (act 1) to the start of act 3 passes locked scene-4 (act 2).
    const p = project(locked('scene-4'))
    expect(
      applySceneMove(p, { type: 'act', sceneId: 'scene-2', act: 3 }),
    ).toEqual({ blockedBy: 'scene-4' })
  })

  it('refuses moving a locked scene, and any move in a locked episode', () => {
    expect(
      applySceneMove(project(locked('scene-3')), {
        type: 'step',
        sceneId: 'scene-3',
        dir: -1,
      }),
    ).toEqual({ blockedBy: 'scene-3' })
    const p = project(fixtureLikeScenes())
    p.seasons[0].episodes[0].locked = true
    expect(
      applySceneMove(p, { type: 'act', sceneId: 'scene-5', act: 4 }),
    ).toEqual({ blockedBy: 'scene-5' })
  })
})
```

(If `project()` builds the episode inline, set `locked` on `p.seasons[0].episodes[0]` as shown.) These fail today for the right reason: the old `applySceneMove` treats every non-`swap` move as an act change and returns ops.

- [ ] **Step 4 — run and see them fail for the right reason.** API: `pytest … tests/test_patch_locks.py tests/test_locks.py` → the two route tests get 200 instead of 409, the two rejecting unit tests don't raise; the "allows" unit test passes. Web: `npx vitest run src/plan/planTree.test.ts` → the three new tests fail with an `{ ops, next }` vs `{ blockedBy }` diff (type errors in these tests are expected until Task 2; vitest does not typecheck).
- [ ] **Step 5 — commit the tests:** `plan: add lock-violation tests for insert reorder`
- [ ] **Step 6 — the guard.** In `assert_no_locked_writes`'s scene loop, right after the content-projection check:

```python
        if after.get("index") != scene.get("index"):
            raise LockViolation(f"cannot move locked scene {scene['id']!r}")
```

  Docstrings: in the module header replace "Locked-scene drag-among-scenes (scene `index` among episode siblings) stays allowed server-side for MVP." with "A locked scene's own `index` is frozen too (T3.8): a reorder may not shift a locked scene, or any scene of a locked episode." Reword the `_EXEMPT_ON_LOCKED` comment so `index` is exempt only for beats (scenes check it explicitly). `routes.patch_project`: "Unlocking and reindexing stay allowed" → "Unlocking, and reindexing beats in an unlocked scene, stay allowed".
- [ ] **Step 7 — the applier check (feature, after the lock tests; passes on arrival).** In `test_patch_locks.py` "allowed" block:
  - `test_one_patch_of_index_replaces_and_an_act_is_one_snapshot` — insert scene-4 before scene-2: ops `[{SCENE_4}/index 1, {SCENE_4}/act 1, {SCENE_2}/index 2, {SCENE_3}/index 3]` (`SCENE_4 = …/scenes/3`) → 200; `_snap_count` + 1; scenes sorted by `(act, index)` → `['scene-1','scene-4','scene-2','scene-3','scene-5','scene-6']`; array order unchanged.
  - `test_a_multi_op_patch_with_a_bad_op_changes_nothing` — `[{SCENE_2}/index 5, replace "/seasons/0/episodes/0/scenes/99/index"]` → 400 `VALIDATION`; doc byte-identical; no new snapshot.
- [ ] **Step 8 — run:** `pytest … tests/test_patch_locks.py tests/test_locks.py tests/test_patching.py tests/test_change_sets_apply_locks.py tests/test_scene_skeleton_apply_locks.py tests/test_accept_locks.py` green; then the full API suite `pytest … tests` (MockLlmClient only); `ruff check apps/api`; `scripts/check_contract.py` green.
- [ ] **Step 9 — commits:** `locks: refuse a PATCH that shifts a locked scene` then `api: pin multi-op index PATCH as one snapshot`

---

### Task 2: The insert move model (`planTree.ts`, `story.ts`)

**Files:** `src/plan/planTree.ts`, `src/plan/planTree.test.ts`, `src/plan/story.ts`, `src/plan/story.test.ts`, `src/api/client.ts` (comment).
**Depends on:** Task 1.

**Interfaces (`planTree.ts`):**

```ts
export type SceneMove =
  /** A drop on a card: before it (left half) or after it (right half); the
   * scene takes the target's act. */
  | { type: 'insert'; sceneId: string; targetSceneId: string; after: boolean }
  /** The Act select or a drop on an empty act: the chosen act's nearest
   * edge — the start of a later act, the end of an earlier one. */
  | { type: 'act'; sceneId: string; act: number }
  /** ⌥← / ⌥→: one slot in board order; at an act's edge, into the
   * previous / next board act in place (empty acts too). */
  | { type: 'step'; sceneId: string; dir: 1 | -1 }

/** A move's one PATCH and its optimistic twin, or the locked scene that
 * refuses it (owner decision #2: nothing may shift a locked scene). */
export type AppliedMove =
  | { ops: JsonPatchOp[]; next: Project }
  | { blockedBy: string }

/** Board order: act, then index (Board's frames). Moved here from story.ts. */
export function boardOrder(scenes: readonly Scene[]): Scene[]

/** null when nothing would move (unknown scene or target, a drop beside
 * itself, the scene's own act, a step off the first / last act). */
export function applySceneMove(project: Project, move: SceneMove): AppliedMove | null
```

Removed: `buildSceneSwapPatch`, `swapScenesLocally` and their tests (nothing else uses them).

**Interfaces (`story.ts`):**

```ts
export { boardOrder } from './planTree' // existing importers keep working

/** What a move would do: null when nothing would move, the locked scene in
 * the way, or the order problems it would add — on applySceneMove's own
 * result, so it always matches the save. */
export type MovePrediction = { blockedBy: string } | { issues: OrderIssue[] } | null
export function predictMove(project: Project, move: SceneMove): MovePrediction

/** "Can't move past scene n: it's locked", or "Can't move scene n: it's
 * locked" when the locked scene is the one being moved; n = today's number. */
export function lockedMoveText(model: BoardModel, sceneId: string, blockedBy: string): string
```

- [ ] **Step 1 — feature tests in `planTree.test.ts`** (replace the swap `describe`s and the old `applySceneMove` block; keep Task 1's lock block). Use `fixtureLikeScenes()` (acts 0,1,1,2,3,4). Assert exact ops in **array order**, index before act within a scene:
  - "an insert renumbers to board position and sends only what changed" — scene-5 before scene-2 (`after: false`) → ops `scenes/1/index 2`, `scenes/2/index 3`, `scenes/3/index 4`, `scenes/4/index 1`, `scenes/4/act 1`; `boardOrder(next…scenes).map(id)` = `[1,5,2,3,4,6]`; scenes array order unchanged; unchanged scenes are the same objects (`toBe`).
  - "an insert after a card takes its act; the right half of an act's last card ends that act" — scene-5 after scene-3 → scene-5 `{index 3, act 1}`, scene-4 `{index 4}`; scene-2 after scene-1 → scene-2 moves into act 0 (`act` op only).
  - "a drop beside itself, on itself, or on an unknown card is null" — scene-2 before scene-3 → `null`; scene-3 after scene-2 → `null`; target itself / `scene-nope` → `null`.
  - "an Act move lands on the nearest edge: the start of a later act, the end of an earlier one" — scene-5 → act 0 → order `[1,5,2,3,4,6]` (ops as above with `act 0`); scene-2 → act 3 → order `[1,3,4,2,5,6]`, scene-2 `act 3`; scene-5 → act 2 (the end of an earlier act right before it) → only `scenes/4/act 2`; own act → `null`; unknown scene → `null`.
  - "an empty act takes the scene in place when nothing lies between" — scenes with act 2 empty (`act` of scene-4 set to 3): scene-3 → act 2 → only an `act` op.
  - "a step passes one neighbour, and at an act's edge crosses into the next act in place" — scene-3 `dir -1` → ops `scenes/1/index 2`, `scenes/2/index 1`; scene-3 `dir 1` (last of act 1) → only `scenes/2/act 2`; with act 2 empty, scene-3 `dir 1` → `act 2`, then from there `dir 1` → `act 3` (in place), and only the next step passes a scene.
  - "a step off the first or last act is null" — scene-1 `dir -1`, scene-6 `dir 1` → `null`.
  - "a move that leaves a locked scene in place is allowed" — scene-6 locked: scene-5 `dir 1` → only `scenes/4/act 4`; scene-3 locked: scene-1 before scene-3 → allowed (scene-3 keeps index 2).
  - "indices out of board order are renumbered by the first move" — scenes `{s1 0 a0, s2 1 a3, s3 2 a1, s4 3 a2, s5 4 a3}` (board: s1 s3 s4 s2 s5): scene-4 before scene-3 → s4 `index 1`, s3 `index 2` (unchanged → no op), s2 `index 3`; documents Defaults 2.
- [ ] **Step 2 — `applySceneMove`** (the tricky part; write it as below, keep `scenePointerPath`, `findScenePointer`, `actNumbersForBoard` as they are):

```ts
export function applySceneMove(
  project: Project,
  move: SceneMove,
): AppliedMove | null {
  const ptr = findScenePointer(project, move.sceneId)
  if (!ptr) return null
  const episode = project.seasons[ptr.seasonIdx].episodes[ptr.episodeIdx]
  const order = boardOrder(episode.scenes)
  const at = order.findIndex((s) => s.id === move.sceneId)
  const scene = order[at]
  const rest = order.filter((s) => s !== scene)
  let act = scene.act
  let to = at // the scene's slot in `rest`
  if (move.type === 'insert') {
    const t = rest.findIndex((s) => s.id === move.targetSceneId)
    if (t < 0) return null
    act = rest[t].act
    to = t + (move.after ? 1 : 0)
  } else if (move.type === 'act') {
    if (move.act === scene.act) return null
    act = move.act
    const edge = rest.findIndex((s) =>
      act > scene.act ? s.act >= act : s.act > act,
    )
    to = edge < 0 ? rest.length : edge
  } else if (order[at + move.dir]?.act === scene.act) {
    to = at + move.dir // pass one neighbour
  } else {
    const acts = actNumbersForBoard(project.format, episode.scenes)
    const next = acts[acts.indexOf(scene.act) + move.dir]
    if (next === undefined) return null
    act = next // cross the act break in place
  }
  const placed = [...rest.slice(0, to), { ...scene, act }, ...rest.slice(to)]
  // index = board position, so card numbers follow the board.
  const was = new Map(episode.scenes.map((s) => [s.id, s]))
  const changes = new Map<string, Partial<Pick<Scene, 'index' | 'act'>>>()
  placed.forEach((s, index) => {
    const old = was.get(s.id)!
    const fields: Partial<Pick<Scene, 'index' | 'act'>> = {}
    if (old.index !== index) fields.index = index
    if (old.act !== s.act) fields.act = s.act
    if (Object.keys(fields).length > 0) changes.set(s.id, fields)
  })
  if (changes.size === 0) return null
  const locked = (s: Scene) => episode.locked || s.locked
  if (locked(scene)) return { blockedBy: scene.id }
  const blocker = placed.find((s) => changes.has(s.id) && locked(s))
  if (blocker) return { blockedBy: blocker.id }
  const ops: JsonPatchOp[] = episode.scenes.flatMap((s, sceneIdx) =>
    Object.entries(changes.get(s.id) ?? {}).map(([field, value]) => ({
      op: 'replace' as const,
      path: scenePointerPath({ ...ptr, sceneIdx }, field),
      value,
    })),
  )
  const next: Project = {
    ...project,
    seasons: project.seasons.map((season, si) =>
      si !== ptr.seasonIdx
        ? season
        : {
            ...season,
            episodes: season.episodes.map((ep, ei) =>
              ei !== ptr.episodeIdx
                ? ep
                : {
                    ...ep,
                    scenes: ep.scenes.map((s) => {
                      const c = changes.get(s.id)
                      return c ? { ...s, ...c } : s
                    }),
                  },
            ),
          },
    ),
  }
  return { ops, next }
}
```

  If eslint rejects the `!` on `was.get(s.id)!`, use `?? s`. Update `planTree.ts`'s header comment for the swap rationale to describe the insert (no `move` op on the server; reorders are `replace`s).
- [ ] **Step 3 — `story.ts`:** import `boardOrder` from `./planTree` and re-export it (delete the local definition); `predictMove` returns `applied` unchanged when it is `null` or `{ blockedBy }`, else `{ issues: newOrderIssues(orderIssues(before), orderIssues(after)) }` (keep the existing `episodeOf` helper); add `lockedMoveText` (uses the existing `cardNumber`). Strings exactly: `` `Can't move past scene ${n}: it's locked` `` / `` `Can't move scene ${n}: it's locked` `` (straight apostrophes, like the old "Locked — can't swap").
- [ ] **Step 4 — `story.test.ts`:** rewrite the `predictMove` describe:
  - "predictMove equals the new problems of the saved insert" — for several moves (insert before/after, act, step) on a project with a thread (setup scene-2 → payoff scene-5), `predictMove(p, move)` `toEqual({ issues: newOrderIssues(orderIssues(ep), orderIssues(applied.next ep)) })`; scene-5 before scene-2 yields one `payoff_first`.
  - "predictMove is null when nothing would move and blockedBy when a locked scene is in the way".
  - Update the existing act-change prediction test (`~line 1680`) to read `.issues`.
  - "lockedMoveText names the scene in the way, or the scene itself" — both sentences with today's numbers.
  - `boardOrder` tests keep importing from `./story` (re-export).
- [ ] **Step 5 — `api/client.ts`:** the `JsonPatchOp` comment says "(an index/act swap, not an array move) is expressed as two or three `replace` ops" → "(index/act `replace`s for the scenes a move shifts, never an array `move`)".
- [ ] **Step 6 — run:** `npx vitest run src/plan/planTree.test.ts src/plan/story.test.ts` green (Task 1's lock tests now pass); `npx tsc -b` — errors only in `Board.tsx`, `Board.test.tsx`, `PlanScreen.tsx` (expected; Tasks 3 and 5); eslint + prettier on the touched files.
- [ ] **Step 7 — commit:** `plan: build every board move as an insert with renumbered indexes`

---

### Task 3: Board — drop side, insertion bar, refusal on the target, ⌥←/⌥→

**Files:** `src/plan/Board.tsx`, `src/plan/Board.test.tsx`, `src/plan/BoardCard.tsx`, `src/plan/BoardCard.test.tsx`.
**Depends on:** Task 2.

**Interfaces:**

```ts
// Board.tsx — BoardProps changes
/** Every board move: a drop on a card or an empty act, ⌥← / ⌥→. Replaces
 * onReorder and onMoveToAct. */
onMove: (move: SceneMove) => void
/** story.predictMove on the project: the drop target's tape, bar and
 * whether it takes the drop. Default: every move allowed, no problems. */
predict?: (move: SceneMove) => MovePrediction

// BoardCard.tsx — BoardCardProps changes
/** A valid insert lands on this side of the card: the coral bar. */
insert?: 'before' | 'after' | null
/** Dragged over, with the pointer on the right half (`after`) or the left;
 * returns whether the card takes the drop (Board's call). */
onDragOver: (after: boolean) => boolean
onDrop: (after: boolean) => void
```

- [ ] **Step 1 — lock test first (`Board.test.tsx`):** "over a target whose insert would shift a locked scene: the amber reason, no bar, and the drop is refused" — `predict = vi.fn(() => ({ blockedBy: 'scene-3' }))`; dragStart scene-2, dragOver scene-4 → `fireEvent.dragOver` returns `true` (not prevented); tape text `"Can't move past scene 3: it's locked"`, `bg-tr-amber`, card `ring-tr-amber`; no `[data-insert-bar]` anywhere. Same for an empty act: its box reads the reason (`text-tr-amber`), frame `inset-ring-tr-amber`, dragOver not prevented. Run → fails for the right reason (the old Board reads the prediction as `OrderIssue[]` and tapes "Swap with 2"). Commit it alone: `plan: add board lock-refusal test for insert drops`.
- [ ] **Step 2 — feature tests (`Board.test.tsx`; rewrite the swap ones).** jsdom rects are all zero, so `clientX: 0` reads as the left half and any positive `clientX` as the right half; `fireEvent.dragOver` drops `clientX` in jsdom (no `DragEvent`), so use:

```ts
function dragOverAt(el: HTMLElement, clientX: number) {
  const event = createEvent.dragOver(el, { dataTransfer: dt() })
  Object.defineProperty(event, 'clientX', { value: clientX })
  return fireEvent(el, event)
}
```

  - "over a card's left half: the coral bar before it and the insert's prediction" — `predict` called with `{ type: 'insert', sceneId: 'scene-5', targetSceneId: 'scene-1', after: false }`; `[data-insert-bar][data-side="before"]` inside scene-1 with `bg-tr-coral`; tape = `predictionTape(m, [PAYS_OFF_FIRST]).text`, amber ring; dragOver prevented (returns `false`).
  - "over a card's right half: the coral bar after it and the insert's prediction" — `after: true`, `data-side="after"`; with `predict: () => ({ issues: [] })` the tape is sky `Move 5 here` and the card's accessible name contains it.
  - "a drop beside itself shows nothing and is refused" — `predict: () => null` → no tape, no ring, no bar, not prevented.
  - "a locked card takes a drop that leaves it in place" — scene-3 locked, `predict: () => ({ issues: [] })` → dragOver prevented, bar shown; drop calls `onMove` once with the insert.
  - "a drop calls onMove with the insert on the pointer's side" — drop at `clientX 1` → `onMove({ type: 'insert', …, after: true })`; tape/bar cleared after drop and after dragEnd/dragLeave (keep today's clear-down asserts).
  - "an empty act takes a drop as an act move" — `onMove({ type: 'act', sceneId: 'scene-1', act: 4 })`; keep "Move scene n here" and the prediction-on-empty-act asserts with `{ issues }`.
  - "⌥← / ⌥→ ask for a step; never while pending; plain arrows still select" — `keyDown(card, { key: 'ArrowRight', altKey: true })` → `onMove({ type: 'step', sceneId, dir: 1 })`, default prevented; `ArrowLeft` → `dir: -1`; with `pending` → no call (still prevented); ⌘/Ctrl+⌥ → nothing; a locked card still calls `onMove` (PlanScreen says why); `onSelectScene` not called by ⌥ keys.
  - Keep "a dragover without a drag from this board changes nothing" and "the drop tape replaces the relation and highlight tapes" (expect `Move 5 here`).
  - `BoardCard.test.tsx`: "the insert bar renders on the given side" (`insert: 'before' | 'after'`, `aria-hidden`); "dragover reports the pointer's half and prevents default only when onDragOver says yes" (stub `getBoundingClientRect` → `{ left: 0, width: 150 }`; `clientX 140` → `onDragOver(true)`); "a locked card reports dragover too (Board decides)"; "a two-line tape" (`line-clamp-2`, no `truncate`). Replace the `"Locked — can't swap"` / `'Swap with 5'` fixtures with the new strings.
- [ ] **Step 3 — `BoardCard.tsx`:**

```ts
/** The right half of the card inserts after it. */
function pointerAfter(event: DragEvent<HTMLElement>): boolean {
  const r = event.currentTarget.getBoundingClientRect()
  return event.clientX > r.left + r.width / 2
}

function handleDragOver(event: DragEvent<HTMLDivElement>) {
  if (onDragOver(pointerAfter(event))) event.preventDefault()
}

function handleDrop(event: DragEvent<HTMLDivElement>) {
  event.preventDefault()
  onDrop(pointerAfter(event))
}
```

  `locked` keeps gating `draggable` only. The bar, inside the card root (it is `relative`): `{insert && <span aria-hidden="true" data-insert-bar data-side={insert} className={`absolute inset-y-0 w-[3px] rounded-full bg-tr-coral ${insert === 'before' ? '-left-[7.5px]' : '-right-[7.5px]'}`} />}` (centred in the 12px `gap-x-3`). Tape: `line-clamp-2` instead of `truncate` (keep `max-w-[134px]`). Update the component doc comment (no more "Locked — can't swap").
- [ ] **Step 4 — `Board.tsx`:** replace `onReorder`/`onMoveToAct` with `onMove`; `NO_PREDICTION = (): MovePrediction => ({ issues: [] })`; add `dropAfter` state beside `dropTargetId`. Core of the card wiring:

```ts
const allowed = (p: MovePrediction) => p !== null && !('blockedBy' in p)
/** The insert a drop here would make; null with no drag or over itself. */
const insertAt = (id: string, after: boolean): SceneMove | null =>
  dragged && id !== dragged.scene.id
    ? { type: 'insert', sceneId: dragged.scene.id, targetSceneId: id, after }
    : null
const overMove = dropTargetId ? insertAt(dropTargetId, dropAfter) : null
const prediction = overMove ? predict(overMove) : null
function dropTape(from: SceneSignals, p: NonNullable<MovePrediction>): CardTape {
  if ('blockedBy' in p)
    return { text: lockedMoveText(model, from.scene.id, p.blockedBy), tone: 'amber' }
  return predictionTape(model, p.issues) ?? { text: `Move ${from.number} here`, tone: 'sky' }
}
// per card:
const over = id === dropTargetId && prediction !== null
//   tape={over && dragged ? dropTape(dragged, prediction) : (relation ?? match)}
//   dropTarget={over}
//   insert={over && allowed(prediction) ? (dropAfter ? 'after' : 'before') : null}
//   onDragOver={(after) => {
//     const move = insertAt(id, after)
//     if (!move) return false
//     setDropTargetId(id)
//     setDropAfter(after)
//     return allowed(predict(move))
//   }}
//   onDrop={(after) => { const move = insertAt(id, after); if (move) onMove(move); clearDrag() }}
```

  Empty act: the prediction is `predict({ type: 'act', sceneId, act })`; its text is the refusal (amber), else `predictionTape`, else `Move scene n here`; `onDragOver` calls `e.preventDefault()` only when `allowed(…)`; `onDrop` → `onMove({ type: 'act', … })`. Frame ring amber when refused or problems, else sky.
  `handleKey`, before the existing modifier bail-out:

```ts
if (
  event.altKey &&
  !event.metaKey &&
  !event.ctrlKey &&
  (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
) {
  event.preventDefault()
  if (!pending)
    onMove({ type: 'step', sceneId: id, dir: event.key === 'ArrowRight' ? 1 : -1 })
  return
}
```

  Delete the "⌥←/→ is Phase 4's insert move" comment; update the component doc comment (drag inserts; a locked card never drags and takes a drop only when the insert leaves it in place).
- [ ] **Step 5 — run:** `npx vitest run src/plan/Board.test.tsx src/plan/BoardCard.test.tsx` green; `npx tsc -b` — errors only in `PlanScreen.tsx` (Task 5); eslint + prettier on the four files.
- [ ] **Step 6 — commit:** `plan: insert where a card is dropped, with ⌥←/⌥→ to step`

---

### Task 4: The Act select keeps focus through its save

**Files:** `src/plan/panel/ScenePanel.tsx`, `src/plan/panel/ScenePanel.test.tsx`.
**Depends on:** nothing (parallel with Tasks 1–3).

**Interface:** unchanged props. The select becomes `disabled={locked}`, `aria-disabled={pending || undefined}`, and `onChange` returns early while `pending` (React restores the controlled `value`). Add `aria-disabled:opacity-50` beside `disabled:opacity-50`.

- [ ] **Step 1 — tests (`ScenePanel.test.tsx`):** replace "Act select and the lock switch are disabled while a patch is pending" with:
  - "the Act select stays focusable while its save is pending and ignores a second change" — `renderPanel({ pending: true })`: select `.disabled === false`, `aria-disabled="true"`; `select.focus()` then `fireEvent.change(select, { target: { value: '3' } })` → `onSaveSceneField` not called, `document.activeElement === select`, value still the scene's act.
  - "the lock switch is disabled while a patch is pending" (unchanged assert for the toggle).
  - Keep the locked-scene and locked-episode tests (`disabled` true).
- [ ] **Step 2 — implement** (three attributes + one guard line). Add a one-line comment: "Disabled would blur the focused select to <body> for the save; aria-disabled keeps it."
- [ ] **Step 3 — run:** `npx vitest run src/plan/panel/ScenePanel.test.tsx`; eslint + prettier.
- [ ] **Step 4 — commit:** `plan: keep the Act select focused while its move saves`

---

### Task 5: Wire moves in PlanScreen; e2e

**Files:** `src/plan/PlanScreen.tsx`, `src/plan/PlanScreen.test.tsx`, `apps/web/e2e/plan.spec.ts`.
**Depends on:** Tasks 3 and 4.

**Interfaces:** `PlanScreen` passes `onMove={(move) => void applyMove(move)}` and `predict={(move) => predictMove(project, move)}` to `Board`; new state `const [moveRefusal, setMoveRefusal] = useState<string | null>(null)` rendered as `<Toast tone="danger" onDismiss={() => setMoveRefusal(null)}>{moveRefusal}</Toast>` beside the other toasts.

- [ ] **Step 1 — lock tests first (`PlanScreen.test.tsx`, in the T3.7 describe):**
  - "a drop that would shift a locked scene sends no PATCH and says why (rule 2)" — `orderProject()` with scene-3 `locked`; `dragStart` scene-5, `drop` on scene-1 (jsdom: left half → before) → `patchProjectMock` not called; the toast and `plan-live` read `Can't move past scene 3: it's locked`; the board order is unchanged.
  - "⌥→ on a locked card sends no PATCH and says why" — scene-2 locked; `keyDown(card('scene-2'), { key: 'ArrowRight', altKey: true })` → no PATCH; toast `Can't move scene 2: it's locked`.
  Run → fail (PlanScreen does not pass `onMove` yet, so no refusal is shown and nothing says why); commit: `plan: add PlanScreen lock-refusal tests for moves`.
- [ ] **Step 2 — feature tests.** Update the T3.7 helpers: the server reply `moved(p)` becomes `{ project: { …(applySceneMove(p, { type: 'act', sceneId: 'scene-5', act: 0 }) as { next: Project }).next, headSnapshotId: head }, consistencyFlags: [] }`; `NOTE` becomes `'Pays off “The spare key” before its setup in scene 3.'` (scene-2 is now number 3); the live text `'Moved to COLD OPEN, scene 2 of 5. 1 new order problem.'`; "an act change sends one PATCH…" expects the ops `scenes/1/index 2`, `scenes/2/index 3`, `scenes/3/index 4`, `scenes/4/index 1`, `scenes/4/act 0`. "an empty-act drop sends one act PATCH and nothing else" expects the builder's ops for scene-1 → act 4 (compute by hand from `project()`'s two scenes; still exactly one call). New:
  - "a drop inserts before the card: one PATCH, and Undo the move restores the order" — `orderProject()`; scene-5 dropped on scene-2 → one `patchProject` call with `scenes/1/index 2, scenes/2/index 3, scenes/3/index 4, scenes/4/index 1, scenes/4/act 1` and `If-Match` `snap-root`; act-frame-1 order `[scene-5, scene-2, scene-3]`; after the save resolves, **Undo the move** → `undoProjectMock` with `{ expectedHeadSnapshotId: 'snap-moved' }`; resolving it with the original project restores act-frame-1 to `[scene-2, scene-3]` and `plan-live` says `Move undone.`
  (Keyboard tests: focus the card first — `card.focus()` or a `user.click` — since `applyMove` keeps focus only on a card that had it.)
  - "⌥→ moves the focused card one slot and keeps focus on it" — focus scene-2 (first of act 1), Alt+ArrowRight → ops `scenes/1/index 2, scenes/2/index 1`; `await waitFor(() => expect(document.activeElement).toBe(card('scene-2')))`; `plan-live` `Moved to ACT ONE, scene 3 of 5.`
  - "a move into a collapsed act opens it and scrolls the card into view" — click `Hide ACT TWO`, select scene-3 (last of act 1), Alt+ArrowRight → one PATCH with only `scenes/2/act 2`; act-frame-2 shows scene-3 and its chevron reads `Hide ACT TWO` (`aria-expanded="true"`); `scrollIntoView` was called on scene-3's card; scene-3 focused. Same for the Act select into a collapsed act (focus stays on the select).
  - "a refusal toast clears on the next move".
- [ ] **Step 3 — `applyMove` (replace the current one):**

```ts
  /** A drop, an Act change or ⌥←/⌥→: one PATCH, one snapshot (rule 4). A
   * move that would shift a locked scene sends nothing and says why. Its new
   * problems show at once from the optimistic doc; Undo the move is offered
   * once the server has made this move the head. */
  function applyMove(move: SceneMove): Promise<boolean> {
    if (!project || !model) return Promise.resolve(false)
    const applied = applySceneMove(project, move)
    if (!applied) return Promise.resolve(false)
    if ('blockedBy' in applied) {
      const text = lockedMoveText(model, move.sceneId, applied.blockedBy)
      setMoveRefusal(text)
      announce(text)
      return Promise.resolve(false)
    }
    const moved = findScene(applied.next, move.sceneId)
    if (!moved) return Promise.resolve(false)
    setMoveRefusal(null)
    const fresh = newOrderIssues(
      model.issues,
      orderIssues(applied.next.seasons[0].episodes[0]),
    )
    // A move into a collapsed act opens it, as selecting into one does.
    acts.expand(moved.act)
    announce(
      [
        `Moved to ${actLabel(moved.act, project.format)}, scene ${moved.index + 1} of ${model.order.length}.`,
        fresh.length > 0 && `${plural(fresh.length, 'new order problem')}.`,
      ]
        .filter(Boolean)
        .join(' '),
    )
    // A card moved under focus (⌥←/⌥→, a drag) keeps it; the Act select keeps its own.
    const fromCard = document.activeElement?.closest('[data-scene-card]')
    // A failed move leaves the previous one the head: give its offer back.
    const prev = undoMove.move
    undoMove.setMove({ issueIds: fresh.map((i) => i.id), head: null })
    const result = patcher
      .patch(applied.ops, applied.next, (saved) =>
        undoMove.setMove((m) => m && { ...m, head: saved.headSnapshotId }),
      )
      .then((ok) => {
        if (!ok) undoMove.setMove(prev)
        return ok
      })
    // The optimistic doc is on screen by the next frame (the card may have
    // remounted in another act): bring it into view below the sticky header.
    requestAnimationFrame(() => {
      const card = cardEl(move.sceneId)
      card?.scrollIntoView({ block: 'nearest' })
      if (fromCard) card?.focus()
    })
    return result
  }
```

  Imports: `actLabel` from `./planTree`; `lockedMoveText`, `newOrderIssues`, `orderIssues` from `./story`. Board: `onMove={(move) => void applyMove(move)}`; drop `onReorder`/`onMoveToAct`. `saveSceneField`'s `act` branch is unchanged.
- [ ] **Step 4 — e2e (`plan.spec.ts`).** Existing tests:
  - "reorder scene-4 before scene-3 (cross-act drag)…": `dragTo(scene-3, { targetPosition: { x: 12, y: 53 } })` (left half); expectations unchanged (`[scene-2, scene-4, scene-3]`).
  - The T3.7 test: `/before its setup in scene 3/` and `'⚠ order with 2'` (scene-5 is number 2 in the cold open, scene-2 number 3).
  New, appended (state per "Codebase facts"; `page.setViewportSize({ width: 1280, height: 900 })` first, as the drag test does). Mid-drag assertions use manual mouse steps — two moves so Chromium fires `dragover`:

```ts
async function dragOver(page: Page, from: Locator, to: Locator, x: number) {
  await from.hover()
  await page.mouse.down()
  await to.hover({ position: { x, y: 53 } })
  await to.hover({ position: { x: x + 2, y: 53 } })
}
```

  - "a drop inserts where it lands, with a coral bar, and ⌥→ steps a card across an act break (T3.8)" — `dragOver(scene-2 → scene-3, x 130)`: scene-3 has `[data-insert-bar][data-side="after"]` and the tape `Move 2 here`; `mouse.up()` → act-frame-1 order `[scene-4, scene-3, scene-2]`. Click scene-2, `Alt+ArrowRight` → scene-2 in act-frame-2, focused, `plan-live` contains `Moved to ACT TWO, scene 4 of 6.`; `Alt+ArrowLeft` → back at the end of act-frame-1. Reload → act-frame-1 `[scene-4, scene-3, scene-2]`.
  - "a move past a locked scene is refused on the target and sends nothing (T3.8)" — count `PATCH` requests with `page.on('request', …)`; `dragOver(scene-5 → scene-6, x 130)` (scene-6 is locked): tape `Can't move past scene 6: it's locked`, no `[data-insert-bar]`; `mouse.up()` → scene-5 still in act-frame-3, 0 PATCHes. Click scene-5, `Alt+ArrowRight` → scene-5 in act-frame-4 before scene-6 (allowed: scene-6 stays put; 1 PATCH); `Alt+ArrowRight` again → the danger toast reads `Can't move past scene 6: it's locked` (scope the locator to the toast: `plan-live` holds the same words), still 1 PATCH; `Alt+ArrowLeft` → scene-5 back in act-frame-3.
  - "the Act select keeps focus through its save, and a move into a collapsed act opens it (T3.8)" — click scene-5, click act-frame-2's `Hide ACT TWO`; `select.focus()`, `selectOption('2')` → act-frame-2 shows scene-5 (the act opened), the card turns `draggable="true"` (saved), then `await expect(select).toBeFocused()`; `selectOption('3')` → back in act-frame-3, select still focused.
  Run `plan-notes.spec.ts plan.spec.ts review.spec.ts zz-structure.spec.ts`, then the full e2e set; compare any non-plan failure with the `origin/main` baseline.
- [ ] **Step 5 — run:** `(cd apps/web && npx vitest run)` green; `npx tsc -b`, `npx eslint .`, `npx prettier --check .` clean; temporary e2e files removed.
- [ ] **Step 6 — commits:** `plan: route drops, ⌥←/⌥→ and the Act select through one insert move`, then `e2e: cover insert reorder, keyboard moves and lock refusals`

---

### Task 6: T3.8 docs

**Files:** `docs/tableread-ui-spec.md`, `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md`, `docs/tableread-data-contract.md`.
**Depends on:** nothing (content is fixed by this plan; parallel with any task).

- [ ] **UI spec §5:**
  - *Scene cards* bullet: replace "Drag one card onto another to swap them … 'Locked — can't swap' …" with: a drop inserts the card where it lands — before the target on its left half, after it on its right half (a coral bar on that side), taking the target's act; scene numbers follow the board after every move. A move that would shift a locked scene (or move a locked one) is refused: the target reads amber "Can't move past scene n: it's locked" and never takes the drop; a locked card never drags but takes a drop that leaves it in place. Nothing drags while a write is in flight.
  - *Live order check* bullet: "Every move — a drop, ⌥←/⌥→, the Act select, an empty-act drop — is one PATCH and one snapshot, setting each shifted scene's `index` to its board position (and the moved scene's `act`)"; a move into a collapsed act opens it; the moved card is scrolled into view and keeps focus when it had it; every move announces "Moved to ACT n, scene k of N." (+ new problems); drag prediction tape "Move n here" (sky) / the prediction (amber) / the lock reason (amber).
  - *Keyboard* bullet: ⌥← / ⌥→ on a focused card move it one slot in board order; at an act's edge the first press moves it into the neighbouring act in place (empty acts too); refused moves show a toast and are announced.
  - *Top of body* (panel): the Act select moves the scene to the chosen act's nearest edge (the start of a later act, the end of an earlier one); refused past a locked scene (toast); while a save is pending it stays focused but ignores changes (`aria-disabled`); disabled only for locked scenes/episodes.
- [ ] **Build plan T3.8** — add `_Accept:_` after the T3.8 paragraph: Vitest — `applySceneMove` insert before/after, act nearest edge, step (one slot, act break in place, empty acts, null at the ends), index = board position with only changed fields, legacy renumbering, lock refusal (`blockedBy`, no ops) incl. locked episode and a move that leaves a locked scene in place; `predictMove` = the saved insert's new problems / null / blockedBy; Board drop side, coral bar, refusal tape and no drop, empty-act act move, ⌥←/⌥→ (not while pending); Act select stays focusable while pending; PlanScreen one PATCH per move, refusal toast with no PATCH, Undo the move after an insert, focus kept on a stepped card, collapsed act opened. pytest — a PATCH shifting a locked scene's index (or any in a locked episode) → 409 `LOCKED_OBJECT`, no snapshot; several index replaces + an act in one PATCH = one snapshot; a bad op changes nothing. E2E — insert with the bar persists after reload; ⌥→ crosses an act break; a drop past locked scene-6 is refused and sends nothing; the Act select keeps focus and opens a collapsed act.
- [ ] **Test plan** — "Plan insert reorder (T3.8)" sentences in the backend lock paragraph (the two 409 cases + one-snapshot multi-op), the Vitest paragraph and the E2E paragraph, same content as the acceptance line; note that the lock-violation tests landed first.
- [ ] **Handoff** — decision-log row: "2026-10-14: Plan drag inserts where dropped (pointer half; coral bar); ⌥←/⌥→ step a card, crossing act breaks in place; the Act select and empty-act drop insert at the chosen act's nearest edge. Every move is one PATCH that sets `index` = board position for the scenes it shifts (and the moved scene's `act`), built by `applySceneMove`, which the drop prediction reuses. Nothing may shift a locked scene: the client refuses ("Can't move past scene n: it's locked") and the PATCH lock guard now freezes a locked scene's own `index` (409 `LOCKED_OBJECT`). The Act select stays focused while saving; a move into a collapsed act opens it." | "Owner decision #2 (insert, lock-violation test first); numbers that follow the board keep Plan, Write and Ledger in agreement".
- [ ] **Data contract §4** `PATCH /projects/{pid}` line: "Patches into locked ranges, including a stale attempt to change a locked scene's act **or `index`** (a reorder that would shift a locked scene, or any scene of a locked episode), → 409 `LOCKED_OBJECT`." No type changes.
- [ ] **Commit:** `docs: insert reorder and keyboard moves (T3.8)`

---

## Self-check before the PR

- [ ] `(cd apps/web && npx vitest run)`, `npx tsc -b`, `npx eslint .`, `npx prettier --check .` clean.
- [ ] API: full `pytest … tests` green (MockLlmClient only), `ruff check apps/api` clean, `scripts/check_contract.py` green and unchanged.
- [ ] The e2e set passes (only the six known Write-mode baseline failures elsewhere).
- [ ] `git log --oneline` shows the lock-violation test commits (Task 1 Step 5, Task 3 Step 1, Task 5 Step 1) before their feature commits.
- [ ] `git grep -n "buildSceneSwapPatch\|swapScenesLocally\|'swap'\|Swap with\|can't swap" -- apps/web` is empty.
- [ ] `git grep -n "DESIGN-GAP" -- apps/web/src/plan apps/api` shows none, or each names a task id. No hex, no new `--tr-*` token.
- [ ] `git status --short` shows no `playwright.local.config.ts` and no `apps/api/.venv`.
- [ ] PR description quotes the build-plan T3.8 acceptance line with pass/fail, flags no new dependency, and lists the decisions (Defaults 2, 3, 5) for the owner.
