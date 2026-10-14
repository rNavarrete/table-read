# Plan Redesign — Phase 4b (T3.9 Draft a fix in Review…) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is deliberately lean: exact interfaces, test names with their key assertions, and code only where the logic is easy to get wrong. Write the rest in the style of the Phase 1–3 files it names.

**Goal:** On a story continuity note in Plan's notes strip, add **Draft a fix in Review…**: an inline editor prefilled with a plain-language instruction derived from the note, a one-line explainer, and **Open Review**, which creates an ordinary Change Set through the existing `POST /projects/{pid}/change-sets` and goes to Review exactly as the structural footer's Open Review does (leave-Plan guard, discarded drafts restored on failure). Hidden on locked scenes and in locked episodes; never on act-split, import or Order notes.

**Architecture:** No server code, no schema, no prompt. The existing create request `{targetObjectId, instruction}` already carries a free-text instruction scoped to a scene, and the blast-radius prompt renders it as `EDIT: <id> -> <instruction>` (`render.build_blast_radius_prompt`), so the feature is three client pieces: a pure `fixInstruction(note, scene, scenes, ledger)` in `story.ts`; the verb and its editor in `panel/NotesStrip.tsx` (local state, keyed by scene through PlanScreen); and `PlanScreen.sendToReview`, the existing `handleOpenReview` body lifted so both Open Review paths share the leave guard, `createChangeSet`, `stashChangeSet` and `navigateToReview`. Locks stay server-enforced by the path every Change Set already takes (create annotates `locked`; preview/apply refuse locked ids before any model call; a regenerate that returns an unrequested id is `SCHEMA_INVALID_LLM`; apply asserts no locked writes). Task 1 pins that path for this entry point before any feature code.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 4 (`--tr-*` tokens only), Vitest + Testing Library (jsdom 29); FastAPI + pytest with `MockLlmClient`; Playwright e2e against the real API, a seeded temp DB and `MockLlmClient`; types from `packages/contract` (`contract`).

**Spec:** `docs/superpowers/specs/2026-10-13-plan-redesign-design.md` — §3 owner decision 3 ("Draft a fix in Review…" in the last phase, hidden on locked scenes, lock-violation test first), §4.6 notes strip verbs, §6 (rule 2, rule 8), §7 Phase 4 (T3.9), §8. Visual reference: the owner's mockup `reports/Plan redesign/Plan redesign mockup.html` in the owner's checkout. It is built on a copyrighted script: **never copy its text into the repo, tests or docs.** Use `docs/tableread-fixture.json` ("The Long Pour") and generic wording.

## Global Constraints

- **No contract change, no new endpoint, no new LLM operation, no prompt change, no PROMPT_VERSION bump.** Reuse `createChangeSet(projectId, { targetObjectId, instruction })` from `apps/web/src/api/client.ts` unchanged. If anything below seems to need a schema or prompt change, stop and report it; do not make it.
- **Rule 2 (locks):** Task 1's lock-violation tests land in their own commit before any feature code or feature test. The verb and its editor render only when the scene and its episode are unlocked; the server's lock filter stays the backstop (no client-side filtering of impacted rows).
- **Rule 8 / quiet AI:** opening the editor, typing in it and Cancel send nothing. Only the editor's **Open Review** click calls `createChangeSet` (which runs the classifier). No new import of `suggestInstructions` anywhere.
- **Rule 4:** the create writes no snapshot (Change Sets are not versioned); nothing in this plan PATCHes the project.
- **Rule 5:** no new logging, client or server.
- **Rule 6:** tokens only; reuse the existing class strings (`VERB`, `FOCUS` in `NotesStrip.tsx`; the coral primary button and `CONTROL` textarea classes from `PlanField.tsx`, copied as literals). No new token.
- **Never a raw id or `[code]`** in the prefilled instruction or the editor.
- No new dependencies. No `DESIGN-GAP` comments expected; if one is needed it must name a task id (`// DESIGN-GAP(T3.9): …`).
- Kept test ids and names: `notes-strip`, `note-{flagId}`, `order-note-{issueId}`, `notes-import-group`, `inspector`, `lock-toggle`, `leave-plan-dialog`, `change-set-panel`, button "Open Review" (structural footer). New: button **"Draft a fix in Review…"** (U+2026), textarea **aria-label "Fix instruction"**, `data-testid="fix-editor"`.
- Commits: `area: imperative summary`, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tests beside code; e2e in `apps/web/e2e/`.
- Never edit the owner's checkout (`/Users/rolandonavarrete/Documents/tableread`), never `git stash`, never push, never `make`, never call the Anthropic API, never `make evals`.

## Review Focus

1. **A Change Set drafted from a note never changes locked content** — locked rows annotated, preview/apply refuse them with 409 `LOCKED_OBJECT` and zero `regenerate_elements` calls, a sneaked locked id is 502 `SCHEMA_INVALID_LLM`, and the locked scene/beat is byte-identical after an apply of the unlocked rows. *Pinned by:* Task 1 (`test_change_sets_note_fix_locks.py`, all three tests).
2. **The verb is never offered where it must not be** — absent on a locked scene and in a locked episode (an open editor goes when the scene locks), and absent on act-split, import and Order notes. *Pinned by:* Task 1 ("Draft a fix in Review… is never offered on a locked scene or in a locked episode"), Task 3 ("only on continuity notes", "hidden while locked; an open editor goes when the scene locks").
3. **No model call without the explicit click** — opening and editing send nothing; Open Review sends exactly one create with the scene id and the edited, trimmed text. *Pinned by:* Task 3 ("opening the editor sends nothing…"), Task 4 ("Draft a fix sends nothing until Open Review, then one create for the scene and Review").
4. **Leaving Plan behaves exactly like Open Review** — any unsaved field asks first; Stay sends nothing and keeps the editor; Discard and leave, then a failed create, gives every draft back and shows the error inline with the edited text kept (no toast). *Pinned by:* Task 4 ("with an unsaved field, Draft a fix asks first…", "Discard and leave, then a failed Draft a fix…"), plus the existing Open Review tests, which pin the `sendToReview` refactor.
5. **The prefill reads as words** — "scene n (Place)" / "beat n.m", other scenes by their card number and place, facts quoted, a gone scene as "a deleted scene"; never `scene-…`, `fact-…` or `[code]`. *Pinned by:* Task 2 (`fixInstruction` tests), Task 4 e2e (`not.toHaveValue(/scene-|fact-|\[/)`).

