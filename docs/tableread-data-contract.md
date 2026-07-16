# Table Read Data Contract (MVP)

Single source of truth for types and API. Frontend uses the Zod definitions (generate TS types via `z.infer`); backend mirrors them in Pydantic. **A CI check diffs the two — any divergence fails the build.** Field names are camelCase on the wire; Pydantic uses `alias_generator=to_camel`.

## 1. Core types (Zod)

```ts
import { z } from "zod";

export const Id = z.string().min(1); // "scene-1", "beat-1-2", "fact-04", "char-marta"

export const ShowFormat = z.object({
  genre: z.enum(["drama", "comedy", "dramedy"]),
  runtimeMinutes: z.number().int().positive(),
  actCount: z.number().int().min(1).max(6),
  coldOpen: z.boolean(),
  tag: z.boolean(),
  serialization: z.number().min(0).max(1),
});

export const Character = z.object({
  id: Id, name: z.string(), locked: z.boolean().default(false),
  // Alternate names/nicknames the script uses for this character. Populated
  // by infer_story_entities (§2a) at import time and used to resolve knownBy
  // strings and later mentions against the right character. Defaults to []
  // so pre-existing docs validate.
  aliases: z.array(z.string()).default([]),
  embodiment: z.string(), presentation: z.string(), hiding: z.string(),
  traits: z.string(), seriesArc: z.string(),
});

export const Relationship = z.object({
  between: z.tuple([Id, Id]), label: z.string(),
  reallyLike: z.string(), locked: z.boolean().default(false),
});

export const SeriesBible = z.object({
  existentialQuestion: z.object({ text: z.string(), locked: z.boolean().default(false) }),
  worldRules: z.array(z.object({ text: z.string(), locked: z.boolean().default(false) })),
  storiesToAvoid: z.array(z.string()),
  characters: z.array(Character),
  relationships: z.array(Relationship),
  audienceGoals: z.array(z.string()),
  narratorGoals: z.array(z.string()),
  worldQA: z.array(z.object({ q: z.string(), a: z.string(), locked: z.boolean().default(false) })),
});

export const Motivation = z.object({
  characterId: Id, objective: z.string(), stakes: z.string(), obstacle: z.string(),
});

export const Beat = z.object({
  id: Id, index: z.number().int().min(0), locked: z.boolean().default(false),
  whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string(),
  scriptText: z.string().default(""), scriptLocked: z.boolean().default(false),
});

export const Scene = z.object({
  id: Id, index: z.number().int().min(0),
  act: z.number().int().min(0),            // 0 = cold open
  storyline: z.enum(["A", "B", "C"]).default("A"), // present in schema; UI tagging is v2
  locked: z.boolean().default(false),
  location: z.string(), time: z.string(), socialSituation: z.string(),
  whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string(),
  motivations: z.array(Motivation),
  beats: z.array(Beat),
});

export const Episode = z.object({
  id: Id, index: z.number().int().min(0), locked: z.boolean().default(false),
  title: z.string(), premise: z.string(), seasonFunction: z.string().default(""),
  storylines: z.array(z.object({ id: z.enum(["A","B","C"]), summary: z.string(), characterIds: z.array(Id) })),
  scenes: z.array(Scene),
});

export const Season = z.object({
  id: Id, index: z.number().int().min(0), locked: z.boolean().default(false),
  seasonArc: z.string().default(""),
  characterArcs: z.array(z.object({ characterId: Id, arc: z.string(), locked: z.boolean().default(false) })),
  episodes: z.array(Episode), // MVP: exactly one
});

export const SourceSpan = z.object({
  episodeId: Id, sceneId: Id, beatId: Id,
  // Offsets within the beat's scriptText. Lines are model-reported (input is
  // line-numbered); char offsets are computed server-side by locating
  // sourceText verbatim within the line range (disambiguates duplicates).
  startLine: z.number().int().min(0).nullable().default(null),
  endLine: z.number().int().min(0).nullable().default(null),
  charStart: z.number().int().min(0).nullable().default(null),
  charEnd: z.number().int().min(0).nullable().default(null),
});

export const LedgerFact = z.object({
  id: Id,
  fact: z.string(),
  factType: z.enum(["event", "state", "knowledge", "relationship", "world_rule"]),
  sourceSpan: SourceSpan,
  sourceText: z.string().default(""), // verbatim quote from the establishing beat; server-verified
  knownBy: z.array(Id),
  audienceKnows: z.boolean().default(true), // distinct from knownBy — dramatic irony lives in the gap
  provenance: z.enum(["inferred", "writer_confirmed", "writer_authored"]),
  confidence: z.number().min(0).max(1),
  status: z.enum(["active", "superseded", "stale", "pending_review", "rejected"]),
  supersedes: Id.nullable(), supersededBy: Id.nullable(),
});

export const Project = z.object({
  id: Id, title: z.string(),
  format: ShowFormat,
  enabledComponents: z.array(z.string()),
  premise: z.string(),
  seriesBible: SeriesBible,
  seasons: z.array(Season),
  headSnapshotId: Id.nullable(),
  /** Adoption A3 — per-project default for Write/Review craft pickers. */
  defaultCraftLevel: z.enum(["fast", "standard", "considered"]).default("standard"),
});
// Ledger, snapshots, suggestionHistory live in separate stores (design doc §5).

export const ProjectSummary = z.object({
  id: Id,
  title: z.string(),
  format: ShowFormat,
  updatedAt: z.string().datetime(),
  pendingReviewCount: z.number().int().min(0),
  setupState: z.enum(["incomplete", "ready"]),
});

export const CharacterSeed = z.object({
  name: z.string().min(1),
  traits: z.string().nullable().default(null),
});

export const ProjectFoundationInput = z.object({
  existentialQuestion: z.string().nullable().default(null),
  storiesToAvoid: z.array(z.string()).nullable().default(null),
  characters: z.array(CharacterSeed).nullable().default(null),
});

export const ProjectCreateRequest = z.object({
  title: z.string(),
  format: ShowFormat,
  premise: z.string(),
  foundation: ProjectFoundationInput.nullable().default(null),
});

// §9.3 atomic create-and-import: project basics (no `foundation`) plus the
// script source. `premise` is optional (the import wizard has no premise step).
export const ProjectImportCreateRequest = z.object({
  title: z.string(),
  format: ShowFormat,
  premise: z.string().nullable().default(null),
  source: z.object({
    format: z.enum(["fountain", "text"]),
    content: z.string(),
  }),
});

export const PdfExtractMethod = z.enum(["text_layer", "ocr"]);

export const PdfExtractResult = z.object({
  text: z.string(),
  method: PdfExtractMethod,
  pageCount: z.number().int().positive(),
  warnings: z.array(z.string()),
});
```

