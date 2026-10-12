# Structure checklist — design

**Date:** 2026-10-11 · **Status:** approved by owner 2026-10-11 · **Replaces:** the Narrative Map (Story Map) card, in a later step

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
| TV act structure | The import beat sheet's own label list: Cold open (when `format.coldOpen`); then for acts One to N−1 an "Act N Turn" and an "Act N Out"; the last act gets only "Act N Out"; then Climax; then Tag (when `format.tag`). For a 4-act format: Act One Turn, Act One Out … Act Three Out, Act Four Out, Climax. | **No AI.** Read from the import's `storyOverview.beatSheet` (rows carry `label`, `beatId`, `sceneId`, `act`). Labels match case-insensitively, with whitespace collapsed; "Teaser" also counts as Cold open. A stage is Hit when a row with its label exists (the first such row wins), else Missing. Computed client-side; nothing stored. With no beat sheet every stage is Missing, and with no format the panel says the format isn't known yet. |
| Hero's Journey | 12 stages: the existing `HeroJourneyStageName` enum (`ordinary_world` … `return_with_elixir`) | AI check |
| Story Circle | 8 stages (ids prefixed `circle_`): you, need, go, search, find, take, return, change | AI check |
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
     - every stage of the structure appears exactly once; the server puts them in canonical order
     - every stage belongs to the requested structure
     - hit and thin stages cite a beat id that exists; missing stages cite none.
   - **Retries:** a shape failure is retried once inside the LLM client, as for every op. A validation failure above gets one retry with the problems listed, then `SCHEMA_INVALID_LLM` (rule 9).
   - **Doesn't fit:** when `applies` is false, the stages are dropped and verification is skipped. Only the rationale is stored.
   - **Evidence:** the server attaches the evidence quote from the cited beat's own text. The model never writes quotes.
2. **Verify (`verify_structure_check`, Sonnet 5.5 via `writer`, effort low).**
   - **Input:** each hit or thin stage's claim plus a bounded excerpt of its cited beat (same 520-char cap as the map verifier).
   - **Output:** for each stage, `supported` true/false plus a reason.
   - **Unsupported stages** become **Couldn't verify** and keep the verifier's reason. They are never deleted, and they never sink the other stages.
   - **Missing stages** are not verified, because absence can't be cited.
   - **A stage the verifier returns no verdict for** is also Couldn't verify, with the reason "Not verified". That label describes the check, not the story, so it's not a fabricated answer. Verdicts for stages that weren't claimed are ignored.
   - **If the verify call itself fails** after its one retry, the whole check fails with `SCHEMA_INVALID_LLM` and nothing is saved. There is no fabricated fallback.
3. **Save.** The result is written through the snapshot helper (`storage/snapshots.py`, rule 4) as one snapshot.

**Cost and time target, per check:** about $0.25 and under 60 seconds. That's against $3.30 and 14 minutes for a Story Map run, at `config/llm_pricing.json` rates.

**Request shape.** A synchronous `POST`: one Opus call plus one Sonnet call fits a normal request. The client shows progress and disables the button while the check runs. There is no background job table; add one only if real checks run past about 90 seconds.

## Data and contract

All homes change together (rule 3): Zod in `packages/contract`, Pydantic in `schemas.py`, the data-contract doc, the prompt-spec summary, and regenerated `config/tool_schemas/`.

```ts
StructureLens = 'heros_journey' | 'story_circle' | 'save_the_cat'   // the AI structures; TV act structure is web-only
StructureStageStatus = 'hit' | 'thin' | 'missing' | 'unverified'
StructureStage = { stage: StructureStageName, status, beatId: Id | null, sceneId: Id | null,
                   reason: string, evidenceQuote: string | null }
StructureCheck = { lens, applies: boolean, rationale: string, stages: StructureStage[],
                   sourceHash: string, checkedAt: string, promptVersion: string }
// stored at episode.structureChecks: StructureCheck[] (default []), at most one per lens; a new check replaces that lens's entry
```

**Schema notes:**

- **Stage names:** `StructureStageName` is one enum covering the AI structures' stages (12 + 8 + 15). The server checks each stage belongs to the requested structure. That keeps the tool schema strict and static.
- **Hero's Journey:** reuses `HeroJourneyStageName`'s values.
- **No numeric constraints:** `minimum`/`maximum` are stripped for strict tools.
- **A list, not a keyed map:** `make check-contract` can't compare a Pydantic `dict` keyed by an enum against Zod's record.

**Server-filled fields:** `sceneId` comes from the beat, and the quote from the beat text.

**Source hash:** a plain fingerprint the server and the browser compute the same way. Walk the episode's scenes in order, and each scene's beats in order. For each beat, add `sceneId + "\x1f" + beatId + "\x1f" + scriptText + "\x1e"` (empty `scriptText` when absent). Take the SHA-256 of the UTF-8 string as lowercase hex. The web recomputes it from the project it already has (`crypto.subtle`), and shows the stale line when it differs from the stored `sourceHash`. This is narrower than the Story Map's hash on purpose: it changes only when the script text or scene and beat ids change.

**API:**

- `POST /api/v1/projects/{pid}/structure-checks/{lens}`, with `If-Match` against the head snapshot (409 `CONFLICT_STALE_HEAD` otherwise). Returns the updated `Project` (as accept does), which carries the new head and the saved check.
- Saved checks are read from the project doc; there is no GET endpoint.
- Any `lens` outside `StructureLens`, `tv_act_structure` included, is rejected with 400 `VALIDATION`.
- An episode with no beats returns 409 `STRUCTURE_CHECK_NOT_READY` (a new code, added to data contract §4).
- Errors follow accept's mapping:
  - 409 `CONFLICT_STALE_HEAD`
  - 502 `SCHEMA_INVALID_LLM`
  - 503 `LLM_UNAVAILABLE`, for provider errors and timeouts.
- **Locks:** a check runs on a locked episode (owner answer 1). It never runs the whole-doc lock assertion, because that would flag the new `structureChecks` entry. Instead the lock-violation test proves nothing outside `episode.structureChecks` changes.

## Repo rules this touches

- **Rule 1:** tests use `MockLlmClient` only.
- **Rule 2:** this is a new generation path, so the lock-violation test comes first. A check must never change scene, beat, plan or ledger content, and the test asserts the doc is identical outside `episode.structureChecks`.
- **Rule 4:** every save goes through the snapshot helper.
- **Rule 5:** logs carry ids, structure, token counts and `PROMPT_VERSION`, never stage reasons or quotes.
- **Rule 7:** two new prompts, so bump `PROMPT_VERSION`. **Sign-off is a hand check, not `make evals`** (owner decision, 2026-10-11): `make evals` hangs and is inefficient, and won't be re-run until the evals are redesigned. Before merge, with the owner's OK (about $1 total), run each AI structure in the local app on *Field of Dreams* and the West Wing pilot, and record the results in the PR:
  - stage statuses and evidence for each run
  - Hero's Journey applies on *Field of Dreams*
  - Hero's Journey doesn't fit the West Wing pilot
  - nothing is thrown away when a stage fails verification
  - cost and time for each check.
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
- Redesigning the evals. That's a separate task, and it has to be done before `make evals` is run again.

## Owner answers (2026-10-11)

1. **Locked episodes:** checks are allowed, because a check never changes the script, only `episode.structureChecks`.
2. **Save the Cat on a TV episode:** the 15 beats run as written, and the model can say they don't fit.
3. **Thin:** it ships. Drop it if writers find it noisy.
