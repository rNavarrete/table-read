// Table Read data contract — Zod schemas (source of truth).
//
// Mirrors docs/tableread-data-contract.md §1 (core types), §2 (generation /
// review types), and §2a (LLM operation schemas). Pydantic mirrors live in
// apps/api/schemas.py; `scripts/check_contract.py` diffs the two on every PR
// (CLAUDE.md hard rule 3). Section numbers below match the doc so a diff
// against the doc is easy to eyeball.
//
// A final "Storage (§3) — persisted-state envelope" section adds Snapshot /
// SuggestionHistoryEntry / PersistedState. These are NOT part of the §1/§2/§2a
// diff surface (data contract §5 scopes the CI schema diff to §1, §2, §2a
// only) — they exist purely so the fixture's full envelope
// (project/ledger/snapshots/consistencyFlags/changeSets/suggestionHistory)
// can be validated end-to-end. Their shape is inferred directly from the §3
// storage table description (column names) plus the fixture's own shape,
// which agree exactly — see the task report for details.

import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────
// §1. Core types
// ─────────────────────────────────────────────────────────────────────────

export const Id = z.string().min(1) // "scene-1", "beat-1-2", "fact-04", "char-marta"
export type Id = z.infer<typeof Id>

export const ShowFormat = z.object({
  genre: z.enum(['drama', 'comedy', 'dramedy']),
  runtimeMinutes: z.number().int().positive(),
  actCount: z.number().int().min(1).max(6),
  coldOpen: z.boolean(),
  tag: z.boolean(),
  serialization: z.number().min(0).max(1),
})
export type ShowFormat = z.infer<typeof ShowFormat>

export const Character = z.object({
  id: Id,
  name: z.string(),
  locked: z.boolean().default(false),
  // Alternate names/nicknames the script uses for this character (T-continuity
  // §1: infer_story_entities resolves these against existing characters
  // before minting a new one). Defaults to [] so pre-existing docs validate.
  aliases: z.array(z.string()).default([]),
  embodiment: z.string(),
  presentation: z.string(),
  hiding: z.string(),
  traits: z.string(),
  seriesArc: z.string(),
  // T7.31 — Ledger People profile prose (separate from craft fields above).
  // Defaults keep pre-existing docs / fixture validating without migration.
  summary: z.string().default(''),
  bio: z.string().default(''),
})
export type Character = z.infer<typeof Character>

export const Relationship = z.object({
  between: z.tuple([Id, Id]),
  label: z.string(),
  reallyLike: z.string(),
  locked: z.boolean().default(false),
})
export type Relationship = z.infer<typeof Relationship>

// T7.19 — extends the original `{ text, locked }` bible entry with
// structured limit/cost/exception fields plus one evidence citation
// (design doc "WorldRule"). All new fields default so pre-existing docs
// (and the fixture's original two-field rules) still validate unchanged.
export const WorldRule = z.object({
  text: z.string(),
  locked: z.boolean().default(false),
  limit: z.string().default(''),
  cost: z.string().default(''),
  exception: z.string().default(''),
  evidenceSceneId: Id.nullable().default(null),
  evidenceQuote: z.string().default(''),
})
export type WorldRule = z.infer<typeof WorldRule>

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
export type SeriesBible = z.infer<typeof SeriesBible>

// `objective` is what the character is actually pursuing — unchanged meaning,
// so pre-existing docs keep working. `statedObjective` is what they claim to
// be pursuing when that differs; empty (the default) means there is no gap,
// which is the common case. A non-empty `statedObjective` IS the ulterior
// motive: the drama lives in the distance between the two.
//
// `concealed` separates the two ways that gap arises — deliberate deception
// (true) from self-deception or a want the character can't yet articulate
// (false). A dramaturg treats those very differently, and it is not
// recoverable from the two strings alone.
export const Motivation = z.object({
  characterId: Id,
  objective: z.string(),
  stakes: z.string(),
  obstacle: z.string(),
  statedObjective: z.string().default(''),
  concealed: z.boolean().default(false),
})
export type Motivation = z.infer<typeof Motivation>

export const Beat = z.object({
  id: Id,
  index: z.number().int().min(0),
  locked: z.boolean().default(false),
  whatHappens: z.string(),
  audienceLearns: z.string(),
  audienceFeels: z.string(),
  scriptText: z.string().default(''),
  scriptLocked: z.boolean().default(false),
})
export type Beat = z.infer<typeof Beat>

export const Scene = z.object({
  id: Id,
  index: z.number().int().min(0),
  act: z.number().int().min(0), // 0 = cold open
  storyline: z.enum(['A', 'B', 'C']).default('A'), // present in schema; UI tagging is v2
  locked: z.boolean().default(false),
  location: z.string(),
  time: z.string(),
  socialSituation: z.string(),
  whatHappens: z.string(),
  audienceLearns: z.string(),
  audienceFeels: z.string(),
  motivations: z.array(Motivation),
  beats: z.array(Beat),
})
export type Scene = z.infer<typeof Scene>

// T7.24 — a relative or absolute time marker between scenes, inferred from
// scene slugline time-of-day text on import (fountain.timeline.
// merge_timeline_anchors). Display-only in MVP: the as-of filter stays
// scene-index-based (design doc T7.24) — anchors never reorder scenes.
export const TimelineAnchor = z.object({
  afterSceneId: Id, // the scene this time jump happens after
  label: z.string(), // e.g. "Three days later"
  kind: z.enum(['relative', 'absolute']),
  quote: z.string().default(''), // verbatim slugline/action text evidence
})
export type TimelineAnchor = z.infer<typeof TimelineAnchor>

// T7.25 — a scene-anchored relationship snapshot (design doc "Scene-anchored
// rows"). `seriesBible.relationships` stays the single current/baseline
// label per pair; `relationshipStates` is the timeline of when/where that
// (or an earlier) label was evidenced, one row per `InferredRelationship`
// evidence citation (fountain.characters.merge_inferred_entities) — no
// separate classifier call. "Latest state with sceneId <= k" is the as-of
// read (design doc); MVP has no dedicated as-of endpoint yet.
export const RelationshipState = z.object({
  between: z.tuple([Id, Id]),
  label: z.string(),
  sceneId: Id,
  quote: z.string().default(''),
})
export type RelationshipState = z.infer<typeof RelationshipState>

