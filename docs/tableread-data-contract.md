# Table Read Data Contract (MVP)

Single source of truth for types and API. Frontend uses the Zod definitions (generate TS types via `z.infer`); backend mirrors them in Pydantic. **A CI check diffs the two — any divergence fails the build.** Field names are camelCase on the wire; Pydantic uses `alias_generator=to_camel`.

## 1. Core types (Zod)

```ts
import { z } from 'zod'

export const Id = z.string().min(1) // "scene-1", "beat-1-2", "fact-04", "char-marta"

export const ShowFormat = z.object({
  genre: z.enum(['drama', 'comedy', 'dramedy']),
  runtimeMinutes: z.number().int().positive(),
  actCount: z.number().int().min(1).max(6),
  coldOpen: z.boolean(),
  tag: z.boolean(),
  serialization: z.number().min(0).max(1),
})

export const Character = z.object({
  id: Id,
  name: z.string(),
  locked: z.boolean().default(false),
  // Alternate names/nicknames the script uses for this character. Populated
  // by infer_story_entities (§2a) at import time and used to resolve knownBy
  // strings and later mentions against the right character. Defaults to []
  // so pre-existing docs validate.
  aliases: z.array(z.string()).default([]),
  embodiment: z.string(),
  presentation: z.string(),
  hiding: z.string(),
  traits: z.string(),
  seriesArc: z.string(),
  // T7.31 — Ledger People profile prose (defaults keep old docs valid).
  summary: z.string().default(''),
  bio: z.string().default(''),
})

export const Relationship = z.object({
  between: z.tuple([Id, Id]),
  label: z.string(),
  reallyLike: z.string(),
  locked: z.boolean().default(false),
})

// T7.19 — extends the original { text, locked } bible entry with structured
// limit/cost/exception fields plus one evidence citation. New fields all
// default so pre-existing docs (and the fixture's original two-field rules)
// still validate unchanged.
export const WorldRule = z.object({
  text: z.string(),
  locked: z.boolean().default(false),
  limit: z.string().default(''),
  cost: z.string().default(''),
  exception: z.string().default(''),
  evidenceSceneId: Id.nullable().default(null),
  evidenceQuote: z.string().default(''),
})

export const SeriesBible = z.object({
  existentialQuestion: z.object({
    text: z.string(),
    locked: z.boolean().default(false),
  }),
  worldRules: z.array(WorldRule),
  storiesToAvoid: z.array(z.string()),
  characters: z.array(Character),
  relationships: z.array(Relationship),
  audienceGoals: z.array(z.string()),
  narratorGoals: z.array(z.string()),
  worldQA: z.array(
    z.object({
      q: z.string(),
      a: z.string(),
      locked: z.boolean().default(false),
    }),
  ),
})

// `objective` = what the character actually pursues (meaning unchanged).
// `statedObjective` = what they claim, when that differs; empty means no gap.
// The distance between the two is the ulterior motive. `concealed` separates
// deliberate deception from self-deception. Both default, so pre-existing
// docs validate.
export const Motivation = z.object({
  characterId: Id,
  objective: z.string(),
  stakes: z.string(),
  obstacle: z.string(),
  statedObjective: z.string().default(''),
  concealed: z.boolean().default(false),
})

export const Beat = z.object({
  id: Id,
  index: z.number().int().min(0),
  locked: z.boolean().default(false),
  whatHappens: z.string(),
  audienceLearns: z.string(),
  audienceFeels: z.string(),
  scriptText: z.string().default(''),
  scriptLocked: z.boolean().default(false),
  // T10.1 — the beat from the character's side: who drives it, the tactic as
  // an action verb ("probes", never "talks"), whom it is aimed at, and how they
  // answer. Import fills them from segment_scene; the server resolves the
  // returned names to ids after the entities stage (unknown or ambiguous →
  // null, verb and reaction kept). Authored and generated beats leave them
  // empty; read-only in Plan. Defaulted so pre-existing docs validate.
  actorCharacterId: Id.nullable().default(null),
  actionVerb: z.string().default(''),
  targetCharacterId: Id.nullable().default(null),
  reaction: z.string().default(''),
})

// T10.1 — a value's charge as a scene opens or closes (McKee / Story Grid
// polarity; "mixed" is their +/−).
export const Charge = z.enum(['positive', 'negative', 'mixed'])

// Story order is (act, index), ties in array order — never a scene's position
// in `scenes`: Plan moves rewrite act/index and leave the array alone. Every
// reader (Write, Ledger, export, prompts) follows it; a scene's number is its
// 1-based position in it.
// A scene's `act` under its format: 0 is the cold open when `coldOpen`
// (otherwise act one), the numbered acts follow, and the tag is the act after
// the last act (`actCount + 1` with a cold open, `actCount` without) when `tag`
// (T10.7). Plan's Act selector lists exactly these; a tag's last scene is not
// an act-out.
// T10.2 — a TV room's strands: A the main story, B the second, C and D lesser
// strands or a runner. Import infers them (infer_narrative_promises §2a).
export const StorylineId = z.enum(['A', 'B', 'C', 'D'])

export const Scene = z.object({
  id: Id,
  index: z.number().int().min(0),
  // 0 = cold open; the tag is the act after the last act (actCount + 1 with a
  // cold open, actCount without) when format.tag (T10.7)
  act: z.number().int().min(0),
  storyline: StorylineId.default('A'), // import infers it (T10.2); writer tagging is v2
  locked: z.boolean().default(false),
  location: z.string(),
  time: z.string(),
  socialSituation: z.string(),
  whatHappens: z.string(),
  audienceLearns: z.string(),
  audienceFeels: z.string(),
  motivations: z.array(Motivation),
  beats: z.array(Beat),
  // T10.1 — the scene's turn: the value at stake (one or two words), its
  // charge as the scene opens and closes, and why it happens now (one
  // sentence). Import readings from segment_scene, read-only in Plan; authored
  // scenes leave them empty. Whether the scene turns (both charges set and
  // different) is derived where shown, never stored. A charge without a value,
  // or one charge without the other, is stored as returned.
  valueAtStake: z.string().default(''),
  chargeIn: Charge.nullable().default(null),
  chargeOut: Charge.nullable().default(null),
  whyNow: z.string().default(''),
})

// T7.19 — a narrative setup/payoff arc, MVP-scoped to the episode it lives
// on (non-goal: cross-episode threads). status is a single lifecycle
// label, not step tracking — an "open" thread may have only a setup;
// "paid_off" has a payoff span. Import mints ids and resolves ownerNames
// (see infer_narrative_promises §2a) to ownerCharacterIds server-side.

// T7.27 — episode story overview (logline, scene outline, named beat sheet,
// two-paragraph synopsis). Import fills via infer_story_overview; model never
// mints ids. Defaults to null so pre-existing docs validate.
// T10.6 — story time (Genette's order). storyOrder is the scene's rank in
// story chronology (0 = earliest), null on every row unless the import's
// ranks are a full permutation of the outline rows that differs from script
// order. anachrony is kept independently: a flashback can be marked without
// a full order. Read-only import readings.
export const Anachrony = z.enum(['none', 'flashback', 'flashforward'])
export const StoryOverviewOutlineItem = z.object({
  sceneId: Id,
  summary: z.string(),
  storyOrder: z.number().int().min(0).nullable().default(null),
  storyTime: z.string().default(''), // "Day 1, night", "Eight years earlier"
  anachrony: Anachrony.default('none'),
})
export const StoryOverviewBeatItem = z.object({
  beatId: Id,
  label: z.string().default(''),
  summary: z.string(),
  sceneId: Id.nullable().default(null),
  act: z.number().int().min(0).nullable().default(null),
})
export const StoryOverview = z.object({
  logline: z.string(),
  outline: z.array(StoryOverviewOutlineItem),
  beatSheet: z.array(StoryOverviewBeatItem),
  summary: z.string(),
  // T10.6 — what the episode is about: the yes/no question the climax
  // answers, the central argument as an arguable claim ("love requires
  // surrender", not "love"), and the anti-theme the lead starts out embodying.
  dramaticQuestion: z.string().default(''),
  centralArgument: z.string().default(''),
  antiTheme: z.string().default(''),
  provenance: z.enum(['inferred', 'writer_authored']).default('inferred'),
  locked: z.boolean().default(false),
})

// T10.6 — a principal's arc across one episode: want (conscious goal), need
// (what they must learn or become), lie (the false belief), ghost (the past
// wound behind it), the continuum the episode moves them along, and where
// their head is at on it per scene (stops in scene order, one per scene).
// Episode-scoped like threads; Season.characterArcs stays series-level.
export const CharacterArcStop = z.object({ sceneId: Id, headAt: z.string() })
export const EpisodeCharacterArc = z.object({
  characterId: Id,
  want: z.string(),
  need: z.string(),
  lie: z.string(),
  ghost: z.string(),
  continuumAxis: z.string(), // "trusting ↔ suspicious"
  stops: z.array(CharacterArcStop),
})

// T7.32 - an evidence-grounded map of the episode's macro structure and
// scene-level dramatic movement. Quotes must be verbatim substrings of the
// cited beat's scriptText; ids are validated server-side. `locked` prevents
// an import refresh from replacing a writer-approved analysis.
export const NarrativeEvidence = z.object({
  beatId: Id,
  quote: z.string().min(1).max(200),
})
export const NarrativeTheme = z.object({
  label: z.string(),
  statement: z.string(),
  evidence: z.array(NarrativeEvidence).min(1),
})
export const NarrativeAct = z.object({
  act: z.number().int().min(0),
  dramaticQuestion: z.string(),
  escalation: z.string(),
  // Server-filled from the inferred act's `escalationEvidence` (§2a) — quotes
  // are derived on merge, never sent by the model. Defaulted so maps saved
  // before this field validate, and because an act whose escalation was
  // cleared keeps its coverage and loses only the claim.
  escalationEvidence: z.array(NarrativeEvidence).default([]),
  turnBeatId: Id,
  evidenceQuote: z.string().min(1).max(200),
})
export const HeroJourneyStageName = z.enum([
  'ordinary_world',
  'call_to_adventure',
  'refusal',
  'meeting_the_mentor',
  'crossing_the_threshold',
  'tests_allies_enemies',
  'approach',
  'ordeal',
  'reward',
  'road_back',
  'resurrection',
  'return_with_elixir',
])
export const HeroJourney = z.object({
  applies: z.boolean(),
  protagonistCharacterId: Id.nullable(),
  rationale: z.string(),
  stages: z.array(
    z.object({
      stage: HeroJourneyStageName,
      beatId: Id,
      summary: z.string(),
      evidenceQuote: z.string().min(1).max(200),
    }),
  ),
})
export const NarrativeCharacterArc = z.object({
  characterId: Id,
  want: z.string(),
  need: z.string(),
  internalConflict: z.string(),
  externalPressure: z.string(),
  arcSummary: z.string(),
  turningPoints: z
    .array(
      z.object({
        beatId: Id,
        change: z.string(),
        quote: z.string().min(1).max(200),
      }),
    )
    .min(1),
})
export const SceneTurn = z.object({
  sceneId: Id,
  focalCharacterId: Id.nullable(),
  dramaticFunction: z.string(),
  conflict: z.string(),
  stakes: z.string(),
  turnBeatId: Id,
  turn: z.string(),
  evidenceQuote: z.string().min(1).max(200),
})
// Shared with StoryThread.movements (T10.3): the map is retiring, the enum stays.
export const ThreadMovementPhase = z.enum([
  'setup',
  'escalation',
  'reversal',
  'reveal',
  'payoff',
  'aftermath',
])
export const ThreadMovement = z.object({
  threadId: Id,
  beatId: Id,
  phase: ThreadMovementPhase,
  summary: z.string(),
  evidenceQuote: z.string().min(1).max(200),
})
export const NarrativeMap = z.object({
  dramaticQuestion: z.string(),
  centralConflict: z.string(),
  controllingIdea: z.string(),
  themes: z.array(NarrativeTheme).min(1),
  acts: z.array(NarrativeAct).min(1),
  heroJourney: HeroJourney,
  characterArcs: z.array(NarrativeCharacterArc),
  sceneTurns: z.array(SceneTurn).min(1),
  threadMovements: z.array(ThreadMovement),
  // T9.3: scenes the analysis could not read after one same-prompt re-roll.
  // A listed scene has no sceneTurn, is left out of the synthesis spine, the
  // overview rows sent to synthesis and the verifier's evidence, and counts as
  // covered. Merge rejects any claim citing it (`cites_unanalyzed_scene`). The
  // server never writes analysis prose in its place.
  unanalyzedSceneIds: z.array(Id).default([]),
  provenance: z.enum(['inferred', 'writer_authored']).default('inferred'),
  locked: z.boolean().default(false),
})

// Structure checklist (spec 2026-10-11). TV act structure is derived in the
// web from storyOverview.beatSheet and never stored, so it is not a lens here.
// `turning_points` (T10.5) is Hauge's five turning points as TRIPOD defines them.
export const StructureLens = z.enum(['heros_journey', 'story_circle', 'save_the_cat', 'turning_points'])
// One enum over the four AI structures' stages (12 + 8 + 15 + 5); the server
// checks each stage belongs to the requested lens. Hero's Journey reuses
// HeroJourneyStageName's values; Story Circle ids are prefixed `circle_`,
// Turning Points ids `tp_`.
export const StructureStageName = z.enum([
  ...HeroJourneyStageName.options,
  'circle_you', 'circle_need', 'circle_go', 'circle_search',
  'circle_find', 'circle_take', 'circle_return', 'circle_change',
  'opening_image', 'theme_stated', 'set_up', 'catalyst', 'debate',
  'break_into_two', 'b_story', 'fun_and_games', 'midpoint',
  'bad_guys_close_in', 'all_is_lost', 'dark_night_of_the_soul',
  'break_into_three', 'finale', 'final_image',
  'tp_opportunity', 'tp_change_of_plans', 'tp_point_of_no_return',
  'tp_major_setback', 'tp_climax',
])
// `unverified` is server-set: the verifier did not support the cited beat, or
// returned no verdict for it ("Couldn't verify" in the UI).
export const StructureStageStatus = z.enum(['hit', 'thin', 'missing', 'unverified'])
// Where a stage's beat sits against the lens's expected window (T10.5). Separate
// from `status`: status says whether the evidence holds, placement where it sits.
export const StructurePlacement = z.enum(['in_window', 'early', 'late', 'out_of_order'])
export const StructureStage = z.object({
  stage: StructureStageName,
  status: StructureStageStatus,
  beatId: Id.nullable(), // null for missing
  sceneId: Id.nullable(), // server-filled from the beat
  reason: z.string(),
  evidenceQuote: z.string().min(1).max(200).nullable(), // server-quoted from the beat's own text
  // Server-derived (T10.5), never from the model; defaulted so older checks load.
  // positionPct: the share of the episode's script text (sum of beat `scriptText`
  // lengths, scenes by (act, index), beats by index — the act share bar's measure)
  // before the cited beat's midpoint, rounded to 0.1; null without a beat or
  // when the episode has no script text.
  positionPct: z.number().min(0).max(100).nullable().default(null),
  // The lens's expected position and tolerance (± percentage points); null for
  // stages the lens does not place. Turning Points: TRIPOD's means ± SD,
  // 11/32/51/74/89 ± 7/11/12/8/5. Save the Cat: Snyder's page targets over
  // 110 pages for catalyst, break into two, midpoint, all is lost and break
  // into three (10.9/22.7/50/68.2/77.3) ± 8; its other beats are unplaced.
  // Hero's Journey and Story Circle are functional: nothing placed.
  expectedPct: z.number().nullable().default(null),
  windowPct: z.number().nullable().default(null),
  // Only for placed hit/thin stages; null for missing, unverified and unplaced.
  // out_of_order: the beat comes before an earlier placed hit/thin stage's beat
  // in the lens order; else early/late outside expectedPct ± windowPct
  // (inclusive); else in_window.
  placement: StructurePlacement.nullable().default(null),
})
export const StructureCheck = z.object({
  lens: StructureLens,
  applies: z.boolean(), // false: `rationale` is the "doesn't fit" note and `stages` is []
  rationale: z.string(),
  stages: z.array(StructureStage), // canonical order for the lens
  // SHA-256 (lowercase hex) of, over scenes by (act, index) then beats by index,
  // sceneId + "\x1f" + beatId + "\x1f" + (scriptText ?? "") + "\x1e".
  // The web recomputes it to show the stale line.
  sourceHash: z.string().min(1),
  checkedAt: z.string(),
  promptVersion: z.string(),
})

// T10.3 — how a paid-off thread is closed (Petrović): plot, the question is
// answered on screen; story, answered by consequence; thematic, answered by
// meaning rather than event; parametric, answered by form (a repeated image, a
// callback).
export const ThreadClosureLevel = z.enum(['plot', 'story', 'thematic', 'parametric'])
// T10.3 — one scene where a thread appears and what changed for it there. Same
// shape as the model's row (§2a NarrativePromises.threads[].movements); scene
// and beat ids come from the import spine and the server enforces them.
export const StoryThreadMovement = z.object({
  sceneId: Id,
  beatId: Id.nullable(), // a beat of sceneId; one outside it is stored null
  phase: ThreadMovementPhase,
  summary: z.string(), // one line: what changed for the thread here
})

export const StoryThread = z.object({
  id: Id,
  label: z.string(),
  summary: z.string(),
  status: z.enum(['open', 'paid_off', 'abandoned']),
  ownerCharacterIds: z.array(Id).default([]),
  setupSceneId: Id,
  payoffSceneId: Id.nullable().default(null),
  setupQuote: z.string().default(''),
  payoffQuote: z.string().default(''),
  // Server-filled on merge from the beat the model cited (§2a
  // NarrativePromises); the quote is derived from that beat's text, never
  // written by the model. Both are stored only if the beat belongs to the
  // scene the claim cites, its line is substantive enough to be evidence (a
  // bare character cue or a fragment is not), and the quote is not reused by
  // another claim. Otherwise the quote is cleared and the beat id left null —
  // "no evidence offered" is true, while a plausible-looking citation reads
  // as corroboration and is not.
  setupBeatId: Id.nullable().default(null),
  payoffBeatId: Id.nullable().default(null),
  locked: z.boolean().default(false),
  // T10.2 — the episode storyline this thread belongs to, kept only when that
  // storyline survived the import merge. Null = untagged.
  storyline: StorylineId.nullable().default(null),
  // T10.3 — every scene the thread moves in, sorted by scene order (act, index)
  // then beat index, at most one row per (scene, phase). Multi-stage payoffs are
  // several `payoff` rows; `payoffSceneId` stays the final payoff. The setup and
  // payoff scenes need not appear. Import-only, read-only.
  movements: z.array(StoryThreadMovement).default([]),
  // T10.3 — how the thread is closed; null unless `status` is 'paid_off'.
  closureLevel: ThreadClosureLevel.nullable().default(null),
  // T10.3 — what the setup does when planted besides planting (a laugh, a
  // characterization, a reveal); '' when it does nothing else.
  secondJob: z.string().default(''),
})

// A StoryThread's shape applied to concealment: established -> revealed
// rather than setup -> paid off. What it adds is the asymmetry a thread has
// no room for — who holds it and who is kept in the dark. A fact everyone
// knows is not a secret, and `knownBy` alone cannot say whether the gap is
// deliberate. `factId` links the concealed LedgerFact when one exists, so the
// secret never becomes a second, drifting copy of the truth. Import links it
// by beat (T10.4): the one fact on the secret's establishing beat (its scene
// when the beat is null) known to every holder and to no one it is hidden
// from; none or several, or a fact two secrets would claim, leave it null.
// `revealedSceneId: null` = still concealed at end of episode.
export const Secret = z.object({
  id: Id,
  summary: z.string(),
  factId: Id.nullable().default(null),
  holderCharacterIds: z.array(Id).default([]),
  concealedFromCharacterIds: z.array(Id).default([]),
  audienceKnows: z.boolean().default(true),
  establishedSceneId: Id,
  revealedSceneId: Id.nullable().default(null),
  concealmentSceneIds: z.array(Id).default([]),
  establishedQuote: z.string().default(''),
  revealedQuote: z.string().default(''),
  // Server-derived, same policy as StoryThread.setupBeatId.
  establishedBeatId: Id.nullable().default(null),
  revealedBeatId: Id.nullable().default(null),
  provenance: z
    .enum(['inferred', 'writer_confirmed', 'writer_authored'])
    .default('inferred'),
  locked: z.boolean().default(false),
})

export const Episode = z.object({
  id: Id,
  index: z.number().int().min(0),
  locked: z.boolean().default(false),
  title: z.string(),
  premise: z.string(),
  seasonFunction: z.string().default(''),
  storylines: z.array(
    z.object({
      id: StorylineId,
      summary: z.string(),
      characterIds: z.array(Id),
    }),
  ),
  scenes: z.array(Scene),
  // T7.19 narrative-promise threads — MVP stores threads on the first
  // (only) episode. Defaults to [] so pre-existing docs validate.
  threads: z.array(StoryThread).default([]),
  // Concealment arcs, episode-scoped like threads. Defaults to [].
  secrets: z.array(Secret).default([]),
  // T7.27 episode story overview — null when not yet inferred.
  storyOverview: StoryOverview.nullable().default(null),
  // T10.6 — at most three principals' arcs, from infer_story_overview.
  characterArcs: z.array(EpisodeCharacterArc).default([]),
  // T7.32 evidence-grounded structural map — null when not yet inferred.
  narrativeMap: NarrativeMap.nullable().default(null),
  // Structure checklist — at most one per lens; a new check replaces that
  // lens's entry. A list, not a keyed map (check-contract can't diff an
  // enum-keyed record). Defaults to [] so pre-existing docs validate.
  structureChecks: z.array(StructureCheck).default([]),
})

export const Season = z.object({
  id: Id,
  index: z.number().int().min(0),
  locked: z.boolean().default(false),
  seasonArc: z.string().default(''),
  characterArcs: z.array(
    z.object({
      characterId: Id,
      arc: z.string(),
      locked: z.boolean().default(false),
    }),
  ),
  episodes: z.array(Episode), // MVP: exactly one
})

export const SourceSpan = z.object({
  episodeId: Id,
  sceneId: Id,
  beatId: Id,
  // Offsets within the beat's scriptText. Lines are model-reported (input is
  // line-numbered); char offsets are computed server-side by locating
  // sourceText within the line range (disambiguates duplicates). Import also
  // searches the whole beat and ignores whitespace, HTML entities and page
  // furniture (T9.9); null means the quote was not found on the page.
  startLine: z.number().int().min(0).nullable().default(null),
  endLine: z.number().int().min(0).nullable().default(null),
  charStart: z.number().int().min(0).nullable().default(null),
  charEnd: z.number().int().min(0).nullable().default(null),
})

// §5c infer_story_overview (T7.27) — episode logline / outline / beat sheet /
// two-paragraph synopsis. outline.sceneId and beatSheet.beatId must name
// ids from the imported partition; server drops unknowns and sets
// provenance/locked on Episode.storyOverview.
//
// T10.6 (0.59.0) adds, all defaulted so a pre-0.59.0 response or checkpoint
// parses: the About strings; per outline row storyOrder / storyTime /
// anachrony; and up to three characterArcs named by characterName. The server
// resolves names with fountain.characters.resolve_character_id and drops
// unresolved arcs, keeps at most three (duplicate characters keep the first),
// drops stops on unknown scenes, keeps one stop per scene (first wins) in
// scene order, and nulls storyOrder on every row unless the ranks are a
// permutation of 0..n−1 over the outline rows that differs from script order.
export const InferredStoryOverview = z.object({
  logline: z.string(),
  outline: z.array(
    z.object({
      sceneId: Id,
      summary: z.string(),
      storyOrder: z.number().int().min(0).nullable().default(null),
      storyTime: z.string().default(''),
      anachrony: Anachrony.default('none'),
    }),
  ),
  beatSheet: z.array(
    z.object({
      beatId: Id,
      label: z.string(),
      summary: z.string(),
      sceneId: Id.nullable(),
      act: z.number().int().min(0).nullable(),
    }),
  ),
  summary: z.string(),
  dramaticQuestion: z.string().default(''),
  centralArgument: z.string().default(''),
  antiTheme: z.string().default(''),
  characterArcs: z
    .array(
      z.object({
        characterName: z.string(),
        want: z.string(),
        need: z.string(),
        lie: z.string(),
        ghost: z.string(),
        continuumAxis: z.string(),
        stops: z.array(CharacterArcStop),
      }),
    )
    .default([]),
})

// T7.32 infer_narrative_map. The model names characters because import
// entity IDs are server-owned and selects source beat ids only. The merger
// resolves names, derives exact excerpts from those beats, and writes the
// persisted NarrativeMap shape above. It validates ids, one row per imported
// act, and one row per imported scene.
export const InferredNarrativeMap = z.object({
  dramaticQuestion: z.string(),
  centralConflict: z.string(),
  controllingIdea: z.string(),
  themes: z
    .array(
      z.object({
        label: z.string(),
        statement: z.string(),
        evidence: z.array(z.object({ beatId: Id })).min(1),
      }),
    )
    .min(1),
  acts: z
    .array(
      z.object({
        act: z.number().int().min(0),
        dramaticQuestion: z.string(),
        escalation: z.string(),
        // `turnBeatId` is the one beat the act pivots on; `escalation` is prose
        // about how the whole act raises the stakes. Only one of them used to
        // carry evidence, so a verifier judged the escalation against the turn
        // beat's excerpt and rejected claims that were on the page elsewhere in
        // the same act. The claim now names the 1-3 beats it rests on, and the
        // server rejects any that fall outside this act (merge diagnostic
        // `act_escalation_evidence_mismatch`, repairable).
        escalationEvidence: z.array(z.object({ beatId: Id })).min(1).max(3),
        turnBeatId: Id,
      }),
    )
    .min(1),
  heroJourney: z.object({
    applies: z.boolean(),
    protagonistName: z.string().nullable(),
    rationale: z.string(),
    stages: z.array(
      z.object({
        stage: HeroJourneyStageName,
        beatId: Id,
        summary: z.string(),
      }),
    ),
  }),
  characterArcs: z.array(
    z.object({
      characterName: z.string(),
      want: z.string(),
      need: z.string(),
      internalConflict: z.string(),
      externalPressure: z.string(),
      arcSummary: z.string(),
      turningPoints: z
        .array(
          z.object({
            beatId: Id,
            change: z.string(),
          }),
        )
        .min(1),
    }),
  ),
  sceneTurns: z
    .array(
      z.object({
        sceneId: Id,
        focalCharacterName: z.string().nullable(),
        dramaticFunction: z.string(),
        conflict: z.string(),
        stakes: z.string(),
        turnBeatId: Id,
        turn: z.string(),
      }),
    )
    .min(1),
  threadMovements: z.array(
    z.object({
      threadId: Id,
      beatId: Id,
      phase: z.enum([
        'setup',
        'escalation',
        'reversal',
        'reveal',
        'payoff',
        'aftermath',
      ]),
      summary: z.string(),
    }),
  ),
})

// verify_narrative_map — the independent audit pass over a synthesis
// candidate. The two findings lists are MUTUALLY EXCLUSIVE and only one of
// them rejects: a nonempty `unsupportedClaims` (or `missingSceneIds`) discards
// the whole analysis, `advisories` never does. `approved` is the model's
// opinion; the server re-derives the verdict from the lists, so a nonempty
// blocking list overrides an approval and two empty ones override a rejection
// (analysis version 3.5).
//
// Both carry `{path, reason}`. `path` names the disputed field alone —
// indexing into it only where that identifies which item is meant, as in
// `characterArcs[C.J.].turningPoints[beat-9-3]` — and all explanation belongs
// in `reason`. The server pattern-matches `path` to decide which claim it can
// prune locally instead of discarding the map, so prose in a path is read as a
// claim about a field nobody disputed. `unsupportedClaims` was
// `unsupportedPaths: string[]` before analysis version 2.8: with no reason
// field the verifier appended its reasoning to each path, which both defeated
// that matching and led it to file the same finding in both lists, turning
// every double-filed advisory into a rejection.
export const NarrativeMapVerification = z.object({
  approved: z.boolean(),
  // `excerptCarriesClaim` is declared last so the model states the path,
  // reasons in `reason`, and only then commits to an answer — property order
  // is the decoding grammar's order. The verifier talks itself out of
  // rejections and leaves them rejecting ("so this is actually supported.
  // Retained here only for the compound claim"), and asking it in the prompt
  // not to did not work. `true` means the excerpt does carry the claim, so the
  // finding is not a rejection whatever list it arrived in, and
  // `partition_self_retracted_claims` moves it to advisories before anything
  // downstream sees it. Keyed on the boolean, never on the prose.
  unsupportedClaims: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
      excerptCarriesClaim: z.boolean(),
    }),
  ),
  missingSceneIds: z.array(Id),
  advisories: z.array(z.object({ path: z.string(), reason: z.string() })),
})

// T7.23 — a knowledge-state transition after a fact's establishing scene
// (baseline knowers live on knownBy). "learns" adds characterIds to the
// knower set as of sceneId; "forgets" removes them. knowers_as_of
// (drama_manager/ledger_as_of.py) starts from baseline knownBy and folds in
// every event with sceneId index <= the queried scene, in scene order.
// Only `learns`/`confirms` add to the knower set and only `forgets` removes.
// `suspects` and `misinformed` are recorded but deliberately do NOT move it,
// so `knownBy` keeps meaning "who actually knows the true fact" — a belief is
// not knowledge, and folding one in is how a ledger becomes confidently wrong.
// Fold semantics live in drama_manager/ledger_as_of.py.
export const KnowledgeEventKind = z.enum([
  'learns',
  'confirms',
  'forgets',
  'suspects',
  'misinformed',
])

export const KnowledgeEvent = z.object({
  sceneId: Id,
  characterIds: z.array(Id).default([]),
  kind: KnowledgeEventKind,
  quote: z.string().default(''), // <=200 chars evidence
  // T10.4 — for suspects/misinformed, what the character believes instead
  // ("the money went to the bank"); blanked server-side on other kinds.
  belief: z.string().default(''),
})

export const LedgerFact = z.object({
  id: Id,
  fact: z.string(),
  factType: z.enum([
    'event',
    'state',
    'knowledge',
    'relationship',
    'world_rule',
  ]),
  sourceSpan: SourceSpan,
  sourceText: z.string().default(''), // verbatim quote from the establishing beat; server-verified
  knownBy: z.array(Id),
  // T7.23 knowledge-transition history beyond the baseline knownBy set.
  knowledgeEvents: z.array(KnowledgeEvent).default([]),
  audienceKnows: z.boolean().default(true), // distinct from knownBy — dramatic irony lives in the gap
  provenance: z.enum(['inferred', 'writer_confirmed', 'writer_authored']),
  confidence: z.number().min(0).max(1),
  status: z.enum([
    'active',
    'superseded',
    'stale',
    'pending_review',
    'rejected',
  ]),
  supersedes: Id.nullable(),
  supersededBy: Id.nullable(),
  // T7.23 response-only enrichment: GET /ledger?asOfScene= fills this with
  // knowers_as_of's result so the UI can show who knew a fact at that scene
  // without rewriting canonical knownBy. Always null outside that query
  // param — never persisted, never settable by clients.
  knownByAsOf: z.array(Id).nullable().default(null),
})

export const Project = z.object({
  id: Id,
  title: z.string(),
  format: ShowFormat,
  enabledComponents: z.array(z.string()),
  premise: z.string(),
  seriesBible: SeriesBible,
  seasons: z.array(Season),
  headSnapshotId: Id.nullable(),
  /** Adoption A3 — per-project default for Write/Review craft pickers. */
  defaultCraftLevel: z
    .enum(['fast', 'standard', 'considered'])
    .default('standard'),
})
// Ledger, snapshots, suggestionHistory live in separate stores (design doc §5).

export const ProjectSummary = z.object({
  id: Id,
  title: z.string(),
  format: ShowFormat,
  updatedAt: z.string().datetime(),
  pendingReviewCount: z.number().int().min(0),
  setupState: z.enum(['incomplete', 'ready']),
})

export const CharacterSeed = z.object({
  name: z.string().min(1),
  traits: z.string().nullable().default(null),
})

export const ProjectFoundationInput = z.object({
  existentialQuestion: z.string().nullable().default(null),
  storiesToAvoid: z.array(z.string()).nullable().default(null),
  characters: z.array(CharacterSeed).nullable().default(null),
})

export const ProjectCreateRequest = z.object({
  title: z.string(),
  format: ShowFormat,
  premise: z.string(),
  foundation: ProjectFoundationInput.nullable().default(null),
})

// §9.3 atomic create-and-import: project basics (no `foundation`) plus the
// script source. `premise` is optional (the import wizard has no premise step).
export const ProjectImportCreateRequest = z.object({
  title: z.string(),
  // null (the import wizard always sends none): the import works the format
  // out from the script in its act stage (owner decision 2026-10-11).
  format: ShowFormat.nullable().default(null),
  premise: z.string().nullable().default(null),
  source: z.object({
    format: z.enum(['fountain', 'text']),
    content: z.string(),
  }),
})

export const PdfExtractMethod = z.enum(['text_layer', 'ocr'])

export const PdfExtractResult = z.object({
  text: z.string(),
  method: PdfExtractMethod,
  pageCount: z.number().int().positive(),
  warnings: z.array(z.string()),
})
```

