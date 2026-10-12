# Structure checklist — design

**Date:** 2026-10-11 · **Status:** draft for owner review · **Replaces:** the Narrative Map (Story Map) card, in a later step

## Why

The writer wants to check a script against a story structure (Hero's Journey, Story Circle, TV act structure, Save the Cat) and see every stage hit or missed. The owner approved a mockup of this on 2026-10-11.

The Narrative Map was meant to provide it and does not:

- **Mostly a repeat of the import.** On *Field of Dreams*, all 6 of its act turns are import beat-sheet beats, its thread movements restate import threads, and its scene summaries restate the import outline. The synthesis is built from the import's own outputs (`render.py:769-771`).
- **Nothing reads it.** Only `NarrativeMapCard.tsx` and `LedgerScreen.tsx` read the map; Next Beat, Plan and Write never do.
- **Expensive and brittle.** A run is 51 sequential Opus scene passes plus synthesis and verification: about $3.30 and 14 minutes. The verifier is all-or-nothing, and no prune rule covers `heroJourney`. One bad Hero's Journey stage threw away the whole *Field of Dreams* run (`nmap-54fe…`, EVIDENCE_REJECTED).
- **Hero's Journey has never reached a writer.** All three saved maps say `applies: false`; the only run that applied was the rejected one.

**Owner decisions (2026-10-11):**

- Replace the Story Map in four steps:
  1. Fix character names (done: #13, #14).
  2. Build this checklist.
  3. Move theme, the lead's arc and scene stakes into the import.
  4. Delete the Story Map.
- The scene/character/thread timeline mockup is dropped.
- When a structure doesn't fit the script, show a note to the writer instead of a checklist.

## What the writer sees

A new **Structure** tab in the Ledger, after Threads, with a picker for the four structures.

For the chosen structure:

- **Header:** structure name and a summary line, e.g. "11 of 12 stages hit · 1 thin · 0 missing".
- **Timeline strip:** one tick per stage, placed by the cited scene's position in the script (`Scene.index`) and grouped by act, so out-of-order stages show. Reuse `SceneStrip` / `groupScenesByAct`.
- **Stage list, in the structure's canonical order.** Each row has:
  - stage name
  - status: **Hit**, **Thin**, **Missing** or **Couldn't verify**
  - one-line reason
  - the evidence line, quoted from the script, for Hit and Thin
  - a link to the scene.
- **Clicking a row** opens Write at that beat (`/?project=…&scene=…&highlightBeat=…`). `navigateToWriteScene` deletes `highlightBeat`, so add a scene-plus-beat variant to `shell/modeNavigation.ts`. `LedgerScreen.handleSourceSpanClick` already builds this URL.
- **Doesn't fit:** the model's reason, plus a **Check TV act structure instead** button. The suggestion is fixed, not model-chosen: TV act structure always applies to a TV script.
- **Stale:** when the script has changed since the check, a line says so, with **Check again**.
- **Not run yet:** a **Check structure** button with the cost and time ("about 25¢, under a minute"). TV act structure needs no button (see below).

Every status shows text, not color alone. Colors come from tokens only (`--tr-*`, via `Chip` hues; rule 6).

The picker choice is remembered per viewer in `localStorage`, like `tr.ledger.view`. It is not a doc mutation.

## The four structures

| Structure | Stages (canonical order) | How it's produced |
|---|---|---|
| TV act structure | Cold open (when `format.coldOpen`), Act N turn / Act N out for each act up to `format.actCount`, Climax, Tag (when `format.tag`) | **No AI.** Read from the import's `storyOverview.beatSheet` (labels such as "Act One Turn", with `beatId`, `sceneId`, `act`). A stage is Hit when a row with that label exists, else Missing. Computed client-side; nothing stored. |
| Hero's Journey | 12 stages: the existing `HeroJourneyStageName` enum (`ordinary_world` … `return_with_elixir`) | AI check |
| Story Circle | 8 stages: you, need, go, search, find, take, return, change | AI check |
| Save the Cat | 15 beats: opening image, theme stated, set-up, catalyst, debate, break into two, B story, fun and games, midpoint, bad guys close in, all is lost, dark night of the soul, break into three, finale, final image | AI check |

**Save the Cat and the import's ban.** The import's story-overview prompt bans Save the Cat labels from the beat sheet (`render.py:585-596`). That ban stays: it stops film vocabulary leaking into the TV beat sheet. Here the writer picks Save the Cat on purpose. The prompt notes that it's a feature-film template, and can say it doesn't fit a TV episode.

## How an AI check works

One click runs one structure: one model call, then one verification call.

1. **Check (`check_structure`, Opus 5.5 via `import_analyst`, effort medium).**
   - **Input:** the import's existing breakdown, built into a compact spine (no new reading of the script):
     - format
     - story overview: logline, summary, beat sheet
     - each scene: id, act, heading, `whatHappens`, `audienceLearns`
     - each beat: id and short `whatHappens`
     - threads with setup and payoff beats
   - **Output (strict tool schema):**
     - `applies`
     - `rationale`: one sentence; it's the "doesn't fit" note when `applies` is false
     - `stages[]`, each with `stage` (enum), `status` (`hit` | `thin` | `missing`), `beatId` (required for hit and thin, null for missing) and `reason` (one line).
   - **Server-side validation:**
     - every stage of the structure appears exactly once, in canonical order
     - cited beat ids exist
     - a schema failure gets exactly one retry, then `SCHEMA_INVALID_LLM` (rule 9).
   - **Evidence:** the server attaches the evidence quote from the cited beat's own text. The model never writes quotes.
2. **Verify (`verify_structure_check`, Sonnet 5.5 via `writer`, effort low).**
   - **Input:** each hit or thin stage's claim plus a bounded excerpt of its cited beat (same 520-char cap as the map verifier).
   - **Output:** for each stage, `supported` true/false plus a reason.
   - **Unsupported stages** become **Couldn't verify** and keep the verifier's reason. They are never deleted, and they never sink the other stages.
   - **Missing stages** are not verified, because absence can't be cited.
   - **If the verify call itself fails** after its one retry, the whole check fails with `SCHEMA_INVALID_LLM` and nothing is saved. There is no fabricated fallback.
3. **Save.** The result is written through the snapshot helper (`storage/snapshots.py`, rule 4) as one snapshot.

**Cost and time target, per check:** about $0.25 and under 60 seconds. That's against $3.30 and 14 minutes for a Story Map run, at `config/llm_pricing.json` rates.

**Request shape.** A synchronous `POST`: one Opus call plus one Sonnet call fits a normal request. The client shows progress and disables the button while the check runs. There is no background job table; add one only if real checks run past about 90 seconds.

## Data and contract

All homes change together (rule 3): Zod in `packages/contract`, Pydantic in `schemas.py`, the data-contract doc, the prompt-spec summary, and regenerated `config/tool_schemas/`.

```ts
StructureLens = 'tv_act_structure' | 'heros_journey' | 'story_circle' | 'save_the_cat'
StructureStageStatus = 'hit' | 'thin' | 'missing' | 'unverified'
StructureStage = { stage: StructureStageName, status, beatId: Id | null, sceneId: Id | null,
                   reason: string, evidenceQuote: string | null }
StructureCheck = { lens, applies: boolean, rationale: string, stages: StructureStage[],
                   sourceHash: string, checkedAt: string, promptVersion: string }
// stored at episode.structureChecks: Partial<Record<Exclude<StructureLens,'tv_act_structure'>, StructureCheck>>
```

**Schema notes:**

- **Stage names:** `StructureStageName` is one enum covering the AI structures' stages (12 + 8 + 15). The server checks each stage belongs to the requested structure. That keeps the tool schema strict and static.
- **Hero's Journey:** reuses `HeroJourneyStageName`'s values.
- **No numeric constraints:** `minimum`/`maximum` are stripped for strict tools.

**Server-filled fields:** `sceneId` comes from the beat, and the quote from the beat text.

**Source hash:** covers scene and beat ids plus beat `scriptText`, the same inputs as the Story Map's source hash. A mismatch with the head shows the stale line.

**API:**

- `POST /api/v1/projects/{pid}/structure-checks/{lens}`, with `If-Match` against the head snapshot (409 `CONFLICT_STALE_HEAD` otherwise). Returns the saved `StructureCheck` and the new head.
- Saved checks are read from the project doc; there is no GET endpoint.
- `tv_act_structure` is rejected with 400, since it's never generated.

## Repo rules this touches

- **Rule 1:** tests use `MockLlmClient` only.
- **Rule 2:** this is a new generation path, so the lock-violation test comes first. A check must never change scene, beat, plan or ledger content, and the test asserts the doc is identical outside `episode.structureChecks`.
- **Rule 4:** every save goes through the snapshot helper.
- **Rule 5:** logs carry ids, structure, token counts and `PROMPT_VERSION`, never stage reasons or quotes.
- **Rule 7:** two new prompts, so bump `PROMPT_VERSION` and add eval cases. `make evals` must run before merge; the owner runs or approves it, since it costs money.
  - *Field of Dreams*-like single-hero script: Hero's Journey applies.
  - West Wing-like ensemble: Hero's Journey doesn't fit.
  - Fabricated-evidence probe: the verifier downgrades the stage.
- **Rule 8:** checks only start from a click on the Ledger Structure tab. Nothing runs in Write.
- **Rule 10:** no new dependencies.

## Testing

- **pytest:**
  - op validation: missing or duplicate stages, a stage from another structure, an unknown beat id, the one retry then `SCHEMA_INVALID_LLM`
  - verifier downgrade to `unverified`
  - verify-call failure saves nothing
  - quote and scene filled from the beat
  - snapshot written
  - lock-violation test
  - stale-head 409
  - `tv_act_structure` rejected.
- **Vitest:**
  - TV act structure built from a beat sheet, including Missing rows
  - all four statuses render with text
  - the "doesn't fit" note and its button
  - stale line
  - row click builds the `highlightBeat` URL
  - picker remembered per viewer.
- **e2e:** Structure tab on the seeded fixture shows TV act structure with no AI call; a mocked Hero's Journey check renders and links into Write.

## Not in this step

- Theme, the lead's arc and scene stakes moving into the import (step 3).
- Deleting the Narrative Map code, card, run table use and contract types (step 4). Until then the old card stays on the Story tab.
- Re-citing a stage whose claim is right but whose beat is wrong. A later improvement if "Couldn't verify" turns up often for that reason.
- Structures beyond these four.

## Open questions for the owner

1. **Locked episodes.** Should a check run on a locked episode? A check never changes the script, only `episode.structureChecks`. The Story Map refuses on a locked episode. **Proposed:** allow it.
2. **Save the Cat on a TV episode.** Run the 15 beats as written, and let the model say it doesn't fit, or scale the beats to the act count? **Proposed:** as written.
3. **Thin vs. missing.** "Thin" is the model's judgment (the stage is there but weak or partial, with a reason). **Proposed:** ship it, and drop "thin" if writers find it noisy.