// T7.26 — object custody / location continuity (design doc "simpler MVP"
// path): one row per state/event ledger fact whose text names an object's
// hiding/storage location, inferred deterministically from already-
// extracted fact text (fountain.object_states) — no new LLM call.
// `holderCharacterId` is unset in this MVP cut (location-only signal); the
// field exists so a future holder-tracking pass has nowhere else to add.
export const ObjectState = z.object({
  name: z.string(),
  holderCharacterId: Id.nullable(),
  locationLabel: z.string(),
  sceneId: Id,
  quote: z.string().default(''),
})
export type ObjectState = z.infer<typeof ObjectState>

// T7.19 — a narrative setup/payoff arc, MVP-scoped to the episode it lives
// on (design doc "StoryThread"; non-goal: cross-episode threads).
// `status` is a single lifecycle label, not step tracking — an "open"
// thread may have only a setup; "paid_off" has a payoff span. Import mints
// these server-side (never writer-authored ids from the model) and
// resolves `ownerNames` (see `infer_narrative_promises`) to
// `ownerCharacterIds` against the existing bible.
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
  // Which beat each quote was found in, derived by the server on merge — the
  // model never supplies these, exactly like `id` and `ownerCharacterIds`. A
  // quote is only kept if it appears verbatim in the scene it cites, and the
  // beat is where it appeared. Null means the quote was not verifiable and
  // was dropped. Scene-level citation is too coarse to trust on its own: a
  // scene that runs two locations under one slugline will happily verify a
  // quote from the wrong storyline.
  setupBeatId: Id.nullable().default(null),
  payoffBeatId: Id.nullable().default(null),
  locked: z.boolean().default(false),
})
export type StoryThread = z.infer<typeof StoryThread>

// A secret is a StoryThread's shape applied to concealment: established ->
// revealed instead of setup -> paid off, which is why it lives beside it and
// mirrors its fields. What it adds is the asymmetry a thread has no room for
// — WHO holds it and who is kept in the dark. That pair is the whole point:
// a fact everyone knows is not a secret, and `knownBy` alone can't say
// whether the gap is deliberate.
//
// `factId` links to the LedgerFact being concealed when there is one, so the
// secret does not become a second, drifting copy of the truth. It is nullable
// because a secret can be established before the fact is nailed down (a
// character conceals something the ledger hasn't pinned yet).
//
// `revealedSceneId: null` means still concealed at end of episode — the
// direct analogue of an open thread, and the thing a writer most wants
// flagged. Defaults throughout so pre-existing docs validate.
export const Secret = z.object({
  id: Id,
  summary: z.string(),
  factId: Id.nullable().default(null),
  holderCharacterIds: z.array(Id).default([]),
  concealedFromCharacterIds: z.array(Id).default([]),
  audienceKnows: z.boolean().default(true),
  establishedSceneId: Id,
  revealedSceneId: Id.nullable().default(null),
  // Scenes where the secret is actively maintained — a deflection, a lie, a
  // change of subject. These are the beats a writer scans for when the reveal
  // needs to land, and they are invisible from the establish/reveal pair.
  concealmentSceneIds: z.array(Id).default([]),
  establishedQuote: z.string().default(''),
  revealedQuote: z.string().default(''),
  // Server-derived beat anchors for the two quotes above — see
  // `StoryThread.setupBeatId` for why the scene id alone is not enough.
  establishedBeatId: Id.nullable().default(null),
  revealedBeatId: Id.nullable().default(null),
  provenance: z
    .enum(['inferred', 'writer_confirmed', 'writer_authored'])
    .default('inferred'),
  locked: z.boolean().default(false),
})
export type Secret = z.infer<typeof Secret>

// T7.27 — episode-level story overview (logline, scene outline, named beat
// sheet, two-paragraph synopsis). Import mints no ids; outline/beatSheet
// rows must reference scene/beat ids from the imported partition. Defaults
// to null so pre-existing docs validate.
export const StoryOverviewOutlineItem = z.object({
  sceneId: Id,
  summary: z.string(),
})
export type StoryOverviewOutlineItem = z.infer<typeof StoryOverviewOutlineItem>

export const StoryOverviewBeatItem = z.object({
  beatId: Id,
  label: z.string().default(''),
  summary: z.string(),
  sceneId: Id.nullable().default(null),
  // Teleplay section (0 = cold open when format.coldOpen). Coerced from the
  // parent scene's act on merge; null when the beat cannot be placed.
  act: z.number().int().min(0).nullable().default(null),
})
export type StoryOverviewBeatItem = z.infer<typeof StoryOverviewBeatItem>

export const StoryOverview = z.object({
  logline: z.string(),
  outline: z.array(StoryOverviewOutlineItem),
  beatSheet: z.array(StoryOverviewBeatItem),
  summary: z.string(),
  provenance: z.enum(['inferred', 'writer_authored']).default('inferred'),
  locked: z.boolean().default(false),
})
export type StoryOverview = z.infer<typeof StoryOverview>

// A source-grounded, multi-scale reading of an imported episode. Every
// interpretive claim carries a beat id and an exact quote that the server
// verifies before persisting it.
export const NarrativeEvidence = z.object({
  beatId: Id,
  quote: z.string().min(1).max(200),
})
export type NarrativeEvidence = z.infer<typeof NarrativeEvidence>

export const NarrativeTheme = z.object({
  label: z.string(),
  statement: z.string(),
  evidence: z.array(NarrativeEvidence).min(1),
})
export type NarrativeTheme = z.infer<typeof NarrativeTheme>

export const NarrativeAct = z.object({
  act: z.number().int().min(0),
  dramaticQuestion: z.string(),
  escalation: z.string(),
  // Server-filled from `InferredNarrativeAct.escalationEvidence` — quotes are
  // derived here, never sent by the model, same as `NarrativeTheme.evidence`.
  // Defaulted so maps saved before this field validate unchanged, and because
  // an act whose escalation was cleared (by verifier repair, or by evidence
  // that would not ground) keeps its coverage and loses only the claim.
  escalationEvidence: z.array(NarrativeEvidence).default([]),
  turnBeatId: Id,
  evidenceQuote: z.string().min(1).max(200),
})
export type NarrativeAct = z.infer<typeof NarrativeAct>

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
export type HeroJourneyStageName = z.infer<typeof HeroJourneyStageName>

