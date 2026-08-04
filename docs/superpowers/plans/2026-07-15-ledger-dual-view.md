# Ledger Dual View (Atlas + Knowledge Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Ledger as a story bible with two swappable views — Story Atlas (chaptered expandable facts) and Knowledge Web (character-focused knowledge graph) — without changing APIs or schemas.

**Architecture:** Keep `LedgerScreen` as the mutation/data owner. Extract pure helpers for chapter grouping, graph node selection, and view persistence. Presentational components (`LedgerViewSwitcher`, `StoryAtlas`, `KnowledgeWeb`) consume facts + filters; reuse `FactCard` for queue + detail panels. Relabel `FilterRail` in place (or thin `LensesRail` wrapper).

**Tech Stack:** React 18 + TypeScript + Vite + Vitest + Tailwind (`--tr-*` tokens only). No new npm dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-ledger-dual-view-design.md`
- No Zod/Pydantic/prompt/tool-schema changes; no `make evals`
- Tokens only (`--tr-*`); no hardcoded colors/spacing in components
- Never call Anthropic in tests; existing Mock patterns unchanged
- Commit style: `area: imperative summary` (e.g. `ledger: add story atlas chapters`)
- Workspace: `/Users/rolandonavarrete/Documents/tableread`
- Do not commit unrelated Write-mode / whimsy dirty files; stage only Ledger dual-view paths
- Prefer `npx vitest run src/ledger/...` from `apps/web` for focused tests

## File structure

| File                                         | Role                                   |
| -------------------------------------------- | -------------------------------------- |
| `apps/web/src/ledger/viewPreference.ts`      | load/save Atlas\|Web per projectId     |
| `apps/web/src/ledger/factChapters.ts`        | group facts into storytelling chapters |
| `apps/web/src/ledger/knowledgeGraph.ts`      | select focus + fact nodes for Web      |
| `apps/web/src/ledger/LedgerViewSwitcher.tsx` | Atlas · Web segmented control          |
| `apps/web/src/ledger/StoryAtlas.tsx`         | chapter list + expandable rows         |
| `apps/web/src/ledger/KnowledgeWeb.tsx`       | graph + detail panel                   |
| `apps/web/src/ledger/FilterRail.tsx`         | writer-facing labels (Lenses)          |
| `apps/web/src/ledger/LedgerScreen.tsx`       | wire switcher, views, shared queue     |
| `docs/tableread-ui-spec.md` §7               | document dual view                     |
| `docs/tableread-build-plan.md`               | add T5.2                               |
| matching `*.test.ts(x)` beside code          | unit coverage                          |

---

### Task 1: Pure helpers — view preference, chapters, knowledge graph

**Files:**

- Create: `apps/web/src/ledger/viewPreference.ts`
- Create: `apps/web/src/ledger/viewPreference.test.ts`
- Create: `apps/web/src/ledger/factChapters.ts`
- Create: `apps/web/src/ledger/factChapters.test.ts`
- Create: `apps/web/src/ledger/knowledgeGraph.ts`
- Create: `apps/web/src/ledger/knowledgeGraph.test.ts`

**Interfaces:**

- Produces:
  - `export type LedgerViewId = 'atlas' | 'web'`
  - `loadLedgerView(projectId: string): LedgerViewId`
  - `saveLedgerView(projectId: string, view: LedgerViewId): void`
  - `export type FactChapterId = 'knowledge' | 'event' | 'state' | 'relationship' | 'world_rule'`
  - `export interface FactChapter { id: FactChapterId; title: string; facts: LedgerFact[] }`
  - `groupFactsIntoChapters(facts: LedgerFact[]): FactChapter[]` — omit empty; order: knowledge, event, state, relationship, world_rule; titles: "People & knowledge", "Events", "States", "Relationships", "World rules"
  - `export interface KnowledgeGraphModel { focusId: string | null; focusLabel: string; factNodes: LedgerFact[] }`
  - `buildKnowledgeGraph(facts: LedgerFact[], project: Project, characterId: string | null, cap?: number): KnowledgeGraphModel` — focusLabel from character name or "Audience"; when `characterId` set, facts where `knownBy` includes id (prefer knowledge/relationship first, then others); when null, facts with `knownBy.length === 0` (audience-only); cap default 24

- [ ] **Step 1: Write failing tests** for preference round-trip (mock localStorage), chapter grouping order/omit-empty, graph focus filters + cap

- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/ledger/viewPreference.test.ts src/ledger/factChapters.test.ts src/ledger/knowledgeGraph.test.ts` — expect FAIL (modules missing)

- [ ] **Step 3: Implement** the three modules

- [ ] **Step 4: Re-run tests** — expect PASS

- [ ] **Step 5: Commit** only these six files: `ledger: add atlas/web helpers for dual view`

---

### Task 2: View switcher + Lenses rail labels

**Files:**

- Create: `apps/web/src/ledger/LedgerViewSwitcher.tsx`
- Create: `apps/web/src/ledger/LedgerViewSwitcher.test.tsx`
- Modify: `apps/web/src/ledger/FilterRail.tsx`
- Modify: `apps/web/src/ledger/FilterRail.test.tsx` (if present; else create minimal assertions)

**Interfaces:**

