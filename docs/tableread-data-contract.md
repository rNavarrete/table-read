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
});
// Ledger, snapshots, suggestionHistory live in separate stores (design doc §5).
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
  applyMode: z.enum(["regenerate", "flag_only"]), // server-annotated: scene/beat → regenerate; character/ledgerFact → flag_only (MVP has no machine-edit path for them)
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

export const ChangeSetPreview = z.object({
  beatUpdates: z.array(BeatUpdate),
  sceneUpdates: z.array(SceneUpdate),
  continuityConflicts: z.array(z.object({ factId: Id, objectId: Id, explanation: z.string() })),
  basedOnSnapshotId: Id,              // head at preview time; apply 409s (PREVIEW_STALE) if head moved
  generatedAt: z.string().datetime(),
});

export const ChangeSet = z.object({
  id: Id, projectId: Id,
  instruction: z.string(),            // the edit that triggered it
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

// §6 suggest_instructions
export const InstructionSuggestions = z.object({
  suggestions: z.array(z.string()).length(3),
});

// §7 parse_script stage 2
export const SegmentedScene = z.object({
  beats: z.array(z.object({
    startLine: z.number().int().min(0), endLine: z.number().int().min(0),
    whatHappens: z.string(), audienceLearns: z.string(), audienceFeels: z.string(),
  })),
  unassigned: z.array(z.object({
    startLine: z.number().int().min(0), endLine: z.number().int().min(0),
    reason: z.string(),
  })),
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
- Undo at root → 409 `VALIDATION` ("nothing to undo").

## 4. API contract (FastAPI, `/api/v1`)

**Projects**

- `POST /projects` `{title, format, premise}` → `Project` — in one transaction: creates the project (minimal bible scaffolded) **and its root snapshot** (`parent_id: null`, `doc` = initial state, `ledger` = `[]`, `flags` = `[]`), setting `headSnapshotId` to it. `headSnapshotId` is therefore never null after creation — previews, undo, and forks always have an anchor. (Undo at root still 409s: the root has no parent.)
- `GET /projects/{pid}` → `Project`
- `PATCH /projects/{pid}` — JSON-patch body for direct writer edits (no regeneration); creates snapshot. Patches touching **structural plan fields** (scene/episode `whatHappens`, `premise`, storyline summaries) additionally trigger `scan_consistency` and return `{project, consistencyFlags}` — the "Save field only" path skips Review, never the flagging promise. Patches into locked ranges → 409 `LOCKED_OBJECT`.
- `POST /projects/{pid}/undo` → `Project` (moves head to parent snapshot)
- `POST /projects/{pid}/import` `{format: "fountain"|"text", content}` → `{project, newFacts, consistencyFlags}` — full import transaction:
  1. Deterministic scene split + LLM beat segmentation (prompt spec §7); `VALIDATION` reject on coverage failure, nothing persisted.
  2. Run `extract_ledger_facts` over every imported scene; **all import-derived facts are created `pending_review` regardless of confidence** (nobody has vouched for inferences over a whole script — the writer batch-reviews them in the Ledger queue).
  3. Run `scan_consistency` across the imported episode (initial sweep — imports can carry internal contradictions).
  4. One snapshot committing doc + ledger + flags together; partial failure rolls back all of it.
- `GET /projects/{pid}/export.fountain` → `text/plain`
- `DELETE /projects/{pid}` — purges every project-scoped row across **all six DB tables plus embeddings**: `projects`, `snapshots`, `ledger_facts`, `change_sets` (including stored previews — they contain generated script text and instructions), `consistency_flags`, `suggestion_history`, and the embedding blobs stored with suggestion history (privacy §7.1). One transaction; the purge test asserts zero remaining rows per table. ("All six DB tables plus embeddings" is the canonical phrasing — build plan and test plan use it verbatim.)

**Generation (Write mode)**

- `POST /projects/{pid}/scenes/{sid}/candidates` `{afterBeatId?, instruction?}` → **SSE stream**: events `candidate_start {index}`, `delta {text}` (provisional display only), `candidate_done {BeatCandidate}` (validated — card becomes actionable) or `candidate_failed {error}`, ×3, then `done`. Clients must not enable Accept/Tune before `candidate_done`.
- `POST /projects/{pid}/scenes/{sid}/candidates/tune` `{candidate: BeatCandidate, instruction}` → SSE, one candidate
- `POST /projects/{pid}/scenes/{sid}/beats` `{candidate: BeatCandidate, afterBeatId?}` — accept: inserts beat, snapshots, triggers ledger extraction + consistency scan → `{project, newFacts, contradictions, consistencyFlags}`. `newFacts` are policy-processed `LedgerFact`s (§5 policy applied server-side); each `contradictions[]` entry additionally carries `proposalId` — the id of the supersede-proposal fact the server created.

**Review mode**

- `POST /projects/{pid}/change-sets` `{targetObjectId, instruction}` → `ChangeSet` (runs classify_blast_radius; annotates locks server-side)
- `GET /projects/{pid}/change-sets?status=` → `ChangeSet[]` — list persisted Change Sets for the project (optional status filter; comma-separated values allowed, e.g. `draft,previewing` for the Review open picker). sessionStorage is cache only.
- `GET /change-sets/{cid}` → `ChangeSet` — fetch one persisted Change Set by id.
- `POST /change-sets/{cid}/preview` `{approvedObjectIds: []}` → `ChangeSet` — runs `regenerate_elements`, stores the result as the typed `preview` payload (`beatUpdates`/`sceneUpdates` with `basedOnSnapshotId` = current head), and renders `after` display snippets from it; does NOT mutate the project
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

- `POST /projects/{pid}/suggest` `{context: "scene"|"beat", targetId}` → `{suggestions: string[3]}`

**Error shape (all endpoints):** `{error: {code, message, details?}}`. Codes: `LOCKED_OBJECT`, `SCHEMA_INVALID_LLM` (after retry), `NOT_FOUND`, `VALIDATION`, `LLM_UNAVAILABLE`, `PREVIEW_STALE`, `CONFLICT_STALE_PROPOSAL`, `CONFLICT_STALE_HEAD`.

**Optimistic concurrency:** every project-mutating write (PATCH, accept, ledger confirm/reject/edit/batch, flag dismiss, import, undo, Change Set apply) goes through an atomic compare-and-swap on `projects.head_snapshot_id` (`UPDATE … WHERE head_snapshot_id = :expected`). Clients SHOULD send `If-Match: <headSnapshotId>` on those mutations; when present and stale, the server returns 409 `CONFLICT_STALE_HEAD` and persists nothing. When omitted, the server still CAS-guards against the head observed at read time so two concurrent writers that both loaded H cannot both commit children of H. Change Set apply additionally rejects when `preview.basedOnSnapshotId` ≠ current head (`PREVIEW_STALE` — re-preview required) before the CAS.

## 5. Pydantic mirror rules

- One module `schemas.py`, models named identically (`Beat`, `Scene`, `LedgerFact`, …).
- `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)`.
- Enums as Python `StrEnum` with identical values.
- CI: `scripts/check_contract.py` exports JSON Schema from both sides and diffs — **covering §1, §2, and the §2a LLM operation schemas**. It also regenerates the strict tool `input_schema`s from §2a and diffs them against the committed `config/tool_schemas/` directory, so a Zod change that would alter a tool schema is a visible, reviewable diff (and triggers the `make evals` requirement, same as a prompt edit).
