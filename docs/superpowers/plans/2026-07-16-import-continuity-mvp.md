# Import Continuity MVP (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every script import produces a reviewable, alias-aware cast plus relationship/location/object entities with source evidence, and ledger `knownBy` resolves against that cast — the P0 phase of `docs/superpowers/specs/2026-07-16-continuity-layer-roadmap-design.md`.

**Architecture:** One new classifier LLM op (`infer_story_entities`) runs per-import (single call over scene plan summaries + cue-derived speaker list), its output merges into `seriesBible` before fact extraction; `fountain/characters.py` grows alias-aware resolution; a Cast panel in Ledger lets the writer merge/rename/remove minted people via snapshot mutations. Evals gate extraction quality.

**Tech Stack:** Zod (`packages/contract`) + Pydantic (`apps/api/schemas.py`) + generated `config/tool_schemas/`, FastAPI + snapshots, React Ledger UI, pytest/Vitest, `make evals`.

## Global Constraints

- Schema changes touch every home or none: Zod, Pydantic, data-contract doc, prompt-spec summary, regenerated tool schemas; `make check-contract` green (CLAUDE.md rule 3).
- New op ⇒ `PROMPT_VERSION` 0.11.0 → 0.12.0 in `apps/api/drama_manager/render.py`; **`make evals` sign-off required before merge; never run evals without explicit authorization** (rule 7 + "costs money").
- All inferred entities enter as unlocked, review-visible additions; never overwrite locked characters; every mutation through `storage/snapshots.py`.
- All freeform text into prompts via `drama_manager/render.py` `<source_data_{nonce}>` wrapping (rule 10). No writer text in logs (rule 5).
- Import stays atomic: failure creates zero rows; one root snapshot for create-and-import.
- Model never mints ids — server assigns `char-{uuid.hex}` etc.; model refers to entities by name strings which the server resolves.

---

## Task 1: Contract — `StoryEntities` op schema + `Character.aliases` + import stage

**Files:**
- Modify: `packages/contract/src/index.ts`
- Modify: `apps/api/schemas.py`
- Modify: `docs/tableread-data-contract.md` (§1 Character, §2a new op, import stage enum)
- Modify: `docs/tableread-prompt-spec.md` (§5a summary of the new op)
- Regenerate: `config/tool_schemas/infer_story_entities.json` (via the existing schema-gen script)

**Interfaces:**
- Produces (Zod, mirrored in Pydantic):

```ts
// §1: Character gains aliases (default [])
export const Character = z.object({
  id: Id, name: z.string(), locked: z.boolean().default(false),
  aliases: z.array(z.string()).default([]),
  embodiment: z.string(), presentation: z.string(), hiding: z.string(),
  traits: z.string(), seriesArc: z.string(),
});

// §2a: infer_story_entities output. Names are strings — the server resolves
// and mints ids. Every entity carries evidence (scene id + short quote).
export const EntityEvidence = z.object({
  sceneId: Id,
  quote: z.string(),           // verbatim-ish, server-truncated to 200 chars
});
export const InferredCharacter = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  role: z.enum(["principal", "supporting", "minor"]),
  traits: z.string(),          // one line, may be ""
  evidence: z.array(EntityEvidence).min(1),
});
export const InferredRelationship = z.object({
  betweenNames: z.tuple([z.string(), z.string()]),
  label: z.string(),
  reallyLike: z.string(),      // may be ""
  evidence: z.array(EntityEvidence).min(1),
});
export const InferredWorldElement = z.object({
  kind: z.enum(["location", "object"]),
  name: z.string(),
  note: z.string(),            // one line, may be ""
  evidence: z.array(EntityEvidence).min(1),
});
export const StoryEntities = z.object({
  characters: z.array(InferredCharacter),
  relationships: z.array(InferredRelationship),
  worldElements: z.array(InferredWorldElement),
});

// Import stage enum gains "inferring_entities" between "inferring_acts"
// and "extracting_facts".
```

- `InferredWorldElement` rows land as `worldQA` entries (`q: "Where/What is <name>?"`, `a: note`) — no new Project field in P0; a first-class world-element entity is P1.

**Steps:**
- [ ] Add `aliases` to `Character` in Zod + Pydantic (default `[]`; wire alias `aliases`)
- [ ] Add the §2a schemas above to `packages/contract/src/index.ts` and mirror in `schemas.py`
- [ ] Add `inferring_entities` to `ProjectImportStageName` (Zod + Pydantic + data-contract §2 stage list)
- [ ] Regenerate tool schemas; commit `config/tool_schemas/infer_story_entities.json`
- [ ] Update data-contract doc §1/§2a and prompt-spec summary table
- [ ] Run `make check-contract` — green
- [ ] Existing fixture still validates (aliases defaults to `[]`)
- [ ] Commit: `contract: add StoryEntities op, Character.aliases, inferring_entities stage`

## Task 2: Prompt + op + import wiring

**Files:**
- Modify: `apps/api/drama_manager/render.py` (new `build_entity_prompt`, PROMPT_VERSION 0.12.0)
- Modify: `apps/api/llm/ops.py` (new `LlmOp("infer_story_entities", "StoryEntities", StoryEntities, "classifier", ...)`)
- Modify: `apps/api/llm/protocol.py`, `apps/api/llm/mock.py`, `apps/api/llm/anthropic_client.py` (dispatch)
- Modify: `apps/api/fountain/pipeline.py` (new stage between act inference and fact extraction)
- Modify: `apps/api/fountain/characters.py` (alias-aware `_resolve_to_id`; merge inferred entities)
- Test: `apps/api/tests/test_import.py`, `apps/api/tests/test_fountain_characters.py`

