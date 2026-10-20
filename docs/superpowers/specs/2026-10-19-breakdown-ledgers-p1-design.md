# Breakdown ledgers, P1 (T10.3–T10.7) — design

Status: owner directive 2026-10-19 ("lets start on the P1 items"), following P0 (`2026-10-19-breakdown-ledgers-p0-design.md`, T10.1/T10.2, merged as #36/#33). As with P0 the owner did not take design questions; every _(call)_ below is the builder's default for the owner to check in review.

## Why

The 2026-10-19 screenplay-breakdown research's P1 rows. Each fills a ledger the craft and scholarly traditions specify and the import does not yet keep:

- **Threads move, not just open and close.** The published *Back to the Future* setup/payoff ledger, Petrović's closure levels (a setup can be closed at plot, story, thematic or parametric level — *Fargo*'s money is closed thematically), Levitz's braiding rule ("each appearance of a plotline must advance it"), and the plant's "second job" (a good plant does something else when it is planted; "characterization is not a plant").
- **Who knows what is a grid.** Hitchcock/McKee's three relations (audience knows less, the same, more — mystery, suspense, irony), Cabañas et al.'s false-belief rows (a misinformed character believes something *specific*), and a secret that points at the fact it hides.
- **Structure is a window, not a page number.** TRIPOD measured Hauge's five turning points at 11/32/51/74/89% of a script with standard deviations of 5–12%; experts agree on the exact turning-point scene only 35–64% of the time. A lens should say where a beat landed against where it is expected, and "early", "late" or "out of order" are findings, not failures.
- **An episode is about something, and its lead moves.** Mazin's central dramatic argument (an arguable claim; the lead starts on the anti-theme side), Rabkin's theme → conflict → leads, Weiland's want / need / lie / ghost, and the Breaking Bad room's standing question, "Where is Walt's head at… on the continuum of his character?" The owner's own next step (structure-checklist spec, 2026-10-11) was "move theme, the lead's arc and scene stakes into the import"; P0 did the stakes.
- **Story order is not script order.** Genette's order (analepsis/prolepsis), Nolan's hairpin, Aronson's flashback structures: a breakdown has to know when a scene happens in the story, not only where it sits in the script.
- **TV acts end on act-outs and some episodes end on a tag.** The act grammar is already the spine; the tag is a non-goal of the act-inference design (§9) because `Scene.act` could not encode it.

## Shape of the work

Five tasks, one LLM operation each, so they build in parallel without sharing a prompt:

| Task | Operation | Adds |
|---|---|---|
| T10.3 Thread ledger | `infer_narrative_promises` | thread movements, closure level, second job |
| T10.4 Knowledge grid | `extract_ledger_facts` | belief content, secret→fact link, per-scene knowledge mode |
| T10.5 Structure windows | `check_structure` (+ verify) | expected-position windows and placement; a Turning Points lens |
| T10.6 About, arcs, story time | `infer_story_overview` | episode argument, lead arcs with head-at stops, story order |
| T10.7 Tag and act-outs | `infer_act_breaks` | a TAG section after the last act |

Invariants carried from P0: evidence-first (the model returns names and ids the server already sent; the server resolves, validates, drops, never invents), every new field defaulted so old docs, checkpoints and responses load, counts-only logs, one snapshot per import, read-only display unless stated, tokens only in UI, no "score" or nag copy.

## Non-goals (all tasks)

- New LLM calls. Every reading rides on a call the import (or the on-demand structure check) already makes.
- Editing the new fields. Read-only, like motivations and P0's turn.
- Gap *type* (temporary vs permanent) on threads: inside one episode an open thread cannot be told apart from one carried to the next episode; that is Butler's enigma taxonomy, P3 _(call)_.
- Genette duration classes (summary/scene/ellipsis/stretch/pause) and repetitive narration _(call: low value per scene in a teleplay; revisit with montage detection)_.
- Thompson's four-part structure for features _(call: Table Read is episodic; Turning Points is the calibrated lens that rescales to an episode)_.
- Cross-episode or season-level anything (P3).
- Half-hour "plot movement" counts _(call: derived trivia without a home in the UI yet)_.