## 2. Generation / Review types

```ts
export const BeatCandidate = z.object({
  label: z.string().max(40),
  beatPlan: z.object({ whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string() }),
  scriptText: z.string(),
  continuityConflicts: z.array(z.object({ factId: Id, explanation: z.string() })),
});

export const ImpactedObject = z.object({
  objectType: z.enum(["scene", "beat", "character", "ledgerFact"]),
  objectId: Id,
  // server-annotated: scene/beat → regenerate; character/ledgerFact →
  // flag_only (MVP has no machine-edit path for them); `add` is the §9.4
  // initial_scene_skeleton variant, where objectId is a proposalId, not a
  // final scene id.
  applyMode: z.enum(["regenerate", "flag_only", "add"]),
  reason: z.string(),
  confidence: z.enum(["high", "speculative"]),
  locked: z.boolean(),          // server-annotated; locked rows render disabled
  before: z.string(),           // rendered snippet
  after: z.string().nullable(), // null until regeneration preview exists; always null for flag_only
  continuityFlags: z.array(z.object({ factId: Id, explanation: z.string() })),
  approved: z.boolean().default(false), // only meaningful for applyMode "regenerate"
});

export const ConsistencyFlag = z.object({
  id: Id,
  objectType: z.enum(["scene", "beat"]),
  objectId: Id,                 // an untouched object
  factId: Id.nullable(),
  explanation: z.string(),
  severity: z.enum(["contradiction", "tension"]),
  status: z.enum(["open", "dismissed", "resolved"]),
  sourceChange: Id,             // the ChangeSet or accepted-beat snapshot that triggered the scan
});

// §9.3 atomic create-and-import result — same shape as the existing
// `POST /projects/{pid}/import` response, returned as the SSE stream's
// terminal `complete` payload.
export const ProjectImportResult = z.object({
  project: Project,
  newFacts: z.array(LedgerFact),
  consistencyFlags: z.array(ConsistencyFlag),
});

// Named import progress stages (§7 step 4), in emission order. `inferring_entities`
// (§2a infer_story_entities/§5a) runs between act inference and fact extraction.
export const ProjectImportStageName = z.enum([
  "parsing_scenes", "segmenting_beats", "inferring_acts", "inferring_entities",
  "extracting_facts", "checking_consistency", "saving",
]);

// §9.3 SSE progress: `stage` events announce each named stage, `progress`
// events report monotonic item counts within a stage (`done <= total`), then
// exactly one terminal `complete` or `failed`. `error` matches the
// canonical `{code, message, details?}` envelope.
export const ProjectImportProgressEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), name: ProjectImportStageName }),
  z.object({
    type: z.literal("progress"),
    stage: ProjectImportStageName,
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("complete"), result: ProjectImportResult }),
  z.object({
    type: z.literal("failed"),
    error: z.object({
      code: z.string(), message: z.string(), details: z.unknown().nullable().default(null),
    }),
  }),
]);

// Exact, typed preview content — what apply actually writes. `ImpactedObject.after`
// is only the rendered display snippet; this is the source of truth.
export const BeatUpdate = z.object({
  beatId: Id,
  beatPlan: z.object({ whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string() }).nullable(),
  scriptText: z.string().nullable(),  // null = field unchanged
});

export const SceneUpdate = z.object({
  sceneId: Id,
  fields: z.object({
    whatHappens: z.string().nullable(), audienceLearns: z.string().nullable(),
    audienceFeels: z.string().nullable(), location: z.string().nullable(),
    time: z.string().nullable(), socialSituation: z.string().nullable(),
  }), // null = field unchanged
});

// §9.4 initial scene skeleton — guided-setup scene-addition Change Set. MVP
// defers storyline inference, so every addition carries storyline "A"
// (Scene's own default). `proposalId` is the server-assigned selection
// handle — never the final scene id — minted once generation validates the
// model's scene list (§2a InitialSceneSkeleton below).
export const SceneAddition = z.object({
  proposalId: Id,
  act: z.number().int().min(0),
  storyline: z.enum(["A"]).default("A"),
  location: z.string(), time: z.string(), socialSituation: z.string(),
  whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string(),
  motivations: z.array(Motivation), // characterId references existing Characters
  beatPlanSeeds: z.array(z.object({
    whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string(),
  })), // ordered; apply mints beat ids/scriptText: "" server-side
});

// One generated skeleton option: the writer compares three of these side by
// side, then selects one to create a Change Set.
export const InitialSceneSkeletonCandidate = z.object({
  candidateId: Id,
  basedOnSnapshotId: Id, // the headSnapshotId this candidate was generated against
  label: z.string().max(40),
  scenes: z.array(SceneAddition), // ordered
});

export const ChangeSetPreview = z.object({
  beatUpdates: z.array(BeatUpdate),
  sceneUpdates: z.array(SceneUpdate),
  continuityConflicts: z.array(z.object({ factId: Id, objectId: Id, explanation: z.string() })),
  basedOnSnapshotId: Id,              // head at preview time; apply 409s (PREVIEW_STALE) if head moved
  generatedAt: z.string().datetime(),
  // §9.4 initial_scene_skeleton variant: the chosen candidate's scene
  // additions, verbatim. Null for the ordinary "edit" ChangeSet kind.
  sceneAdditions: z.array(SceneAddition).nullable().default(null),
});

// "edit" — the classify_blast_radius / regenerate_elements flow above.
// "initial_scene_skeleton" — guided-setup scene additions (§9.4): selecting
// a candidate creates the Change Set already `previewing` (the candidate
// IS the preview; no further model call).
export const ChangeSetKind = z.enum(["edit", "initial_scene_skeleton"]);

export const ChangeSet = z.object({
  id: Id, projectId: Id,
  kind: ChangeSetKind.default("edit"),
  instruction: z.string(),            // the edit that triggered it (or a generated label for initial_scene_skeleton)
  targetObjectId: Id,
  impacted: z.array(ImpactedObject),
  preview: ChangeSetPreview.nullable(), // null until POST /preview succeeds
  status: z.enum(["draft", "previewing", "applied", "discarded", "flagged"]),
  createdAt: z.string().datetime(),
});
```

