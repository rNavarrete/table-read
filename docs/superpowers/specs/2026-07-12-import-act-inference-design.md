# Import act inference + writer correction — design spec

**Date:** 2026-07-12  
**Status:** approved (conversation)  
**Authority after merge:** updates `docs/tableread-data-contract.md` (§2a operation schema and §9.3 import stages), `docs/tableread-prompt-spec.md` (new import classifier operation), `docs/tableread-ui-spec.md` (Analyze progress and editable Plan act field), `docs/tableread-test-plan.md`, and `docs/tableread-build-plan.md`. Zod (`packages/contract`), Pydantic (`apps/api/schemas.py`), and generated `config/tool_schemas/` change together per hard rule 3. This is a prompt/tool-schema change: bump `PROMPT_VERSION`, run `make check-contract`, and require `make evals` sign-off before merge.

## 1. Problem

Import currently persists every scene with `act: 0`. For a format with `coldOpen: true`, Plan correctly labels act 0 as **COLD OPEN**, so an entire imported script appears there.

Act-marker parsing is not a sufficient fix: most uploaded scripts do not contain explicit `ACT ONE` / `ACT TWO` headings. Import must infer narrative act boundaries from the script, constrained by the format the writer selected. Because inference can be wrong, Plan must also let the writer correct a scene's act directly, including moving a scene into an otherwise empty act.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Boundary source | AI inference during the explicit **Create & analyze script** gesture |
| Inference context | Ordered compact scene summaries produced by the existing per-scene segmentation stage |
| Output shape | Ordered act starts: `{ act, startSceneIndex }`; the server derives the total scene partition |
| Format constraint | Only acts valid for the selected `ShowFormat` may be returned |
| Empty sections | Allowed; omitted act numbers represent empty sections |
| Failure | Schema-invalid tool output keeps the client's existing one retry; semantic boundary invalidity gets one pipeline retry, then the atomic import fails with `SCHEMA_INVALID_LLM` |
| Persistence | Still one write after all analysis succeeds; no partial project on failure |
| Writer correction | Editable Act selector in the Plan inspector |
| Correction side effects | One normal snapshot; lock enforcement applies; no consistency scan because story text and facts are unchanged |
| Model role | `classifier`, temperature 0 |
| Prompt policy | New operation schema and prompt; bump `PROMPT_VERSION`; real eval sign-off required |

## 3. Pipeline and data flow

The import pipeline becomes:

1. Deterministically split source into scenes.
2. Segment every scene into beats and produce compact scene-level summaries.
3. Infer global act starts from those ordered summaries and the selected format.
4. Validate and expand act starts into one act assignment per scene.
5. Assemble scene documents using the derived acts.
6. Extract ledger facts per scene.
7. Scan consistency.
8. Persist project + ledger + flags atomically in one root snapshot.

Act inference runs after segmentation because scene headings alone do not contain enough narrative information to identify turning points. The inference prompt receives, in source order:

- zero-based `sceneIndex`;
- scene heading/location;
- the segmented beats' `whatHappens`, `audienceLearns`, and `audienceFeels`;
- selected `ShowFormat` fields relevant to this operation: `runtimeMinutes`, `actCount`, and `coldOpen`.

All imported or model-derived freeform text is rendered through `drama_manager/render.py` inside the existing nonce-wrapped inert source-data boundary. No prompt text is assembled elsewhere.

## 4. Executable schema

Add a synchronized LLM operation schema in Zod and Pydantic and regenerate its strict tool schema:

```ts
const InferredActStart = z.object({
  act: z.number().int().min(0),
  startSceneIndex: z.number().int().min(0),
})

export const InferredActBreaks = z.object({
  starts: z.array(InferredActStart).min(1),
})
```

The model proposes starts only. It never returns scene ids, end indices, or a per-scene assignment array.

Valid act numbers are:

- `coldOpen: true`: `0...actCount` (`0` is Cold Open; `1...actCount` are numbered acts);
- `coldOpen: false`: `0...(actCount - 1)` (`0` displays as Act One).

Omitting an otherwise valid act leaves that section empty. For example, a five-act format with a cold open may return a first start of `{ act: 1, startSceneIndex: 0 }`, leaving Cold Open empty.

## 5. Server normalization and validation

The server validates semantic constraints after schema validation:

1. `starts` is non-empty.
2. The first `startSceneIndex` is `0`.
3. `startSceneIndex` values are strictly increasing and less than the scene count.
4. `act` values are strictly increasing and valid for the selected format.
5. No act or start index is duplicated.

For each start, the server assigns its act from `startSceneIndex` through the scene immediately before the next start. The final start owns all remaining scenes. This guarantees every imported scene receives exactly one act without allowing the model to control source coverage.