## T10.3 Thread ledger (`infer_narrative_promises`)

**Contract.** `StoryThread` adds:
- `movements`: array, default `[]`, of `{ sceneId, beatId: Id | null, phase: 'setup' | 'escalation' | 'reversal' | 'reveal' | 'payoff' | 'aftermath', summary }` — every scene where the thread appears, in scene order, each saying what changed for the thread there. Reuses the Narrative Map's `ThreadMovementPhase` enum (the map is retiring; the enum stays). Multi-stage payoffs are several `payoff` movements; `payoffSceneId` stays the final payoff.
- `closureLevel`: `'plot' | 'story' | 'thematic' | 'parametric' | null`, default `null` — how a paid-off thread is closed; `null` while open.
- `secondJob`: string, default `''` — what the setup does at the moment it is planted besides planting (a laugh, a characterization, a reveal); empty when it does nothing else.

Model output (`NarrativePromises.threads[]`) adds `movements` (`sceneId`, `beatId`, `phase`, `summary`), `closureLevel`, `secondJob`, all defaulted.

**Server.** Movements: drop rows whose scene is unknown or not in this episode; a `beatId` not in that scene → `null`; sort by scene order then beat index; keep at most one row per (scene, phase) _(call)_; a thread's setup and payoff scenes are not required to appear as movements. `closureLevel` on an open thread → `null`. Counts-only logs.

**Prompt.** Ask for each thread's appearances (every scene it moves, the phase, one line on what changed), how a paid-off thread is closed (plot: the question is answered on screen; story: answered by consequence; thematic: answered by meaning rather than event; parametric: answered by form — a repeated image, a callback), and the setup's second job. Name Levitz's test in plain words: an appearance that changes nothing is not a movement.

**UI.** Plan scene panel "What it touches": each thread row adds the phase of this scene's movement ("escalates", "reverses"…) when there is one. Ledger Threads view (`ThreadsPanel`): each thread lists its movements in order (scene number, phase, summary), the gap ("pays off 12 scenes later", derived from scene positions), the closure level for paid-off threads ("closed thematically"), and the second job.

## T10.4 Knowledge grid (`extract_ledger_facts`)

**Contract.** `KnowledgeEvent` and `ExtractedKnowledgeEvent` add `belief`: string, default `''` — for `suspects` and `misinformed`, what the character takes to be true instead, as a plain statement ("the money went to the bank"); empty for other kinds. No other contract change: `Secret.factId` already exists.

**Owner decision 2026-10-19: keep import speed; link by beat.** An earlier cut had the extraction prompt list threads' secrets and the model cite one (`ExtractedFact.secretId`), which made the facts fan-out wait on threads (about +90 s on a 60-scene import). Instead the model never names a secret, facts run beside threads as before, and the server links by beat.

**Server.** `belief` on any kind other than `suspects`/`misinformed` is blanked _(call)_. Once both the threads merge and fact assembly are done, before the import's single snapshot, each secret that is not locked and has `factId` null is linked deterministically:
1. Candidates are the assembled facts (active or pending_review) whose `sourceSpan.beatId` is the secret's `establishedBeatId`; when that is null, whose `sourceSpan.sceneId` is its `establishedSceneId`.
2. Keep facts whose `knownBy` includes every `holderCharacterIds` entry and none of `concealedFromCharacterIds`.
3. If more than one remains, prefer those whose `audienceKnows` equals the secret's.
4. Link only when exactly one candidate remains; otherwise leave null.
5. A fact two secrets would link links neither (as the promises merge clears a quote two claims cite).
Logs carry counts only (linked, no_candidate, ambiguous, contested). Nothing is carried across a resume, so a resumed import links the same way.

