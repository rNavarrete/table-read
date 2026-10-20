# Breakdown ledgers, P0 (T10.1, T10.2) — design

Status: owner directive 2026-10-19 ("just start with the P0 items"); the owner skipped the design questions, so every decision below marked _(call)_ is the builder's default for the owner to check in review.

## Why

The import breakdown is the product's strongest feature: a writer imports a script they admire and reads how it works. The 2026-10-19 screenplay-breakdown research (craft books, showrunners, narratology, computational work) found that the traditions agree on what to record, and that the import records part of it:

- **A scene is a value that turns.** McKee's test: name the value at stake, its charge as the scene opens and as it closes; if they match, the scene did not turn. Story Grid's spreadsheet records the same columns; Snyder's cards record "emotional change". Mamet's memo adds "why now?". Import records none of these.
- **A beat is a tactic change, recorded from the character's side.** Stanislavsky's "bit" and McKee's beat are the same unit: one exchange of action and reaction, and a new beat starts when a character changes tactic. Actors and directors record each beat as who does what to whom (an action verb) and how the other answers. Import records beats from the audience's side only (`whatHappens / audienceLearns / audienceFeels`), and its boundary rule includes "topic change" and a ~10-line cap, which no craft source uses.
- **A TV episode is braided storylines.** Rooms break A, B, C (and a runner) one strand at a time, then braid them (Chase's Sopranos: A and B ~13 scenes each, C 5–6, D a few). `Scene.storyline` and `Episode.storylines` exist in the contract, but import stamps every scene `"A"` and leaves `storylines` empty.

The report's P0 "keep" rows are invariants for this work, not tasks: the evidence-first scaffold (server-derived partition and ids, verbatim quotes, verifiers that only downgrade, no fabricated fallback, one snapshot), `Motivation`, `Secret` and the `knownBy` fold rule, and the TV act grammar with feature beat labels banned.

## Goals

1. Every imported scene records the value at stake, its charge in and out, and why it happens now.
2. Every imported beat records who drives it, the tactic as an action verb, whom it targets, and the reaction — alongside the existing audience-side fields.
3. Beat boundaries follow the craft rule: tactic or objective change, entrance or exit, location change.
4. Every imported episode records its storylines (A–D) and each scene's storyline; each thread records the storyline it belongs to.
5. The writer can see all of it in Plan's scene panel.

## Non-goals

- Removing or renaming `Beat.whatHappens / audienceLearns / audienceFeels`. Write, generation (Next Beat, Tune, skeleton) and Change Sets keep using them. _(call: additive, not a replacement — replacing them touches every mode for no gain the research asks for)_
- Generation ops filling the new fields. Only import fills them; authored and generated beats and scenes leave them empty.
- Editing the new fields. They are read-only import readings, like motivations today. No `SceneUpdate` / `BeatUpdate` change.
- Johnstone status shift per beat (the report marks it optional, moderate evidence).
- A "scene doesn't turn" warning or score. The UI states the charges; it never grades them (McKee's "negation of the negation" — negative to worse — is a turn three charge values cannot show).
- A storyline highlight on the Plan board, storyline colors, or cross-episode storylines. Follow-ups.
- Changing the overview, entity, extract, scan, narrative-map or structure-check prompts.

## Anti-goals

- The model inventing ids. Characters come back as names and the server resolves them; scenes come back as ids the server already sent and are checked.
- A failed or empty new field failing an import. Every new model field has a default; a scene or beat without them imports exactly as today.
- Writer text in logs (hard rule 5): new fields log as counts only.

## Contract changes

All defaulted so existing docs, checkpoints and pre-change model responses validate. Zod (`packages/contract`), Pydantic (`apps/api/schemas.py`), data contract doc, prompt spec, regenerated `config/tool_schemas/` — every home or none (hard rule 3).

`Charge = 'positive' | 'negative' | 'mixed'` _(call: the McKee/Story Grid polarity set; "mixed" is their +/−)_.

### T10.1 — persisted

| Type | New field | Shape | Default |
|---|---|---|---|
| `Scene` | `valueAtStake` | string | `''` |
| `Scene` | `chargeIn` | `Charge` \| null | `null` |
| `Scene` | `chargeOut` | `Charge` \| null | `null` |
| `Scene` | `whyNow` | string | `''` |
| `Beat` | `actorCharacterId` | Id \| null | `null` |
| `Beat` | `actionVerb` | string | `''` |
| `Beat` | `targetCharacterId` | Id \| null | `null` |
| `Beat` | `reaction` | string | `''` |

Whether a scene turns is derived where shown (`chargeIn` and `chargeOut` both set and different), never stored _(call)_.

### T10.1 — model output (`segment_scene`, `SegmentedScene`)

- Each beat segment (`kind: 'beat'`) adds `actor` (name as the script gives it, or `''`), `actionVerb`, `target` (name or `''`), `reaction` — strings, default `''`.
- Scene level adds `sceneValueAtStake` (string), `sceneChargeIn`, `sceneChargeOut` (`Charge` \| null), `sceneWhyNow` (string), defaulted like the four existing `scene*` fields.

### T10.2 — persisted

- `Scene.storyline` and `Episode.storylines[].id` widen from `'A'|'B'|'C'` to `'A'|'B'|'C'|'D'` _(call: D because hour dramas run four strands — Chase's D is "usually a comic runner"; a half-hour's runner is usually C)_. `SceneAddition.storyline` stays `'A'`.
- `StoryThread.storyline`: `'A'|'B'|'C'|'D'` \| null, default `null`.

### T10.2 — model output (`infer_narrative_promises`, `NarrativePromises`)

- `storylines`: array (default `[]`) of `{ letter: 'A'|'B'|'C'|'D', summary: string, characterNames: string[], sceneIds: Id[] }`.
- Each `threads[]` item adds `storyline: 'A'|'B'|'C'|'D' | null`, default `null`.

## Prompt changes

Exact wording is the builder's, within these instructions. Both tasks bump `PROMPT_VERSION` and add a history line. T10.2 merged first as `0.53.0`; T10.1 ships as `0.54.0` (its branch's `0.52.0` never reached main).

**§0 structural definitions** (T10.1; shared by every op, so it also reaches generation — intended): a scene turns on a value change for at least one character — the value at stake and whether it is positive, negative or mixed for them as the scene opens and closes. A beat is one exchange of action and reaction: a character pursues one tactic toward one objective and someone or something answers. A new beat starts when a character changes tactic or objective, someone enters or exits, or the location changes. Most beats run under about ten script lines — a size, not a boundary rule. "Topic change" and "emotional/power shift" leave the list.

**segment_scene** (T10.1): the boundary sentence follows §0 and adds that a topic change while the tactic holds is not a new beat. Per beat: `actor` — the character pursuing the tactic, named as in the script; `actionVerb` — one present-tense transitive verb for the tactic as an actor would play it (probes, flatters, stonewalls, threatens), never a summary verb (talks, discusses, has a conversation); `target` — the character it is aimed at, or empty when it is aimed at no one; `reaction` — how the target answers, a short clause, or empty. Scene level: `sceneValueAtStake` — one or two words (trust, freedom, safety, love); `sceneChargeIn` / `sceneChargeOut` — positive, negative or mixed for the character the scene turns on; `sceneWhyNow` — one sentence on the pressure that forces this scene now rather than earlier or later, or empty. Same grounding rule as today: from this scene, empty rather than padded.

**infer_narrative_promises** (T10.2): name the episode's storylines the way a TV room breaks them — A the main story, B the second, C and D lesser strands or a runner; fewer when the episode has fewer (a one-strand episode has only A). Each with a one-sentence summary, the characters who carry it, and the ids of the scenes that mainly serve it; a scene belongs to at most one. Tag each thread with its storyline's letter, or null.

## Server rules

### T10.1

- `parse.py` carries the four beat fields from the claim through `_FinalBeat` / `ImportedBeat` exactly as it carries `what_happens` today, and the four scene fields in `reading`. A synthetic or absorbed beat gets `''`. Tool-markup blanking covers the new string fields.
- Segment checkpoints round-trip the new fields; a checkpoint without them loads with defaults (no re-segmenting).
- `actor` / `target` resolve to `actorCharacterId` / `targetCharacterId` with `fountain.characters.resolve_character_id` against the bible after the entities stage (the final cast, aliases included). Unresolved or ambiguous → `null`; the verb and reaction are kept. Log counts only (resolved / unresolved).
- An `actionVerb` with no actor, or a charge without a value, is stored as returned — the UI handles partial readings.

### T10.2

- `drama_manager/promises.py` merges `storylines`: a repeated letter keeps its first entry; unknown scene ids are dropped (count only); a scene listed under more than one letter keeps the earliest letter (A before B) _(call)_; a storyline left with no scenes is dropped.
- Each scene's `storyline` is its assigned letter; a scene in no storyline stays `'A'` (today's default) _(call)_.
- `Episode.storylines` = the merged list, in letter order, `characterNames` resolved to `characterIds` as `ownerNames` are today (unresolved dropped).
- A thread's `storyline` is kept only if that letter survived the merge; otherwise `null`.
- An empty `storylines` (or an old promises checkpoint) leaves the episode exactly as today: every scene `'A'`, `storylines: []`.