If semantic validation fails, call `infer_act_breaks` exactly once more with the validation errors appended through the prompt renderer. A second semantically invalid response raises `SchemaInvalidLlmError("infer_act_breaks")`; the SSE route emits the existing canonical failed envelope and persists zero rows. Each individual tool call retains the Anthropic client's existing one schema-validation retry. There is no even-distribution or all-in-one-act fallback.

## 6. Progress and cost preview

Add `inferring_acts` to `ProjectImportStageName`. It starts after `segmenting_beats` completes and before `extracting_facts`.

The nominal model-call estimate changes:

- segmentation: `N`;
- act inference: `1`;
- fact extraction: `N`;
- consistency scan: `1`;
- total: `2N + 2`.

Existing caveats remain: segmentation repair and act-inference repair may add calls. The Analyze UI shows **Inferring act structure** as a truthful stage row. If per-scene progress support is present, this singleton stage uses normal stage start/completion semantics and does not emit scene progress events.

## 7. Plan correction

Replace the selected scene inspector's read-only Act value with a select control populated from the project's valid format acts and labels (`COLD OPEN`, `ACT ONE`, and so on).

Saving a changed act:

- sends the existing scene-field JSON Patch for `act`;
- uses the current optimistic-update/rollback path;
- creates one snapshot with a human-readable instruction;
- is disabled when the scene or containing episode is effectively locked;
- is rejected by the server lock filter if a stale client attempts it;
- does not invoke an LLM or consistency scan because no script, beat meaning, or ledger fact changed.

Existing cross-act drag behavior remains. The selector is the correction path for an empty destination act, which has no scene card to use as a drop target.

## 8. Tests

### Contract and client

- Zod and Pydantic accept valid `InferredActBreaks` and reject malformed primitives.
- Generated strict `infer_act_breaks` tool schema matches committed artifacts.
- Anthropic and mock clients expose the new operation with the existing one-retry structured-output policy.

### Pipeline

- A multi-scene response expands into the expected total act assignment.
- A first start at act 1 leaves Cold Open empty.
- Skipped middle/trailing acts remain empty.
- Out-of-range acts, missing scene-zero start, duplicate/non-increasing acts, and duplicate/non-increasing/out-of-range scene indices trigger one repair.
- A valid repair succeeds; a second invalid result surfaces `SCHEMA_INVALID_LLM`.
- Inference failure persists no project, snapshot, facts, flags, or Change Sets.
- Imported scene order, ids, beats, and byte-identical source reconstruction remain unchanged.

### SSE and wizard

- Stage order includes `inferring_acts` between segmentation and extraction.
- Cost copy reports nominal `2N+2` calls.
- Failure retains the import draft for retry/edit-source actions.

### Plan

- Inspector lists exactly the acts valid for formats with and without a cold open.
- Saving an act updates the board grouping and persists after reload.
- Moving into an empty act works through the selector.
- A failed PATCH rolls back the optimistic selection.
- Locked scenes cannot edit their act; direct server attempts return `LOCKED_OBJECT`.
- Act correction creates one snapshot and makes zero LLM calls.

### Evals

- Add representative half-hour and one-hour scripts with human-labeled approximate act boundaries.
- Hard gates: schema validity after at most one retry and zero unassigned/duplicate scenes.
- Soft quality gate: at least 80% of inferred boundaries fall within two scene positions of the human labels; review misses before changing the prompt or model pin.
- Run the full required prompt-change eval suite before merge.

## 9. Non-goals

- Parsing explicit act headings as an alternate source of truth.
- Inferring A/B/C storylines.
- Representing or inferring a distinct TAG section. `ShowFormat.tag` exists, but the current `Scene.act` model and Plan board cannot encode a tag separately; that requires its own contract/UI design.
- Multi-episode or feature-film import behavior.
- Showing an act-break confirmation step before project creation.
- Rebalancing acts after the writer edits or reorders scenes.
- Adding drag targets to empty act frames.

## 10. Rollout and authority updates

Implementation must update all schema homes and authority docs in the same change:

- `packages/contract/src/index.ts`;
- `apps/api/schemas.py`;
- `config/tool_schemas/`;
- `docs/tableread-data-contract.md`;
- `docs/tableread-prompt-spec.md`;
- `docs/tableread-ui-spec.md`;
- `docs/tableread-test-plan.md`;
- `docs/tableread-build-plan.md`;
- `docs/tableread-handoff.md`.

Required verification is `make test`, `make e2e` because Plan UI changes, `make lint`, `make check-contract`, and `make evals` with explicit sign-off. Do not merge the prompt/tool-schema change without the eval result.