## 2a. LLM operation schemas (tool outputs — also live in `packages/contract`)

These are the structured-output types for every Drama Manager operation in the prompt spec. They live in the same `packages/contract` module, are mirrored in Pydantic, are included in the CI schema diff, and are the source from which strict tool `input_schema`s are generated (`z.toJSONSchema`). **Implementations must not define op schemas anywhere else.** Server-side annotations (e.g., `ImpactedObject.applyMode`/`locked`, `LedgerFact.provenance`/`status`, `ConsistencyFlag.id`/`status`) are deliberately absent here — the model never sets them.

```ts
// §1/§2 generate_beat_candidates, tune_beat → BeatCandidate (defined in §2 above)

// §3 classify_blast_radius
export const BlastRadius = z.object({
  impacted: z.array(z.object({
    objectType: z.enum(["scene", "beat", "character", "ledgerFact"]),
    objectId: Id,
    reason: z.string(),
    confidence: z.enum(["high", "speculative"]),
  })),
});

// §4 regenerate_elements — reuses BeatUpdate/SceneUpdate from §2, so the
// model's output IS the ChangeSetPreview payload shape (no translation layer).
export const RegeneratedElements = z.object({
  beats: z.array(BeatUpdate),
  scenes: z.array(SceneUpdate),
  continuityConflicts: z.array(z.object({ factId: Id, objectId: Id, explanation: z.string() })),
});

// §9.4 generate_scene_skeleton — the guided-setup convergent loop calls this
// 3x (drama_manager/scene_skeleton.py). The model emits no ids and no
// scriptText; the server assigns each scene a proposalId and stamps
// storyline "A" after validation, producing a SceneAddition (§2 above) per
// scene.
export const InitialSceneSkeleton = z.object({
  label: z.string().max(40),
  scenes: z.array(z.object({
    act: z.number().int().min(0),
    location: z.string(), time: z.string(), socialSituation: z.string(),
    whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string(),
    motivations: z.array(Motivation),
    beatPlanSeeds: z.array(z.object({
      whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string(),
    })),
  })),
});

// §5 extract_ledger_facts — model span has lines only; char offsets are computed server-side.
export const ExtractedFact = z.object({
  fact: z.string(),
  factType: z.enum(["event", "state", "knowledge", "relationship", "world_rule"]),
  sourceSpan: z.object({
    episodeId: Id, sceneId: Id, beatId: Id,
    startLine: z.number().int().min(0), endLine: z.number().int().min(0),
  }),
  sourceText: z.string(),
  knownBy: z.array(Id),
  audienceKnows: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export const LedgerExtraction = z.object({
  newFacts: z.array(ExtractedFact),
  contradictions: z.array(z.object({
    existingFactId: Id,
    explanation: z.string(),
    proposedReplacement: z.string().nullable(),
  })),
});

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
});
export const InferredCharacter = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  role: z.enum(["principal", "supporting", "minor"]),
  traits: z.string(), // one line, may be ""
  evidence: z.array(EntityEvidence).min(1),
});
export const InferredRelationship = z.object({
  betweenNames: z.tuple([z.string(), z.string()]),
  label: z.string(),
  reallyLike: z.string(), // may be ""
  evidence: z.array(EntityEvidence).min(1),
});
export const InferredWorldElement = z.object({
  kind: z.enum(["location", "object"]),
  name: z.string(),
  note: z.string(), // one line, may be ""
  evidence: z.array(EntityEvidence).min(1),
});
export const StoryEntities = z.object({
  characters: z.array(InferredCharacter),
  relationships: z.array(InferredRelationship),
  worldElements: z.array(InferredWorldElement),
});

// §6 suggest_instructions
export const InstructionSuggestions = z.object({
  suggestions: z.array(z.string()).length(3),
});

// §7 import act inference
const InferredActStart = z.object({
  act: z.number().int().min(0),
  startSceneIndex: z.number().int().min(0),
});
export const InferredActBreaks = z.object({
  starts: z.array(InferredActStart).min(1),
});
// Bounds that depend on the selected format and parsed scene count are server
// validated, not encoded in this static operation schema. Starts must begin at
// scene 0 and strictly increase by both act and scene index. Valid acts are
// 0...actCount when coldOpen is true, otherwise 0...(actCount - 1). Omitted
// acts are empty sections; the server expands accepted starts into exactly one
// act assignment for every parsed scene.

// §7 parse_script stage 2
const SegmentedSceneBeat = z.object({
  kind: z.literal("beat"), startLine: z.number().int().min(1),
  whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string(),
});
const SegmentedSceneUnassigned = z.object({
  kind: z.literal("unassigned"), startLine: z.number().int().min(1),
  reason: z.string(),
});
export const SegmentedScene = z.object({
  segments: z.array(z.union([SegmentedSceneBeat, SegmentedSceneUnassigned])),
});

// §8c scan_consistency
export const ConsistencyScan = z.object({
  flags: z.array(z.object({
    objectType: z.enum(["scene", "beat"]),
    objectId: Id,
    factId: Id.nullable(),
    explanation: z.string(),
    severity: z.enum(["contradiction", "tension"]),
  })),
});
```