## 2. Generation / Review types

```ts
export const BeatCandidate = z.object({
  label: z.string().max(40),
  beatPlan: z.object({
    whatHappens: z.string(),
    audienceLearns: z.string(),
    audienceFeels: z.string(),
  }),
  scriptText: z.string(),
  continuityConflicts: z.array(
    z.object({ factId: Id, explanation: z.string() }),
  ),
})

export const ImpactedObject = z.object({
  objectType: z.enum(['scene', 'beat', 'character', 'ledgerFact']),
  objectId: Id,
  // server-annotated: scene/beat → regenerate; character/ledgerFact →
  // flag_only (MVP has no machine-edit path for them); `add` is the §9.4
  // initial_scene_skeleton variant, where objectId is a proposalId, not a
  // final scene id.
  applyMode: z.enum(['regenerate', 'flag_only', 'add']),
  reason: z.string(),
  confidence: z.enum(['high', 'speculative']),
  locked: z.boolean(), // server-annotated; locked rows render disabled
  before: z.string(), // rendered snippet
  after: z.string().nullable(), // null until regeneration preview exists; always null for flag_only
  continuityFlags: z.array(z.object({ factId: Id, explanation: z.string() })),
  approved: z.boolean().default(false), // only meaningful for applyMode "regenerate"
})

export const ConsistencyFlag = z.object({
  id: Id,
  objectType: z.enum(['scene', 'beat']),
  objectId: Id, // an untouched object
  factId: Id.nullable(),
  explanation: z.string(),
  severity: z.enum(['contradiction', 'tension']),
  status: z.enum(['open', 'dismissed', 'resolved']),
  sourceChange: Id, // the ChangeSet or accepted-beat snapshot that triggered the scan
})

// §9.3 atomic create-and-import result — same shape as the existing
// `POST /projects/{pid}/import` response, returned as the SSE stream's
// terminal `complete` payload.
export const ProjectImportResult = z.object({
  project: Project,
  newFacts: z.array(LedgerFact),
  consistencyFlags: z.array(ConsistencyFlag),
})

// Named import progress stages (§7 step 4), in emission order. `inferring_entities`
// (§2a infer_story_entities/§5a) runs between act inference and fact extraction;
// `inferring_promises` / `inferring_overview`
// (§2a, T7.19/T7.32) run right after it, still before fact extraction, so
// motivations and analysis see the resolved cast.
export const ProjectImportStageName = z.enum([
  'parsing_scenes',
  'segmenting_beats',
  'inferring_acts',
  'inferring_entities',
  'inferring_promises',
  'inferring_overview',
  'extracting_facts',
  'checking_consistency',
  'saving',
])

// §9.3 `found` payloads: per-unit import results for the live import board.
// Indexes are 0-based positions in the server's scene split; data is
// post-merge where a merge exists and never carries `scriptText`.
const NonNeg = z.number().int().nonnegative()
export const ImportFoundScene = z.object({
  index: NonNeg,
  slugline: z.string(),
  lineCount: NonNeg,
  intExt: z.enum(['int', 'ext', 'other']),
})
// A segmented beat's reading fields (T9.17), in scene order; never `scriptText`.
export const ImportFoundBeat = z.object({
  whatHappens: z.string(),
  audienceLearns: z.string(),
  audienceFeels: z.string(),
})

export const ProjectImportFound = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scenes'), scenes: z.array(ImportFoundScene) }),
  z.object({
    kind: z.literal('scene'),
    index: NonNeg,
    beatCount: NonNeg,
    whatHappens: z.string(),
    failed: z.boolean(),
    beats: z.array(ImportFoundBeat).default([]),
  }),
  z.object({ kind: z.literal('acts'), format: ShowFormat, sceneActs: z.array(NonNeg) }),
  z.object({ kind: z.literal('castRead'), sceneIndexes: z.array(NonNeg) }),
  z.object({
    kind: z.literal('cast'),
    total: NonNeg,
    characters: z.array(z.object({ name: z.string(), sceneCount: NonNeg })),
  }),
  z.object({
    kind: z.literal('threads'),
    threads: z.array(
      z.object({
        label: z.string(),
        status: z.enum(['open', 'paid_off', 'abandoned']),
        setupSceneIndex: NonNeg.nullable(),
        payoffSceneIndex: NonNeg.nullable(),
      }),
    ),
  }),
  z.object({
    kind: z.literal('overview'),
    logline: z.string(),
    beatSheet: z.array(z.object({ label: z.string(), sceneIndex: NonNeg.nullable() })),
  }),
  z.object({ kind: z.literal('facts'), index: NonNeg, factCount: NonNeg, secretCount: NonNeg, failed: z.boolean() }),
  z.object({ kind: z.literal('flags'), contradictions: NonNeg, tensions: NonNeg, other: NonNeg }),
])

// §9.3 SSE progress: `stage` events announce each named stage, `progress`
// events report monotonic item counts within a stage (`done <= total`),
// `found` events (additive) carry per-unit results, then exactly one
// terminal `complete` or `failed`. `error` matches the canonical
// `{code, message, details?}` envelope.
export const ProjectImportProgressEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage'), name: ProjectImportStageName }),
  z.object({
    type: z.literal('progress'),
    stage: ProjectImportStageName,
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('found'),
    stage: ProjectImportStageName,
    cached: z.boolean().default(false),
    data: ProjectImportFound,
  }),
  z.object({ type: z.literal('complete'), result: ProjectImportResult }),
  z.object({
    type: z.literal('failed'),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().nullable().default(null),
    }),
  }),
])

// Exact, typed preview content — what apply actually writes. `ImpactedObject.after`
// is only the rendered display snippet; this is the source of truth.
export const BeatUpdate = z.object({
  beatId: Id,
  beatPlan: z
    .object({
      whatHappens: z.string(),
      audienceLearns: z.string(),
      audienceFeels: z.string(),
    })
    .nullable(),
  scriptText: z.string().nullable(), // null = field unchanged
})

export const SceneUpdate = z.object({
  sceneId: Id,
  fields: z.object({
    whatHappens: z.string().nullable(),
    audienceLearns: z.string().nullable(),
    audienceFeels: z.string().nullable(),
    location: z.string().nullable(),
    time: z.string().nullable(),
    socialSituation: z.string().nullable(),
  }), // null = field unchanged
})

// §9.4 initial scene skeleton — guided-setup scene-addition Change Set. MVP
// defers storyline inference, so every addition carries storyline "A"
// (Scene's own default). `proposalId` is the server-assigned selection
// handle — never the final scene id — minted once generation validates the
// model's scene list (§2a InitialSceneSkeleton below).
export const SceneAddition = z.object({
  proposalId: Id,
  act: z.number().int().min(0),
  storyline: z.enum(['A']).default('A'),
  location: z.string(),
  time: z.string(),
  socialSituation: z.string(),
  whatHappens: z.string(),
  audienceLearns: z.string(),
  audienceFeels: z.string(),
  motivations: z.array(Motivation), // characterId references existing Characters
  beatPlanSeeds: z.array(
    z.object({
      whatHappens: z.string(),
      audienceLearns: z.string(),
      audienceFeels: z.string(),
    }),
  ), // ordered; apply mints beat ids/scriptText: "" server-side
})

// One generated skeleton option: the writer compares three of these side by
// side, then selects one to create a Change Set.
export const InitialSceneSkeletonCandidate = z.object({
  candidateId: Id,
  basedOnSnapshotId: Id, // the headSnapshotId this candidate was generated against
  label: z.string().max(40),
  scenes: z.array(SceneAddition), // ordered
})

export const ChangeSetPreview = z.object({
  beatUpdates: z.array(BeatUpdate),
  sceneUpdates: z.array(SceneUpdate),
  continuityConflicts: z.array(
    z.object({ factId: Id, objectId: Id, explanation: z.string() }),
  ),
  basedOnSnapshotId: Id, // head at preview time; apply 409s (PREVIEW_STALE) if head moved
  generatedAt: z.string().datetime(),
  // §9.4 initial_scene_skeleton variant: the chosen candidate's scene
  // additions, verbatim. Null for the ordinary "edit" ChangeSet kind.
  sceneAdditions: z.array(SceneAddition).nullable().default(null),
})

// "edit" — the classify_blast_radius / regenerate_elements flow above.
// "initial_scene_skeleton" — guided-setup scene additions (§9.4): selecting
// a candidate creates the Change Set already `previewing` (the candidate
// IS the preview; no further model call).
export const ChangeSetKind = z.enum(['edit', 'initial_scene_skeleton'])

export const ChangeSet = z.object({
  id: Id,
  projectId: Id,
  kind: ChangeSetKind.default('edit'),
  instruction: z.string(), // the edit that triggered it (or a generated label for initial_scene_skeleton)
  targetObjectId: Id,
  impacted: z.array(ImpactedObject),
  preview: ChangeSetPreview.nullable(), // null until POST /preview succeeds
  status: z.enum(['draft', 'previewing', 'applied', 'discarded', 'flagged']),
  createdAt: z.string().datetime(),
})
```