**Interfaces:**
- `render.build_entity_prompt(project: dict, scene_summaries: list[dict], speaker_names: list[str], nonce: str) -> tuple[str, str]` — scene summaries are `{id, location, whatHappens}` plus each scene's first ~40 lines of scriptText, all inside `<source_data>`; speaker list from `cues_from_scenes` is given as ground truth to extend, not replace.
- `characters.merge_inferred_entities(bible: dict, entities: StoryEntities) -> list[dict]` — resolves inferred names against existing characters (exact/casefold/alias match), mints missing ones with `aliases` populated, appends relationships whose both endpoints resolve (unresolvable rows dropped + counted in logs), appends world elements to `worldQA`. Never renames or deletes; never touches `locked: true` rows' fields.
- `normalize_known_by` gains alias lookup: a `knownBy` string matching any character alias resolves to that id.

**Pipeline order (analyze_import):** parse → segment → infer acts → **cue mint (T7.14) → `inferring_entities` (one call, one schema retry per rule 9) → merge** → extract facts (characters now include aliases) → normalize knownBy → scan.

**Failure policy:** schema-invalid after one retry ⇒ `SCHEMA_INVALID_LLM`, import fails atomically (consistent with segmentation/acts; no silent degradation).

**Steps:**
- [ ] Failing test: import with mock `StoryEntities` (Doc Brown alias "Doc", non-speaking "Einstein", one relationship) yields bible characters with aliases, the non-speaking character, one relationship row; facts with `knownBy: ["Doc"]` resolve to the Doc Brown id
- [ ] Failing test: lock-safety — pre-existing locked character untouched by merge (name/traits identical after re-import)
- [ ] Implement prompt (nonce-wrapped, ids/counts-only logging), op registration, mock + real client dispatch
- [ ] Implement merge + alias-aware resolution; wire the pipeline stage + SSE stage event
- [ ] Bump `PROMPT_VERSION` to 0.12.0
- [ ] `apps/api/.venv/bin/python -m pytest apps/api/tests/test_import.py apps/api/tests/test_fountain_characters.py apps/api/tests/test_import_create.py -q` — green
- [ ] Update wizard stage row copy (`apps/web` import progress list shows "Identifying characters & world")
- [ ] Commit: `import: infer story entities before fact extraction (T7.15)`

## Task 3: Cast review surface (Ledger)

**Files:**
- Create: `apps/web/src/ledger/CastPanel.tsx` (+ `CastPanel.test.tsx`)
- Modify: `apps/web/src/ledger/LedgerScreen.tsx`, `FilterRail.tsx` (People section gains "Manage cast")
- Modify: `apps/api/routes.py` (PATCH character rename/aliases; `POST /projects/{pid}/characters/{cid}/merge-into/{targetId}`; DELETE character)
- Modify: `docs/tableread-data-contract.md` §4 (three endpoints)
- Test: `apps/api/tests/test_characters.py` (new)

**Behavior:**
- Rename/edit aliases → snapshot mutation (`instruction: "Rename character …"`); locked character ⇒ 409 `LOCKED_OBJECT`.
- Merge: target absorbs source's aliases (+ source name as alias); every ledger fact's `knownBy` rewritten source-id → target-id; relationships re-pointed; source removed — one snapshot, atomic. Merging into/from a locked character ⇒ 409.
- Delete: only when no fact/relationship references remain, else 409 `VALIDATION` with counts in `details`.
- UI: PEOPLE rail rows get an overflow (Rename · Merge into… · Delete); optimistic update, rollback on 4xx/5xx.

**Steps:**
- [ ] API tests first (rename, merge rewrites knownBy atomically, locked 409s, referenced delete 409s, each mutation = exactly one snapshot)
- [ ] Implement routes via `snapshots.mutate`
- [ ] CastPanel + FilterRail wiring; Vitest for merge flow + rollback
- [ ] Commit: `ledger: cast management (rename, merge, delete) (T7.16)`

## Task 4: Eval fixture + gates

**Files:**
- Create: `fixtures/entity-inference.fountain` (planted: 2 alias pairs, 1 non-speaking character, 2 implied relationships, 2 locations, 1 significant object)
- Create: planted-expectations JSON beside it
- Modify: `apps/api/evals/checks.py` / harness registration; `docs/tableread-test-plan.md` §3 (two rows)
- Modify: `docs/tableread-test-plan.md` §1 (unit bullets for T7.15/T7.16)

**Gates (soft, human-reviewed, matching A2 conventions):**
- Entity recall ≥ 0.8 (planted characters incl. non-speaking; relationships; locations)
- Alias resolution: planted alias pairs resolve to one character ≥ 0.9
- Zero basis-free entities (hallucination guard, both directions like A2)

**Steps:**
- [ ] Author fixture + expectations; wire eval family `entity-inference` into `make evals`
- [ ] Non-billable dry-run (`make evals-dry` / mock path) green
- [ ] Update test plan §1/§3; build plan acceptance
- [ ] Commit: `evals: entity-inference fixture and gates (T7.17)`
- [ ] **Ask for authorization to run `make evals`** (0.12.0 sign-off) — do not run unprompted

## Self-review notes

- Spec coverage: op + merge (Task 2) ⇐ roadmap P0 bullets 1–3; cast review ⇐ bullet 4; evals ⇐ bullet 5. Aliases-on-Character is the only Project-schema change; world elements ride `worldQA` until P1.
- Existing projects: adopt via re-import (roadmap policy); no backfill scripts.
- Deferred to P1+: time-aware state, knowledge transitions, relationship history, threads, motivations/arcs, structured world rules, story compiler.