---

## How to run things in this worktree

Worktree root: `/private/tmp/claude-501/-Users-rolandonavarrete-Documents-tableread/e01f6f26-992e-40b8-b7ce-ce2105b26759/scratchpad/wt-fixdraft` (branch `feat/plan-fix-draft`). Every command starts from the worktree root; run each line as its own shell call, or keep the `( … )` subshells.

- Web unit tests: `(cd apps/web && npx vitest run <paths>)`; whole suite: `(cd apps/web && npx vitest run)`
- Typecheck: `(cd apps/web && npx tsc -b)`
- Lint / format: `(cd apps/web && npx eslint <files>)`; `(cd apps/web && npx prettier --write <your files>)` then `--check`
- API tests: `(cd apps/api && PYTHONDONTWRITEBYTECODE=1 /Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/pytest -p no:cacheprovider -q <paths>)`
- API lint: `/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/ruff check apps/api`
- Contract (must stay green, nothing should change): `/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/python scripts/check_contract.py`
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
- One e2e worker shares one seeded DB; files run in name order: `plan-notes.spec.ts` → `plan.spec.ts` → … → `review.spec.ts`. While `plan-notes.spec.ts` runs, `scene-5` is unlocked (`review.spec.ts` locks it later) and its first test has saved scene-2 `whatHappens` = "Dan moves the money before dawn.". `review.spec.ts`'s re-entry test relies on Review's open picker auto-opening a **single** draft/previewing Change Set (`ReviewScreen.tsx`: `rows.length === 1`), so any Change Set an earlier spec creates must be discarded.

## Codebase facts the tasks rely on