## 2a. LLM operation schemas (tool outputs — also live in `packages/contract`)

These are the structured-output types for every Drama Manager operation in the prompt spec. They live in the same `packages/contract` module, are mirrored in Pydantic, are included in the CI schema diff, and are the source from which strict tool `input_schema`s are generated (`z.toJSONSchema`). **Implementations must not define op schemas anywhere else.** Server-side annotations (e.g., `ImpactedObject.applyMode`/`locked`, `LedgerFact.provenance`/`status`, `ConsistencyFlag.id`/`status`) are deliberately absent here — the model never sets them.

```ts
// §1/§2 generate_beat_candidates, tune_beat → BeatCandidate (defined in §2 above)

// §3 classify_blast_radius
export const BlastRadius = z.object({
  impacted: z.array(
    z.object({
      objectType: z.enum(['scene', 'beat', 'character', 'ledgerFact']),
      objectId: Id,
      reason: z.string(),
      confidence: z.enum(['high', 'speculative']),
    }),
  ),
})

// §4 regenerate_elements — reuses BeatUpdate/SceneUpdate from §2, so the
// model's output IS the ChangeSetPreview payload shape (no translation layer).
export const RegeneratedElements = z.object({
  beats: z.array(BeatUpdate),
  scenes: z.array(SceneUpdate),
  continuityConflicts: z.array(
    z.object({ factId: Id, objectId: Id, explanation: z.string() }),
  ),
})

// §9.4 generate_scene_skeleton — the guided-setup convergent loop calls this
// 3x (drama_manager/scene_skeleton.py). The model emits no ids and no
// scriptText; the server assigns each scene a proposalId and stamps
// storyline "A" after validation, producing a SceneAddition (§2 above) per
// scene.
export const InitialSceneSkeleton = z.object({
  label: z.string().max(40),
  scenes: z.array(
    z.object({
      act: z.number().int().min(0),
      location: z.string(),
      time: z.string(),
      socialSituation: z.string(),
      whatHappens: z.string(),
      audienceLearns: z.string(),
      audienceFeels: z.string(),
      motivations: z.array(Motivation),
      beatPlanSeeds: z.array(
        z.object({
          whatHappens: z.string(),
          audienceLearns: z.string(),
          audienceFeels: z.string(),
        }),
      ),
    }),
  ),
})

// T7.23 extract-time counterpart to KnowledgeEvent: the model names
// characters, never ids (same convention as knownBy) — the server resolves
// each name the same way knownBy names are resolved
// (fountain.characters.normalize_known_by) before storing.
export const ExtractedKnowledgeEvent = z.object({
  sceneId: Id,
  characterNames: z.array(z.string()).default([]),
  kind: KnowledgeEventKind,
  quote: z.string().default(''),
  belief: z.string().default(''), // T10.4: see KnowledgeEvent.belief
})

// §5 extract_ledger_facts — model span has lines only; char offsets are computed server-side.
export const ExtractedFact = z.object({
  fact: z.string(),
  factType: z.enum([
    'event',
    'state',
    'knowledge',
    'relationship',
    'world_rule',
  ]),
  sourceSpan: z.object({
    episodeId: Id,
    sceneId: Id,
    beatId: Id,
    startLine: z.number().int().min(0),
    endLine: z.number().int().min(0),
  }),
  sourceText: z.string(),
  knownBy: z.array(Id),
  // T7.23: optional knowledge-transition notes for this fact beyond the
  // baseline knownBy — empty array is the common case (first cut).
  knowledgeEvents: z.array(ExtractedKnowledgeEvent).default([]),
  audienceKnows: z.boolean(),
  confidence: z.number().min(0).max(1),
})
export const LedgerExtraction = z.object({
  newFacts: z.array(ExtractedFact),
  contradictions: z.array(
    z.object({
      existingFactId: Id,
      explanation: z.string(),
      proposedReplacement: z.string().nullable(),
    }),
  ),
})

// §5a infer_story_entities — import-time character/relationship/world-element
// candidates, run between act inference and fact extraction (prompt spec
// §5a). Names are strings, not ids: the server resolves each against the
// existing bible (matching on name/aliases) and mints new ids for anything
// unresolved — the model never sets/knows ids. Every entity carries at least
// one evidence citation (scene id + short quote) for the review UI.
// A character whose name and aliases match more than one existing row is
// neither attached nor minted; it becomes an open `[merge_proposal]` scene
// flag pointing at Merge into (T9.8).
// InferredWorldElement rows land as SeriesBible.worldQA entries
// (`q: "Where/What is <name>?"`, `a: note`) — no first-class Project field
// in P0; a dedicated world-element entity is P1.
export const EntityEvidence = z.object({
  sceneId: Id,
  quote: z.string(), // verbatim-ish; server-truncated to 200 chars
})
export const InferredCharacter = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  role: z.enum(['principal', 'supporting', 'minor']),
  traits: z.string(), // one line, may be ""
  evidence: z.array(EntityEvidence).min(1),
})
export const InferredRelationship = z.object({
  betweenNames: z.tuple([z.string(), z.string()]),
  label: z.string(),
  reallyLike: z.string(), // may be ""
  evidence: z.array(EntityEvidence).min(1),
})
export const InferredWorldElement = z.object({
  kind: z.enum(['location', 'object']),
  name: z.string(),
  note: z.string(), // one line, may be ""
  evidence: z.array(EntityEvidence).min(1),
})
export const StoryEntities = z.object({
  characters: z.array(InferredCharacter),
  relationships: z.array(InferredRelationship),
  worldElements: z.array(InferredWorldElement),
})

// §5b infer_narrative_promises (T7.19) — import-time thread/motivation/
// world-rule read, run after infer_story_entities and before
// extract_ledger_facts. ownerNames/characterName are strings the server
// resolves the same way infer_story_entities does; setupSceneId/
// payoffSceneId/sceneId/evidenceSceneId are already-known scene ids, no
// resolution needed. Server mints thread ids, writes sceneMotivations onto
// matching Scene.motivations, and merges worldRules into the bible (append
// new; never overwrite a locked rule).
//
// Evidence is cited by beat, never quoted (PROMPT_VERSION 0.40.0+). The model
// names the one beat that carries each claim — a beatId from its input spine,
// belonging to the scene cited for that claim — or null when no single beat
// does. It never writes quote text. The server derives the stored quotes
// (StoryThread.setupQuote/payoffQuote, Secret.establishedQuote/revealedQuote,
// WorldRule.evidenceQuote in §1) from the cited beat's own scriptText
// (drama_manager/promises.py `quote_for_beat`): the first spoken line, else
// the first line that is not a slugline or a character cue. A beat outside
// the cited scene, or a line under three words or that is only a cue or
// transition, stores an empty quote and a null beat id. A quote cited by more
// than one thread or secret is cleared from all of them.
export const NarrativePromises = z.object({
  threads: z.array(
    z.object({
      label: z.string(),
      summary: z.string(),
      status: z.enum(['open', 'paid_off', 'abandoned']),
      ownerNames: z.array(z.string()),
      setupSceneId: Id,
      payoffSceneId: Id.nullable(),
      setupBeatId: Id.nullable(),
      payoffBeatId: Id.nullable(),
      // T10.2 — the letter of the storyline (below) this thread belongs to.
      storyline: StorylineId.nullable().default(null),
      // T10.3 — every scene the thread moves in (an appearance that changes
      // nothing is not a movement), how a paid-off thread is closed, and the
      // setup's second job. Merge (§1 StoryThread): rows whose scene is not in
      // the episode are dropped; a beatId not in that scene → null; the first
      // row per (scene, phase) is kept; rows sort by scene order then beat
      // index; closureLevel → null unless status is 'paid_off'. Defaulted so a
      // pre-0.56.0 response or checkpoint parses.
      movements: z.array(StoryThreadMovement).default([]),
      closureLevel: ThreadClosureLevel.nullable().default(null),
      secondJob: z.string().default(''),
    }),
  ),
  // T10.2 — the episode's storylines as a TV room breaks them (A main, B
  // second, C/D lesser strands or a runner), fewer when the episode has fewer.
  // characterNames resolve to Episode.storylines[].characterIds like ownerNames
  // (unresolved dropped); sceneIds come from the supplied list. Merge: first
  // entry per letter wins; unknown scene ids dropped; a scene listed under two
  // letters keeps the earliest (A before B); a storyline left with no scenes is
  // dropped. Each scene's `storyline` is its letter (unassigned stays 'A'); a
  // thread's `storyline` survives only if its letter did. Empty (or a
  // pre-0.53.0 response or checkpoint) leaves the episode untouched.
  storylines: z
    .array(
      z.object({
        letter: StorylineId,
        summary: z.string(),
        characterNames: z.array(z.string()),
        sceneIds: z.array(Id),
      }),
    )
    .default([]),
  // Concealment arcs. Names, not ids (server resolves); scene ids chosen from
  // the supplied list. `revealedSceneId: null` = still concealed. The server
  // mints ids and links `factId` where it can.
  secrets: z.array(
    z.object({
      summary: z.string(),
      holderNames: z.array(z.string()),
      concealedFromNames: z.array(z.string()),
      audienceKnows: z.boolean(),
      establishedSceneId: Id,
      revealedSceneId: Id.nullable(),
      concealmentSceneIds: z.array(Id),
      establishedBeatId: Id.nullable(),
      revealedBeatId: Id.nullable(),
    }),
  ),
  sceneMotivations: z.array(
    z.object({
      sceneId: Id,
      motivations: z.array(
        z.object({
          characterName: z.string(),
          objective: z.string(),
          stakes: z.string(),
          obstacle: z.string(),
          statedObjective: z.string(),
          concealed: z.boolean(),
        }),
      ),
    }),
  ),
  worldRules: z.array(
    z.object({
      text: z.string(),
      limit: z.string(),
      cost: z.string(),
      exception: z.string(),
      evidenceSceneId: Id.nullable(),
      evidenceBeatId: Id.nullable(),
    }),
  ),
})

// §6 suggest_instructions
export const InstructionSuggestions = z.object({
  suggestions: z.array(z.string()).length(3),
})

// §7 import act inference
const InferredActStart = z.object({
  act: z.number().int().min(0),
  startSceneIndex: z.number().int().min(0),
})
export const InferredActBreaks = z.object({
  starts: z.array(InferredActStart).min(1),
  // The format read from the script, for an import given none; null when
  // the import has a format. Always present in the tool call (strict).
  format: ShowFormat.nullable().default(null),
})
// Bounds that depend on the selected format and parsed scene count are server
// validated, not encoded in this static operation schema. Starts must begin at
// scene 0 and strictly increase by both act and scene index. Valid acts are
// 0...actCount when coldOpen is true, otherwise 0...(actCount - 1), plus the
// tag when format.tag: the act after the last act (actCount + 1 with a cold
// open, actCount without; T10.7). Omitted acts are empty sections; the server
// expands accepted starts into exactly one act assignment for every parsed
// scene.

// §7 parse_script stage 2
const SegmentedSceneBeat = z.object({
  kind: z.literal('beat'),
  startLine: z.number().int().min(1),
  whatHappens: z.string(),
  audienceLearns: z.string(),
  audienceFeels: z.string(),
  // T10.1 (0.54.0) — the beat from the character's side. `actor` / `target`
  // are names as the script gives them, '' when none; the server resolves them
  // to Beat.actorCharacterId / targetCharacterId. Defaulted so a pre-0.54.0
  // response still parses.
  actor: z.string().default(''),
  actionVerb: z.string().default(''),
  target: z.string().default(''),
  reaction: z.string().default(''),
})
const SegmentedSceneUnassigned = z.object({
  kind: z.literal('unassigned'),
  startLine: z.number().int().min(1),
  reason: z.string(),
})
export const SegmentedScene = z.object({
  segments: z.array(z.union([SegmentedSceneBeat, SegmentedSceneUnassigned])),
  // Scene-level reading (0.41.0), from the same call that finds the beats;
  // stored on the Scene under the unprefixed names. Defaulted so an older
  // response still parses.
  sceneWhatHappens: z.string().default(''),
  sceneAudienceLearns: z.string().default(''),
  sceneAudienceFeels: z.string().default(''),
  sceneSocialSituation: z.string().default(''),
  // T10.1 (0.54.0) — the scene's turn → Scene.valueAtStake / chargeIn /
  // chargeOut / whyNow.
  sceneValueAtStake: z.string().default(''),
  sceneChargeIn: Charge.nullable().default(null),
  sceneChargeOut: Charge.nullable().default(null),
  sceneWhyNow: z.string().default(''),
})

// §8c scan_consistency
export const ConsistencyScan = z.object({
  flags: z.array(
    z.object({
      objectType: z.enum(['scene', 'beat']),
      objectId: Id,
      factId: Id.nullable(),
      explanation: z.string(),
      severity: z.enum(['contradiction', 'tension']),
    }),
  ),
})

// Structure checklist: check_structure (import_analyst, effort medium). Judges
// each stage of one structure against the import's breakdown. The model never
// writes quotes, sceneId or the T10.5 position fields (it is not told the
// windows) and never says `unverified`. The server checks every
// stage of the lens appears exactly once, belongs to the lens, and that hit/thin
// cite an existing beatId (a beat cited on a missing stage is dropped); one
// retry, then SCHEMA_INVALID_LLM.
export const InferredStructureCheck = z.object({
  applies: z.boolean(),
  rationale: z.string(),
  stages: z.array(
    z.object({
      stage: StructureStageName,
      status: z.enum(['hit', 'thin', 'missing']),
      beatId: Id.nullable(),
      reason: z.string(),
    }),
  ),
})

// verify_structure_check (writer, effort low). One verdict per hit/thin claim,
// judged only against the cited beat's excerpt. `supported` is declared last so
// the model reasons before it answers. Unsupported or unanswered stages become
// `unverified`; they are never dropped.
export const StructureCheckVerification = z.object({
  stages: z.array(
    z.object({
      stage: StructureStageName,
      reason: z.string(),
      supported: z.boolean(),
    }),
  ),
})
```