**Derived knowledge mode (client, no request).** For a scene, the facts in play are the ledger facts established in it (`sourceSpan.sceneId`) plus the facts of secrets it establishes, keeps or reveals; the characters present are the scene's dialogue cues and motivation characters. Then, McKee's three relations:
- **Mystery** — the audience does not know a fact in play that a present character knows (`audienceKnows: false`, knower present as of this scene).
- **Dramatic irony** — the audience knows a fact in play that a present character does not (or is misinformed about).
- **Suspense** — facts are in play and neither of the above holds (audience and characters share the knowledge).
A scene can be Mystery and Irony at once; a scene with nothing in play shows nothing. Knowers use the existing as-of fold (`learns`/`confirms` add, `forgets` removes).

**UI.** Plan scene panel "What it touches": a mode line above the facts ("Dramatic irony — the audience knows; Dan doesn't"), and the secret callout gains the ordering in words ("The audience and Marta know; Dan doesn't") _(call: words, not the `>` notation)_. Ledger fact detail shows each `suspects`/`misinformed` event's belief ("Dan believes: …").

## T10.5 Structure windows (`check_structure` / `verify_structure_check`)

**Contract.** `StructureLens` adds `turning_points`; `StructureStageName` adds `tp_opportunity`, `tp_change_of_plans`, `tp_point_of_no_return`, `tp_major_setback`, `tp_climax`. `StructureStage` adds, server-derived and never from the model:
- `positionPct`: number 0–100 \| null — where the cited beat falls in the episode's script text (share of script characters before the beat's midpoint) _(call: script text, the same length measure as the act share bar)_; null without a beat.
- `expectedPct`: number \| null and `windowPct`: number \| null — the lens's expected position and tolerance; null for stages a lens does not place.
- `placement`: `'in_window' | 'early' | 'late' | 'out_of_order' | null`.