## 3. Storage (SQLite via SQLAlchemy, MVP)

| Table | Notes |
|---|---|
| `projects` | `id`, `doc` (JSON, the canonical `Project`), `head_snapshot_id`, timestamps |
| `snapshots` | `id`, `project_id`, `parent_id`, `instruction`, **`doc` (full materialized project JSON)**, **`ledger` (full materialized `LedgerFact[]`)**, **`flags` (full materialized `ConsistencyFlag[]`)**, `ts`. Append-only |
| `ledger_facts` | one row per fact, columns matching `LedgerFact` |
| `change_sets` | `id`, `project_id`, `doc` (JSON `ChangeSet`), `status` |
| `suggestion_history` | `id`, `project_id`, `text`, `embedding` (blob, MVP: cosine in Python) |
| `consistency_flags` | one row per flag, columns matching `ConsistencyFlag` |

**Snapshot semantics (MVP: materialized, not deltas).** Undo must restore a *consistent world*, not just the script — a beat's ledger facts and consistency flags cannot outlive the beat. Each snapshot therefore stores **all project-scoped versioned state**: the complete project JSON, the complete ledger fact list, and all consistency flags as of that point. A single-episode doc plus ledger is still tens of KB, so simplicity wins over storage; forward+inverse patch compression is a v2 optimization behind the same interface.

