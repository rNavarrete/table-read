# Write mode “script home” (Option A) — design spec

**Date:** 2026-07-14  
**Status:** approved (conversation)  
**Authority after merge:** updates `docs/tableread-ui-spec.md` §4 (Write mode layout), `docs/narrative-sidekick-design-doc.md` §4.3 (script canvas as episode home), `docs/tableread-test-plan.md`, and `docs/tableread-build-plan.md` (new task, suggested **T2.4**). **No schema / contract / prompt changes** — `PROMPT_VERSION` stays; no `make evals`.

## 1. Goal

Write mode becomes the place a writer **reads the episode, jumps to a scene, and drafts the next beat** — an Arc Studio–style script home — without turning Write into a second Plan board.

Today Write shows one scene with no in-mode navigator and a non-scrolling page body. After a large import that is unusable: the writer lands on junk (“UNTITLED SCENE” / title page), cannot scroll, and cannot jump.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Layout | Left **scene outline** (~220px, `--tr-panel-*` token or reuse Story Layers width 232px) · center **continuous episode script** · right **candidate dock** (unchanged) · bottom **command bar** (unchanged shape) |
| Script model | All episode scenes stacked in document order in one scrollable teleplay column; each scene has an in-flow header (slug + whatHappens) and its beats as today |
| Active scene | Scene that owns focus/caret, or last outline click / URL `?scene=` / resume jump. Always one active scene. |
| Generation target | `Q`, command bar, Accept insert, Tune — all use **active scene id** (same APIs as today) |
| Outline row | Index · slug (location/time) · one-line whatHappens clamp; active row accent; click scrolls scene into view and sets active |
| Scroll | Write content area is the scrollport (`overflow-y: auto`); script page grows with content; beat textareas keep auto-grow |
| Outline collapse | Optional collapse control; collapsed state browser-local per project (same spirit as resume) |
| Structure edits | Still Plan only (reorder, act frames, locks UI, skeleton). Outline is navigate-only in v1 — no drag-reorder in Write |
| Quiet AI | Unchanged: canvas focus dims dock; no proactive generation |
| Keyboard | Existing Write shortcuts unchanged; add `[` / `]` for previous/next scene (outline + scroll + active). Disabled while typing in a field (same quiet rule as other Write keys) |
| Deep links | Ledger `highlightBeat` / `?scene=` still work: set active scene, scroll target beat into view, 2s highlight |
| Default open | Keep `pickDefaultScene` (skip unusable stubs); outline still lists all scenes so title-page junk is visible and skippable |
| Contract / API | No new endpoints; client-only layout + scroll/active-scene state |
| Evals | Not required |

## 3. Non-goals

- Drag-reorder scenes from the Write outline (Plan owns that)
- Multi-episode / season navigator (MVP is one episode)
- Full Final Draft Navigator columns (characters, tags, filters)
- Novelcrafter-style timeline rail or per-scene meta chrome on the right (dock stays candidates)
- Import parser fix for title-page-as-scene (track separately; outline + pickDefaultScene mitigate)
- Changing candidate generation, Accept/Tune/Skip, or craft-level UX

## 4. UI design

### 4.1 Shell inside Write

```
┌ AppShell ─────────────────────────────────────────────┐
│ Write | Plan | Review | Ledger                        │
├──────────┬────────────────────────────┬───────────────┤
│ Outline  │  Continuous script sheet   │ Candidate     │
│ (scroll) │  (main scrollport)         │ dock          │
│          │                            │               │
│ sc 1 …   │  SCENE 2 header            │ Craft level   │
│ sc 2 ●   │  beat …                    │ Next Beat [Q] │
│ sc 3 …   │  SCENE 3 header            │ cards         │
├──────────┴────────────────────────────┴───────────────┤
│            Command bar (active scene)                 │
└───────────────────────────────────────────────────────┘
```

