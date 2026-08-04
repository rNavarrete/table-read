# Import Story Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After import, Ledger shows an episode story overview (logline, scene outline, named beat sheet, two-paragraph synopsis) inferred by one **writer** (Sonnet) op.

**Architecture:** New `Episode.storyOverview` persisted object; §2a `infer_story_overview` / `InferredStoryOverview` after `inferring_promises` and before fact extraction; merge grounds scene/beat ids, backfills empty premises from logline, respects locks; Ledger Overview panel mirrors Threads.

**Tech Stack:** Zod/Pydantic/tool schemas, FastAPI import pipeline, React Ledger, pytest/Vitest, evals harness.

## Global Constraints

- Schema changes touch every home or none; `make check-contract` green
- `PROMPT_VERSION` 0.14.0 → 0.15.0 on T7.28; **do not run `make evals` without explicit authorization**
- All freeform prompt text via `render.py` `<source_data_{nonce}>`
- Snapshots for every mutation; import stays atomic (zero rows on failure)
- Model never mints ids — sceneId/beatId must reference the imported partition
- Never overwrite `storyOverview.locked` or overview when `episode.locked`
- No writer text in logs
- Tokens only in UI (`--tr-*`)

## File map

| Area     | Files                                                                                                                                                                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract | `packages/contract/src/index.ts`, `export-json-schema.ts`, `apps/api/schemas.py`, `scripts/check_contract.py`, `docs/tableread-data-contract.md`, `docs/tableread-prompt-spec.md`, `docs/tableread-fixture.json`, `config/tool_schemas/infer_story_overview.json`, `apps/api/llm/ops.py` |
| Import   | `apps/api/drama_manager/render.py`, `apps/api/drama_manager/overview.py`, `apps/api/fountain/pipeline.py`, `apps/api/llm/{protocol,mock,anthropic_client}.py`, `apps/web/.../ImportWizard.tsx`                                                                                           |
| UI       | `apps/web/src/ledger/{OverviewPanel,FilterRail,LedgerScreen}.tsx` (+ tests)                                                                                                                                                                                                              |
| Evals    | `fixtures/story-overview.{fountain,planted.json}`, `apps/api/evals/{adoption,suite,run}.py`                                                                                                                                                                                              |

---

### Task 1: Contract (T7.27)

**Interfaces (Zod):**

```ts
export const StoryOverviewOutlineItem = z.object({
  sceneId: Id,
  summary: z.string(),
})
export const StoryOverviewBeatItem = z.object({
  beatId: Id,
  label: z.string().default(''),
  summary: z.string(),
  sceneId: Id.nullable().default(null),
})
export const StoryOverview = z.object({
  logline: z.string(),
  outline: z.array(StoryOverviewOutlineItem),
  beatSheet: z.array(StoryOverviewBeatItem),
  summary: z.string(),
  provenance: z.enum(['inferred', 'writer_authored']).default('inferred'),
  locked: z.boolean().default(false),
})
// Episode += storyOverview: StoryOverview.nullable().default(null)

export const InferredStoryOverview = z.object({
  logline: z.string(),
  outline: z.array(z.object({ sceneId: Id, summary: z.string() })),
  beatSheet: z.array(
    z.object({
      beatId: Id,
      label: z.string(),
      summary: z.string(),
      sceneId: Id.nullable(),
    }),
  ),
  summary: z.string(),
})
// ProjectImportStageName inserts 'inferring_overview' after 'inferring_promises'
```

- [ ] Add Zod + Pydantic + export lists + ops registry stub + stage enum
- [ ] Fixture episodes: `"storyOverview": null`
- [ ] Data-contract + prompt-spec stub (§5c classifier; craft constraints)
- [ ] Regenerate `config/tool_schemas/infer_story_overview.json`
- [ ] `make check-contract` green
- [ ] Commit: `contract: StoryOverview + infer_story_overview op (T7.27)`

---

### Task 2: Import inference (T7.28)

**`merge_story_overview(doc, episode_id, result) -> doc`:**

- If episode missing → KeyError
- If `episode.locked` or existing `storyOverview.locked` → no-op (log counts only)
- Else build overview: drop unknown sceneIds/beatIds; set provenance inferred, locked false
- If `doc.premise` strip-empty → set to logline; same for `episode.premise`

**Prompt (`build_overview_prompt`):** compact scene summaries + known beat id list; instruct logline 25–40 words / one sentence; outline one short line per scene id; beat sheet named TV turns with beatId anchors; summary exactly two present-tense paragraphs spoiling the ending.

- [ ] Failing import test with mock overview
- [ ] Implement prompt, merge, pipeline stage, LLM dispatch, wizard label
- [ ] PROMPT_VERSION → 0.15.0
- [ ] Commit: `import: infer story overview after promises (T7.28)`

---

### Task 3: Ledger UI (T7.29)

- [ ] `OverviewPanel` + Vitest (logline, paragraphs, outline/beat jumps, empty)
- [ ] FilterRail Overview entry; LedgerScreen wire + header teaser
- [ ] Commit: `ledger: Overview panel for story overview (T7.29)`

---

### Task 4: Evals (T7.30)

- [ ] `fixtures/story-overview.fountain` + planted JSON (logline keywords, scene ids, beat coverage, two-para shape)
- [ ] Soft families `story-overview` + `story-overview-merge` in suite/run; dry-run green
- [ ] **Do not** run real `make evals`
- [ ] Commit: `evals: story-overview fixture and gates (T7.30)`

## Self-review

- Spec coverage: four artifacts, premise backfill, locks, Ledger, evals
- Deferred: PATCH edit UI, idea-path Generate, Plan inspector glimpse

## Follow-up — T7.30a TV beat-sheet grounding (2026-07-17)

Implemented on main after T7.30: optional `act` on beat-sheet rows; prompt 0.16.0 with format + act-ordered spine + beat `whatHappens`; merge resolve/coerce/sort/dedupe; planted STC-label + act checks; Overview keeps formatting with muted act cue. Real `make evals` still deferred until authorized.

## Follow-up — content quality (2026-07-17)

Prompt **0.17.0**: ban location-theater; require names/events; richer spine (learns/feels/scriptExcerpt + known_cast); merge soft-replaces boilerplate with beat `whatHappens`; `max_tokens` 16384; outline UI leads with action. Real `make evals` still deferred.