export const HeroJourneyStage = z.object({
  stage: HeroJourneyStageName,
  beatId: Id,
  summary: z.string(),
  evidenceQuote: z.string().min(1).max(200),
})
export type HeroJourneyStage = z.infer<typeof HeroJourneyStage>

export const HeroJourney = z.object({
  applies: z.boolean(),
  protagonistCharacterId: Id.nullable(),
  rationale: z.string(),
  stages: z.array(HeroJourneyStage),
})
export type HeroJourney = z.infer<typeof HeroJourney>

export const CharacterArcTurningPoint = z.object({
  beatId: Id,
  change: z.string(),
  quote: z.string().min(1).max(200),
})
export type CharacterArcTurningPoint = z.infer<typeof CharacterArcTurningPoint>

export const NarrativeCharacterArc = z.object({
  characterId: Id,
  want: z.string(),
  need: z.string(),
  internalConflict: z.string(),
  externalPressure: z.string(),
  arcSummary: z.string(),
  turningPoints: z.array(CharacterArcTurningPoint).min(1),
})
export type NarrativeCharacterArc = z.infer<typeof NarrativeCharacterArc>

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
export type SceneTurn = z.infer<typeof SceneTurn>

export const ThreadMovementPhase = z.enum([
  'setup',
  'escalation',
  'reversal',
  'reveal',
  'payoff',
  'aftermath',
])
export type ThreadMovementPhase = z.infer<typeof ThreadMovementPhase>

export const ThreadMovement = z.object({
  threadId: Id,
  beatId: Id,
  phase: ThreadMovementPhase,
  summary: z.string(),
  evidenceQuote: z.string().min(1).max(200),
})
export type ThreadMovement = z.infer<typeof ThreadMovement>

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
  // Scenes the analysis could not read after one re-roll. They have no
  // sceneTurn and nothing cites them; the map says nothing about them rather
  // than publishing server-written prose (owner decision 2, T9.3).
  unanalyzedSceneIds: z.array(Id).default([]),
  provenance: z.enum(['inferred', 'writer_authored']).default('inferred'),
  locked: z.boolean().default(false),
})
export type NarrativeMap = z.infer<typeof NarrativeMap>

/** A durable, source-versioned Narrative Map job. The job is intentionally
 * separate from `NarrativeMap`: analysis may be in flight, rejected by the
 * evidence gate, or stale without ever changing the writer's project. */
