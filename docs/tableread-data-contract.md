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
})

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

// T7.19 — a narrative setup/payoff arc, MVP-scoped to the episode it lives
// on (non-goal: cross-episode threads). status is a single lifecycle
// label, not step tracking — an "open" thread may have only a setup;
// "paid_off" has a payoff span. Import mints ids and resolves ownerNames
// (see infer_narrative_promises §2a) to ownerCharacterIds server-side.

// T7.27 — episode story overview (logline, scene outline, named beat sheet,
// two-paragraph synopsis). Import fills via infer_story_overview; model never
// mints ids. Defaults to null so pre-existing docs validate.
export const StoryOverviewOutlineItem = z.object({
  sceneId: Id,
  summary: z.string(),
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
  provenance: z.enum(['inferred', 'writer_authored']).default('inferred'),
  locked: z.boolean().default(false),
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
export const ThreadMovement = z.object({
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
  provenance: z.enum(['inferred', 'writer_authored']).default('inferred'),
  locked: z.boolean().default(false),
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
  // Server-derived on merge (the model supplies neither): the beat each quote
  // was found in. A quote is stored only if it appears verbatim in the scene it
  // cites, is substantive enough to be evidence (a bare character cue or a
  // fragment is not), and is not reused by another claim. Otherwise the quote
  // is cleared and the beat id left null — "no evidence offered" is true, while
  // a plausible-looking citation reads as corroboration and is not.
  setupBeatId: Id.nullable().default(null),
  payoffBeatId: Id.nullable().default(null),
  locked: z.boolean().default(false),
})

// A StoryThread's shape applied to concealment: established -> revealed
// rather than setup -> paid off. What it adds is the asymmetry a thread has
// no room for — who holds it and who is kept in the dark. A fact everyone
// knows is not a secret, and `knownBy` alone cannot say whether the gap is
// deliberate. `factId` links the concealed LedgerFact when one exists, so the
// secret never becomes a second, drifting copy of the truth.
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
      id: z.enum(['A', 'B', 'C']),
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
  // T7.32 evidence-grounded structural map — null when not yet inferred.
  narrativeMap: NarrativeMap.nullable().default(null),
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
  // sourceText verbatim within the line range (disambiguates duplicates).
  startLine: z.number().int().min(0).nullable().default(null),
  endLine: z.number().int().min(0).nullable().default(null),
  charStart: z.number().int().min(0).nullable().default(null),
  charEnd: z.number().int().min(0).nullable().default(null),
})

