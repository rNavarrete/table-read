# Write Script Home (T2.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Write mode into an Arc-style episode script home: left scene outline, continuous scrollable script, active-scene generation — without new APIs.

**Architecture:** Client-only. `WriteScreen` owns `activeSceneId` (URL → resume → `pickDefaultScene`). New `SceneOutline` navigates; `ScriptCanvas` stacks all scenes in one scrollport. Candidate dock / command bar keep binding to `activeSceneId`.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind (`apps/web`); Vitest + Testing Library; existing `--tr-*` tokens (`--tr-panel-story-layers` for outline width).

## Global Constraints

- No schema / contract / prompt / `PROMPT_VERSION` changes; no `make evals`.
- Tokens only — reuse `--tr-panel-story-layers` (232px) for outline; no new colors.
- Quiet AI + existing Write shortcuts preserved; add `[` / `]` for prev/next scene when not typing.
- Outline is navigate-only (no drag-reorder).
- Plan remains sole structural editor.
- Spec: `docs/superpowers/specs/2026-07-14-write-script-home-design.md`.

---

### Task 1: SceneOutline

**Files:**
- Create: `apps/web/src/write/SceneOutline.tsx`
- Create: `apps/web/src/write/SceneOutline.test.tsx`
- Modify: none yet

**Interfaces:**
- Consumes: `Scene[]` via `allScenes`-shaped list; `activeSceneId: string`
- Produces: `SceneOutline({ scenes, activeSceneId, onSelect })` with `data-testid="write-scene-outline"` and row `write-outline-{id}`

- [ ] **Step 1: Write failing tests** for list rendering, active row class, click calls `onSelect(sceneId)`.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/web && npx vitest run src/write/SceneOutline.test.tsx
```

- [ ] **Step 3: Implement `SceneOutline`** — sunken panel `w-panel-story-layers`, header `Scenes · {n}`, rows with slug + clamped whatHappens, active = Plan-like coral-soft selection.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `write: add SceneOutline for script-home nav`

---

### Task 2: Multi-scene ScriptCanvas

**Files:**
- Modify: `apps/web/src/write/ScriptCanvas.tsx`
- Modify: `apps/web/src/write/ScriptCanvas.test.tsx`

**Interfaces:**
- Consumes: either keep `scene: Scene` for back-compat *or* switch to `scenes: Scene[]` + `activeSceneId` + `onSceneFocus(sceneId)` + `highlightBeatId`
- Produces: each scene section `data-testid="write-scene-{id}"`; existing beat testids unchanged

- [ ] **Step 1: Extend tests** — two scenes render two headers/sections; focusing a beat textarea calls `onSceneFocus` with that scene’s id.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — stack scenes inside one raised sheet (or one sheet per scene stacked in a column); export `sceneSlug` if needed by outline; wire focus → `onSceneFocus`.

- [ ] **Step 4: Run — expect PASS** (update old single-scene tests to pass `scenes={[scene]}` or overload).

- [ ] **Step 5: Commit** `write: stack episode scenes in ScriptCanvas`

---

### Task 3: WriteScreen layout + active scene + scrollport

**Files:**
- Modify: `apps/web/src/write/WriteScreen.tsx`
- Create: `apps/web/src/write/WriteScreen.test.tsx` (if none) or extend

**Interfaces:**
- Consumes: Task 1–2 components; `allScenes`, `pickDefaultScene`, resume helpers
- Produces: scrollport wrapper `data-testid="write-scrollport"`; outline wired; generation uses `activeSceneId`

- [ ] **Step 1: Failing test** — with two scenes, outline click updates which scene id is passed to a mocked generate path / visible active outline row; scrollport has overflow-y.

- [ ] **Step 2: Implement layout**

```
flex min-h-[calc(100vh-shell)] overflow-hidden
  SceneOutline (own overflow-y)
  div.write-scrollport (flex-1 overflow-y-auto) > ScriptCanvas
  CandidateDock
CommandBar → activeSceneId
```

- Key candidate session on `activeSceneId` (reset on change).
- Outline click: set active, `history.replaceState` `?scene=`, `saveResume`, `scrollIntoView` on scene section.
- `[` / `]` in `useWriteKeyboard` (or WriteScreen keydown): prev/next scene when not quiet/typing.

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit** `write: wire script-home outline and scrollport`

---

### Task 4: Scroll spy + deep-link polish

**Files:**
- Modify: `apps/web/src/write/WriteScreen.tsx`
- Modify: `apps/web/src/write/WriteScreen.test.tsx` / ScriptCanvas highlight tests

- [ ] **Step 1: On mount / `highlightBeatId`**, scroll beat into view (existing highlight stays).
- [ ] **Step 2: IntersectionObserver** on scene sections updates `activeSceneId` while scrolling, suppressed briefly after outline click and while a beat textarea has focus.
- [ ] **Step 3: Test** suppress flag / focus-wins behavior with a light unit or integration test.
- [ ] **Step 4: Commit** `write: sync outline with scroll and deep links`

---

### Task 5: Authority docs

**Files:**
- Modify: `docs/tableread-ui-spec.md` §4
- Modify: `docs/narrative-sidekick-design-doc.md` §4.3
- Modify: `docs/tableread-build-plan.md` (add T2.4)
- Modify: `docs/tableread-test-plan.md` (outline / scroll / active scene)

- [ ] **Step 1: Update docs** to match shipped behavior (quote acceptance criteria).
- [ ] **Step 2: Commit** `docs: Write script home (T2.4)`

---

### Task 6: Verify

- [ ] `cd apps/web && npx vitest run src/write`
- [ ] `make lint` (or web eslint/prettier for touched files)
- [ ] Manual smoke: open imported pilot → scroll → outline jump → Next Beat on active scene