export const NarrativeMapRun = z.object({
  id: Id,
  projectId: Id,
  sourceSnapshotId: Id,
  sourceHash: z.string().min(1),
  analysisVersion: z.string().min(1),
  status: z.enum([
    'queued',
    'running',
    'completed',
    'rejected',
    'failed',
    'stale',
  ]),
  phase: z.enum([
    'readiness',
    'scene_analysis',
    'synthesis',
    'verification',
    'saving',
    'complete',
    'failed',
  ]),
  sceneCount: z.number().int().min(0),
  completedSceneCount: z.number().int().min(0),
  attemptCount: z.number().int().min(0),
  retryAllowed: z.boolean(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  actualInputTokens: z.number().int().nonnegative().nullable(),
  actualOutputTokens: z.number().int().nonnegative().nullable(),
  resultSnapshotId: Id.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  // Why the evidence gate rejected this run. Recorded on the run's checkpoint
  // since 2.x and surfaced nowhere: the panel said only "the evidence gate
  // rejected this analysis", so a rejection that had already cost a full
  // analysis gave no way to tell an over-claiming synthesis from a genuinely
  // unsupportable script. `reason` is the verifier's own words for why the
  // claim failed, which is the part a writer can actually act on; it carries
  // script content, so it belongs in this response — the writer's own data —
  // and never in a log. Hard rule 5 is satisfied at the logging boundary:
  // `narrative_map_runs` emits `diagnostic_codes` only. Defaulted so older
  // clients still parse; `reason` defaults for diagnostics recorded before it
  // existed and for codes like `verification_repair_path_unresolved` that
  // carry no prose.
  rejectionDiagnostics: z
    .array(
      z.object({
        code: z.string(),
        path: z.string(),
        reason: z.string().default(''),
      }),
    )
    .default([]),
  // The counterpart for a run that succeeded: what the evidence gate pruned
  // from the map before publishing it. A map that passes after local repair
  // has had claims removed — a theme, a character's arc summary, a
  // character's want — and the writer saw fewer things and no word why. Design doc: "never rewrite silently". `subject` is the removed thing
  // in the writer's terms ("C.J.'s arc summary"); `path` is the address;
  // `reason` is the verifier's own words, joined by path. Advisories are not
  // listed, since nothing was done to the map on their account. Defaulted so
  // older clients and runs recorded before this field still parse.
  removedClaims: z
    .array(
      z.object({
        action: z.string(),
        path: z.string(),
        subject: z.string(),
        reason: z.string().default(''),
      }),
    )
    .default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type NarrativeMapRun = z.infer<typeof NarrativeMapRun>

export const Episode = z.object({
  id: Id,
  index: z.number().int().min(0),
  locked: z.boolean().default(false),
  title: z.string(),
  premise: z.string(),
  seasonFunction: z.string().default(''),
  storylines: z.array(
    z.object({
      id: z.enum(['A', 'B', 'C']),
      summary: z.string(),
      characterIds: z.array(Id),
    }),
  ),
  scenes: z.array(Scene),
  // T7.24 timeline anchors, ordered by scene order. Defaults to [] so
  // pre-existing docs validate.
  timelineAnchors: z.array(TimelineAnchor).default([]),
  // T7.25 relationship state history. Defaults to [] so pre-existing docs validate.
  relationshipStates: z.array(RelationshipState).default([]),
  // T7.26 object custody / location continuity. Defaults to [] so
  // pre-existing docs validate.
  objectStates: z.array(ObjectState).default([]),
  // T7.19 narrative-promise threads (design doc "MVP stores threads on the
  // first (only) episode"). Defaults to [] so pre-existing docs validate.
  threads: z.array(StoryThread).default([]),
  // Concealment arcs, episode-scoped like threads: who is hiding what from
  // whom, and whether it has landed yet. Defaults to [] so pre-existing docs
  // validate.
  secrets: z.array(Secret).default([]),
  // T7.27 episode story overview (import-inferred logline/outline/beat sheet/
  // synopsis). Defaults to null so pre-existing docs validate.
  storyOverview: StoryOverview.nullable().default(null),
  // Import-time macro/micro analysis. The map is evidence-grounded to imported
  // beats and remains nullable for existing projects.
  narrativeMap: NarrativeMap.nullable().default(null),
})
export type Episode = z.infer<typeof Episode>

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
export type Season = z.infer<typeof Season>

export const SourceSpan = z.object({
  episodeId: Id,
  sceneId: Id,
  beatId: Id,
  // Offsets within the beat's scriptText. Lines are model-reported (input is
  // line-numbered); char offsets are computed server-side by locating
  // sourceText verbatim within the line range (disambiguates duplicates).
  startLine: z.number().int().min(0).nullable().default(null),
  endLine: z.number().int().min(0).nullable().default(null),
  charStart: z.number().int().min(0).nullable().default(null),
  charEnd: z.number().int().min(0).nullable().default(null),
})
export type SourceSpan = z.infer<typeof SourceSpan>

// T7.23 — a knowledge-state transition after a fact's establishing scene
// (baseline knowers live on `LedgerFact.knownBy`). `kind: "learns"` adds
// `characterIds` to the knower set as of `sceneId`; `"forgets"` removes them.
// `knowers_as_of` (apps/api/drama_manager/ledger_as_of.py) starts from
// baseline `knownBy` and folds in every event with `sceneId` index <= the
// queried scene, in scene order.
// Knowing is not the only epistemic state a scene can put a character in, and
// collapsing the others into "knows" is what produces the confident-but-wrong
// ledger. Only two kinds move the knower set:
//
//   learns      -> joins the knower set
//   confirms    -> joins it (suspicion hardening into knowledge)
//   forgets     -> leaves it
//   suspects    -> does NOT join: they have a hypothesis, not the fact
//   misinformed -> does NOT join: they hold a false belief about it
//
// `knownBy` therefore keeps its exact meaning — who actually knows the true
// fact — while suspicion and misinformation stay visible to the writer
// instead of being rounded up into knowledge. Dramatic irony continues to
// live in the knownBy/audienceKnows gap; `misinformed` is the sharper case
// where a character is confidently wrong.
export const KnowledgeEventKind = z.enum([
  'learns',
  'confirms',
  'forgets',
  'suspects',
  'misinformed',
])
export type KnowledgeEventKind = z.infer<typeof KnowledgeEventKind>

export const KnowledgeEvent = z.object({
  sceneId: Id,
  characterIds: z.array(Id).default([]),
  kind: KnowledgeEventKind,
  quote: z.string().default(''), // <=200 chars evidence
})
export type KnowledgeEvent = z.infer<typeof KnowledgeEvent>

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
  // T7.23 knowledge-transition history beyond the baseline `knownBy` set —
  // see `KnowledgeEvent` above. Defaults to [] so pre-existing docs validate.
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
  // T7.23 response-only enrichment: `GET /ledger?asOfScene=` fills this with
  // `knowers_as_of`'s result so the UI can show who knew a fact at that
  // scene without rewriting canonical `knownBy`. Always null outside that
  // query param — never persisted, never settable by clients.
  knownByAsOf: z.array(Id).nullable().default(null),
})
export type LedgerFact = z.infer<typeof LedgerFact>

export const CraftLevel = z.enum(['fast', 'standard', 'considered'])
export type CraftLevel = z.infer<typeof CraftLevel>

export const Project = z.object({
  id: Id,
  title: z.string(),
  format: ShowFormat,
  enabledComponents: z.array(z.string()),
  premise: z.string(),
  seriesBible: SeriesBible,
  seasons: z.array(Season),
  headSnapshotId: Id.nullable(),
  /** Adoption A3 — per-project default for Write/Review craft picker. */
  defaultCraftLevel: CraftLevel.default('standard'),
})
export type Project = z.infer<typeof Project>
// Ledger, snapshots, suggestionHistory live in separate stores (design doc §5).

export const ProjectSummary = z.object({
  id: Id,
  title: z.string(),
  format: ShowFormat,
  updatedAt: z.string().datetime(),
  pendingReviewCount: z.number().int().min(0),
  setupState: z.enum(['incomplete', 'ready']),
})
export type ProjectSummary = z.infer<typeof ProjectSummary>

export const CharacterSeed = z.object({
  name: z.string().min(1),
  traits: z.string().nullable().default(null),
})
export type CharacterSeed = z.input<typeof CharacterSeed>

export const ProjectFoundationInput = z.object({
  existentialQuestion: z.string().nullable().default(null),
  storiesToAvoid: z.array(z.string()).nullable().default(null),
  characters: z.array(CharacterSeed).nullable().default(null),
})
export type ProjectFoundationInput = z.input<typeof ProjectFoundationInput>

export const ProjectCreateRequest = z.object({
  title: z.string(),
  format: ShowFormat,
  premise: z.string(),
  foundation: ProjectFoundationInput.nullable().default(null),
})
export type ProjectCreateRequest = z.input<typeof ProjectCreateRequest>

// §9.3 atomic create-and-import: project basics (no `foundation` — the
// import path has no idea-path story-foundation step) plus the script
// source. `premise` is optional (the import wizard has no premise step).
export const ProjectImportCreateRequest = z.object({
  title: z.string(),
  format: ShowFormat,
  premise: z.string().nullable().default(null),
  source: z.object({
    format: z.enum(['fountain', 'text']),
    content: z.string(),
  }),
})
export type ProjectImportCreateRequest = z.input<
  typeof ProjectImportCreateRequest
>

export const PdfExtractMethod = z.enum(['text_layer', 'ocr'])
export type PdfExtractMethod = z.infer<typeof PdfExtractMethod>

export const PdfExtractResult = z.object({
  text: z.string(),
  method: PdfExtractMethod,
  pageCount: z.number().int().positive(),
  warnings: z.array(z.string()),
})
export type PdfExtractResult = z.infer<typeof PdfExtractResult>

/** One restorable ancestor for the undo timeline (adoption A5). */
export const SnapshotSummary = z.object({
  id: Id,
  instruction: z.string(),
  ts: z.string(),
})
export type SnapshotSummary = z.infer<typeof SnapshotSummary>

/** `POST /projects/{pid}/restore` — jump head to an ancestor snapshot. */
export const ProjectRestoreRequest = z.object({
  snapshotId: Id,
})
export type ProjectRestoreRequest = z.infer<typeof ProjectRestoreRequest>

// ─────────────────────────────────────────────────────────────────────────
// §2. Generation / Review types
// ─────────────────────────────────────────────────────────────────────────

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
export type BeatCandidate = z.infer<typeof BeatCandidate>

export const ImpactedObject = z.object({
  objectType: z.enum(['scene', 'beat', 'character', 'ledgerFact']),
  objectId: Id,
  // server-annotated: scene/beat → regenerate; character/ledgerFact →
  // flag_only (MVP has no machine-edit path for them); `add` is the §9.4
  // initial_scene_skeleton variant, where `objectId` is a proposalId, not a
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
export type ImpactedObject = z.infer<typeof ImpactedObject>

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
export type ConsistencyFlag = z.infer<typeof ConsistencyFlag>

// §9.3 atomic create-and-import result — same shape as the existing
// `POST /projects/{pid}/import` response (data contract §4), returned as the
// SSE stream's terminal `complete` payload.
export const ProjectImportResult = z.object({
  project: Project,
  newFacts: z.array(LedgerFact),
  consistencyFlags: z.array(ConsistencyFlag),
})
export type ProjectImportResult = z.infer<typeof ProjectImportResult>

// §7 named import progress stages (design doc §7 step 4), in emission order.
export const ProjectImportStageName = z.enum([
  'parsing_scenes',
  'segmenting_beats',
  'inferring_acts',
  'inferring_entities',
  // T7.19 — infer_narrative_promises runs after entities (so motivations
  // see the resolved cast) and before fact extraction (design doc "P2").
  'inferring_promises',
  // T7.27 — infer_story_overview runs after promises (motivations/threads
  // available for synopsis tone) and before fact extraction.
  'inferring_overview',
  'extracting_facts',
  'checking_consistency',
  'saving',
])
export type ProjectImportStageName = z.infer<typeof ProjectImportStageName>

// §9.3 SSE progress: `stage` events mark named stage transitions and
// `progress` events report scene completions within those stages, followed by
// exactly one terminal `complete` or `failed`. `error` matches the canonical
// `{code, message, details?}` envelope (data contract §4) so the wizard's
// failure UI reuses the same error rendering as every other endpoint.
export const ProjectImportProgressEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage'), name: ProjectImportStageName }),
  z.object({
    type: z.literal('progress'),
    stage: ProjectImportStageName,
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
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
export type ProjectImportProgressEvent = z.infer<
  typeof ProjectImportProgressEvent
>

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
export type BeatUpdate = z.infer<typeof BeatUpdate>

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
export type SceneUpdate = z.infer<typeof SceneUpdate>

// §9.4 initial scene skeleton — guided-setup scene-addition Change Set
// (new-project-flow design spec §6/§9.4). MVP defers storyline inference, so
// every addition carries `storyline: 'A'` (`Scene`'s own default) rather than
// a model-set field. `proposalId` is the server-assigned selection handle —
// never the final scene id — minted once generation validates the model's
// scene list (§2a `InitialSceneSkeleton` below); the model never sets ids.
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
export type SceneAddition = z.infer<typeof SceneAddition>

// One generated skeleton option (data contract §9.4): the writer compares
// three of these side by side, then selects one to create a Change Set.
export const InitialSceneSkeletonCandidate = z.object({
  candidateId: Id,
  basedOnSnapshotId: Id, // the headSnapshotId this candidate was generated against
  label: z.string().max(40),
  scenes: z.array(SceneAddition), // ordered
})
export type InitialSceneSkeletonCandidate = z.infer<
  typeof InitialSceneSkeletonCandidate
>

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
export type ChangeSetPreview = z.infer<typeof ChangeSetPreview>

// `edit` — the classify_blast_radius / regenerate_elements flow above.
// `initial_scene_skeleton` — guided-setup scene additions (§9.4): selecting a
// candidate creates the Change Set already `previewing` (the candidate IS
// the preview; no further model call), and `impacted[].objectId` is each
// scene's `proposalId`.
export const ChangeSetKind = z.enum(['edit', 'initial_scene_skeleton'])
export type ChangeSetKind = z.infer<typeof ChangeSetKind>

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
export type ChangeSet = z.infer<typeof ChangeSet>

// ─────────────────────────────────────────────────────────────────────────
// §2a. LLM operation schemas (tool outputs)
//
// Implementations must not define op schemas anywhere else (grep gate in
// scripts/check_contract.py). Server-side annotations (ImpactedObject.applyMode
// /locked, LedgerFact.provenance/status, ConsistencyFlag.id/status) are
// deliberately absent here — the model never sets them.
// ─────────────────────────────────────────────────────────────────────────

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
export type BlastRadius = z.infer<typeof BlastRadius>

// §4 regenerate_elements — reuses BeatUpdate/SceneUpdate from §2, so the
// model's output IS the ChangeSetPreview payload shape (no translation layer).
export const RegeneratedElements = z.object({
  beats: z.array(BeatUpdate),
  scenes: z.array(SceneUpdate),
  continuityConflicts: z.array(
    z.object({ factId: Id, objectId: Id, explanation: z.string() }),
  ),
})
export type RegeneratedElements = z.infer<typeof RegeneratedElements>

// §9.4 generate_scene_skeleton — the guided-setup convergent loop calls this
// 3× (drama_manager/scene_skeleton.py). The model emits no ids and no
// `scriptText` (hard rule: "no scriptText in skeleton"); the server assigns
// each scene a `proposalId` and stamps `storyline: 'A'` after validation,
// producing a `SceneAddition` (§2 above) per scene.
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
export type InitialSceneSkeleton = z.infer<typeof InitialSceneSkeleton>

// §5a infer_story_entities — import-time character/relationship/world-element
// candidates, run between act inference and fact extraction (prompt spec
// §5a). Names are strings, not ids: the server resolves each against the
// existing bible (matching on name/aliases) and mints new ids for anything
// unresolved — the model never sets/knows ids. Every entity carries at least
// one evidence citation (scene id + short quote) for the review UI.
// A character whose name and aliases match more than one existing row is
// neither attached nor minted; it becomes an open `[merge_proposal]` scene
// flag pointing at Merge into (T9.8).
export const EntityEvidence = z.object({
  sceneId: Id,
  quote: z.string(), // verbatim-ish; server-truncated to 200 chars
})
export type EntityEvidence = z.infer<typeof EntityEvidence>

export const InferredCharacter = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  role: z.enum(['principal', 'supporting', 'minor']),
  traits: z.string(), // one line, may be ""
  evidence: z.array(EntityEvidence).min(1),
})
export type InferredCharacter = z.infer<typeof InferredCharacter>

export const InferredRelationship = z.object({
  betweenNames: z.tuple([z.string(), z.string()]),
  label: z.string(),
  reallyLike: z.string(), // may be ""
  evidence: z.array(EntityEvidence).min(1),
})
export type InferredRelationship = z.infer<typeof InferredRelationship>

export const InferredWorldElement = z.object({
  kind: z.enum(['location', 'object']),
  name: z.string(),
  note: z.string(), // one line, may be ""
  evidence: z.array(EntityEvidence).min(1),
})
export type InferredWorldElement = z.infer<typeof InferredWorldElement>

// InferredWorldElement rows land as SeriesBible.worldQA entries
// (`q: "Where/What is <name>?"`, `a: note`) — no first-class Project field
// in P0; a dedicated world-element entity is P1 (see task report).
export const StoryEntities = z.object({
  characters: z.array(InferredCharacter),
  relationships: z.array(InferredRelationship),
  worldElements: z.array(InferredWorldElement),
})
export type StoryEntities = z.infer<typeof StoryEntities>

// T7.19 infer_narrative_promises — import-time threads/motivations/world-rule
// read, run after infer_story_entities and before extract_ledger_facts
// (design doc "LLM op: infer_narrative_promises"). Threads and world rules
// name characters/scenes the same way infer_story_entities does elsewhere:
// `ownerNames` are strings the server resolves to `ownerCharacterIds`
// (unresolvable owners dropped, counts only, never logged as text);
// `setupSceneId`/`payoffSceneId`/`sceneId`/`evidenceSceneId` are already
// server-known scene ids (the model sees the scene list, not raw text
// offsets) so no name resolution is needed for those. Server mints thread
// ids, writes `sceneMotivations` onto matching `Scene.motivations`, and
// merges `worldRules` into the bible (append new; never overwrite a locked
// rule).
export const NarrativePromises = z.object({
  threads: z.array(
    z.object({
      label: z.string(),
      summary: z.string(),
      status: z.enum(['open', 'paid_off', 'abandoned']),
      ownerNames: z.array(z.string()),
      setupSceneId: Id,
      payoffSceneId: Id.nullable(),
      // The model cites the BEAT that carries the claim; the server derives the
      // quote from that beat's real text (drama_manager.promises). It used to
      // supply the quote itself, chosen from six positionally-sampled lines per
      // scene — on a long scene, six lines out of hundreds — so it could not cite
      // the line that states a secret unless that line happened to land on a
      // sample point. Beat ids are already in the prompt spine, and the server
      // holds every beat's full text, so this is both cheaper and exact. Same
      // shape the Narrative Map uses. Null = no beat carries it.
      setupBeatId: Id.nullable(),
      payoffBeatId: Id.nullable(),
    }),
  ),
  // Concealment arcs. Names, not ids (server resolves), and scene ids chosen
  // from the supplied list. `revealedSceneId: null` = still concealed at end
  // of episode. The server mints ids and links `factId` where it can.
  secrets: z.array(
    z.object({
      summary: z.string(),
      holderNames: z.array(z.string()),
      concealedFromNames: z.array(z.string()),
      audienceKnows: z.boolean(),
      establishedSceneId: Id,
      revealedSceneId: Id.nullable(),
      concealmentSceneIds: z.array(Id),
      // The model cites the BEAT that carries the claim; the server derives the
      // quote from that beat's real text (drama_manager.promises). It used to
      // supply the quote itself, chosen from six positionally-sampled lines per
      // scene — on a long scene, six lines out of hundreds — so it could not cite
      // the line that states a secret unless that line happened to land on a
      // sample point. Beat ids are already in the prompt spine, and the server
      // holds every beat's full text, so this is both cheaper and exact. Same
      // shape the Narrative Map uses. Null = no beat carries it.
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
          // Empty unless the character claims a different goal than the one
          // their behaviour serves; the gap is the ulterior motive.
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
      // The model cites the BEAT that carries the claim; the server derives the
      // quote from that beat's real text (drama_manager.promises). It used to
      // supply the quote itself, chosen from six positionally-sampled lines per
      // scene — on a long scene, six lines out of hundreds — so it could not cite
      // the line that states a secret unless that line happened to land on a
      // sample point. Beat ids are already in the prompt spine, and the server
      // holds every beat's full text, so this is both cheaper and exact. Same
      // shape the Narrative Map uses. Null = no beat carries it.
      evidenceBeatId: Id.nullable(),
    }),
  ),
})
export type NarrativePromises = z.infer<typeof NarrativePromises>

// T7.27 infer_story_overview — import-time episode logline / outline /
// beat sheet / two-paragraph synopsis. Model references existing sceneId /
// beatId values only; server drops unknown ids and sets provenance/locked.
export const InferredStoryOverview = z.object({
  logline: z.string(),
  outline: z.array(
    z.object({
      sceneId: Id,
      summary: z.string(),
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
})
export type InferredStoryOverview = z.infer<typeof InferredStoryOverview>

// Import-time narrative map. The model chooses only source beat ids; the server
// resolves character names and attaches exact excerpts before it persists the
// public NarrativeMap shape.
const InferredNarrativeEvidence = z.object({
  beatId: Id,
})

const InferredNarrativeTheme = z.object({
  label: z.string(),
  statement: z.string(),
  evidence: z.array(InferredNarrativeEvidence).min(1),
})

// `turnBeatId` names the one beat the act turns on; `escalation` is prose about
// how the whole act raises the stakes, and the two were persistently confused
// because only one of them carried evidence. A verifier with nothing but the
// turn beat's excerpt judged the escalation against it and rejected act 2 of a
// West Wing episode for a line that was on the page in a later scene of the
// same act. Telling the verifier about act membership helped and did not
// settle it — across ten replays the conflation kept resurfacing, because the
// scope of the claim was still something to be inferred rather than stated.
//
// `escalationEvidence` states it. The claim now carries the beats it rests on,
// the server checks they belong to this act, and the excerpts reach the
// verifier the same way a theme's do. Capped because an escalation is one
// sentence: a citation list longer than this is shotgunning, not support.
const InferredNarrativeAct = z.object({
  act: z.number().int().min(0),
  dramaticQuestion: z.string(),
  escalation: z.string(),
  escalationEvidence: z.array(InferredNarrativeEvidence).min(1).max(3),
  turnBeatId: Id,
})

const InferredHeroJourneyStage = z.object({
  stage: HeroJourneyStageName,
  beatId: Id,
  summary: z.string(),
})

const InferredCharacterArcTurningPoint = z.object({
  beatId: Id,
  change: z.string(),
})

const InferredThreadMovement = z.object({
  threadId: Id,
  beatId: Id,
  phase: ThreadMovementPhase,
  summary: z.string(),
})

// Character references are names at inference time; the server resolves them
// against the imported cast before it persists the map.
const InferredNarrativeCharacterArc = z.object({
  characterName: z.string(),
  want: z.string(),
  need: z.string(),
  internalConflict: z.string(),
  externalPressure: z.string(),
  arcSummary: z.string(),
  turningPoints: z.array(InferredCharacterArcTurningPoint).min(1),
})

const InferredSceneTurn = z.object({
  sceneId: Id,
  focalCharacterName: z.string().nullable(),
  dramaticFunction: z.string(),
  conflict: z.string(),
  stakes: z.string(),
  turnBeatId: Id,
  turn: z.string(),
})

const InferredHeroJourney = z.object({
  applies: z.boolean(),
  protagonistName: z.string().nullable(),
  rationale: z.string(),
  stages: z.array(InferredHeroJourneyStage),
})

export const InferredNarrativeMap = z.object({
  dramaticQuestion: z.string(),
  centralConflict: z.string(),
  controllingIdea: z.string(),
  themes: z.array(InferredNarrativeTheme).min(1),
  acts: z.array(InferredNarrativeAct).min(1),
  heroJourney: InferredHeroJourney,
  characterArcs: z.array(InferredNarrativeCharacterArc),
  sceneTurns: z.array(InferredSceneTurn).min(1),
  threadMovements: z.array(InferredThreadMovement),
})
export type InferredNarrativeMap = z.infer<typeof InferredNarrativeMap>

// Accuracy-first Narrative Map pipeline. Scene analysis reads bounded chunks
// of the actual saved screenplay; global synthesis works from those grounded
// packets, then an independent verifier can reject unsupported conclusions.
const InferredNarrativeMoment = z.object({
  beatId: Id.describe(
    'A beatId copied from allowedBeatIds for the supplied scene.',
  ),
  summary: z
    .string()
    .describe(
      'Concrete on-page action or decision at this moment; never a placeholder.',
    ),
  dramaticFunction: z
    .string()
    .describe(
      'How this moment changes pressure, information, power, or choice in the scene.',
    ),
  consequence: z
    .string()
    .describe(
      'What becomes newly true or must be addressed after this moment.',
    ),
})

const InferredNarrativeSceneAnalysis = z.object({
  sceneId: Id.describe('The single supplied sceneId, copied exactly.'),
  summary: z
    .string()
    .describe(
      "A concrete present-tense summary naming the scene's on-page action.",
    ),
  focalCharacterName: z
    .string()
    .nullable()
    .describe(
      'A name copied from known_cast when one perspective clearly leads; otherwise null.',
    ),
  dramaticFunction: z
    .string()
    .describe(
      "The specific job this scene performs in the episode's developing story.",
    ),
  conflict: z
    .string()
    .describe(
      "The scene's immediate opposition or pressure. For a connective scene, state that there is no independent confrontation and name the pressure carried forward.",
    ),
  stakes: z
    .string()
    .describe(
      "What can be gained, lost, exposed, or made harder by the scene's action.",
    ),
  turnBeatId: Id.describe(
    "The allowed beatId where the scene's main change is clearest.",
  ),
  turn: z
    .string()
    .describe(
      'The concrete change in information, decision, value, or power by scene end.',
    ),
  keyMoments: z
    .array(InferredNarrativeMoment)
    .min(1)
    .describe(
      'One or more decisive on-page moments, each tied to an allowed beatId.',
    ),
})

export const InferredNarrativeSceneAnalysisBatch = z.object({
  scenes: z.array(InferredNarrativeSceneAnalysis).min(1),
})
export type InferredNarrativeSceneAnalysisBatch = z.infer<
  typeof InferredNarrativeSceneAnalysisBatch
>

export const InferredNarrativeMapSynthesis = z.object({
  dramaticQuestion: z.string(),
  centralConflict: z.string(),
  controllingIdea: z.string(),
  themes: z.array(InferredNarrativeTheme).min(1),
  acts: z.array(InferredNarrativeAct).min(1),
  heroJourney: InferredHeroJourney,
  characterArcs: z.array(InferredNarrativeCharacterArc),
  threadMovements: z.array(InferredThreadMovement),
})
export type InferredNarrativeMapSynthesis = z.infer<
  typeof InferredNarrativeMapSynthesis
>

// The verifier's two findings lists are mutually exclusive: `unsupportedClaims`
// blocks the map, `advisories` never does. Both carry `{path, reason}` for the
// same reason — the blocking list used to be `unsupportedPaths: string[]`, with
// nowhere to put the *why*, so the model appended its reasoning to the path
// ("acts[2].turnBeatId beat-12-6 escalation claim '...' — not evidenced at
// beat-12-6"). Two things broke downstream. The local repair matchers in
// `narrative_map_analysis` pattern-match these strings to decide which claim to
// prune, and prose after the path defeats that: a rejection naming `turnBeatId`
// matched the *escalation* rule because the word appeared in the sentence, which
// fails open on exactly the structural rejection that must fail closed. And with
// no reason field, a verifier that wanted to explain itself filed the same
// finding twice — once here as prose, once in `advisories` with a clean path —
// so every advisory it double-filed became blocking.
//
// `advisories` was `issues`, which read as a superset of "unsupported claim" and
// invited that double-filing. The names now say which list rejects.
export const NarrativeMapVerification = z.object({
  approved: z.boolean(),
  // `excerptCarriesClaim` is declared LAST on purpose. Property order is the
  // decoding grammar's order (see `render_tool_schema`), so the model states
  // the path, works the question out in `reason`, and only then commits to an
  // answer — which is the order it was already reasoning in, and the order the
  // old shape gave it no way to record.
  //
  // It exists because the verifier talks itself out of rejections and leaves
  // them rejecting. Real reasons, verbatim: "fine as-is, but no issue here",
  // "this is supported. Retracting", "so this is actually supported. Retained
  // here only for the compound claim". Each one discarded a map. 0.46.0 told
  // the model in the prompt not to do this, naming those exact phrases, and it
  // did it anyway on the next real run — a claim it argued was supported still
  // blocked, because placement in a list was the only thing the server could
  // read.
  //
  // Now the server reads the answer instead. `true` means the excerpt does
  // carry the claim, so the finding is not a rejection whatever list it
  // arrived in, and `partition_self_retracted_claims` moves it to advisories
  // before anything downstream sees it. The model is no longer asked to be
  // disciplined about placement; it is asked a question it can answer.
  unsupportedClaims: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
      excerptCarriesClaim: z.boolean(),
    }),
  ),
  missingSceneIds: z.array(Id),
  advisories: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
    }),
  ),
})
export type NarrativeMapVerification = z.infer<typeof NarrativeMapVerification>