// §5c infer_story_overview (T7.27) — episode logline / outline / beat sheet /
// two-paragraph synopsis. outline.sceneId and beatSheet.beatId must name
// ids from the imported partition; server drops unknowns and sets
// provenance/locked on Episode.storyOverview.
export const InferredStoryOverview = z.object({
  logline: z.string(),
  outline: z.array(z.object({ sceneId: Id, summary: z.string() })),
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
// blocking list overrides an approval.
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
  format: ShowFormat,
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

// §9.3 SSE progress: `stage` events announce each named stage, `progress`
// events report monotonic item counts within a stage (`done <= total`), then
// exactly one terminal `complete` or `failed`. `error` matches the
// canonical `{code, message, details?}` envelope.
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
export const NarrativePromises = z.object({
  threads: z.array(
    z.object({
      label: z.string(),
      summary: z.string(),
      status: z.enum(['open', 'paid_off', 'abandoned']),
      ownerNames: z.array(z.string()),
      setupSceneId: Id,
      payoffSceneId: Id.nullable(),
      setupQuote: z.string(),
      payoffQuote: z.string(),
    }),
  ),
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
      establishedQuote: z.string(),
      revealedQuote: z.string(),
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
      evidenceQuote: z.string(),
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
})
// Bounds that depend on the selected format and parsed scene count are server
// validated, not encoded in this static operation schema. Starts must begin at
// scene 0 and strictly increase by both act and scene index. Valid acts are
// 0...actCount when coldOpen is true, otherwise 0...(actCount - 1). Omitted
// acts are empty sections; the server expands accepted starts into exactly one
// act assignment for every parsed scene.

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
- `PATCH /projects/{pid}` — JSON-patch body for direct writer edits (no regeneration); creates snapshot. Patches touching **structural plan fields** (scene/episode `whatHappens`, `premise`, storyline summaries) additionally trigger `scan_consistency` and return `{project, consistencyFlags}` — the "Save field only" path skips Review, never the flagging promise. Changing a scene's `act` is a non-text structural correction: it creates one normal snapshot but runs no LLM/extraction/consistency call. Patches into locked ranges, including a stale attempt to change a locked scene's act, → 409 `LOCKED_OBJECT`.
- `POST /projects/{pid}/undo` → `Project` (moves head to parent snapshot)
- `GET /projects/{pid}/snapshots` → `SnapshotSummary[]` (adoption A5) — up to 20 proper ancestors of the current head, nearest parent first. Each entry is `{id, instruction, ts}` for the undo-timeline dropdown. Does not include the current head.
- `POST /projects/{pid}/restore` `{snapshotId}` → `Project` (adoption A5) — restore doc+ledger+flags from that ancestor; same CAS/`If-Match` rules as undo. Non-ancestor or current head → 409 `VALIDATION`.
- `POST /projects/{pid}/import` `{format: "fountain"|"text", content}` → `{project, newFacts, consistencyFlags}` — full import transaction:
  1. Deterministic scene split + LLM typed segment-start proposal (prompt spec §7); the server derives a total line partition, optionally retries that scene once under the repair-quality gate, and persists a review flag for every repair in the selected attempt. Semantic start errors never drop/duplicate text or abort coverage.
  2. Run `infer_act_breaks` over compact scene summaries in source order; the model returns ordered `{act, startSceneIndex}` starts and the server validates format/scene bounds and derives a total partition with exactly one act per scene. Omitted valid acts remain empty. A semantic failure gets exactly one classifier retry with inert diagnostics; a second failure surfaces `SCHEMA_INVALID_LLM`, and the import persists nothing.
  3. Run `extract_ledger_facts` over every imported scene; **all import-derived facts are created `pending_review` regardless of confidence** (nobody has vouched for inferences over a whole script — the writer batch-reviews them in the Ledger queue).
  4. Run `scan_consistency` across the imported episode (initial sweep — imports can carry internal contradictions).
  5. One snapshot committing doc + ledger + flags together; partial failure rolls back all of it.
- `POST /projects/import/extract-pdf` multipart `file` (`application/pdf`) → `PdfExtractResult` — pre-project PDF extraction only. It creates no project, snapshot, ledger row, or idempotency record, and never calls the LLM. Text-layer extraction uses `pypdf`; OCR uses pypdfium2-rendered pages plus Tesseract. On success, the client treats the editable result as `source.format: "text"` for the existing create-and-import path. Response wire shape is `{text, method, pageCount, warnings}` where `method` is `"text_layer"` or `"ocr"`. Reject missing/non-PDF, oversize/page-cap, unreadable, or empty extraction with `{error: {code: "VALIDATION", message}}`; if Tesseract is unavailable when OCR is required, return `{error: {code: "UNAVAILABLE", message}}`.
- `POST /projects/import` `ProjectImportCreateRequest` with required `Idempotency-Key` header → **SSE** (§9.3 atomic create-and-import — the import-wizard analogue of `POST /projects` above): reuses the same parse/import pipeline as `POST /projects/{pid}/import`, but creates the project **and** its imported state in one DB transaction — every core LLM/parsing stage runs before that single write, never an empty root followed by an import child. Events: `stage {type: "stage", name}` announces each named stage in order (`parsing_scenes`, `segmenting_beats`, `inferring_acts`, `inferring_entities`, `inferring_promises`, `inferring_overview`, `extracting_facts`, `checking_consistency`, `saving`); `progress {type: "progress", stage, done, total}` may appear after a stage starts to report monotonic item progress within that stage, with `0 <= done <= total`. Scene progress is emitted for `segmenting_beats` and `extracting_facts`; singleton analysis stages emit no per-scene progress. The stream then emits exactly one terminal `complete {type: "complete", result: ProjectImportResult}` or `failed {type: "failed", error}`. `ProjectImportResult` is `{project, newFacts, consistencyFlags}` — the same shape `POST /projects/{pid}/import` returns. `POST /projects/{pid}/narrative-map` is an explicit, independent Sonnet 5 synthesis over the saved Opus analysis that writes a second snapshot; a timeout there never invalidates or re-runs the source import. Idempotency mirrors `POST /projects`: a hash conflict is rejected with a plain 409 `IDEMPOTENCY_CONFLICT` JSON response _before_ the stream opens (never a mid-stream surprise); a same-key/same-hash replay opens a stream whose only frame is the terminal `complete` with the original result; a failed transaction leaves no key, so a retry with the same key runs normally.
- `GET /projects/{pid}/export.fountain` → `text/plain`
- `GET /projects/{pid}/export.json` → `PersistedState` (adoption A6) — the full fixture-shaped envelope (`project`, `ledger`, `snapshots`, `consistencyFlags`, `changeSets`, `suggestionHistory`). Privacy §7.1 "export-everything"; Settings UI offers the download. Round-trip: export → purge → re-seed from export restores project doc and ledger byte-identical.
- `DELETE /projects/{pid}` — purges every project-scoped row across **all six DB tables plus embeddings**: `projects`, `snapshots`, `ledger_facts`, `change_sets` (including stored previews — they contain generated script text and instructions), `consistency_flags`, `suggestion_history`, and the embedding blobs stored with suggestion history (privacy §7.1). One transaction; the purge test asserts zero remaining rows per table. ("All six DB tables plus embeddings" is the canonical phrasing — build plan and test plan use it verbatim.)

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
- `POST /projects/{pid}/characters/{cid}/merge-into/{targetId}` → `{project, ledger}` — atomic, one snapshot: the target absorbs the source's `aliases` plus the source's own `name` as a new alias; every characterId reference is rewritten from source to target — ledger fact `knownBy`, relationship `between`, scene `motivations[].characterId`, season `characterArcs[].characterId`, and episode storyline `characterIds` — deduping the set-shaped fields so the rewrite never produces a duplicate id; a relationship the merge collapses into a self-pair (source and target were directly related) is dropped; the source character is removed. Merging a character into itself → 400 `VALIDATION`. Either side locked, or either id unknown, is rejected before any mutation (409 `LOCKED_OBJECT` / 404 `NOT_FOUND`).
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

**Error shape (all endpoints):** `{error: {code, message, details?}}`. Codes: `LOCKED_OBJECT`, `SCHEMA_INVALID_LLM` (after retry), `NOT_FOUND`, `VALIDATION`, `LLM_UNAVAILABLE`, `UNAVAILABLE`, `PREVIEW_STALE`, `CONFLICT_STALE_PROPOSAL`, `CONFLICT_STALE_HEAD`, `IDEMPOTENCY_CONFLICT`.

**Optimistic concurrency:** every project-mutating write (PATCH, accept, ledger confirm/reject/edit/batch, flag dismiss, import, undo, restore, Change Set apply) goes through an atomic compare-and-swap on `projects.head_snapshot_id` (`UPDATE … WHERE head_snapshot_id = :expected`). Clients SHOULD send `If-Match: <headSnapshotId>` on those mutations; when present and stale, the server returns 409 `CONFLICT_STALE_HEAD` and persists nothing. When omitted, the server still CAS-guards against the head observed at read time so two concurrent writers that both loaded H cannot both commit children of H. Change Set apply additionally rejects when `preview.basedOnSnapshotId` ≠ current head (`PREVIEW_STALE` — re-preview required) before the CAS.

## 5. Pydantic mirror rules

- One module `schemas.py`, models named identically (`Beat`, `Scene`, `LedgerFact`, …).
- `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)`.
- Enums as Python `StrEnum` with identical values.
- CI: `scripts/check_contract.py` exports JSON Schema from both sides and diffs — **covering §1, §2, and the §2a LLM operation schemas**. It also regenerates the strict tool `input_schema`s from §2a and diffs them against the committed `config/tool_schemas/` directory, so a Zod change that would alter a tool schema is a visible, reviewable diff (and triggers the `make evals` requirement, same as a prompt edit).
