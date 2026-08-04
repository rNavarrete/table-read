# Ledger Atlas organization research

**Date:** 2026-07-17  
**Status:** research note — recommendations only; no product code in this change  
**Scope:** Table Read Ledger → **Story Atlas** (not Knowledge Web): chapters, type cues, FilterRail / “As of”, dense post-import ledgers (~700 facts, noisy cast)  
**Companion canvas:** open beside chat at  
`~/.cursor/projects/Users-rolandonavarrete-Documents-tableread-worktrees-import-coverage-cost/canvases/ledger-atlas-org-research.canvas.tsx`  
**Related:** dual-view design `2026-07-15-ledger-dual-view-design.md`; time-aware ledger `2026-07-16-time-aware-ledger-design.md`; Web research `2026-07-17-knowledge-web-graph-ux-research.md`

---

## 0. Authority

| Layer                                        | Role                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/narrative-sidekick-design-doc.md` §4.6 | Product intent: Ledger = inspectable “what is true” / story bible; Atlas + Web; shared lenses                                             |
| `docs/tableread-ui-spec.md` §7               | Writer-facing Atlas chapters, row anatomy, FilterRail                                                                                     |
| `packages/contract` / data contract          | Executable `factType`, `knownBy`, `audienceKnows`, statuses — **do not invent new fact types or rewrite who-knows semantics in UI alone** |
| This note                                    | Organization / tagging _presentation_ and rail IA; import quality called out as a separate track                                          |

If a recommendation needs new fact types, persisted tags, or prompt changes, it must go through the full schema/prompt path (AGENTS.md rules 3 & 7). UI regrouping over existing fields does not.

---

## 1. User-reported problem

On Atlas, with **Status = All** and **As of = Latest**, the chapter **People & knowledge (52)** shows a wall of nearly identical cards: gray **KNOWS** pill → fact text → knower initials → ep/sc/beat. Facts feel unorganized / incorrectly tagged; the left rail (Status + As of scene list) feels unhelpful.

Two separable causes (do not conflate):

1. **UI organization** — chaptering + cues + rail make a dense, correctly typed knowledge set look uniform and hard to navigate.
2. **Import / extraction quality** — over-classification as `knowledge`, noisy cast minting, weak `knownBy` — makes tags feel “wrong” even when the Atlas is doing what the spec says. Track separately (prompts, entity mint, review queue), not only as chrome polish.

---

## 2. Diagnosis — current Atlas (repo truth)

### 2.1 Why every card shows **KNOWS** in People & knowledge

This is **chapter-driven**, not a second tagging system gone wrong.

1. Atlas chapters are a 1:1 map of `factType` (`factChapters.ts` / UI spec §7d):

   | Chapter            | `factType`     |
   | ------------------ | -------------- |
   | People & knowledge | `knowledge`    |
   | Events             | `event`        |
   | States             | `state`        |
   | Relationships      | `relationship` |
   | World rules        | `world_rule`   |

2. Collapsed rows always render a type cue from `factType` (`StoryAtlas.tsx`):

   ```ts
   knowledge → 'KNOWS'
   event → 'EVENT'
   // …
   ```

3. Therefore **inside** “People & knowledge”, every row’s pill is identically **KNOWS**. The chapter title already answered “what kind”; the pill adds no discrimination. It _looks_ like every fact is tagged the same way—because, at the `factType` layer, they are.

**“Who knows” is a different field.** `knownBy` (and as-of `knownByAsOf`) + `audienceKnows` carry dramatic irony (design doc / prompt spec). Those appear as trailing initials / “audience”, not as the KNOWS pill. Naming the type cue **KNOWS** collides linguistically with “who knows,” which amplifies the sense that tagging is broken.

### 2.2 Why the sidebar feels weak for “browse what’s true”

`FilterRail` order today: **Status → As of (full scene list) → People → Threads → Lenses**.

| Control | Job when browsing dense Atlas              | At default (All / Latest)                                           |
| ------- | ------------------------------------------ | ------------------------------------------------------------------- |
| Status  | Workflow (queue vs active vs rejected)     | **No-op** — still dominates the rail                                |
| As of   | Continuity question (“true as of scene N”) | **No-op** as “Latest”; long radio list burns space                  |
| People  | Who-knows / character bible cut            | High value — buried below As of                                     |
| Lenses  | Same axis as chapters (`factType`)         | High value but **redundant** with chapter headers when “All truths” |
| Threads | Setups/payoffs                             | Orthogonal, useful but not primary browse                           |

Facet literature and tool practice agree: put **high-discrimination** facets first, show **counts**, collapse low-use facets, don’t dedicate prime space to identity filters (All / Latest) that don’t change the set.

Also: People filter matches `knownBy` only (`filters.ts`) — it does not surface “facts _about_ this character” if they aren’t listed as knowers. Character-bible mental model (Scriptation / room practice) expects **sections per character**, not only “facts this person knows.”

### 2.3 Uniform card wall

Collapsed rows share the same visual weight: neutral chip + 1–2 lines of text + muted metadata. No progressive disclosure within a chapter (no knower clusters, no audience-vs-secret bands, no scene subheads). At ~50–200 knowledge facts that wall is exactly the failure mode Scrivener/Obsidian/Heptabase users avoid with labels, MOCs, or sectioned boards.

### 2.4 Dual-view already anticipated a softer chapter

Dual-view design §5.1: People & knowledge = `knowledge` **(+ optionally character-tied `state` — MVP: knowledge only)**. That optional merge was deferred; dense imports make the “everything is knowledge” chapter heavier, which increases pressure for **substructure**, not for more top-level `factType`s.

---

## 3. Patterns that work elsewhere

### 3.1 Story / development / room practice

| Pattern                                                                                     | Source                                                                                                                                                                                                                                                              | Takeaway for Atlas                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Character bible sections** (per-person FIRSTS / LASTS / NEED-TO-KNOW; episode event logs) | [Scriptation — TV show & character bibles](https://scriptation.com/blog/tv-show-bible-and-character-bibles-guide/)                                                                                                                                                  | Primary browse axis for “people” facts is often **character dossier**, not a flat type list                    |
| **Elements + scene linkage + tags**                                                         | StudioBinder Elements (cast/props linked to scenes; keywords)                                                                                                                                                                                                       | Entity-centric index with scene provenance — we already have `sourceSpan`; underuse entity grouping            |
| **Labels (singular, visual) vs keywords (multi, searchable)**                               | Scrivener corkboard / keywords ([Literature & Latte](https://www.literatureandlatte.com/blog/use-keywords-to-manage-your-scrivener-projects); [Writer Unboxed](https://writerunboxed.com/2022/02/22/scrivener-scenario-tag-color-code-and-organize-with-metadata/)) | One high-visibility cue per card; many cross-cutting tags for search — don’t put five equal pills on every row |
| **Pitch bible vs living production bible**                                                  | ScreenWeaver / Slima series-bible guides                                                                                                                                                                                                                            | Atlas is closer to the _living_ continuity bible; pitch-style chapter essays are not the job                   |

### 3.2 PKM / research

| Pattern                                                         | Source                                                                                                                                                                                  | Takeaway                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Folders/chapters = exclusive home; tags = cross-cutting signals | Obsidian community ([Holloran](https://danholloran.me/posts/tags-vs-folders-in-obsidian-how-to-organize-your-vault); [Das](https://blog.shuvangkardas.com/obsidian-note-organization/)) | Keep `factType` chapters; add orthogonal facets (people, audience/secret, scene) |
| Properties for queryable fields; tags for discovery             | Obsidian properties / Dataview discourse                                                                                                                                                | Prefer structured fields we already store over freeform writer tags (v1)         |
| MOCs when a tag area gets large                                 | Obsidian MOC threads                                                                                                                                                                    | Chapter TOC + per-character “maps” when N≫50                                     |
| Spatial sections without edge hairballs                         | Heptabase card library / sections                                                                                                                                                       | Subheads inside chapters beat another graph view for Atlas                       |

### 3.3 Faceted navigation / enterprise

| Pattern                                                       | Source                                                                                                                                                                                                                                                                                        | Takeaway                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 3–5 primary facets; progressive disclosure; counts on options | [A List Apart — faceted navigation](https://alistapart.com/article/design-patterns-faceted-navigation/); [Strynal](https://strynal.com/blog/filters-and-faceted-search/); [BTNG filter UX](https://www.btng.studio/articles/top-ecommerce-ux-filter-design-patterns-practical-tips-for-2025/) | Reorder rail; show `(n)` on People / Lenses / Status; collapse As of            |
| Removable active chips + Clear all                            | Same                                                                                                                                                                                                                                                                                          | Surface Status/As-of/People as chips above Atlas when non-default               |
| Label groups + saved views                                    | [Linear labels/filters](https://linear.app/docs/labels)                                                                                                                                                                                                                                       | Later: saved “Audience secrets”, “Marta knows” — not first slice                |
| Typed databases + filtered views                              | Notion / Airtable practice                                                                                                                                                                                                                                                                    | Web already owns focus-centric view; Atlas should own chapter + subfacet browse |

### 3.4 Continuity / script annotation

Scriptation’s value prop for character bibles is **tag facts in script drafts and retain them across revisions** — provenance-first. Table Read already jumps via `sourceSpan`; organization should amplify **character + scene**, not invent a parallel tag vocabulary before writers ask for freeform tags.

---

## 4. Ranked recommendations (Table Read–specific)

### R1 — Remove redundant type cues inside chapters; promote knower / irony cues (UI only)

**Problem:** Identical KNOWS pills create a false “everything mistagged” read.

**Change:**

- Inside a chapter matching `factType`, **omit** the type cue chip (or show it only when Lenses ≠ that chapter / when viewing a mixed list).
- Promote a **discriminating** chip instead, derived from existing fields only:
  - empty `knownBy` → **Audience** (or “audience only”)
  - non-empty + `audienceKnows === false` → **Secret** / irony cue (copy TBD with UI spec; semantics already in contract)
  - else → primary knower initials / “N knowers” (detail already has full chips)
- Keep full `factType` visible in expanded `FactCard` (source of truth for edit/review).

**Why first:** Fixes the screenshot symptom immediately; no schema; aligns Scrivener “one strong label”; clarifies KNOWS-as-type vs who-knows.

**Confidence:** high (~0.9)

### R2 — Rebuild FilterRail for browse-first IA (UI only)

**Reorder / progressive disclosure:**

1. **People** (with counts; search when cast is long; “Manage cast” stays)
2. **Browse / chapters** — sticky chapter TOC with counts (jump links into Atlas sections); Lenses can merge with this or stay as filter that collapses to one chapter
3. **Status** — collapsed by default; expand; show pending count in header chip (already partially exists)
4. **As of** — collapsed to a single control: `Latest` + compact scene picker (select/combobox), not a full radio list of every scene
5. Threads — keep, lower

Active non-defaults as removable chips above the list.

**Why:** Matches facet discrimination; Status/As-of stay available for their real jobs without owning the rail when idle.

**Confidence:** high (~0.85)

### R3 — Substructure inside large chapters (client grouping)

When a chapter exceeds ~20–24 facts, auto-subhead (pick one default; allow toggle later):

| Mode                                  | Group key                             | Best for                        |
| ------------------------------------- | ------------------------------------- | ------------------------------- |
| **By knower** (default for knowledge) | each `knownBy` id + “Audience” bucket | Character bible                 |
| **By scene**                          | `sourceSpan.sceneId`                  | Continuity / as-of mental model |
| **Irony**                             | audience-only / shared / secret       | Drama                           |

Empty `knownBy` = audience bucket (already product language). Multi-knower facts may appear under multiple knower subheads **or** under a “Shared” bucket — prefer **Shared + list knowers** to avoid card duplication (simpler, Quiet Tool).

**Confidence:** high (~0.8) for knower subheads on knowledge; medium for shipping all three modes at once.

### R4 — “About person” vs “Known by person” (careful semantics)

Today People = `knownBy` membership. Writers often want **facts mentioning / about** a character (character bible). Options:

- **A (safe):** keep filter = knownBy; add Web-style name mention heuristic as optional secondary (already contemplated for Web).
- **B (schema):** explicit `aboutCharacterIds` — contract change; defer.
- **C (UX):** when a person is selected, Atlas default subhead mode = that person’s dossier (knownBy filter + optional “also mentioned” section).

Recommend **A/C** before schema.

**Confidence:** medium (~0.65) — product wording needs a one-line decision (“knows” vs “about”).

### R5 — Import / tagging quality track (separate from Atlas chrome)

Symptoms that look like “wrong tags” but aren’t fixed by R1–R3:

- Events/states extracted as `knowledge`
- Walk-on cast flooded into People
- Weak or over-broad `knownBy`

Actions: eval samples on import ledgers; tighten classifier examples; cast merge (existing Manage cast / mint design); keep pending_review as the human filter. **Do not** paper over with freeform UI tags that diverge from `factType`.

**Confidence:** high that this is real and separate (~0.85); fix ownership is import/LLM, not Atlas layout alone.

### R6 — Later / defer

- Freeform writer tags / Linear-style label groups — needs contract + migration story
- New `factType` values — full schema path
- Merging character-tied states into People & knowledge (dual-view optional) — only after R3, with explicit chapter rules
- Saved facet views — after rail chips exist
- Making Atlas a second Knowledge Web — out of scope; Web owns focus-centric who-knows

---

## 5. Anti-patterns

1. **Repeating chapter identity on every row** (KNOWS wall).
2. **Equal-weight pill soup** (type + status + provenance + irony + knower all visible collapsed).
3. **Status/As-of as primary browse chrome** when both are identity values.
4. **Full scene radio lists** for temporal filters (use compact picker).
5. **Inventing parallel tag vocabularies** that disagree with `factType` / `knownBy`.
6. **Treating cast noise as a layout bug** — Manage cast + import quality first.
7. **Third Ledger view** for organization — dual-view already fixed Web vs Atlas jobs.
8. **Auto-executing filters from suggestion chips** — Quiet Tool / AI-quiet rules still apply.

---

## 6. Recommended next implementation slice

**Name:** Atlas browse clarity (UI-only)  
**Suggested build-plan home:** follow-on to T5.2 / Ledger dual-view (new task id when scheduled)  
**Out of scope for slice:** schema, prompts, `PROMPT_VERSION`, evals, new fact types

### Acceptance sketch

1. In Story Atlas, rows inside a single-`factType` chapter do **not** show that chapter’s redundant type cue (no KNOWS-everywhere in People & knowledge).
2. Collapsed rows show a knower/irony-discriminating cue per R1.
3. FilterRail: People (+ counts) above Status; As of is compact / collapsed, not a long always-open list.
4. Knowledge chapter with ≥20 facts groups under knower (or Audience) subheads.
5. Expanded `FactCard` still shows full type, knownBy, status, provenance.
6. No contract/OpenAPI/tool-schema diff; `make test` + Ledger unit/component tests updated.
7. UI spec §7 updated to match; this research note linked from the PR.

### Explicit non-goals for slice 1

- Import classifier retuning
- `aboutCharacterIds`
- Freeform tags
- Changing as-of _semantics_ (only chrome)

---

## 7. Confidence & sources

| Claim                                               | Confidence                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| KNOWS-everywhere is chapter + `TYPE_CUE` redundancy | **Very high** — confirmed in `StoryAtlas.tsx` / `factChapters.ts` / UI spec §7d             |
| Rail order mismatches browse jobs                   | **High** — `FilterRail.tsx` + facet UX literature                                           |
| Knower subheads improve dense knowledge chapters    | **High** — character-bible practice + PKM MOC pattern                                       |
| Import mistagging is a separate major driver        | **High** that it exists; **medium** on share of this user’s pain without their project dump |
| First slice should stay UI-only                     | **High** — AGENTS authority split                                                           |

**Primary internal sources:** UI spec §7; design doc §4.6; dual-view + time-aware specs; `apps/web/src/ledger/{StoryAtlas,factChapters,FilterRail,filters}.tsx`.

**Primary external sources:** Scriptation character bible guide; Scrivener labels/keywords; Obsidian folders/tags/MOCs; A List Apart / Strynal / BTNG faceted navigation; Linear labels/filters; Heptabase sectioned boards; StudioBinder elements (entity↔scene).

---

## 8. Open product questions (do not improvise in code)

1. Collapsed irony label copy: **Secret** vs **Audience doesn’t know** vs chip hush icon + tooltip?
2. Multi-knower facts: Shared bucket vs duplicate under each knower? (research recommends Shared)
3. Should selecting People switch Atlas into “dossier mode” automatically, or only filter the flat/chaptered list?
4. Is Lenses still needed once chapter TOC + jump links exist, or does it become “show only this chapter”?

A PR that answers any of these with a DESIGN-GAP must reference a task id per AGENTS.md.