## 3. Storage (SQLite via SQLAlchemy, MVP)

| Table                | Notes                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`           | `id`, `doc` (JSON, the canonical `Project`), `head_snapshot_id`, timestamps                                                                                                                                         |
| `snapshots`          | `id`, `project_id`, `parent_id`, `instruction`, **`doc` (full materialized project JSON)**, **`ledger` (full materialized `LedgerFact[]`)**, **`flags` (full materialized `ConsistencyFlag[]`)**, `ts`. Append-only |
| `ledger_facts`       | one row per fact, columns matching `LedgerFact`                                                                                                                                                                     |
| `change_sets`        | `id`, `project_id`, `doc` (JSON `ChangeSet`), `status`                                                                                                                                                              |
| `suggestion_history` | `id`, `project_id`, `text`, `embedding` (blob, MVP: cosine in Python)                                                                                                                                               |
| `consistency_flags`  | one row per flag, columns matching `ConsistencyFlag`                                                                                                                                                                |

**Snapshot semantics (MVP: materialized, not deltas).** Undo must restore a _consistent world_, not just the script — a beat's ledger facts and consistency flags cannot outlive the beat. Each snapshot therefore stores **all project-scoped versioned state**: the complete project JSON, the complete ledger fact list, and all consistency flags as of that point. A single-episode doc plus ledger is still tens of KB, so simplicity wins over storage; forward+inverse patch compression is a v2 optimization behind the same interface.

Versioned together (in the snapshot): `doc`, `ledger_facts`, `consistency_flags`. **Deliberately not versioned:** `suggestion_history`/embeddings (dedup memory — harmless across undo) and `change_sets` (drafts reference `basedOnSnapshotId`; after undo, a stale draft's apply is already rejected by `PREVIEW_STALE`, and the UI labels it "based on an earlier version").

Defined transactions:

- **Mutation:** in one transaction — write new snapshot row (`parent_id` = current head; `doc`, `ledger`, `flags` = new state), set `projects.doc` + rewrite `ledger_facts` + `consistency_flags` tables to the new state, set `head_snapshot_id` = new snapshot id.
- **Undo:** in one transaction — read parent snapshot of current head, restore `projects.doc`, `ledger_facts`, and `consistency_flags` byte-identical from it, set `head_snapshot_id` = parent id. No new snapshot row; a subsequent mutation forks the tree (its `parent_id` is the restored snapshot).
- **Restore to ancestor** (adoption A5): same transaction as undo, but the target may be any _proper_ ancestor of the current head (walk `parent_id` toward root). Non-ancestor / current head / missing → 409 `VALIDATION`. No new snapshot row; later mutations fork from the restored head. Snapshot `instruction` must be non-empty on every write (`EmptyInstruction` if blank/whitespace).
- Undo at root → 409 `VALIDATION` ("nothing to undo").

## 4. API contract (FastAPI, `/api/v1`)

**Projects**

- `GET /projects` -> `ProjectSummary[]` sorted by `updatedAt` descending. `pendingReviewCount` counts Ledger facts with `status: "pending_review"`. `setupState` is `"ready"` iff the project has at least one scene containing at least one beat; otherwise `"incomplete"`. Summaries must not include full writer text fields such as `premise` or `seasons`.
- `POST /projects` `ProjectCreateRequest` with required `Idempotency-Key` header → `Project` — in one transaction: creates the project (minimal bible scaffolded, plus optional writer-supplied foundation) **and its root snapshot** (`parent_id: null`, `doc` = initial state, `ledger` = `[]`, `flags` = `[]`), setting `headSnapshotId` to it. `headSnapshotId` is therefore never null after creation — previews, undo, and forks always have an anchor. Character seeds contain no IDs; the server assigns `char-*`, sets `locked: false`, maps supplied `traits` or `""` (also into `summary` when traits are supplied), initializes `aliases` to `[]`, and initializes `embodiment`, `presentation`, `hiding`, `seriesArc`, and `bio` to `""` (empty `summary` when no seed traits). Project creation performs no LLM call. Same idempotency key + same canonical request hash replays the 201 response; same key + different hash returns 409 `IDEMPOTENCY_CONFLICT`; failed transactions persist no key.
- `GET /projects/{pid}` → `Project`
- `PATCH /projects/{pid}` — JSON-patch body for direct writer edits (no regeneration); creates snapshot. Patches touching **structural plan fields** (scene/episode `whatHappens`, `premise`, storyline summaries) additionally trigger `scan_consistency` and return `{project, consistencyFlags}` — the "Save field only" path skips Review, never the flagging promise. Changing a scene's `act` is a non-text structural correction: it creates one normal snapshot but runs no LLM/extraction/consistency call. Patches into locked ranges, including a stale attempt to change a locked scene's act or `index` (a reorder that would shift a locked scene, or any scene of a locked episode), → 409 `LOCKED_OBJECT`.
- `POST /projects/{pid}/undo` → `Project` (moves head to parent snapshot)
- `GET /projects/{pid}/snapshots` → `SnapshotSummary[]` (adoption A5) — up to 20 proper ancestors of the current head, nearest parent first. Each entry is `{id, instruction, ts}` for the undo-timeline dropdown. Does not include the current head.
- `POST /projects/{pid}/restore` `{snapshotId}` → `Project` (adoption A5) — restore doc+ledger+flags from that ancestor; same CAS/`If-Match` rules as undo. Non-ancestor or current head → 409 `VALIDATION`.
- `POST /projects/{pid}/import` `{format: "fountain"|"text", content}` → `{project, newFacts, consistencyFlags}` — full import transaction:
  1. Deterministic scene split + LLM typed segment-start proposal (prompt spec §7); the server derives a total line partition, optionally retries that scene once under the repair-quality gate, and persists a review flag for every repair in the selected attempt. Semantic start errors never drop/duplicate text or abort coverage.
  2. **An import with no `format`** (the import wizard sends none) works it out here, then follows the rest of this step with it: the server first reads the structure the script prints with no format given, from the whole script including the front matter stripped before scene split (`fountain/acts.printed_structure`: the highest printed act, where `END OF ACT n` names act n, with a cold open when `TEASER`/`COLD OPEN` is printed or a scene precedes the first `ACT ONE`, and a tag when `TAG` is printed), then always runs `infer_act_breaks`, whose `format` (genre, runtime, act count, cold open, tag, serialization) is required on this path. A printed structure overrides the model's `actCount`, `coldOpen` and `tag`, even when its markers state no full partition; it supplies the acts when they do, and otherwise the model's starts are expanded against the overridden format. With no act marker printed, the model's format and starts are used. A null `format` gets the op's one retry, then `SCHEMA_INVALID_LLM`; the format is saved with the act checkpoint and becomes the project's `format`. With a `format` given, the model returns `format: null` and the step is unchanged:
     When the act markers the script prints (`TEASER`/`COLD OPEN`, `ACT ONE`…, `END OF ACT …`, `TAG`, where `END OF ACT n` marks the start of act n+1) state every act of the selected format exactly once, in order, as a valid partition, the server takes the acts from them and makes no model call; under a cold-open format, unmarked scenes before `ACT ONE` are the cold open, and a script that opens on `ACT ONE` has an empty cold open. A printed `TAG` opens the tag, the act after the last act (`actCount + 1` with a cold open, `actCount` without) (T10.7), under a format with `tag`; an act printed past the last act is a disagreement, never the tag; unprinted, the tag stays empty, and printed under a format without one, the markers disagree with it. Only when markers are absent, partial, conflicting, or disagree with `format.actCount`/`coldOpen`/`tag` does the import run `infer_act_breaks` over compact scene summaries in source order; the model returns ordered `{act, startSceneIndex}` starts (a start for the act after the last act (`actCount + 1` with a cold open, `actCount` without) is the tag, valid only when `format.tag`; otherwise it fails the bounds check like any out-of-range act) and the server validates format/scene bounds and derives a total partition with exactly one act per scene. Omitted valid acts remain empty. A semantic failure gets exactly one classifier retry with inert diagnostics; a second failure surfaces `SCHEMA_INVALID_LLM`, and the import persists nothing.
  3. Run `extract_ledger_facts` over every imported scene; **each import-derived fact gets the status a fact found while writing gets** (`drama_manager/ledger_policy.py`): `active` when `confidence >= 0.8` and its quote is found on the page (or it has no quote to verify), otherwise `pending_review`. Owner decision 2026-10-11, replacing "all import-derived facts are created `pending_review`": nobody reviews hundreds of imported facts, and only `active` facts are ever prompt-eligible, so holding them all left an import's ledger inert. Auto-accepted facts keep `provenance: inferred`; a later import into the same project is refused while any non-`pending_review` fact exists (`locks.assert_import_target_writable`, unchanged).
  4. Run `scan_consistency` across the imported episode (initial sweep — imports can carry internal contradictions).
  5. One snapshot committing doc + ledger + flags together; partial failure rolls back all of it. The one exception is a single scene unit that still fails after its rule-9 retry, which degrades instead of failing the import (§9.3 below, T9.11).
- `POST /projects/import/extract-pdf` multipart `file` (`application/pdf`) → `PdfExtractResult` — pre-project PDF extraction only. It creates no project, snapshot, ledger row, or idempotency record, and never calls the LLM. Text-layer extraction uses `pypdf`; OCR uses pypdfium2-rendered pages plus Tesseract. On success, the client treats the editable result as `source.format: "text"` for the existing create-and-import path. Response wire shape is `{text, method, pageCount, warnings}` where `method` is `"text_layer"` or `"ocr"`. Reject missing/non-PDF, oversize/page-cap, unreadable, or empty extraction with `{error: {code: "VALIDATION", message}}`; if Tesseract is unavailable when OCR is required, return `{error: {code: "UNAVAILABLE", message}}`.
- `POST /projects/{pid}/narrative-map` (with `If-Match`) starts or resumes one idempotent, source-versioned Narrative Map run and returns `NarrativeMapRun`; `GET /projects/{pid}/narrative-map/runs/latest` and `GET .../runs/{runId}` read it back. The run carries status/phase/progress, `retryAllowed`, token and cost fields, and two writer-facing diagnostic lists — both defaulted `[]`, both about the writer's own script and never logged: `rejectionDiagnostics[{code, path, reason}]` says why the evidence gate refused a **rejected** run, and `removedClaims[{action, path, subject, reason}]` says what the gate pruned from a **completed** map before publishing it (`subject` in the writer's terms — "C.J.'s arc summary" — `reason` in the verifier's). Advisories appear in neither: nothing was done to the map on their account. Checkpoints stay server-internal. `retryAllowed` is true on a **completed** run when its map lists `unanalyzedSceneIds` (or the run predates the current analysis version); the same `POST` then re-reads only those scenes, reusing every analysed scene packet, and rebuilds and re-verifies the story-wide map, which costs new model calls. A run in which no scene could be analysed is rejected (`no_scene_analyzed`) before any synthesis call. A **failed** run's `errorCode` says whether the same `POST` resumes it from its checkpoints: `LLM_TIMEOUT` (our deadline, the SDK's timeout, or a 504) and `WORKER_INTERRUPTED` resume only after a 10-minute grace, since the provider may still be working; `LLM_UNAVAILABLE` (429, 529, other 5xx, a non-timeout connection error) resumes at once; `SCHEMA_INVALID_LLM` resumes only when the synthesis call failed, reusing every saved scene packet and re-running synthesis with the same prompt, then verification; `LLM_REQUEST_REFUSED` (any other 4xx, e.g. an exhausted credit balance) and `INTERNAL_ERROR` (a server bug) are terminal for that analysis version. A **rejected** `EVIDENCE_REJECTED` run stays blocked unless one of the saved-analysis repairs applies.
- `POST /projects/{pid}/structure-checks/{lens}` `{}` (with `If-Match`) → `Project` — runs one structure check (`check_structure`, then `verify_structure_check` over the hit/thin stages) and saves it in `episode.structureChecks` with one snapshot, replacing that lens's entry. `lens` is a `StructureLens`; anything else, `tv_act_structure` included, is 400 `VALIDATION`. An episode with no beats is 409 `STRUCTURE_CHECK_NOT_READY`; a stale `If-Match` is 409 `CONFLICT_STALE_HEAD`; a failed op after its retry is 502 `SCHEMA_INVALID_LLM` and saves nothing; provider errors and timeouts are 503 `LLM_UNAVAILABLE`. Allowed on a locked episode: it changes nothing outside `episode.structureChecks`. Saved checks are read from the project doc; there is no GET.
- `POST /projects/import` `ProjectImportCreateRequest` with required `Idempotency-Key` header → **SSE** (§9.3 atomic create-and-import — the import-wizard analogue of `POST /projects` above): reuses the same parse/import pipeline as `POST /projects/{pid}/import`, but creates the project **and** its imported state in one DB transaction — every core LLM/parsing stage runs before that single write, never an empty root followed by an import child. A scene unit — one scene's `segment_scene` or `extract_ledger_facts` call — whose output still fails schema validation after its rule-9 retry does not fail the import (T9.11): a failed segmentation keeps the scene's verbatim text as a single beat with every description field empty (the server writes nothing for it), a failed extraction yields zero facts for that scene, and each files one open `tension` `ConsistencyFlag` on that scene (`objectType: "scene"`, explanation code `[segmentation_failed]` or `[extraction_failed]`). Such a unit is not saved as a checkpoint, so a resumed attempt asks the model again and reruns every later stage rather than reusing results saved without that unit. Act inference and every whole-script stage (`inferring_entities`, `inferring_promises`, `inferring_overview`, `checking_consistency`) stay required: their failure, and any provider error (timeout, unavailable), still ends the stream `failed` and persists nothing. Events: `stage {type: "stage", name}` announces each named stage in order (`parsing_scenes`, `segmenting_beats`, `inferring_acts`, `inferring_entities`, `inferring_promises`, `inferring_overview`, `extracting_facts`, `checking_consistency`, `saving`); `progress {type: "progress", stage, done, total}` may appear after a stage starts to report monotonic item progress within that stage, with `0 <= done <= total`. Scene progress is emitted for `segmenting_beats` and `extracting_facts`; singleton analysis stages emit no per-scene progress. The stream then emits exactly one terminal `complete {type: "complete", result: ProjectImportResult}` or `failed {type: "failed", error}`. `ProjectImportResult` is `{project, newFacts, consistencyFlags}` — the same shape `POST /projects/{pid}/import` returns. `POST /projects/{pid}/narrative-map` is an explicit post-import run (`import_analyst` scene and synthesis passes, independent `writer`-role verification) over the saved import analysis that writes a second snapshot; a timeout there never invalidates or re-runs the source import. Idempotency mirrors `POST /projects`: a hash conflict is rejected with a plain 409 `IDEMPOTENCY_CONFLICT` JSON response _before_ the stream opens (never a mid-stream surprise); a same-key/same-hash replay opens a stream whose only frame is the terminal `complete` with the original result; a failed transaction leaves no key, so a retry with the same key runs normally. That retry reuses a failed attempt's saved per-scene results only when the scene's text still matches and `PROMPT_VERSION` and `config/models.toml` are unchanged; an unfinished attempt expires 7 days after its last activity and is deleted, saved results included, when the next import starts (T9.5).
  - **`found {type: "found", stage, cached, data: ProjectImportFound}`** carries per-unit results for the live import board. **Additive; clients ignore unknown event types.** Payloads are built from data already in memory (no LLM calls, no DB writes), are post-merge where a merge exists, and never contain `scriptText`; the server logs each frame as stage, kind and counts only. Indexes are 0-based positions in the server's scene split (`scene-{index+1}` is the eventual id). Units reused from a resumed attempt's checkpoints are re-emitted with `cached: true` (default `false`). One kind per `data`:
    - `scenes` (`parsing_scenes`) — once, after the split: `{index, slugline, lineCount, intExt}` per scene.
    - `scene` (`segmenting_beats`) — once per segmented scene, in completion order: `beatCount`, `whatHappens` (the segmenter's scene reading), `failed: true` when the unit degraded (T9.11), and `beats` (T9.17, additive, default `[]`): each final beat's `whatHappens`, `audienceLearns` and `audienceFeels`, in scene order, post-merge, for the board's reading view. A beat's position in the array is its order; there are no beat ids yet. `beats` carries **only those three reading fields — never `scriptText` or any other script source text**; a failed unit sends `beats: []` (its one beat holds only the scene's verbatim text). A cached re-emit carries the same beats.
    - `acts` (`inferring_acts`) — once, after the acts merge: the resolved `format` and each scene's act number in `sceneActs`.
    - `castRead` (`inferring_entities`) — once per finished entity chunk: the scene indexes it covered.
    - `cast` (`inferring_entities`) — once, after the entities merge: `total` characters and the top 12 by `sceneCount` (scenes where the character speaks, using the whole-script shooting-script decision).
    - `threads` (`inferring_promises`) — once: each thread's `label`, `status`, and setup/payoff scene indexes (`null` when absent).
    - `overview` (`inferring_overview`) — once: the `logline` and beat sheet items with their scene index (`null` when unanchored).
    - `facts` (`extracting_facts`) — once per extracted scene, in completion order: `factCount`, `secretCount` (facts hidden from the audience), and `failed: true` when the unit degraded (T9.11).
    - `flags` (`checking_consistency`) — once: counts of `contradictions`, `tensions` and `other` flags.
- `GET /projects/{pid}/export.fountain` → `text/plain`
- `GET /projects/{pid}/export.breakdown.csv` → `text/csv` (T10.10) — the scene breakdown: a header row, then one row per scene of the first episode in board order (act, then index). `Content-Disposition: attachment; filename="{title}-breakdown.csv"`, title characters outside `A–Z a–z 0–9 _ . -` replaced by `_` (empty → `script`). UTF-8 with a BOM (so Excel reads it as UTF-8), stdlib `csv` quoting, CRLF rows. Read-only: no snapshot, no LLM call. Unknown project → 404 `NOT_FOUND`; no episode → the header row only. An absent value is an empty cell. Columns, in order:
  `Scene` (1-based position in board order) · `Act` (the board's act label: `COLD OPEN`, `ACT ONE`…, `TAG`) · `Storyline` (the letter) · `Location` · `Time` · `What happens` · `Value at stake` · `Charge in` · `Charge out` · `Turns` (`yes` when both charges are set and differ, `no` when equal, empty otherwise) · `Why now` · `Story order` (the outline row's `storyOrder` + 1) · `Story time` · `Anachrony` (`flashback` / `flashforward`; `none` is empty) · `Beats` (count) · `Kernel beats` / `Choices` (beats whose `kernel` / `pressureChoice` is true; empty when no beat in the scene was read for it) · `Wants` (`Name: objective` per motivation with an objective) · `Threads set up` / `Threads paid off` (labels of threads whose `setupSceneId` / `payoffSceneId` is the scene) · `Threads moving` (`label (phase, …)` for threads with movements in the scene that neither set up nor pay off there) · `Secrets` (`summary (set|out|kept)`: established, revealed, or a concealment scene, first match) · `Facts established` (ledger facts whose `sourceSpan.sceneId` is the scene, `active` or `pending_review`) · `Characters` (bible characters with a dialogue cue in the scene, by name, first name or alias, or a motivation there; bible order). Lists are joined with `; `.
- `GET /projects/{pid}/export.json` → `PersistedState` (adoption A6) — the full fixture-shaped envelope (`project`, `ledger`, `snapshots`, `consistencyFlags`, `changeSets`, `suggestionHistory`). Privacy §7.1 "export-everything"; Settings UI offers the download. Round-trip: export → purge → re-seed from export restores project doc and ledger byte-identical.
- `DELETE /projects/{pid}` — purges every project-scoped row across **all six DB tables plus embeddings**: `projects`, `snapshots`, `ledger_facts`, `change_sets` (including stored previews — they contain generated script text and instructions), `consistency_flags`, `suggestion_history`, and the embedding blobs stored with suggestion history (privacy §7.1). One transaction; the purge test asserts zero remaining rows per table. ("All six DB tables plus embeddings" is the canonical phrasing — build plan and test plan use it verbatim.) The same transaction deletes the import run that created the project and every import run of the same script that has failed or has been idle for more than 10 minutes, since saved import units hold verbatim script text; a run that may still be in progress is left to the 7-day expiry (T9.5).

**Generation (Write mode)**

- `POST /projects/{pid}/scenes/{sid}/candidates` `{afterBeatId?, instruction?, craftLevel?}` → **SSE stream**: events `candidate_start {index}`, `delta {text}` (provisional display only), `candidate_done {BeatCandidate}` (validated — card becomes actionable) or `candidate_failed {error}`, then `done`. `craftLevel` (adoption A3): `fast` → 1 candidate; `standard` (default, or project `defaultCraftLevel`) → 3; `considered` → 3 sync diversity samples + 1 streamed polish (no new LLM op). Clients must not enable Accept/Tune before `candidate_done`.
- `POST /projects/{pid}/scenes/{sid}/candidates/tune` `{candidate: BeatCandidate, instruction}` → SSE, one candidate
- `POST /projects/{pid}/scenes/{sid}/beats` `{candidate: BeatCandidate, afterBeatId?}` — accept: inserts beat, snapshots, triggers ledger extraction + consistency scan → `{project, newFacts, contradictions, consistencyFlags}`. `newFacts` are policy-processed `LedgerFact`s (§5 policy applied server-side); each `contradictions[]` entry additionally carries `proposalId` — the id of the supersede-proposal fact the server created.

**Guided Plan setup (new-project-flow design spec §6/§9.4)**

- `POST /projects/{pid}/scene-skeleton/candidates` → `InitialSceneSkeletonCandidate[]` (exactly 3) — the explicit "Generate scene skeleton" gesture; runs the three-candidate convergent loop (`generate_scene_skeleton`, §9.4). Read-only: nothing is persisted.
- `POST /projects/{pid}/scene-skeleton/change-sets` `InitialSceneSkeletonCandidate` (the exact candidate the writer compared, echoed back verbatim) → `ChangeSet` with `kind: "initial_scene_skeleton"`, already `status: "previewing"` — selecting a candidate creates the Change Set and sends the writer to Review; it never writes the plan directly. `impacted[].objectId` is each scene's `proposalId`, `applyMode: "add"`. 409 `PREVIEW_STALE` if `basedOnSnapshotId` no longer matches the project head; 409 `VALIDATION` if a motivation references an unknown `characterId`.
- Apply/discard/flag reuse the existing `POST /change-sets/{cid}/apply|discard|flag` below. For this Change Set kind, `approvedObjectIds` are proposal ids; apply mints the final `scene-*`/`beat-*` ids for the approved subset (in the candidate's original order), inserts them into the project's single episode (scaffolding `season-1`/`ep-1` if the project has none yet), and writes exactly one snapshot — no `regenerate_elements`/extraction/scan calls (there is no existing content to regenerate and no script text yet to extract facts from). Routes through the same lock guard as every other apply path: a locked episode → 409 `LOCKED_OBJECT`, zero mutation. `POST /change-sets/{cid}/preview` 409s `VALIDATION` for this kind (the selected candidate already _is_ the preview).

**Review mode**

- `POST /projects/{pid}/change-sets` `{targetObjectId, instruction}` → `ChangeSet` (runs classify_blast_radius; annotates locks server-side)
- `GET /projects/{pid}/change-sets?status=` → `ChangeSet[]` — list persisted Change Sets for the project (optional status filter; comma-separated values allowed, e.g. `draft,previewing` for the Review open picker). sessionStorage is cache only.
- `GET /change-sets/{cid}` → `ChangeSet` — fetch one persisted Change Set by id.
- `POST /change-sets/{cid}/preview` `{approvedObjectIds: [], craftLevel?}` → `ChangeSet` — runs `regenerate_elements`, stores the result as the typed `preview` payload (`beatUpdates`/`sceneUpdates` with `basedOnSnapshotId` = current head), and renders `after` display snippets from it; does NOT mutate the project. `craftLevel: "considered"` runs a second polish regenerate (adoption A3); `fast`/`standard` are a single pass.
- `POST /change-sets/{cid}/apply` `{approvedObjectIds: []}` → `{project, changeSet, consistencyFlags}` — **applies the stored `preview` payload verbatim** (never reruns the model, never parses snippets), filtered to approved ids; snapshots, re-extracts ledger, runs `scan_consistency` over untouched scenes. 409s: any locked or `flag_only` id in the list; `preview` is null; `preview.basedOnSnapshotId` ≠ current head (`PREVIEW_STALE` — re-preview required); any approved regenerate id that is **not** present in the stored preview's `beatUpdates`/`sceneUpdates` (`VALIDATION` — apply ids must be a subset of the previewed set)
- `POST /change-sets/{cid}/discard` / `POST /change-sets/{cid}/flag`
- `GET /projects/{pid}/consistency-flags?status=open` → `ConsistencyFlag[]` · `POST /consistency-flags/{fid}/dismiss`

**Ledger mode**

- `GET /projects/{pid}/ledger?status=&characterId=&asOfScene=` → `LedgerFact[]` — `asOfScene` (T7.18) filters to facts in force as of that scene (established at or before it in the project's scene order, and not superseded by a fact established at or before it — `drama_manager/ledger_as_of.facts_as_of`), applied _before_ `status`/`characterId`. Unknown scene id → 400 `VALIDATION`. Omit → no temporal filter (today's behavior). When `asOfScene` is set, each returned fact's `knownByAsOf` (T7.23) is filled with `drama_manager/ledger_as_of.knowers_as_of`'s result — baseline `knownBy` plus every `knowledgeEvents` entry with `sceneId` at or before `asOfScene`, in scene order (`learns` unions, `forgets` removes). `knownByAsOf` is `null` on every other response (no `asOfScene`, or any other endpoint); it is a response-only enrichment, never stored, never writer-editable.
- `POST /ledger/{factId}/confirm` | `/reject` | `PATCH /ledger/{factId}` (edit text and/or knownBy → provenance becomes `writer_authored`; if the fact was `pending_review`, status also becomes `active` so it leaves the review queue)
- `POST /projects/{pid}/ledger/batch` `{confirmIds: [], rejectIds: []}` → `{ledger}` — batch review (import queue); supersede-proposal semantics apply per id; **one snapshot for the whole batch**; any invalid id fails the entire batch (400, nothing applied)

**Ledger mutations are versioned mutations.** Confirm, reject, edit, and batch all run the standard snapshot transaction (§3 — ledger is snapshot-versioned state), so every ledger action is undoable via `POST /undo` like any other change.

**Cast management (T7.16)**

- `PATCH /projects/{pid}/characters/{cid}` `{name?, aliases?}` → `Character` — rename and/or replace aliases; one snapshot (`instruction: "Rename character"`). At least one of `name`/`aliases` is required, else 400 `VALIDATION`. A locked character → 409 `LOCKED_OBJECT` before any mutation.
- `POST /projects/{pid}/characters/{cid}/merge-into/{targetId}` → `{project, ledger}` — atomic, one snapshot: the target absorbs the source's `aliases` plus the source's own `name` as a new alias; every characterId reference is rewritten from source to target — ledger fact `knownBy`, relationship `between`, scene `motivations[].characterId`, season `characterArcs[].characterId`, episode storyline `characterIds`, and episode `characterArcs[].characterId` (T10.6; when both characters had an episode arc, the first in the list is kept) — deduping the set-shaped fields so the rewrite never produces a duplicate id; a relationship the merge collapses into a self-pair (source and target were directly related) is dropped; the source character is removed. Merging a character into itself → 400 `VALIDATION`. Either side locked, or either id unknown, is rejected before any mutation (409 `LOCKED_OBJECT` / 404 `NOT_FOUND`).
- `DELETE /projects/{pid}/characters/{cid}` → 204 — deletes a character with zero remaining references. Any ledger-fact `knownBy` or relationship `between` reference remaining → 409 `VALIDATION` with `details: {facts, relationships}` counts, nothing mutated. A locked character → 409 `LOCKED_OBJECT`.

**Supersede resolution semantics (atomic — one transaction each):**

- `confirm` on a `pending_review` fact with `supersedes: null` → fact becomes `active` / `writer_confirmed`.
- `confirm` on a `pending_review` fact with `supersedes: fact-X` and non-empty `fact` text → in the same transaction: proposal becomes `active` / `writer_confirmed`, **and fact-X becomes `status: superseded` with `supersededBy` set to the proposal's id**. Never one without the other.
- **Retirement confirm (null `proposedReplacement`):** detection is **stored-null** — at mint time a null `proposedReplacement` is stored as empty proposal `fact` (`""`). `confirm` on such a proposal → in the same transaction: fact-X becomes `superseded` with `supersededBy` = proposal id; the proposal becomes `rejected` / `writer_confirmed` (not activated as a replacement); the `supersedes` link is preserved. Carry-forward-as-active of the target text is retired.
- `reject` on a supersede proposal (including retirement proposals) → proposal becomes `rejected`, and fact-X's state is untouched (it never left `active`); the proposal's `supersedes` link is preserved for audit.
- `confirm`/`reject` on a fact that is not `pending_review` → 409 `VALIDATION`.
- If fact-X was itself superseded or deleted between proposal and confirm → 409 `CONFLICT_STALE_PROPOSAL`; the writer re-reviews.
- Proposal minting only targets **active** facts; contradictions against non-active ids are dropped at creation time.

**Misc**

- `POST /projects/{pid}/suggest` `{context: "scene"|"beat", targetId, surface: "command_bar"|"scene_premise"|"tune", draftScript?}` → `{suggestions: string[3]}` (adoption A4) — contextual instruction chips; click inserts only, never auto-executes. Context bundle includes scene plan + latest accepted beat script (+ optional unsaved `draftScript`). Dedup against `suggestion_history`.

**Error shape (all endpoints):** `{error: {code, message, details?}}`. Codes: `LOCKED_OBJECT`, `SCHEMA_INVALID_LLM` (after retry), `NOT_FOUND`, `VALIDATION`, `LLM_UNAVAILABLE`, `UNAVAILABLE`, `PREVIEW_STALE`, `CONFLICT_STALE_PROPOSAL`, `CONFLICT_STALE_HEAD`, `IDEMPOTENCY_CONFLICT`, `STRUCTURE_CHECK_NOT_READY` (409: the episode has no beats to check).

**Optimistic concurrency:** every project-mutating write (PATCH, accept, ledger confirm/reject/edit/batch, flag dismiss, import, undo, restore, Change Set apply) goes through an atomic compare-and-swap on `projects.head_snapshot_id` (`UPDATE … WHERE head_snapshot_id = :expected`). Clients SHOULD send `If-Match: <headSnapshotId>` on those mutations; when present and stale, the server returns 409 `CONFLICT_STALE_HEAD` and persists nothing. When omitted, the server still CAS-guards against the head observed at read time so two concurrent writers that both loaded H cannot both commit children of H. Change Set apply additionally rejects when `preview.basedOnSnapshotId` ≠ current head (`PREVIEW_STALE` — re-preview required) before the CAS.

## 5. Pydantic mirror rules

- One module `schemas.py`, models named identically (`Beat`, `Scene`, `LedgerFact`, …).
- `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)`.
- Enums as Python `StrEnum` with identical values.
- CI: `scripts/check_contract.py` exports JSON Schema from both sides and diffs — **covering §1, §2, and the §2a LLM operation schemas**. It also regenerates the strict tool `input_schema`s from §2a and diffs them against the committed `config/tool_schemas/` directory, so a Zod change that would alter a tool schema is a visible, reviewable diff (and triggers the `make evals` requirement, same as a prompt edit).