Versioned together (in the snapshot): `doc`, `ledger_facts`, `consistency_flags`. **Deliberately not versioned:** `suggestion_history`/embeddings (dedup memory — harmless across undo) and `change_sets` (drafts reference `basedOnSnapshotId`; after undo, a stale draft's apply is already rejected by `PREVIEW_STALE`, and the UI labels it "based on an earlier version").

Defined transactions:

- **Mutation:** in one transaction — write new snapshot row (`parent_id` = current head; `doc`, `ledger`, `flags` = new state), set `projects.doc` + rewrite `ledger_facts` + `consistency_flags` tables to the new state, set `head_snapshot_id` = new snapshot id.
- **Undo:** in one transaction — read parent snapshot of current head, restore `projects.doc`, `ledger_facts`, and `consistency_flags` byte-identical from it, set `head_snapshot_id` = parent id. No new snapshot row; a subsequent mutation forks the tree (its `parent_id` is the restored snapshot).
- **Restore to ancestor** (adoption A5): same transaction as undo, but the target may be any *proper* ancestor of the current head (walk `parent_id` toward root). Non-ancestor / current head / missing → 409 `VALIDATION`. No new snapshot row; later mutations fork from the restored head. Snapshot `instruction` must be non-empty on every write (`EmptyInstruction` if blank/whitespace).
- Undo at root → 409 `VALIDATION` ("nothing to undo").

## 4. API contract (FastAPI, `/api/v1`)

**Projects**

- `GET /projects` -> `ProjectSummary[]` sorted by `updatedAt` descending. `pendingReviewCount` counts Ledger facts with `status: "pending_review"`. `setupState` is `"ready"` iff the project has at least one scene containing at least one beat; otherwise `"incomplete"`. Summaries must not include full writer text fields such as `premise` or `seasons`.
- `POST /projects` `ProjectCreateRequest` with required `Idempotency-Key` header → `Project` — in one transaction: creates the project (minimal bible scaffolded, plus optional writer-supplied foundation) **and its root snapshot** (`parent_id: null`, `doc` = initial state, `ledger` = `[]`, `flags` = `[]`), setting `headSnapshotId` to it. `headSnapshotId` is therefore never null after creation — previews, undo, and forks always have an anchor. Character seeds contain no IDs; the server assigns `char-*`, sets `locked: false`, maps supplied `traits` or `""`, initializes `aliases` to `[]`, and initializes `embodiment`, `presentation`, `hiding`, and `seriesArc` to `""`. Project creation performs no LLM call. Same idempotency key + same canonical request hash replays the 201 response; same key + different hash returns 409 `IDEMPOTENCY_CONFLICT`; failed transactions persist no key.
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
- `POST /projects/import` `ProjectImportCreateRequest` with required `Idempotency-Key` header → **SSE** (§9.3 atomic create-and-import — the import-wizard analogue of `POST /projects` above): reuses the same parse/import pipeline as `POST /projects/{pid}/import`, but creates the project **and** its imported state in one DB transaction — every LLM/parsing stage that can fail runs before that single write, never an empty root followed by an import child. Events: `stage {type: "stage", name}` announces each named stage in order (`parsing_scenes`, `segmenting_beats`, `inferring_acts`, `inferring_entities`, `extracting_facts`, `checking_consistency`, `saving`); `progress {type: "progress", stage, done, total}` may appear after a stage starts to report monotonic item progress within that stage, with `0 <= done <= total`. Scene progress is emitted for `segmenting_beats` and `extracting_facts`; the singleton `inferring_acts` stage emits no per-scene progress. Example frames include `event: progress` / `data: {"type":"progress","stage":"segmenting_beats","done":2,"total":3}` while segmenting scenes and `event: progress` / `data: {"type":"progress","stage":"extracting_facts","done":2,"total":3}` while extracting facts. The stream then emits exactly one terminal `complete {type: "complete", result: ProjectImportResult}` or `failed {type: "failed", error}`. `ProjectImportResult` is `{project, newFacts, consistencyFlags}` — the same shape `POST /projects/{pid}/import` returns. Idempotency mirrors `POST /projects`: a hash conflict is rejected with a plain 409 `IDEMPOTENCY_CONFLICT` JSON response *before* the stream opens (never a mid-stream surprise); a same-key/same-hash replay opens a stream whose only frame is the terminal `complete` with the original result; a failed transaction leaves no key, so a retry with the same key runs normally.
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
- Apply/discard/flag reuse the existing `POST /change-sets/{cid}/apply|discard|flag` below. For this Change Set kind, `approvedObjectIds` are proposal ids; apply mints the final `scene-*`/`beat-*` ids for the approved subset (in the candidate's original order), inserts them into the project's single episode (scaffolding `season-1`/`ep-1` if the project has none yet), and writes exactly one snapshot — no `regenerate_elements`/extraction/scan calls (there is no existing content to regenerate and no script text yet to extract facts from). Routes through the same lock guard as every other apply path: a locked episode → 409 `LOCKED_OBJECT`, zero mutation. `POST /change-sets/{cid}/preview` 409s `VALIDATION` for this kind (the selected candidate already *is* the preview).

**Review mode**

- `POST /projects/{pid}/change-sets` `{targetObjectId, instruction}` → `ChangeSet` (runs classify_blast_radius; annotates locks server-side)
- `GET /projects/{pid}/change-sets?status=` → `ChangeSet[]` — list persisted Change Sets for the project (optional status filter; comma-separated values allowed, e.g. `draft,previewing` for the Review open picker). sessionStorage is cache only.
- `GET /change-sets/{cid}` → `ChangeSet` — fetch one persisted Change Set by id.
- `POST /change-sets/{cid}/preview` `{approvedObjectIds: [], craftLevel?}` → `ChangeSet` — runs `regenerate_elements`, stores the result as the typed `preview` payload (`beatUpdates`/`sceneUpdates` with `basedOnSnapshotId` = current head), and renders `after` display snippets from it; does NOT mutate the project. `craftLevel: "considered"` runs a second polish regenerate (adoption A3); `fast`/`standard` are a single pass.
- `POST /change-sets/{cid}/apply` `{approvedObjectIds: []}` → `{project, changeSet, consistencyFlags}` — **applies the stored `preview` payload verbatim** (never reruns the model, never parses snippets), filtered to approved ids; snapshots, re-extracts ledger, runs `scan_consistency` over untouched scenes. 409s: any locked or `flag_only` id in the list; `preview` is null; `preview.basedOnSnapshotId` ≠ current head (`PREVIEW_STALE` — re-preview required); any approved regenerate id that is **not** present in the stored preview's `beatUpdates`/`sceneUpdates` (`VALIDATION` — apply ids must be a subset of the previewed set)
- `POST /change-sets/{cid}/discard` / `POST /change-sets/{cid}/flag`
- `GET /projects/{pid}/consistency-flags?status=open` → `ConsistencyFlag[]` · `POST /consistency-flags/{fid}/dismiss`

**Ledger mode**

- `GET /projects/{pid}/ledger?status=&characterId=` → `LedgerFact[]`
- `POST /ledger/{factId}/confirm` | `/reject` | `PATCH /ledger/{factId}` (edit text and/or knownBy → provenance becomes `writer_authored`; if the fact was `pending_review`, status also becomes `active` so it leaves the review queue)
- `POST /projects/{pid}/ledger/batch` `{confirmIds: [], rejectIds: []}` → `{ledger}` — batch review (import queue); supersede-proposal semantics apply per id; **one snapshot for the whole batch**; any invalid id fails the entire batch (400, nothing applied)

**Ledger mutations are versioned mutations.** Confirm, reject, edit, and batch all run the standard snapshot transaction (§3 — ledger is snapshot-versioned state), so every ledger action is undoable via `POST /undo` like any other change.

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