// T7.23 extract-time counterpart to `KnowledgeEvent`: the model names
// characters, never ids (same convention as `knownBy`/`InferredCharacter`);
// the server resolves each name the same way `knownBy` names are resolved
// (`fountain.characters.normalize_known_by`) before storing.
// Extract-time counterpart to KnowledgeEvent: same kinds, but the model names
// characters rather than minting ids (server resolves via
// fountain.characters.normalize_known_by). See KnowledgeEventKind above for
// which kinds move the knower set — the model reports what the scene shows,
// the server decides what that means for `knownBy`.
export const ExtractedKnowledgeEvent = z.object({
  sceneId: Id,
  characterNames: z.array(z.string()).default([]),
  kind: KnowledgeEventKind,
  quote: z.string().default(''),
})
export type ExtractedKnowledgeEvent = z.infer<typeof ExtractedKnowledgeEvent>

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
  // baseline `knownBy` — empty array is the common case (first cut; see
  // design doc T7.23 "Import"). Names resolved server-side, same as `knownBy`.
  knowledgeEvents: z.array(ExtractedKnowledgeEvent).default([]),
  audienceKnows: z.boolean(),
  confidence: z.number().min(0).max(1),
})
export type ExtractedFact = z.infer<typeof ExtractedFact>

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
export type LedgerExtraction = z.infer<typeof LedgerExtraction>