## UI (Plan scene panel; UI spec §5)

Read-only, tokens only, nothing calls a model. Both tasks update UI spec §5 in their own sentence.

- **What the scene does** (T10.1): under The audience, a **The turn** row when `valueAtStake` or a charge is set: the value, then the charges as `+`, `−`, `±` with spoken names ("Trust: negative to positive"); same charge in and out reads "holds at −"; then **Why now** when `whyNow` is set. Neither row shows when the scene has none of these (authored scenes, older imports).
- **Beats** (T10.1): an opened beat row shows, above What happens, one line "Marta probes Dan → Dan deflects to the foreclosure letter": actor name, verb, target name (from `seriesBible.characters`), then `→` and the reaction. Missing parts are left out; no line when `actionVerb` is empty.
- **Details** (T10.2): the existing disabled Storyline select already appears when `episode.storylines` is non-empty; it shows the scene's letter and that storyline's summary.

## Tests (T10.1 and T10.2 each)

- Contract: Zod and Pydantic parse old docs and old model responses (defaults), new fields round-trip, `check_contract` passes with regenerated tool schemas.
- `MockLlmClient` returns the new fields deterministically; no test calls the real API (hard rule 1).
- pytest: field carriage through normalization and merge (including synthetic beats, absorbed unassigned runs, tool-markup blanking); checkpoint round-trip and old-checkpoint load; name resolution (resolved, unknown, ambiguous → null); storyline merge rules (duplicate letters, unknown scene ids, multi-letter scenes, empty storylines, thread letter dropped with its storyline); logs carry counts, never text.
- Vitest: the turn row (charges, holds, why now, hidden when empty), the beat action line (full, partial, absent), the Details storyline select.
- `make check-gaps` passes; no DESIGN-GAP without a task id.

## Sign-off

`make evals` is on hold (owner, 2026-10-11). Each PR names its `PROMPT_VERSION` bump and asks the owner for the substitute sign-off; neither PR runs evals.

## Left to the builder

Exact prompt wording within the instructions above; fixture values (`docs/tableread-fixture.json` scene 3 gets a turn and beat actions so a seeded dev DB shows T10.1); where the resolution step sits in `pipeline.py`; test file layout.
