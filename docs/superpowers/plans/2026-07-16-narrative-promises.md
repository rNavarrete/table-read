# Narrative Promises (P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import extracts story threads, scene motivations, and structured world rules — P2 of the continuity-layer roadmap.

**Architecture:** New classifier op `infer_narrative_promises` after entity inference; server mints `thread-*` ids onto `Episode.threads`, fills `Scene.motivations`, extends `worldRules` shape; Ledger shows a Threads list. Temporal spine = scene ids (T7.18 as-of remains compatible).

**Tech Stack:** Zod/Pydantic/tool schemas, FastAPI import pipeline, React Ledger, pytest/Vitest, evals harness.

## Global Constraints

- Schema changes touch every home or none; `make check-contract` green
- `PROMPT_VERSION` 0.12.0 → 0.13.0; **do not run `make evals` without explicit authorization**
- All freeform prompt text via `render.py` `<source_data_{nonce}>`
- Snapshots for every mutation; import stays atomic (zero rows on failure)
- Model never mints ids — names in, server resolves
- Never overwrite `locked: true` world rules or characters
- No writer text in logs

---

### Task 1: Contract — Thread, WorldRule fields, NarrativePromises, stage

**Files:**
- `packages/contract/src/index.ts`
- `apps/api/schemas.py`
- `docs/tableread-data-contract.md`, `docs/tableread-prompt-spec.md`
- `apps/api/llm/ops.py` (minimal `LlmOp` registration so schemas generate)
- Regenerate: `config/tool_schemas/infer_narrative_promises.json`
- `packages/contract/scripts/export-json-schema.ts` if needed for new exports
- Fixture: add `"threads": []` on episodes; worldRules gain optional fields with defaults

**Interfaces (Zod):**

```ts
export const StoryThread = z.object({
  id: Id,
  label: z.string(),
  summary: z.string(),
  status: z.enum(["open", "paid_off", "abandoned"]),
  ownerCharacterIds: z.array(Id).default([]),
  setupSceneId: Id,
  payoffSceneId: Id.nullable().default(null),
  setupQuote: z.string().default(""),
  payoffQuote: z.string().default(""),
  locked: z.boolean().default(false),
});
// Episode gains: threads: z.array(StoryThread).default([])

// WorldRule object becomes:
{ text, locked, limit: "", cost: "", exception: "",
  evidenceSceneId: Id.nullable(), evidenceQuote: "" }

export const NarrativePromises = z.object({
  threads: z.array(z.object({
    label: z.string(), summary: z.string(),
    status: z.enum(["open", "paid_off", "abandoned"]),
    ownerNames: z.array(z.string()),
    setupSceneId: Id, payoffSceneId: Id.nullable(),
    setupQuote: z.string(), payoffQuote: z.string(),
  })),
  sceneMotivations: z.array(z.object({
    sceneId: Id,
    motivations: z.array(z.object({
      characterName: z.string(),
      objective: z.string(), stakes: z.string(), obstacle: z.string(),
    })),
  })),
  worldRules: z.array(z.object({
    text: z.string(), limit: z.string(), cost: z.string(), exception: z.string(),
    evidenceSceneId: Id.nullable(), evidenceQuote: z.string(),
  })),
});
// ProjectImportStageName inserts "inferring_promises" after "inferring_entities"
```

- [x] Add schemas + Pydantic mirrors + stage enum
- [x] Register minimal op; regenerate tool schema
- [x] Update fixture episode(s) with `threads: []`; worldRules defaults validate
- [x] `make check-contract` green
- [x] Commit: `contract: NarrativePromises op, StoryThread, structured WorldRule (T7.19)`

---

### Task 2: Prompt + merge helpers + pipeline

**Files:**
- `apps/api/drama_manager/render.py` — `build_promises_prompt`, PROMPT_VERSION 0.13.0
- `apps/api/drama_manager/promises.py` — `merge_narrative_promises(doc, result) -> doc`
- `apps/api/fountain/pipeline.py` — stage after entities
- `apps/api/llm/{protocol,mock,anthropic_client}.py` — dispatch
- Tests: `apps/api/tests/test_promises.py`, extend `test_import.py`
- Wizard: stage label in `ImportWizard.tsx`

**`merge_narrative_promises`:**
- Mint `thread-{uuid.hex[:12]}` via IdMinter pattern
- Resolve ownerNames / characterName via alias-aware lookup (reuse fountain/characters or drama_manager/characters helpers)
- Set `episode["threads"]` (replace import-derived list for that episode)
- Patch scene motivations when sceneId matches and character resolves
- Append world rules whose `text` casefold not already present; skip if colliding with locked rule text

- [x] Failing import test with mock NarrativePromises
- [x] Implement prompt, merge, pipeline, SSE stage
- [x] Commit: `import: infer narrative promises before fact extraction (T7.20)`

---

### Task 3: Ledger Threads UI

**Files:**
- `apps/web/src/ledger/ThreadsPanel.tsx` (+ test)
- Wire into `LedgerScreen` / FilterRail lens **Threads** or Atlas chapter
- Jump: setup/payoff scene → Plan or Write `?scene=`

- [x] List threads by status; empty state
- [x] Vitest: renders open thread + scene link
- [x] Commit: `ledger: Threads panel for narrative promises (T7.21)`

---

### Task 4: Eval fixture + docs

**Files:**
- `fixtures/narrative-promises.fountain` + planted JSON (1 setup/payoff pair, 1 open thread, 1 motivation, 1 world rule with limit)
- Wire soft family in evals suite
- `docs/tableread-build-plan.md` T7.19–T7.22, test-plan, roadmap P2 note

- [x] Dry-run green; **do not** run real evals
- [x] Commit: `evals: narrative-promises fixture and gates (T7.22)`

## Self-review

- Spec coverage: threads, motivations, structured rules, UI list, evals
- Deferred: Plan connectors, P3 compiler, P1 knowledge transitions
