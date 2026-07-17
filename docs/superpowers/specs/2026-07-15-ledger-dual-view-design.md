# Ledger dual view — Story Atlas + Knowledge Web

**Date:** 2026-07-15  
**Status:** approved (conversation)  
**Authority after merge:** updates `docs/tableread-ui-spec.md` §7 (Ledger mode), `docs/narrative-sidekick-design-doc.md` §4.6 (Ledger as inspectable story bible), `docs/tableread-test-plan.md`, and `docs/tableread-build-plan.md` (new task, suggested **T5.2** under Ledger). **No schema / contract / prompt changes** — `PROMPT_VERSION` stays; no `make evals`.

## 1. Goal

Ledger today is correct but clinical: filter rail + amber queue + two-column fact cards read like a database admin tool. Writers open Ledger to understand **what is true in the story world**. The redesign keeps every existing capability (filters, review queue, accept/edit/reject/batch, source-span jump, confidence, known-by, supersede chains, versioned mutations) while presenting facts as a **delightful, scannable story bible** with two interchangeable views:

| View | Job |
|---|---|
| **Story Atlas** (default) | Compact expandable rows grouped by storytelling meaning |
| **Knowledge Web** | Who-knows-what graph focused on a character (or audience) |

Writers swap views via a Quiet Tool segmented control. Preference persists per project in `localStorage` (same spirit as resume).

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Primary product job | Understand what is true (story bible), not inbox-first |
| Default density | Balanced: compact rows that expand for detail |
| Views | Atlas + Web only (Continuity Desk not a third mode) |
| View switcher | Segmented control in page header: **Atlas · Web** |
| Persistence | `localStorage` key scoped by project id (e.g. `tr.ledger.view.{projectId}`) |
| Shared rail | “Lenses” + Status — same filter power as today, friendlier labels |
| Review queue | Remains pinned at top when non-empty in **both** views |
| Mutations | Unchanged APIs; Accept / Edit / Reject / batch / If-Match / undo |
| Contract / API | No new endpoints; client-only presentation + local view preference |
| Evals | Not required |
| Graph library | No new dependency for MVP — CSS/absolute or simple layered layout |

## 3. Non-goals

- Continuity Desk as a third mode
- Full force-directed physics / graph library (v2)
- New ledger fields, fact types, or server-side grouping
- Episode / storyline filters beyond current rail (v2)
- Changing accept/edit/reject semantics or snapshot behavior
- Hardcoded colors outside `--tr-*` tokens

## 4. Information architecture

### 4.1 Page chrome

```
┌ AppShell ──────────────────────────────────────────────────┐
│ … · Ledger (active) · …                                    │
├──────────┬─────────────────────────────────────────────────┤
│ Lenses   │  What’s true in this story          [Atlas|Web] │
│ (shared) │  optional subtitle + “N to review” chip         │
│          │  ─────────────────────────────────────────────  │
│ Status   │  [ Review queue when pending > 0 ]              │
│          │  Active view body (Atlas list OR Web graph)     │
└──────────┴─────────────────────────────────────────────────┘
```

- **Title:** display font — “What’s true in this story”
- **Switcher:** coral-soft active segment (match mode switcher / craft picker)
- **Pending chip:** amber when `pending_review` count > 0; click scrolls to / focuses review queue

### 4.2 Shared Lenses rail (replaces raw FilterRail copy)

Keep `LedgerFilters` model (`status`, `characterId`, `factType`). Relabel for writers:

| Current | Writer-facing |
|---|---|
| Status → All / pending_review / active / … | Status → All / Needs review / Active / Superseded / Stale / Rejected |
| Character → All / names | People → All / character names (also drives Web focus when Web is active) |
| Fact type → All / event / state / … | Lenses → All truths / Events / States / Knowledge / Relationships / World rules |

Rail chrome: warm sunken panel (may share Write outline amber-soft wash if `WRITE_WHIMSY` / Ledger whimsy flag is on — optional; tokens only). Width stays `--tr-panel-ledger-filters` (198px).

### 4.3 Review queue (both views)

Unchanged behavior from UI spec §7 / current `LedgerScreen`:

- Amber section when pending non-empty
- “Accept all high-confidence (n)”
- Per-scene grouping with Accept scene / Reject scene
- Cards use the same detail actions as expanded Atlas rows

Presentation polish only: friendlier scene labels (location slug when resolvable from project, not raw `scene-38`), quieter batch chrome.

## 5. Story Atlas

### 5.1 Grouping

Group **filtered non-queue facts** (same exclusion rule as today: pending stay in queue unless status filter is pending_review) into chapters by `factType`:

| Chapter | `factType` |
|---|---|
| People & knowledge | `knowledge` (+ optionally `state` that is character-tied — MVP: knowledge only; states in States) |
| Events | `event` |
| States | `state` |
| Relationships | `relationship` |
| World rules | `world_rule` |

Empty chapters omitted. Chapter header: display/secondary label + count.

### 5.2 Row anatomy

**Collapsed (default):**

1. Type cue chip (short: EVENT / STATE / KNOWS / REL / RULE)
2. Fact text (15px primary, one-line clamp or two-line max)
3. Trailing muted: known-by initials or “audience”, scene link label