Placement is separate from `status`: status says whether the evidence holds, placement says where it sits _(call)_. Rules: `out_of_order` when a hit or thin stage's beat comes before an earlier stage's beat in the lens order (Turning Points and Save the Cat only; Hero's Journey and Story Circle are functional and Vogler allows reordering, so they get no placement) _(call)_; else `early`/`late` outside the window; else `in_window`; `null` for missing or unverified stages.

**Windows** _(call)_: Turning Points from TRIPOD's empirical means and standard deviations — 11/32/51/74/89% ± 7/11/12/8/5. Save the Cat from the book's page targets over 110 pages — catalyst 12, break into two 25, midpoint 55, all is lost 75, break into three 85 (as %: 10.9, 22.7, 50, 68.2, 77.3) ± 8; other Save the Cat stages unplaced. Constants live in `structure_stages.py` beside the stage lists, mirrored in `apps/web/src/ledger/structure/stages.ts` with a test pinning both.

**Prompt.** The Turning Points lens (Hauge's five, as TRIPOD defines them: opportunity, change of plans, point of no return, major setback, climax) with the same hit/thin/missing rules and `applies: false` for episodes with no single protagonist arc; the model is not told the windows (it must find the beats, not place them) _(call)_. Verification unchanged in kind.

**UI.** Ledger structure panel: Turning Points is a fourth opt-in lens; each placed stage shows its position ("at 48% · expected 51% ± 12") and, when off, the placement in plain words ("earlier than usual", "comes before the change of plans") — stated, never graded.

## T10.6 About, lead arcs and story time (`infer_story_overview`)

**Contract.**
- `StoryOverview` adds `dramaticQuestion`, `centralArgument`, `antiTheme` (strings, default `''`).
- `StoryOverviewOutlineItem` adds `storyOrder`: int \| null, `storyTime`: string (default `''`), `anachrony`: `'none' | 'flashback' | 'flashforward'` (default `'none'`). `storyOrder` is the scene's rank in story chronology (0 = earliest); null when the episode is told in order _(call: the outline row is already one-per-scene, so story time rides on it)_.
- `Episode.characterArcs`: array, default `[]`, of `{ characterId, want, need, lie, ghost, continuumAxis, stops: [{ sceneId, headAt }] }` — for the episode's principal characters (at most three) _(call: episode-scoped like threads; the bible's `seriesArc` stays series-level)_.

Model output (`InferredStoryOverview`) adds the three strings, the three outline-row fields, and `characterArcs` with `characterName` instead of `characterId`.

**Server.** Resolve `characterName` with `resolve_character_id`; unresolved arcs dropped (count); at most three kept; duplicate characters keep the first. Stops: unknown scene ids dropped, one per scene (first wins), sorted by scene order. `storyOrder`: if the returned ranks are not a permutation of 0..n−1 over the outline rows, or the order matches script order, store null for every row _(call: a partial or identity order is noise)_. `anachrony` other than `none` on a row whose `storyOrder` is null is kept (a flashback can be marked without a full order).

**Prompt.** The dramatic question (yes/no, answered by the climax); the central argument as an arguable claim, not a topic ("love requires surrender", not "love"); the anti-theme the lead starts out embodying. Up to three principals: want (conscious goal), need (what they must learn or become), lie (the false belief they hold), ghost (the past wound behind it), the continuum the episode moves them along ("trusting ↔ suspicious"), and per scene where they matter, where their head is at on that continuum in one line. For each outline row: when it happens in the story relative to the others, a short story-time label ("Day 1, night", "Eight years earlier"), and whether it is a flashback or flashforward.

**UI.** Plan Episode view: an **About** section (question, argument, anti-theme) and the arcs (name, want / need / lie / ghost, the continuum). Plan scene panel "Who wants what": for an arc character present, "Head at: …" under their motivation card (or alone when they have no motivation row). Plan episode chart: a **Story order** toggle that reorders blocks by `storyOrder` when the episode has one, flashbacks and flashforwards marked; hidden when `storyOrder` is null everywhere _(call: the chart is the one place both orders fit; the board stays in script order)_. Ledger character profile shows the arc fields.

## T10.7 Tag and act-outs (`infer_act_breaks`)

**Contract.** A tag is the act after the last act: `Scene.act = format.actCount + 1`, valid only when `format.tag` is true _(call: mirrors cold open = act 0; no new field, no migration)_. `InferredActBreaks.starts` may include that act. The act-inference §9 non-goal is lifted.

**Server.** `fountain/acts.py`: printed `TAG` markers (and `END OF SHOW`/`END OF EPISODE` before a final short scene, if the existing marker regex already supports them — no new heuristics) start the tag; a model start for act `actCount + 1` is accepted only when `format.tag`; otherwise it is an invalid start handled like any other (repair code, no fabricated fallback). Every other act rule is unchanged.

**Prompt.** When the format has a tag, the model may start the tag at the last scene(s) that follow the final act's climax as a short coda; it never invents a tag the format does not have.

**UI.** Everywhere an act label is built (`actLabel` in `apps/web/src/plan/planTree.ts` and any copy), `actCount + 1` with `format.tag` reads **TAG**; the Plan Act selector lists TAG when `format.tag`; act frames, the episode chart and Write's outline show it like any act. Act-outs: unchanged — the beat sheet's "Act N Out" rows and the board's ACT OUT tag already anchor them; the tag's last card is not an act-out _(call)_.

## Tests (each task)

Contract: old docs, checkpoints and responses parse with defaults; new fields round-trip; `check_contract` passes with the regenerated tool schema. `MockLlmClient` returns the new fields deterministically. pytest for every server rule above (drops, dedupes, nulls, links, counts-only logs). Vitest for every UI line above (present, partial, hidden). `check_design_gaps` passes.

## Sign-off

Each task bumps `PROMPT_VERSION` from main's current value; when several are open, each merge after the first renumbers to the next minor. `make evals` is on hold; each PR asks for the substitute sign-off and does not block on it.

## Left to the builder

Exact prompt wording within the instructions; layout and copy within the UI sentences; where server rules live; test layout; fixture values that exercise the UI on a seeded dev DB.
