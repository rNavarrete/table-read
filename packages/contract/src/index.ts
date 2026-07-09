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
  embodiment: z.string(),
  presentation: z.string(),
  hiding: z.string(),
  traits: z.string(),
  seriesArc: z.string(),
})
export type Character = z.infer<typeof Character>

export const Relationship = z.object({
  between: z.tuple([Id, Id]),
  label: z.string(),
  reallyLike: z.string(),
  locked: z.boolean().default(false),
})
export type Relationship = z.infer<typeof Relationship>

export const SeriesBible = z.object({
  existentialQuestion: z.object({
    text: z.string(),
    locked: z.boolean().default(false),
  }),
  worldRules: z.array(
    z.object({ text: z.string(), locked: z.boolean().default(false) }),
  ),
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

export const Motivation = z.object({
  characterId: Id,
  objective: z.string(),
  stakes: z.string(),
  obstacle: z.string(),
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
})
export type LedgerFact = z.infer<typeof LedgerFact>

export const Project = z.object({
  id: Id,
  title: z.string(),
  format: ShowFormat,
  enabledComponents: z.array(z.string()),
  premise: z.string(),
  seriesBible: SeriesBible,
  seasons: z.array(Season),
  headSnapshotId: Id.nullable(),
})
export type Project = z.infer<typeof Project>
// Ledger, snapshots, suggestionHistory live in separate stores (design doc §5).

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
  applyMode: z.enum(['regenerate', 'flag_only']), // server-annotated: scene/beat → regenerate; character/ledgerFact → flag_only (MVP has no machine-edit path for them)
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

export const ChangeSetPreview = z.object({
  beatUpdates: z.array(BeatUpdate),
  sceneUpdates: z.array(SceneUpdate),
  continuityConflicts: z.array(
    z.object({ factId: Id, objectId: Id, explanation: z.string() }),
  ),
  basedOnSnapshotId: Id, // head at preview time; apply 409s (PREVIEW_STALE) if head moved
  generatedAt: z.string().datetime(),
})
export type ChangeSetPreview = z.infer<typeof ChangeSetPreview>

export const ChangeSet = z.object({
  id: Id,
  projectId: Id,
  instruction: z.string(), // the edit that triggered it
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

// §7 parse_script stage 2
export const SegmentedScene = z.object({
  beats: z.array(
    z.object({
      startLine: z.number().int().min(0),
      endLine: z.number().int().min(0),
      whatHappens: z.string(),
      audienceLearns: z.string(),
      audienceFeels: z.string(),
    }),
  ),
  unassigned: z.array(
    z.object({
      startLine: z.number().int().min(0),
      endLine: z.number().int().min(0),
      reason: z.string(),
    }),
  ),
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