**Expanded:**

- Full fact text
- Type · source-span link · known-by chips · confidence bar · provenance · status
- Supersede chain (existing)
- Queue actions when `pending_review` (Accept / Edit / Reject)

Click row toggles expand; only one expanded at a time per chapter (or globally — pick **one expanded globally** for simplicity).

### 5.3 Empty / filtered empty

Keep product copy from UI spec §7: empty ledger message; filtered empty “No facts match.”

## 6. Knowledge Web

### 6.1 Focus

- Focus character = `filters.characterId`, or **Audience** when `characterId === null` (default “All” means audience-centric overview: facts with empty `knownBy`, plus a short prompt to pick a person)
- When a person is selected in People, Web centers on that character

### 6.2 Nodes & edges

- **Center:** focus character (or Audience)
- **Fact nodes:** facts where:
  - focus is in `knownBy` / `knownByAsOf`, OR
  - focus is Audience and effective known-by is empty, OR
  - fact text mentions the focused character’s name (best-effort; no NLP)
- Prefer `knowledge` and `relationship` fact types when ranking; cap visible fact nodes at **24** with **+N more → Atlas** overflow chrome
- **Spokes:** SVG paths from focus → each visible fact (radial/arc layout)
- **Mini-edges:** light SVG links between visible facts that share knowers, and between facts tied by relationship co-mentions (character names in text). Cap degree / edge count so the web stays readable. No force-directed physics / no graph library.

### 6.3 Interaction

- Click / keyboard-activate fact node → side detail panel with same fields/actions as Atlas expanded row
- Click “Open in Atlas” jumps to Atlas view and expands that fact
- “+N more” switches to Atlas (browse full set under current filters)
- Empty graph: “No knowledge facts for {name} yet” + People / Atlas nudge; Audience/All empty or sparse → stronger “pick a person” cliff copy

### 6.4 Layout

Layered placement without a graph library:

- Focus node fixed center-left on a taller clay-wash canvas
- Fact nodes placed on an arc/radial ring to the right of focus (pure layout helper + SVG)
- Dense node chrome: type cue · scene · knower count; selected = accent outline + lift (`--tr-*` motion tokens)
- Soft clay wash always on; no `LEDGER_WHIMSY` flag (decorative extras stay token-bound and ship without a kill switch)

## 7. Whimsy / visual language

Stay inside Quiet Tool + existing tokens (`--tr-*`):

- Page: `bg-tr-surface-page` or light clay wash on the main column
- Titles: `font-display`
- Pending: amber-soft, never alarm-red for normal review
- Confirmed: sage chips
- No purple AI gradients, no emoji, no new hard-coded hex in components
- Optional `LEDGER_WHIMSY` flag parallel to `WRITE_WHIMSY` for rollback of purely decorative extras (chapter wash, soft motion). Prefer shipping Atlas/Web structure without requiring a flag; use a flag only if decorative extras risk overreach.

## 8. Components / files

| Unit | Responsibility |
|---|---|
| `ledger/LedgerScreen.tsx` | Load data, mutations, view state, queue, wire Atlas/Web |
| `ledger/LedgerViewSwitcher.tsx` | Atlas · Web segmented control + persistence helper |
| `ledger/LensesRail.tsx` | Relabeled FilterRail (or evolve `FilterRail.tsx` in place) |
| `ledger/StoryAtlas.tsx` | Chapter grouping + expandable rows |
| `ledger/KnowledgeWeb.tsx` | Focus graph + detail panel |
| `ledger/FactCard.tsx` | Reuse / slim for detail panel + queue (avoid duplicating edit form) |
| `ledger/factChapters.ts` | Pure grouping helpers + tests |
| `ledger/knowledgeGraph.ts` | Pure node selection helpers + tests |
| Tests | Switcher persistence; Atlas chapters; Web focus; existing mutation tests stay green |
| Docs | UI spec §7, design doc §4.6, build plan T5.2, test plan |

## 9. Acceptance criteria

1. Writer can switch Atlas ↔ Web; choice persists for the project after reload.
2. Atlas groups facts by storytelling chapters; rows expand for full metadata and actions.
3. Web shows a character-focused knowledge graph with clickable fact detail and queue actions when pending.
4. Review queue, batch accept, scene batch, source-span → Write, edit/accept/reject, and head refresh after mutations still work.
5. Filters (lenses) affect both views; People selection sets Web focus.
6. No contract/schema/prompt changes; tokens only; `make test` green for touched packages.
7. Empty and filtered-empty states remain clear and on-brand.

## 10. Suggested build-plan task

**T5.2 Ledger dual view (Atlas + Knowledge Web).** Client presentation redesign per this spec.  
*Accept:* criteria in §9.

## 11. Open questions (resolved)

| Question | Resolution |
|---|---|
| Primary job? | Story bible (“what’s true”) |
| Density? | Balanced expand-to-detail |
| Which mockups? | A + B with header swap |
| Switcher chrome? | Segmented control in page header |
| Third Continuity Desk mode? | Out of scope |