- Main row: `flex` with `min-h-0` under AppShell; **center column** is `overflow-y: auto` and owns episode scroll.
- Outline has its own `overflow-y: auto` so a 100-scene list does not stretch the page.
- Command bar remains floating; content gets bottom padding so the last beats are not covered (`pb-24` today — keep).

### 4.2 Scene outline

- Header: `Scenes · {n}`
- Rows: `data-testid="write-outline-{sceneId}"`; active: coral-soft / accent ink per existing selection tokens (match Plan scene-card selected treatment, not new colors).
- Click: `setActiveScene(id)` → update URL `?scene=` (replaceState) → `saveResume` → `scrollIntoView` on `data-testid="write-scene-{id}"`.
- Unusable scenes (empty location/whatHappens) still listed; slug falls back to `Untitled scene` as today.

### 4.3 Continuous script canvas

Replace single-`scene` `ScriptCanvas` usage with an episode canvas:

- Outer: scrollport wrapper.
- For each scene: section with `id` / `data-testid="write-scene-{sceneId}"`, scene header (slug + pitch), then existing beat rows (extract current `BeatRow` / per-scene body unchanged in behavior).
- Typing in a beat’s textarea sets that scene active (focus handler).
- Locked beat / planned-beat / empty-scene copy unchanged per scene.

### 4.4 Active scene + generation

- State: `activeSceneId` in `WriteScreen` (derived initially from URL → resume → `pickDefaultScene`).
- `useCandidateSession` / `useAcceptBeat` / CommandBar keep taking `sceneId={activeSceneId}`.
- When active scene changes while a candidate session is streaming: **reset** the session (same as today’s scene change via remount/key — key dock/session on `activeSceneId`).
- Accept still inserts into the active scene’s beat list via existing accept API.

### 4.5 Scroll sync (outline ↔ script)

- On outline click: programmatic scroll to scene section; set a short “suppress spy” flag so IntersectionObserver does not fight the jump.
- While scrolling: IntersectionObserver (or rootMargin-tuned) updates active scene to the topmost mostly-visible scene header — **only when not typing** (if canvas has focus inside a beat, do not steal active scene from caret’s scene).
- Caret/focus in a beat always wins over scroll spy.

## 5. Components / files

| Unit | Responsibility |
|---|---|
| `write/SceneOutline.tsx` | Presentational outline list + collapse |
| `write/EpisodeCanvas.tsx` (or evolve `ScriptCanvas.tsx`) | Stack scenes; per-scene headers; reuse beat editing |
| `write/WriteScreen.tsx` | Active scene state, URL/resume, scroll spy, wire generation |
| `write/projectTree.ts` | Keep `allScenes` / `pickDefaultScene`; no server changes |
| Tests | Outline click sets active + scroll target; scrollport exists; generation uses active scene; deep-link highlight still works |

## 6. Authority doc updates (same PR or follow-up commit in the task)

- **UI spec §4:** layout gains left outline; script is episode-continuous; active-scene rules; `[`/`]` shortcuts.
- **Design doc §4.3:** “current scene” → “episode script with active scene”; outline as navigate-only.
- **Build plan:** add **T2.4 Write script home** under Milestone 2 (or M5 if sequencing prefers post-import) with acceptance criteria mirroring §2.
- **Test plan:** outline navigation, scrollport, active-scene generation target, Ledger jump.

## 7. Acceptance criteria

1. Writer can scroll the full imported episode in Write without the page trapping content.
2. Outline lists every scene; click jumps to that scene and highlights the row.
3. Next Beat / command bar / Accept operate on the active scene.
4. `?scene=` and Ledger `highlightBeat` still land on the right beat with highlight.
5. Plan remains the only place to reorder scenes / edit act structure.
6. Quiet AI and existing Write keyboard shortcuts still hold; `[`/`]` move scenes when not typing.
7. No contract/schema/prompt changes; `make test` / lint green for touched packages.

## 8. Out-of-band follow-up

- Import: avoid promoting title-page / set-list blocks to real scenes (parser / segment heuristics) — separate task; not required for T2.4 to ship.