// §6 suggest_instructions
export const InstructionSuggestions = z.object({
  suggestions: z.array(z.string()).length(3),
})
export type InstructionSuggestions = z.infer<typeof InstructionSuggestions>

/** `POST /projects/{pid}/suggest` (adoption A4). */
export const SuggestRequest = z.object({
  context: z.enum(['scene', 'beat']),
  targetId: Id,
  surface: z.enum(['command_bar', 'scene_premise', 'tune']),
  /** Optional unsaved script text from the canvas (A4: current story state). */
  draftScript: z.string().nullable().default(null),
})
export type SuggestRequest = z.infer<typeof SuggestRequest>

const InferredActStart = z.object({
  act: z.number().int().min(0),
  startSceneIndex: z.number().int().min(0),
})

export const InferredActBreaks = z.object({
  starts: z.array(InferredActStart).min(1),
})
export type InferredActBreaks = z.infer<typeof InferredActBreaks>

// §7 parse_script stage 2
const SegmentedSceneBeat = z.object({
  kind: z.literal('beat'),
  startLine: z.number().int().min(1),
  whatHappens: z.string(),
  audienceLearns: z.string(),
  audienceFeels: z.string(),
})

const SegmentedSceneUnassigned = z.object({
  kind: z.literal('unassigned'),
  startLine: z.number().int().min(1),
  reason: z.string(),
})