- `PlanScreen.handleOpenReview(targetObjectId, instruction)` (the structural footer's Open Review): counts drafts other than `draftKey(target, 'whatHappens')`; if any, `await leave.confirmLeave()` (Stay → return) and re-sets the sent field's draft that Discard cleared; `setOpeningReview(true)`; `createChangeSet` → `stashChangeSet` → `drafts.clear(key)` → `navigateToReview(projectId, cs.id)`; on failure `leave.undoDiscard()`, the `reviewError` danger toast, `setOpeningReview(false)`. `busy` includes `openingReview`, and `NotesStrip` gets `busy`. `leave.confirmLeave()` resolves `true` at once when there are no drafts.
- `NotesStrip` is rendered by PlanScreen through ScenePanel's `notes` render prop, keyed `${selectedScene.id}:${freshHere.join(' ')}` — local state lives while the scene stays selected. Today it gets `actLocked={episode.locked || selectedScene.locked || busy}` (for Change the act); there is no plain `locked` prop yet. Continuity notes are `note.kind === 'continuity'` inside `story`; act-split cards use the same `story` loop; import notes sit in `notes-import-group`; Order notes are `orderNotes` cards.
- `story.ts`: `linkifyNote(text, scenes, ledger)` → segments (`scene` with `sceneId`, `fact` with `factId` — only for ids in the ledger, `text`); a scene reference to a scene not in `scenes` stays plain text **as written, raw ids included** (`scene-a1b2c3`); an unknown fact id becomes plain "a Ledger fact". `placeTitle(scene)` is the card title ("Kitchen", "Back Room", "The Long Pour"). Card numbers are `scene.index + 1`; beat labels `n.m` = `scene.index + 1`.`beat.index + 1`.
- API: `create_change_set` validates the target, runs `classify_blast_radius`, annotates every impacted row with `locked = locks.is_locked(doc, id)` (episode → scene → beat cascade), persists a `draft`, writes no snapshot. `preview_change_set` and `apply_change_set` call `_resolve_approved_regenerate_targets`, which raises `ApplyRejected("LOCKED_OBJECT")` (route → 409) for a locked row **before** any model call; `_validate_regenerated_ids` turns any unrequested id in the model's reply into `SchemaInvalidLlmError` (502); apply ends with `locks.assert_no_locked_writes`. `MockLlmClient` has `set_response(op, model)` and `invocation_count(op)`; its default `scan_consistency` returns one tension note on `scene-5` ("The argument's stakes reference the bar as the money's hiding place, which is no longer true."); its default `classify_blast_radius` names `scene-2`, `beat-4-2`, `fact-02`, `scene-5` whatever the target.
- Fixture: `beat-1-2` is locked (scene-1); `scene-5` (index 4, "INT. THE LONG POUR - KITCHEN - NIGHT" → "Kitchen") has `beat-5-1`; `beat-4-2` is in `scene-4`; nothing else is locked; `consistencyFlags: []`.
- Existing coverage this plan does not duplicate: `test_change_sets_create.py::test_locked_objects_annotated_locked_true`, `test_change_sets_apply_locks.py` (apply with a locked id → 409, doc unchanged), `test_change_sets_preview_apply.py::test_preview_rejects_extra_ids_from_llm_as_schema_invalid`. Missing, and added in Task 1: **preview** refusing a locked id, a Change Set whose **target is a locked scene**, a **locked episode**, and an apply that proves the locked part is untouched while the unlocked part lands — all with a note-shaped instruction.
- The Episode view's Notes rows are scene buttons with no verbs (`EpisodeView.tsx` `NoteRows`), so the verb is strip-only; `EpisodeView` is untouched.

## Defaults this plan takes (product calls the spec leaves open)

Each is built as written unless the owner says otherwise; none blocks the work.

1. **Prefill wording:** `Fix this continuity note in scene 5 (Kitchen): <the note>` (a beat note: `in beat 5.1 (Kitchen)`); other scenes read `Scene 3 (Basement)` by their card number and place; a fact id reads `the Ledger fact “<its text>”` (unknown: "a Ledger fact"); a reference to a scene that no longer exists reads "a deleted scene". The confirm button reuses the footer's label: **Open Review** ("Opening…" while it runs).
2. **Target = the note's scene**, also for a note on a beat (the beat is named in words). A note on a locked beat in an unlocked scene still offers the verb: the fix may belong elsewhere, and Review shows that beat as a locked row it never changes.
3. **The edited instruction is not a Plan draft:** no coral dot, no leave dialog for it; it lasts while the scene stays selected (kept across Stay in Plan and a failed create), and is lost on a scene switch or on leaving Plan.
4. **The note stays open** after its fix is applied; the writer dismisses it (apply rescans and may raise fresh notes).

## File Structure

`src/` = `apps/web/src/`.

| File | Status | Task | Responsibility |
|---|---|---|---|
| `apps/api/tests/test_change_sets_note_fix_locks.py` | new | 1 | Lock-violation tests for a Change Set drafted from a note |
| `src/plan/PlanScreen.test.tsx` | modify | 1, 4 | Task 1: the verb is absent on a locked scene / episode. Task 4: the wiring tests |
| `src/plan/story.ts` (+ `.test.ts`) | modify | 2 | `fixInstruction` |
| `src/plan/panel/NotesStrip.tsx` (+ `.test.tsx`) | modify | 3 | The verb, the inline editor, pending and inline error |
| `src/plan/PlanScreen.tsx` | modify | 3 (one line), 4 | Task 3: pass `locked`. Task 4: `sendToReview`, `onDraftFix` |
| `apps/web/e2e/plan-notes.spec.ts` | modify | 4 | Note → lock hides the verb → unlock → draft → Review shows the instruction |
| `docs/tableread-ui-spec.md`, `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md` | modify | 5 | Per-PR docs |

Untouched: `apps/api` source (routes, `drama_manager/*`, `schemas.py`, `render.py`), `packages/contract`, `config/tool_schemas/`, `docs/tableread-data-contract.md`, `docs/tableread-prompt-spec.md`, `api/client.ts`, `review/*`, `ScenePanel.tsx`, `EpisodeView.tsx`, `tokens.css`.

## PR boundary and order

One PR, **T3.9 Draft a fix in Review…**, on `feat/plan-fix-draft` (cut from `main` after #29).

```
1 (lock tests: API + PlanScreen.test) ─┬─► 2 (fixInstruction) ─► 3 (NotesStrip + 1 line PlanScreen) ─► 4 (PlanScreen wiring + e2e)
                                       └─► 5 (docs)
```

- Task 1 first, in its own commit (rule 2). Task 5 can run in parallel with 2–4 (disjoint files; its copy is fixed by this plan). Tasks 2 → 3 → 4 are sequential (3 imports 2; 3 and 4 share `PlanScreen.tsx`; 1 and 4 share `PlanScreen.test.tsx`).
- The parallel T3.8 PR (insert reorder) also edits `PlanScreen.tsx` (`applyMove`, `onReorder`), `PlanScreen.test.tsx` and the same four docs. Keep this PR's hunks away from those: in `PlanScreen.tsx` touch only `handleOpenReview` and the `NotesStrip` props; in `PlanScreen.test.tsx` put new tests right after "Discard and leave, then a failed Open Review…" (not at the end of the file); in docs edit only the T3.9 lines, the notes-strip bullet and new rows. Whichever PR merges second rebases.

---

### Task 1: Lock-violation tests (rule 2, before any feature code)

**Depends on:** none · **e2e:** no

**Files:** create `apps/api/tests/test_change_sets_note_fix_locks.py`; modify `apps/web/src/plan/PlanScreen.test.tsx`.

**Interfaces:** none (tests only; no production file changes in this task).

- [ ] **Step 1: API lock tests.** Write the file in full (it is the rule-2 pin, so the code is given):

```python
"""Draft a fix in Review (T3.9) — lock violation, CLAUDE.md rule 2.

Written BEFORE the feature. "Draft a fix in Review…" on a Plan story note
creates an ordinary Change Set (target = the note's scene, instruction = the
note in words) through the existing create → preview → apply path; it adds no
server code. These tests pin that path for this entry point: whatever the
classifier names, locked content is annotated `locked`, preview and apply
refuse it with 409 LOCKED_OBJECT before any model call, a regenerate that
sneaks a locked id in is 502 SCHEMA_INVALID_LLM, and locked content never
changes. MockLlmClient only (hard rule 1).
"""

from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from schemas import BlastRadius, RegeneratedElements
from storage.models import ProjectRow

client = TestClient(app)

PROJECT_ID = "proj-longpour"
# What Plan's prefill (story.ts fixInstruction) reads for the mock scan's scene-5 note.
NOTE_FIX = (
    "Fix this continuity note in scene 5 (Kitchen): The argument's stakes "
    "reference the bar as the money's hiding place, which is no longer true."
)


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _blast(*rows: tuple[str, str]) -> BlastRadius:
    return BlastRadius.model_validate(
        {
            "impacted": [
                {
                    "objectType": object_type,
                    "objectId": object_id,
                    "reason": "Touched by the fix.",
                    "confidence": "high",
                }
                for object_type, object_id in rows
            ]
        }
    )


def _regen(*object_ids: str) -> RegeneratedElements:
    return RegeneratedElements.model_validate(
        {
            "beats": [
                {
                    "beatId": oid,
                    "beatPlan": {
                        "whatHappens": f"FIXED {oid}",
                        "audienceLearns": "learns",
                        "audienceFeels": "feels",
                    },
                    "scriptText": f"FIXED SCRIPT {oid}",
                }
                for oid in object_ids
                if oid.startswith("beat-")
            ],
            "scenes": [
                {
                    "sceneId": oid,
                    "fields": {
                        "whatHappens": f"FIXED {oid}",
                        "audienceLearns": None,
                        "audienceFeels": None,
                        "location": None,
                        "time": None,
                        "socialSituation": None,
                    },
                }
                for oid in object_ids
                if oid.startswith("scene-")
            ],
            "continuityConflicts": [],
        }
    )


def _create(target: str = "scene-5"):
    return client.post(
        f"/api/v1/projects/{PROJECT_ID}/change-sets",
        json={"targetObjectId": target, "instruction": NOTE_FIX},
    )


def _post(cid: str, step: str, ids: list[str]):
    return client.post(f"/api/v1/change-sets/{cid}/{step}", json={"approvedObjectIds": ids})


def _doc(db_session) -> dict:
    db_session.expire_all()
    return copy.deepcopy(db_session.get(ProjectRow, PROJECT_ID).doc)


def _episode(doc: dict) -> dict:
    return doc["seasons"][0]["episodes"][0]


def _scene(doc: dict, scene_id: str) -> dict:
    return next(s for s in _episode(doc)["scenes"] if s["id"] == scene_id)


def _lock(db_session, mutate) -> None:
    """Flip a lock in the live doc (no snapshot), as test_change_sets_apply_locks does."""
    project = db_session.get(ProjectRow, PROJECT_ID)
    doc = copy.deepcopy(project.doc)
    mutate(doc)
    project.doc = doc
    db_session.commit()


def _locked_by_id(created) -> dict[str, bool]:
    return {row["objectId"]: row["locked"] for row in created.json()["impacted"]}


def test_note_fix_never_previews_a_locked_beat(seeded_project, db_session, mock_llm):
    """The note is on unlocked scene-5; the classifier also names locked beat-1-2."""
    mock_llm.set_response(
        "classify_blast_radius", _blast(("scene", "scene-5"), ("beat", "beat-1-2"))
    )
    before = _doc(db_session)

    created = _create()
    assert created.status_code == 200
    cid = created.json()["id"]
    assert _locked_by_id(created) == {"scene-5": False, "beat-1-2": True}

    for ids in (["beat-1-2"], ["scene-5", "beat-1-2"]):
        resp = _post(cid, "preview", ids)
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert mock_llm.invocation_count("regenerate_elements") == 0

    # The model sneaks the locked beat into a preview of the unlocked scene.
    mock_llm.set_response("regenerate_elements", _regen("scene-5", "beat-1-2"))
    resp = _post(cid, "preview", ["scene-5"])
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "SCHEMA_INVALID_LLM"

    assert client.get(f"/api/v1/change-sets/{cid}").json()["preview"] is None
    assert _doc(db_session) == before


def test_note_fix_on_a_locked_scene_never_changes_it(seeded_project, db_session, mock_llm):
    """A client that ignores the hidden verb: the note's own scene is locked."""
    _lock(db_session, lambda doc: _scene(doc, "scene-5").update(locked=True))
    mock_llm.set_response(
        "classify_blast_radius",
        _blast(("scene", "scene-5"), ("beat", "beat-5-1"), ("beat", "beat-4-2")),
    )
    before = _doc(db_session)

    created = _create()
    assert created.status_code == 200  # a draft writes nothing
    cid = created.json()["id"]
    assert _locked_by_id(created) == {"scene-5": True, "beat-5-1": True, "beat-4-2": False}

    for ids in (["scene-5"], ["beat-5-1"]):
        resp = _post(cid, "preview", ids)
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert mock_llm.invocation_count("regenerate_elements") == 0

    mock_llm.set_response("regenerate_elements", _regen("beat-4-2"))
    assert _post(cid, "preview", ["beat-4-2"]).status_code == 200
    resp = _post(cid, "apply", ["beat-4-2", "beat-5-1"])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _doc(db_session) == before

    assert _post(cid, "apply", ["beat-4-2"]).status_code == 200
    after = _doc(db_session)
    assert _scene(after, "scene-5") == _scene(before, "scene-5")
    assert _scene(after, "scene-4") != _scene(before, "scene-4")  # the unlocked fix landed


def test_note_fix_in_a_locked_episode_changes_nothing(seeded_project, db_session, mock_llm):
    """Episode lock cascades: every regenerate row is locked, every preview refused."""
    _lock(db_session, lambda doc: _episode(doc).update(locked=True))
    before = _doc(db_session)

    created = _create()  # default mock blast: scene-2, beat-4-2, fact-02, scene-5
    assert created.status_code == 200
    cid = created.json()["id"]
    regenerate = [r for r in created.json()["impacted"] if r["applyMode"] == "regenerate"]
    assert regenerate and all(r["locked"] for r in regenerate)

    for row in regenerate:
        resp = _post(cid, "preview", [row["objectId"]])
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert mock_llm.invocation_count("regenerate_elements") == 0
    assert _doc(db_session) == before
```

- [ ] **Step 2: Run it.** Expected: 3 passed on `main` — the backstop already exists; that is the point (this entry point adds no server path).
- [ ] **Step 3: Prove it fails for the right reason.** Temporarily change `if hit.get("locked") or locks.is_locked(doc, object_id):` in `_resolve_approved_regenerate_targets` (`apps/api/drama_manager/change_sets.py`) to `if False:`; rerun → all three fail on the `409`/`LOCKED_OBJECT` asserts (not on setup). Restore with `git checkout -- apps/api/drama_manager/change_sets.py`; `git diff --quiet apps/api/drama_manager` must succeed.
- [ ] **Step 4: Web lock test.** In `PlanScreen.test.tsx`, inside `describe('PlanScreen')`, directly after "a locked scene still shows its notes, and Dismiss stays available" (it uses `OPEN_FLAG`, a continuity note on `scene-1`):

```tsx
  it.each(['scene', 'episode'] as const)(
    'Draft a fix in Review… is never offered on a locked %s (rule 2)',
    async (lock) => {
      const user = userEvent.setup()
      const p = project()
      const ep = p.seasons[0].episodes[0]
      if (lock === 'scene') ep.scenes[0].locked = true
      else ep.locked = true
      getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
      await loadPlan(p)

      const strip = await screen.findByTestId('notes-strip')
      await user.click(within(strip).getByRole('button', { name: 'Show' }))
      const note = screen.getByTestId('note-flag-1')
      // The card and its other verbs render: the absence below is the lock's doing.
      expect(within(note).getByRole('button', { name: 'Dismiss' })).not.toBeNull()
      expect(
        within(note).queryByRole('button', { name: 'Draft a fix in Review…' }),
      ).toBeNull()
      expect(within(note).queryByLabelText('Fix instruction')).toBeNull()
    },
  )
```

  Expected: passes on `main` (the verb does not exist yet). Task 4 adds the positive control and re-proves this test red without the lock guard.
- [ ] **Step 5: Lint and commit.** `ruff check apps/api`; `(cd apps/web && npx eslint src/plan/PlanScreen.test.tsx && npx prettier --check src/plan/PlanScreen.test.tsx)`.

Commit: `plan: add lock-violation tests for Draft a fix in Review`

---

### Task 2: `fixInstruction` (`story.ts`)

**Depends on:** 1 · **e2e:** no

**Files:** modify `apps/web/src/plan/story.ts`, `apps/web/src/plan/story.test.ts`.

**Interface** (in the `// ── Notes` section, after `linkifyNote`):

```ts
/** The instruction "Draft a fix in Review…" starts from (T3.9): where the note
 * sits ("scene 5 (Kitchen)", "beat 5.1 (Kitchen)"), then the note in words —
 * other scenes by their card number and place, a fact id as the quoted Ledger
 * fact, a scene that is gone as "a deleted scene". Never a raw id or [code];
 * the writer edits it before anything is sent. Continuity notes only. */
export function fixInstruction(
  note: PlanNote,
  scene: Scene,
  scenes: readonly Scene[],
  ledger: readonly LedgerFact[],
): string
```

**Implementation** (the only tricky part is the segment mapping):

```ts
  const where = note.beat
    ? `beat ${scene.index + 1}.${note.beat.index + 1}`
    : `scene ${scene.index + 1}`
  const body = linkifyNote(note.flag.explanation, scenes, ledger)
    .map((s) => {
      if (s.type === 'scene') {
        const target = scenes.find((x) => x.id === s.sceneId)!
        // "Scene"/"scene" as written; the number is the card's, not the id's.
        return `${s.text.slice(0, 5)} ${target.index + 1} (${placeTitle(target)})`
      }
      if (s.type === 'fact')
        return `the Ledger fact “${ledger.find((f) => f.id === s.factId)!.fact}”`
      return s.text
    })
    .join('')
    // linkifyNote keeps a reference to a missing scene as written, id included.
    .replace(/\bscene-[0-9a-z]+\b/gi, 'a deleted scene')
    .trim()
  return `Fix this continuity note in ${where} (${placeTitle(scene)}): ${body}`
```

**Tests** (`describe('fixInstruction')` after `describe('noteSentence')`; import `fixInstruction`). Fixtures: `s5 = scene('scene-5', 4, { location: 'INT. THE LONG POUR - KITCHEN - NIGHT', beats: [beat('beat-5-1', 0)] })`, `s2 = scene('scene-2', 2, { location: 'INT. THE LONG POUR - BASEMENT - NIGHT' })` (index 2: scene-2 now plays third), `cash = { ...fact('fact-02', 'scene-2', 'active'), fact: 'The cash is in the ice machine' }` (the helper's default text contains the id), notes via `notesForScene([flag({...})], s5)[0]`.

- `'says where the note is, then the note with other scenes by card number and place and the fact quoted'` — explanation `'Scene 2 moved the money, so the stakes here rest on fact-02, which is no longer true.'` → exactly `'Fix this continuity note in scene 5 (Kitchen): Scene 3 (Basement) moved the money, so the stakes here rest on the Ledger fact “The cash is in the ice machine”, which is no longer true.'`
- `'names a beat note as beat n.m and keeps a lower-case "scene" lower-case'` — beat flag on `beat-5-1`, explanation `'The cover story here contradicts scene 2.'` → `'Fix this continuity note in beat 5.1 (Kitchen): The cover story here contradicts scene 3 (Basement).'`
- `'never shows a raw id: a gone scene reads "a deleted scene", an unknown fact "a Ledger fact"'` — explanation `'scene-a1b2c3 and fact-zz9 disagree with Scene 40.'` → `'Fix this continuity note in scene 5 (Kitchen): a deleted scene and a Ledger fact disagree with Scene 40.'`; and for every case above `expect(text).not.toMatch(/scene-|fact-|\[/)`.

Run: `(cd apps/web && npx vitest run src/plan/story.test.ts)`, `npx tsc -b`, eslint + prettier on both files.

Commit: `plan: derive the Draft a fix instruction from a note`

---

### Task 3: The verb and the inline editor (`NotesStrip`)

**Depends on:** 2 · **e2e:** no

**Files:** modify `apps/web/src/plan/panel/NotesStrip.tsx`, `apps/web/src/plan/panel/NotesStrip.test.tsx`, and **one line** in `apps/web/src/plan/PlanScreen.tsx` (pass `locked`, so `tsc -b` stays green).

**Interface** (add to `NotesStripProps`):

```ts
  /** The scene or its episode is locked: no "Draft a fix in Review…" and no
   * open fix editor (rule 2; owner decision 3). Notes and Dismiss still work. */
  locked: boolean
  /** Draft a fix in Review… → Open Review: PlanScreen creates the Change Set
   * and goes to Review. Resolves once on the way, or when the writer stays in
   * Plan; rejects with the error the editor shows. Absent → no verb. */
  onDraftFix?: (instruction: string) => Promise<void>
```

PlanScreen (this task, one line in the `<NotesStrip …>` props): `locked={episode.locked || selectedScene.locked}`.

**Behavior:**

- Only in the continuity branch of the `story` loop (`note.kind !== 'act_split'`), after **Open in Write** and before **Dismiss**, when `onDraftFix && !locked`: a `VERB` button **Draft a fix in Review…**, `aria-expanded` = this note's editor is open, `disabled={busy}`. Click toggles this note's editor; opening (or switching to another note) sets the text to `fixInstruction(note, scene, scenes, ledger)` and clears the error. Never on act-split cards, the import group or Order notes.
- One editor at a time, under the verbs row of its card, also only when `onDraftFix && !locked` (so locking the scene hides an open editor; unlocking shows it again with the text):
  - `<textarea aria-label="Fix instruction" aria-describedby="plan-fix-explainer" rows={4} autoFocus readOnly={sending}>` with PlanField's `CONTROL` classes plus `text-13 resize-y`.
  - `<p id="plan-fix-explainer" className="text-12 text-tr-text-primary">Nothing changes until you apply it in Review. Locked scenes are never changed.</p>`
  - the error, when set: `<p role="alert" className="text-13 text-tr-danger">{error}</p>`
  - **Open Review** — the footer's coral primary classes; `disabled={busy || sending || !text.trim()}`; reads **Opening…** while `sending`. **Cancel** (`VERB`, `disabled={sending}`) closes the editor and returns focus to its Draft a fix button.
  - Wrapper: `data-testid="fix-editor"`.

**Implementation notes** (hooks go above the `return null` early exit):

```tsx
  // The one open fix editor (T3.9): its note and the writer's text. Lives
  // while this scene stays selected (PlanScreen keys the strip by scene).
  const [fix, setFix] = useState<{ flagId: string; text: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [fixError, setFixError] = useState<string | null>(null)
  const fixVerbRef = useRef<HTMLButtonElement>(null)
  const fixAreaRef = useRef<HTMLTextAreaElement>(null)

  function sendFix() {
    if (!fix || !onDraftFix) return
    setSending(true)
    setFixError(null)
    onDraftFix(fix.text.trim()).then(
      () => setSending(false), // on the way to Review, or Stay in Plan
      (err: unknown) => {
        setSending(false)
        setFixError(err instanceof Error ? err.message : "Couldn't open Review.")
        fixAreaRef.current?.focus() // the text is kept; let the writer edit it
      },
    )
  }
  // Cancel: focus the verb first (it exists before and after the close).
  function cancelFix() {
    fixVerbRef.current?.focus()
    setFix(null)
    setFixError(null)
  }
```

  Attach `ref={fix?.flagId === note.flag.id ? fixVerbRef : undefined}` to the open note's verb.

**Tests** (`NotesStrip.test.tsx`; add `locked: false` to `renderStrip`'s defaults; `onDraftFix` passed per test as `vi.fn()` returning a promise; `FLAGS` already has continuity notes `flag-scene` and `flag-beat`, act-split `flag-act`, and two import notes):

- `'Draft a fix in Review… only on continuity notes: not on act-split, import or Order notes'` — with `onDraftFix` and `orderNotes: [ORDER_NOTE]`, Show, open the import `<details>`: the verb is in `note-flag-scene` and `note-flag-beat`; not in `note-flag-act`, `notes-import-group` or `order-note-…`. Without `onDraftFix`: no verb anywhere.
- `'hidden while locked; an open editor goes when the scene locks and comes back with its text'` — `locked: true` → no verb. Then `locked: false`, open the editor on `flag-scene`, type " Keep the fight.", `rerender` with `locked: true` → no `fix-editor`, no verb; `rerender` with `locked: false` → editor back with the typed text.
- `'opening the editor sends nothing; it is prefilled in words with the explainer'` — click the verb: `onDraftFix` not called; textbox "Fix instruction" is `document.activeElement`, its value is `fixInstruction(notes[0], SCENE_5, SCENES, [FACT_02])` (compute with the import) and `not.toMatch(/scene-|fact-|\[/)`; the explainer text is present and its id is the textarea's `aria-describedby`; the verb's `aria-expanded` is `'true'`. (No jest-dom in this repo: plain `expect` on DOM properties, as the existing tests do.)
- `'Open Review sends the edited, trimmed text; it reads Opening… and waits; Cancel closes and refocuses the verb'` — deferred `onDraftFix`; clear + type `'  Move the money talk to the marina.  '`; click Open Review → called once with `'Move the money talk to the marina.'`; button reads "Opening…" and is disabled, Cancel disabled; resolve → enabled again. Then Cancel → no `fix-editor`, focus on the verb. An emptied textarea disables Open Review.
- `'a failed send shows the error inline, keeps the edited text and focuses it'` — `onDraftFix` rejects `new Error('review is down')`: `role="alert"` reads "review is down", the textarea keeps the edited text and has focus, Open Review enabled again.
- `'the verb is disabled while a write is in flight'` — `busy: true` → the verb is disabled (Dismiss already is).

Run: `(cd apps/web && npx vitest run src/plan/panel/NotesStrip.test.tsx src/plan/PlanScreen.test.tsx)`, `npx tsc -b`, eslint + prettier on the three files.

Commit: `plan: add Draft a fix in Review… to continuity notes`

---

### Task 4: Wire it to the Open Review path (`PlanScreen`) + e2e

**Depends on:** 1, 3 · **e2e:** yes

**Files:** modify `apps/web/src/plan/PlanScreen.tsx`, `apps/web/src/plan/PlanScreen.test.tsx`, `apps/web/e2e/plan-notes.spec.ts`.

**Interface** (inside `PlanScreen`, replacing `handleOpenReview`'s body):

```ts
  /** Open Review and Draft a fix (T3.9): create the Change Set — the explicit
   * gesture (rule 8) — and go to Review. Any draft but `sending` (the field
   * whose text travels in the Change Set) would be lost on the way, so ask
   * first; Stay resolves without sending. Throws when the create fails:
   * nothing left Plan, and what "Discard and leave" cleared is back. */
  async function sendToReview(
    targetObjectId: string,
    instruction: string,
    sending?: string,
  ): Promise<void> {
    const own = sending && drafts.get(sending) !== undefined ? 1 : 0
    if (drafts.size - own > 0) {
      if (!(await leave.confirmLeave())) return
      // Discard cleared it too: keep the text being sent on screen.
      if (sending) drafts.set(sending, targetObjectId, instruction)
    }
    setOpeningReview(true)
    try {
      const changeSet = await createChangeSet(activeProjectId, {
        targetObjectId,
        instruction,
      })
      stashChangeSet(changeSet)
      // Its text now lives in the Change Set: clear it so beforeunload does
      // not stop the navigation.
      if (sending) drafts.clear(sending)
      navigateToReview(activeProjectId, changeSet.id)
    } catch (err: unknown) {
      leave.undoDiscard()
      setOpeningReview(false)
      throw err
    }
  }

  function handleOpenReview(targetObjectId: string, instruction: string) {
    setReviewError(null)
    sendToReview(
      targetObjectId,
      instruction,
      draftKey(targetObjectId, 'whatHappens'),
    ).catch((err: unknown) =>
      setReviewError(err instanceof Error ? err.message : 'failed to open Review'),
    )
  }
```

`NotesStrip` gets `onDraftFix={(instruction) => sendToReview(selectedScene.id, instruction)}` (the error goes inline, never to the `reviewError` toast). `onOpenReview={(sceneId, instruction) => handleOpenReview(sceneId, instruction)}` (drop the now-pointless `void`). Nothing else changes; the existing Open Review tests ("a failed Open Review shows a danger toast…", "Open Review sends its own draft without asking…", "…with another unsaved field asks first; Stay sends nothing", "while Open Review is in flight the whole panel waits…", "Discard and leave, then a failed Open Review…") must pass untouched — they pin the refactor.

**Tests** (`PlanScreen.test.tsx`, directly after "Discard and leave, then a failed Open Review: every draft comes back…"; `OPEN_FLAG` on scene-1 reads `'Scene 2 still has the money in the bar.'`, so the prefill is `PREFILL = 'Fix this continuity note in scene 1 (The Long Pour): Scene 2 (Back Room) still has the money in the bar.'`; open it with Show → `note-flag-1` → "Draft a fix in Review…"):

- `'Draft a fix sends nothing until Open Review, then one create for the scene and Review'` — after opening: textbox "Fix instruction" value `PREFILL`, `createChangeSetMock` not called, `suggestInstructionsMock` not called. Type " Keep the bar." and click Open Review inside `note-flag-1` → `createChangeSetMock` called once with `('proj-longpour', { targetObjectId: 'scene-1', instruction: PREFILL + ' Keep the bar.' })`; `navigateToReviewMock` with `('proj-longpour', 'cs-1')`; no leave dialog opened. (This is also the positive control for Task 1's lock test.)
- `'while a drafted fix is on its way the strip waits: Opening…, Dismiss disabled'` — deferred create: "Opening…" disabled, Dismiss disabled (`busy` includes `openingReview`); resolve → navigates.
- `'a failed Draft a fix shows the error in the editor, keeps the edited text, and raises no toast'` — `failing()` create, reject `'review is down'`: `within(note-flag-1)` `role="alert"` "review is down", textarea value kept, `screen.queryByTestId('toast')` null.
- `'with an unsaved field, Draft a fix asks first; Stay sends nothing and keeps the editor'` — type in "Audience learns", open the editor, Open Review → `leave-plan-dialog` open; Stay in Plan → `createChangeSetMock` not called, editor still there with `PREFILL`, "Audience learns" kept.
- `'Discard and leave, then a failed Draft a fix: the drafts come back and the error shows inline'` — same as above, but Discard and leave → create called → reject → "Audience learns" back to the typed text (`value(panel, 'Audience learns')`), inline alert, editor text kept.

**Mutation check (rule 2, the right reason):** temporarily pass `locked={false}` to `NotesStrip` → Task 1's "never offered on a locked scene / episode" tests fail on the `queryByRole(… 'Draft a fix in Review…')` assert; restore `locked={episode.locked || selectedScene.locked}` and rerun green.

**E2E** (`plan-notes.spec.ts`, a third test at the end; extend the header comment: this file also locks and unlocks scene-5 and creates, then discards, one Change Set so Review's single-draft auto-open in `review.spec.ts` still holds):

```ts
test('Draft a fix in Review… sends a note to Review as an editable instruction; never on a locked scene', async ({
  page,
  request,
}) => {
  await page.goto('/plan?project=proj-longpour')
  // A Save field only on scene-2 leaves a scene-5 note (MockLlmClient scan).
  // New text: the first test already saved its own.
  await page.getByTestId('scene-card-scene-2').click()
  const inspector = page.getByTestId('inspector')
  await inspector
    .getByLabel('What happens', { exact: true })
    .fill('Dan moves the money to the marina at dawn.')
  await inspector.getByRole('button', { name: 'Save field only' }).click()
  await expect(
    inspector.getByText('Structural change — review impact?'),
  ).toHaveCount(0)

  await page.getByTestId('scene-card-scene-5').click()
  const strip = inspector.getByTestId('notes-strip')
  await strip.getByRole('button', { name: 'Show', exact: true }).click()
  const note = strip
    .locator('[data-testid^="note-"]')
    .filter({ hasText: 'stakes reference the bar' })
    .first()
  const draftFix = note.getByRole('button', { name: 'Draft a fix in Review…' })
  await expect(draftFix).toBeVisible()

  // Rule 2: never offered on a locked scene. Lock, check, unlock (shared DB).
  const lock = inspector.getByTestId('lock-toggle')
  await lock.click()
  await expect(lock).toHaveAttribute('aria-checked', 'true')
  await expect(draftFix).toHaveCount(0)
  await lock.click()
  await expect(lock).toHaveAttribute('aria-checked', 'false')

  await draftFix.click()
  const box = note.getByLabel('Fix instruction')
  await expect(box).toHaveValue(
    /^Fix this continuity note in scene 5 \(Kitchen\): .*stakes reference the bar/,
  )
  await expect(box).not.toHaveValue(/scene-|fact-|\[/)
  await expect(note).toContainText(
    'Nothing changes until you apply it in Review. Locked scenes are never changed.',
  )
  const instruction = `${await box.inputValue()} Keep the fight; point it at the marina.`
  await box.fill(instruction)
  await note.getByRole('button', { name: 'Open Review' }).click()

  await expect(page).toHaveURL(/\/review\?.*changeSet=/)
  await expect(page.getByTestId('change-set-panel')).toContainText(instruction)

  // Shared DB: discard it, so Review's single-draft auto-open still holds.
  const cid = new URL(page.url()).searchParams.get('changeSet')
  const discarded = await request.post(`/api/v1/change-sets/${cid}/discard`)
  expect(discarded.ok()).toBeTruthy()
})
```

Run: `(cd apps/web && npx vitest run src/plan)`, `npx tsc -b`, eslint + prettier on the three files; e2e `plan-notes.spec.ts plan.spec.ts review.spec.ts recipes.spec.ts` with the temporary config (the last three prove the shared DB is left as they expect). Delete the temporary config and symlink; `git status --short` shows neither.

Commit: `plan: send a drafted fix to Review through the Open Review path`

---

### Task 5: Docs

**Depends on:** 1 · **e2e:** no

**Files:** modify `docs/tableread-ui-spec.md`, `docs/tableread-build-plan.md`, `docs/tableread-test-plan.md`, `docs/tableread-handoff.md`. No data-contract or prompt-spec change (none is needed; say so in the PR description).

- [ ] **UI spec §5, the "Notes strip (T3.4, `notes-strip`)" bullet:** in the continuity-note clause change "with **Show beat** · **Open in Write** · **Dismiss**" to "with **Show beat** · **Open in Write** · **Draft a fix in Review…** · **Dismiss**", and append after the "Change the act" sentence:

  > **Draft a fix in Review…** (T3.9) is on continuity notes only — never on act-split, import or Order notes — and never on a locked scene or in a locked episode (an open editor goes when the scene locks). It opens an editor under the note: a textarea (`Fix instruction`) prefilled in words ("Fix this continuity note in scene 5 (Kitchen): …"; a beat note says "beat 5.1"; other scenes read by card number and place, a fact id as the quoted Ledger fact, a scene that is gone as "a deleted scene" — never a raw id or `[code]`), the line "Nothing changes until you apply it in Review. Locked scenes are never changed.", **Open Review** (disabled while empty; "Opening…" while it runs) and **Cancel**. Opening and editing send nothing. Open Review is the existing Change Set create (`targetObjectId` = the scene, the edited text as `instruction`) and goes to Review through the same leave-Plan guard as the structural footer's Open Review: any unsaved field asks first, and Stay sends nothing. A failed create shows its error under the editor, keeps the edited text and gives back the drafts "Discard and leave" cleared. The edited text is not a Plan draft: it lasts while the scene stays selected. The note stays open after its fix is applied. The Episode view's notes have no verbs.

- [ ] **Build plan T3.9:** keep the description line; replace its `_Accept:_` line with:

  > _Accept:_ the lock-violation tests land first (`test_change_sets_note_fix_locks.py`: a Change Set drafted from a note — the note's scene as target, the note in words as instruction — annotates locked rows; preview and apply refuse them with 409 `LOCKED_OBJECT` and no model call; a regenerate that sneaks a locked id in is 502 `SCHEMA_INVALID_LLM`; a note on a locked scene or in a locked episode changes nothing, and an apply of the unlocked rows leaves the locked scene byte-identical; Vitest: the verb is absent on a locked scene and in a locked episode). Then Vitest — `fixInstruction` reads in words with no raw id; the verb only on continuity notes and gone while locked; opening the editor sends nothing; Open Review sends one create (scene, edited text) and navigates; Stay sends nothing; a failed create shows inline, keeps the text and restores discarded drafts; the existing Open Review tests unchanged. E2E `plan-notes.spec.ts` — the scene-5 note → locking hides the verb → unlock → Draft a fix → edit → Open Review lands on Review showing the instruction. No contract, prompt or PROMPT_VERSION change.

- [ ] **Test plan:** under "Lock enforcement (the non-negotiables)" add a sub-bullet:

  > - Draft a fix in Review (T3.9, `test_change_sets_note_fix_locks.py`, written first): a Change Set created from a note-shaped instruction annotates locked rows; preview of a locked id → 409 `LOCKED_OBJECT` with zero `regenerate_elements` calls; a regenerate reply naming a locked id → 502 `SCHEMA_INVALID_LLM`; a locked target scene or locked episode → nothing previewable, and applying the unlocked rows leaves the locked scene byte-identical.

  In the Frontend unit paragraph, after the "Plan chart and order check (T3.7)" sentence, add: "Plan Draft a fix (T3.9): `fixInstruction` (where the note is, other scenes by card number and place, the fact quoted, a gone scene as 'a deleted scene', never a raw id or `[code]`); the verb only on continuity notes, never on a locked scene or episode (an open editor goes on lock); opening and editing send nothing; Open Review sends one create with the scene and the trimmed text, reads 'Opening…' and holds Plan's writes; a failure shows inline and keeps the text; the leave guard asks with other drafts (Stay sends nothing; Discard and a failed create restore them)." In the E2E paragraph, after the T3.4 notes-and-drafts sentence, add: "Draft a fix (T3.9, `plan-notes.spec.ts`): the scene-5 note → lock hides the verb → unlock → Draft a fix → edited instruction → Review shows it (then discarded via the API, for the shared DB)."

- [ ] **Handoff decision log:** append a row after the last 2026-10-13 row (after the T3.8 row if that PR merged first):

  > | 2026-10-14: "Draft a fix in Review…" on Plan's continuity notes (T3.9, owner decision 3). An inline instruction, prefilled from the note in words and editable, goes through the existing Change Set create (no new endpoint, operation, schema or prompt) and on to Review behind the same leave-Plan guard as Open Review. Hidden on locked scenes and episodes and on act-split, import and Order notes; the target is the note's scene; the edited text is not a Plan draft; the note stays open after its fix is applied. Lock-violation tests landed first | A note said what was wrong, but the only ways on were Write or Dismiss; Review already plans multi-scene fixes and never changes locked content |

Run: nothing to lint (`make lint` does not cover `docs/`); reread each edit in context and keep the surrounding Markdown table and bullet shapes intact.

Commit: `docs: Draft a fix in Review (T3.9)`

---

## Done when

- `pytest -q tests/test_change_sets_note_fix_locks.py tests/test_change_sets_create.py tests/test_change_sets_apply_locks.py tests/test_change_sets_preview_apply.py tests/test_locks.py` green; `ruff check apps/api` clean; `scripts/check_contract.py` green with no diff.
- `(cd apps/web && npx vitest run)` green; `npx tsc -b` clean; eslint + prettier clean on every touched file.
- E2E `plan-notes.spec.ts`, `plan.spec.ts`, `review.spec.ts`, `recipes.spec.ts` green (Write-mode failures compared against `origin/main`); temporary config and symlink deleted.
- `git log --oneline main..` shows the lock-test commit first. `git diff main --stat` touches no file under `apps/api` except the new test, nothing in `packages/contract`, `config/tool_schemas/`, `docs/tableread-data-contract.md` or `docs/tableread-prompt-spec.md`.
- PR description quotes the T3.9 acceptance line with pass/fail per clause and states: no schema, prompt, PROMPT_VERSION, dependency or token change.