- Consumes: `LedgerViewId`, `saveLedgerView` / `loadLedgerView` from Task 1
- Produces: `LedgerViewSwitcherProps { projectId: string; value: LedgerViewId; onChange: (v: LedgerViewId) => void }` — segmented **Atlas · Web**; `data-testid="ledger-view-switcher"`; active segment `bg-tr-coral-soft text-tr-accent-ink`; onChange also calls `saveLedgerView`
- FilterRail: legend "Status" options show writer labels (Needs review, Active, …); "Character" legend → "People"; "Fact type" → "Lenses"; option text: All truths / Events / States / Knowledge / Relationships / World rules — keep radio `value`s as existing enum strings

- [ ] **Step 1: Failing tests** — switcher calls onChange + persists; FilterRail shows "Needs review" and "Lenses"

- [ ] **Step 2: Implement** switcher + FilterRail copy

- [ ] **Step 3: Run** `npx vitest run src/ledger/LedgerViewSwitcher.test.tsx src/ledger/FilterRail.test.tsx` — PASS

- [ ] **Step 4: Commit** `ledger: add view switcher and lenses labels`

---

### Task 3: Story Atlas

**Files:**

- Create: `apps/web/src/ledger/StoryAtlas.tsx`
- Create: `apps/web/src/ledger/StoryAtlas.test.tsx`

**Interfaces:**

- Consumes: `groupFactsIntoChapters`, `FactCard` (or inline expand using FactCard when expanded)
- Produces: `StoryAtlasProps { facts: LedgerFact[]; allFacts: LedgerFact[]; project: Project; busy: boolean; onAccept; onReject; onEdit; onSourceSpanClick }` — renders chapters; collapsed row shows type cue + clamped fact + muted known-by/scene; click expands **one** fact globally using `FactCard` without `queueActions` (or with if pending); `data-testid="story-atlas"` and `data-testid={fact-chapter-${id}}`

- [ ] **Step 1: Failing test** — chapters render titles; expand shows fact full text / FactCard

- [ ] **Step 2: Implement StoryAtlas**

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit** `ledger: add Story Atlas chaptered list`

---

### Task 4: Knowledge Web

**Files:**

- Create: `apps/web/src/ledger/KnowledgeWeb.tsx`
- Create: `apps/web/src/ledger/KnowledgeWeb.test.tsx`

**Interfaces:**

- Consumes: `buildKnowledgeGraph`, `FactCard`
- Produces: `KnowledgeWebProps` same action props as Atlas + `characterId: string | null` — focus node + up to 24 fact node buttons; click selects detail (`FactCard`); empty state copy when no nodes; `data-testid="knowledge-web"`; fact nodes `data-testid={web-fact-${id}}`. Layout: CSS flex/absolute in a raised/clay panel; **no new dependencies**. Pending nodes: `bg-tr-amber-soft`.

- [ ] **Step 1: Failing tests** — focus label, node click opens detail, empty state

- [ ] **Step 2: Implement KnowledgeWeb**

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit** `ledger: add Knowledge Web view`

---

### Task 5: Wire LedgerScreen

**Files:**

- Modify: `apps/web/src/ledger/LedgerScreen.tsx`
- Modify: `apps/web/src/ledger/LedgerScreen.test.tsx` (extend)

**Interfaces:**

- Consumes: Tasks 1–4
- Behavior:
  - Header above queue: title “What’s true in this story” (`font-display text-17` or `text-22`), `LedgerViewSwitcher`, optional amber “N to review” chip
  - Keep existing review queue section
  - Replace plain grid with `view === 'atlas' ? <StoryAtlas …/> : <KnowledgeWeb … characterId={filters.characterId} />` for `gridFacts`
  - `useState` view initialized from `loadLedgerView(projectId)` when project loads
  - Scene group headers: prefer scene `location` from project when resolvable, else sceneId

- [ ] **Step 1: Extend LedgerScreen tests** — switcher present; Atlas default; selecting Web shows `knowledge-web`

- [ ] **Step 2: Wire LedgerScreen**

- [ ] **Step 3: Run** `npx vitest run src/ledger` — all PASS

- [ ] **Step 4: Commit** `ledger: wire Atlas and Knowledge Web dual view`

---

### Task 6: Docs

**Files:**

- Modify: `docs/tableread-ui-spec.md` §7
- Modify: `docs/narrative-sidekick-design-doc.md` §4.6 (brief)
- Modify: `docs/tableread-build-plan.md` — add **T5.2** after existing Ledger tasks
- Modify: `docs/tableread-test-plan.md` — Atlas/Web switch + chapter grouping notes

- [ ] **Step 1: Update docs** to match shipped behavior (no DESIGN-GAP without task id)

- [ ] **Step 2: Commit** `docs: Ledger dual-view Atlas + Knowledge Web (T5.2)`

---

## Spec coverage checklist

| Spec §                        | Task         |
| ----------------------------- | ------------ |
| View switcher + persistence   | 1, 2, 5      |
| Lenses rail labels            | 2            |
| Review queue both views       | 5 (preserve) |
| Story Atlas chapters + expand | 3, 5         |
| Knowledge Web + detail        | 4, 5         |
| No API/schema changes         | all          |
| Docs / T5.2                   | 6            |