export const SegmentedScene = z.object({
  segments: z.array(z.union([SegmentedSceneBeat, SegmentedSceneUnassigned])),
  // Scene-level craft fields, defaulted so a pre-0.41.0 response still parses.
  //
  // These ride along with segmentation rather than getting their own pass:
  // this call already reads the whole scene to find beat boundaries, so a
  // scene-level reading is extra output on a call we are already paying for,
  // not another call. Import previously wrote "" into all four, so the Plan
  // inspector — the surface for editing a scene — was blank on every scene of
  // an imported script while the beats underneath were fully described.
  //
  // `socialSituation` is the one that cannot be rolled up from beats at all
  // (a beat says what happens, not what kind of occasion it is), which is why
  // this is a model field rather than a derivation.
  sceneWhatHappens: z.string().default(''),
  sceneAudienceLearns: z.string().default(''),
  sceneAudienceFeels: z.string().default(''),
  sceneSocialSituation: z.string().default(''),
})
export type SegmentedScene = z.infer<typeof SegmentedScene>

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
export type ConsistencyScan = z.infer<typeof ConsistencyScan>

// ─────────────────────────────────────────────────────────────────────────
// Storage (§3) — persisted-state envelope
//
// See the module-header note: Snapshot / SuggestionHistoryEntry / PersistedState
// are inferred from the §3 storage table's column list (not given as Zod in
// the doc) and are out of scope for the §1/§2/§2a CI schema diff. They exist
// solely so the fixture's full envelope can be validated on both sides.
// ─────────────────────────────────────────────────────────────────────────

export const Snapshot = z.object({
  id: Id,
  parentId: Id.nullable(),
  instruction: z.string(),
  doc: Project,
  ledger: z.array(LedgerFact),
  flags: z.array(ConsistencyFlag),
  ts: z.string().datetime(),
})
export type Snapshot = z.infer<typeof Snapshot>

export const SuggestionHistoryEntry = z.object({
  id: Id,
  projectId: Id,
  text: z.string(),
  // MVP: cosine similarity computed in Python (data contract §3). The fixture
  // never carries a populated entry, so the wire shape of the embedding blob
  // is not yet exercised by real data; modeled as a nullable numeric vector.
  embedding: z.array(z.number()).nullable().default(null),
})
export type SuggestionHistoryEntry = z.infer<typeof SuggestionHistoryEntry>

export const PersistedState = z.object({
  project: Project,
  ledger: z.array(LedgerFact),
  snapshots: z.array(Snapshot),
  consistencyFlags: z.array(ConsistencyFlag),
  changeSets: z.array(ChangeSet),
  suggestionHistory: z.array(SuggestionHistoryEntry),
})
export type PersistedState = z.infer<typeof PersistedState>
