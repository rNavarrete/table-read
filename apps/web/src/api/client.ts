import type {
  BeatCandidate,
  ChangeSet,
  ConsistencyFlag,
  CraftLevel,
  InitialSceneSkeletonCandidate,
  LedgerExtraction,
  LedgerFact,
  PdfExtractResult,
  Project,
  ProjectCreateRequest,
  ProjectSummary,
  SnapshotSummary,
  SuggestRequest,
} from 'contract'

import { toApiError } from './errors'

// Relative, not absolute: same-origin under the Vite dev proxy
// (vite.config.ts) in dev, and under whatever origin serves the built app
// alongside the api in later deployment. No CORS config needed either side.
const BASE = '/api/v1'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as T
}

type IfMatchOpts = { expectedHeadSnapshotId?: string | null }
type IdempotencyOpts = { idempotencyKey?: string }

function ifMatchHeaders(
  opts?: IfMatchOpts,
): Record<string, string> | undefined {
  if (!opts?.expectedHeadSnapshotId) return undefined
  return { 'If-Match': opts.expectedHeadSnapshotId }
}

function idempotencyHeaders(
  opts?: IdempotencyOpts,
): Record<string, string> | undefined {
  if (!opts?.idempotencyKey) return undefined
  return { 'Idempotency-Key': opts.idempotencyKey }
}

async function postJson<T>(
  path: string,
  body: unknown,
  opts?: IfMatchOpts & IdempotencyOpts,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...ifMatchHeaders(opts),
      ...idempotencyHeaders(opts),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as T
}

async function patchJson<T>(
  path: string,
  body: unknown,
  opts?: IfMatchOpts,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...ifMatchHeaders(opts),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as T
}

/** One RFC 6902 JSON Patch operation (data contract §4 `PATCH /projects/{pid}`;
 * applier: `apps/api/storage/patching.py`). Only `add`/`replace`/`remove` are
 * supported server-side — `move`/`copy`/`test` are rejected as 400
 * `VALIDATION`, so Plan mode's reorder (an index/act swap, not an array
 * move) is expressed as two or three `replace` ops, never `move`. */
export interface JsonPatchOp {
  op: 'add' | 'replace' | 'remove'
  path: string
  value?: unknown
}

/** `PATCH /projects/{pid}` result, normalized to a single shape. The endpoint
 * is polymorphic (data contract §4): a patch touching a **structural plan
 * field** (scene `whatHappens`, `premise`, storyline summaries) triggers
 * `scan_consistency` and returns `{project, consistencyFlags}`; every other
 * edit returns the bare `Project`. `patchProject` normalizes both to this — an
 * empty `consistencyFlags` for the silent case — so callers never branch on
 * the wire shape. */
export interface PatchResult {
  project: Project
  consistencyFlags: ConsistencyFlag[]
}

/** `PATCH /projects/{pid}` (data contract §4): direct writer edits, no
 * regeneration. Used by Plan mode for scene reorder, the scene/beat lock
 * toggles, and the inspector's per-field "Save" / "Save field only"
 * affordances — all single- or double-field `replace`/`add` ops built by
 * `plan/planTree.ts` against the caller's own in-memory `Project` (so
 * array-index JSON Pointers stay correct without a second fetch). Resolves to
 * the normalized {@link PatchResult}; a `LOCKED_OBJECT` 409 (a patch into a
 * locked range) surfaces as an `ApiError` the caller rolls back on. */
export async function patchProject(
  projectId: string,
  ops: JsonPatchOp[],
  opts?: IfMatchOpts,
): Promise<PatchResult> {
  // Optimistic concurrency: server 409s CONFLICT_STALE_HEAD if the live
  // head moved since the client last loaded the project.
  const body = await patchJson<Project | PatchResult>(
    `/projects/${projectId}`,
    ops,
    opts,
  )
  // Structural edits return {project, consistencyFlags}; other edits the bare
  // Project (which has no `project` key). Normalize to PatchResult.
  return 'project' in body
    ? { project: body.project, consistencyFlags: body.consistencyFlags }
    : { project: body, consistencyFlags: [] }
}

/** `POST /projects/{pid}/undo` — restore parent snapshot (409 at root). */
export function undoProject(
  projectId: string,
  opts?: IfMatchOpts,
): Promise<Project> {
  return postJson<Project>(`/projects/${projectId}/undo`, {}, opts)
}

/** `GET /projects/{pid}/snapshots` — restorable ancestors (adoption A5). */
export function listProjectSnapshots(
  projectId: string,
): Promise<SnapshotSummary[]> {
  return getJson<SnapshotSummary[]>(`/projects/${projectId}/snapshots`)
}

/** `POST /projects/{pid}/restore` — jump head to an ancestor snapshot. */
export function restoreProject(
  projectId: string,
  snapshotId: string,
  opts?: IfMatchOpts,
): Promise<Project> {
  return postJson<Project>(
    `/projects/${projectId}/restore`,
    { snapshotId },
    opts,
  )
}

/** `POST /projects/{pid}/suggest` — 3 contextual instruction chips (A4). */
export function suggestInstructions(
  projectId: string,
  body: SuggestRequest,
): Promise<{ suggestions: [string, string, string] }> {
  return postJson(`/projects/${projectId}/suggest`, body)
}

/** `GET /projects/{pid}/export.fountain` — Fountain teleplay text. */
export async function exportFountain(projectId: string): Promise<string> {
  const res = await fetch(`${BASE}/projects/${projectId}/export.fountain`)
  if (!res.ok) throw await toApiError(res)
  return res.text()
}

/** `GET /projects/{pid}/export.json` — full persisted-state envelope (A6). */
export async function exportProjectJson(projectId: string): Promise<object> {
  return getJson<object>(`/projects/${projectId}/export.json`)
}

export function getProject(projectId: string): Promise<Project> {
  return getJson<Project>(`/projects/${projectId}`)
}

export function listProjects(): Promise<ProjectSummary[]> {
  return getJson<ProjectSummary[]>('/projects')
}

/** `DELETE /projects/{pid}` (data contract §4) — the canonical full purge:
 * clears every project-scoped row across all six DB tables plus embeddings.
 * Resolves on 204; a non-2xx surfaces as an `ApiError` so the dashboard can
 * leave the row visible and report the failure (design spec §11). */
export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${BASE}/projects/${projectId}`, { method: 'DELETE' })
  if (!res.ok) throw await toApiError(res)
}

export function createProject(
  body: ProjectCreateRequest,
  opts: { idempotencyKey: string },
): Promise<Project> {
  return postJson<Project>('/projects', body, {
    idempotencyKey: opts.idempotencyKey,
  })
}

/** Endpoint URL for the atomic create-and-import SSE stream (data contract
 * §9.3: `POST /projects/import`). Streamed responses don't fit the
 * postJson helper above — write/api/sse.ts's `streamSse` POSTs here
 * directly, the same way write/sse.ts does for candidate generation. */
export function importCreateUrl(): string {
  return `${BASE}/projects/import`
}

export async function extractPdf(file: File): Promise<PdfExtractResult> {
  const form = new FormData()
  form.set('file', file)
  const res = await fetch(`${BASE}/projects/import/extract-pdf`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as PdfExtractResult
}

export function getLedger(
  projectId: string,
  opts?: { status?: string; characterId?: string },
): Promise<LedgerFact[]> {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.characterId) params.set('characterId', opts.characterId)
  const qs = params.toString()
  return getJson<LedgerFact[]>(
    `/projects/${projectId}/ledger${qs ? `?${qs}` : ''}`,
  )
}

/** `POST /ledger/{factId}/confirm` — pending_review → active / writer_confirmed. */
export function confirmLedgerFact(
  factId: string,
  opts?: IfMatchOpts,
): Promise<LedgerFact> {
  return postJson<LedgerFact>(`/ledger/${factId}/confirm`, {}, opts)
}

/** `POST /ledger/{factId}/reject` — pending_review → rejected (prompt-ineligible). */
export function rejectLedgerFact(
  factId: string,
  opts?: IfMatchOpts,
): Promise<LedgerFact> {
  return postJson<LedgerFact>(`/ledger/${factId}/reject`, {}, opts)
}

/** `PATCH /ledger/{factId}` — edit text/knownBy → writer_authored (and
 * activates pending_review per T5.1 accept). */
export function editLedgerFact(
  factId: string,
  body: { fact?: string; knownBy?: string[] },
  opts?: IfMatchOpts,
): Promise<LedgerFact> {
  return patchJson<LedgerFact>(`/ledger/${factId}`, body, opts)
}

/** `POST /projects/{pid}/ledger/batch` — one snapshot for the whole batch. */
export function batchLedgerReview(
  projectId: string,
  body: { confirmIds: string[]; rejectIds: string[] },
  opts?: IfMatchOpts,
): Promise<{ ledger: LedgerFact[] }> {
  return postJson<{ ledger: LedgerFact[] }>(
    `/projects/${projectId}/ledger/batch`,
    body,
    opts,
  )
}

/** `GET /projects/{pid}/consistency-flags?status=` (data contract §4). Plan
 * mode loads `status=open` with the board to drive amber scene-card badges
 * (UI spec §5). */
export function getConsistencyFlags(
  projectId: string,
  status?: 'open' | 'dismissed' | 'resolved',
): Promise<ConsistencyFlag[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  return getJson<ConsistencyFlag[]>(
    `/projects/${projectId}/consistency-flags${qs}`,
  )
}

/** `POST /consistency-flags/{fid}/dismiss` — versioned flag-only mutation.
 * Returns the dismissed flag; Plan badges clear once the open-flags list is
 * refreshed (or the id is removed from local state). */
export function dismissConsistencyFlag(
  flagId: string,
  opts?: IfMatchOpts,
): Promise<ConsistencyFlag> {
  return postJson<ConsistencyFlag>(
    `/consistency-flags/${flagId}/dismiss`,
    {},
    opts,
  )
}

/** One accept-response contradiction record: the contract's
 * `LedgerExtraction` contradiction shape plus the server-minted id of the
 * supersede proposal it created (drama_manager/ledger_policy.py). */
export type AcceptContradiction = LedgerExtraction['contradictions'][number] & {
  proposalId: string
}

/** `POST .../beats` response (data contract §4:
 * `{project, newFacts, contradictions, consistencyFlags}`), composed from
 * contract-exported types. `newFacts` is deliberately `LedgerFact[]`, not the
 * §2a `ExtractedFact[]`: the server applies the §5 ledger policy before
 * responding (ledger_policy.apply_extraction_policy mints `id`, sets
 * `provenance`/`status`, computes `charStart`/`charEnd`), so the wire carries
 * full persisted-fact dicts — apps/api/tests/test_accept.py asserts
 * `newFacts[0].status` / `.sourceSpan.charStart` directly. */
export interface AcceptResponse {
  project: Project
  newFacts: LedgerFact[]
  contradictions: AcceptContradiction[]
  consistencyFlags: ConsistencyFlag[]
}

/** `POST .../scenes/{sid}/beats` (data contract §4) — the only mutating,
 * non-streamed write-mode call. Everything else in write/ is read-only
 * (candidates) or SSE (candidates/tune). */
export function acceptBeat(
  projectId: string,
  sceneId: string,
  candidate: BeatCandidate,
  afterBeatId: string | null,
  opts?: IfMatchOpts,
): Promise<AcceptResponse> {
  return postJson<AcceptResponse>(
    `/projects/${projectId}/scenes/${sceneId}/beats`,
    {
      candidate,
      afterBeatId,
    },
    opts,
  )
}

/** Endpoint URL for the SSE candidate-generation stream (write/sse.ts POSTs
 * here directly — streamed responses don't fit the getJson/postJson helpers
 * above). */
export function candidatesUrl(projectId: string, sceneId: string): string {
  return `${BASE}/projects/${projectId}/scenes/${sceneId}/candidates`
}

/** Endpoint URL for the SSE tune stream (one candidate). */
export function tuneUrl(projectId: string, sceneId: string): string {
  return `${BASE}/projects/${projectId}/scenes/${sceneId}/candidates/tune`
}

/** `POST /projects/{pid}/change-sets` (data contract §4 / T4.1) — classify
 * blast radius, annotate locks / applyMode / before snippets, persist a draft
 * ChangeSet. Does not mutate the project doc. */
export function createChangeSet(
  projectId: string,
  body: { targetObjectId: string; instruction: string },
): Promise<ChangeSet> {
  return postJson<ChangeSet>(`/projects/${projectId}/change-sets`, body)
}

/** `GET /change-sets/{cid}` — source of truth for a Change Set (user ruling 3).
 * sessionStorage is only a warm cache after create; prefer this on Review load. */
export function getChangeSet(changeSetId: string): Promise<ChangeSet> {
  return getJson<ChangeSet>(`/change-sets/${changeSetId}`)
}

/** `GET /projects/{pid}/change-sets?status=` — list Change Sets for a project. */
export function listChangeSets(
  projectId: string,
  status?: string,
): Promise<ChangeSet[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  return getJson<ChangeSet[]>(`/projects/${projectId}/change-sets${qs}`)
}

/** `POST /change-sets/{cid}/preview` — regenerate approved rows into the
 * typed preview payload; does not mutate the project. */
export function previewChangeSet(
  changeSetId: string,
  body: { approvedObjectIds: string[]; craftLevel?: CraftLevel },
): Promise<ChangeSet> {
  return postJson<ChangeSet>(`/change-sets/${changeSetId}/preview`, body)
}

/** `POST /change-sets/{cid}/apply` response (data contract §4). */
export interface ApplyChangeSetResponse {
  project: Project
  changeSet: ChangeSet
  consistencyFlags: ConsistencyFlag[]
}

/** `POST /change-sets/{cid}/apply` — writes the stored preview for approved
 * ids only; 409 on locked / flag_only / null or stale preview. */
export function applyChangeSet(
  changeSetId: string,
  body: { approvedObjectIds: string[] },
  opts?: IfMatchOpts,
): Promise<ApplyChangeSetResponse> {
  return postJson<ApplyChangeSetResponse>(
    `/change-sets/${changeSetId}/apply`,
    body,
    opts,
  )
}

/** `POST /change-sets/{cid}/discard` → ChangeSet with status `discarded`. */
export function discardChangeSet(changeSetId: string): Promise<ChangeSet> {
  return postJson<ChangeSet>(`/change-sets/${changeSetId}/discard`, {})
}

/** `POST /change-sets/{cid}/flag` → ChangeSet with status `flagged` (leaves
 * the project untouched). */
export function flagChangeSet(changeSetId: string): Promise<ChangeSet> {
  return postJson<ChangeSet>(`/change-sets/${changeSetId}/flag`, {})
}

/** `POST /projects/{pid}/scene-skeleton/candidates` (design spec §6/§9.4) —
 * the explicit "Generate scene skeleton" gesture: runs the three-candidate
 * convergent loop. Read-only; nothing is persisted. */
export function generateSceneSkeletonCandidates(
  projectId: string,
): Promise<InitialSceneSkeletonCandidate[]> {
  return postJson<InitialSceneSkeletonCandidate[]>(
    `/projects/${projectId}/scene-skeleton/candidates`,
    {},
  )
}

/** `POST /projects/{pid}/scene-skeleton/change-sets` — selecting a
 * generated candidate creates an `initial_scene_skeleton` ChangeSet already
 * `previewing` and sends the writer to Review (never writes the plan
 * directly). `candidate` is echoed back verbatim from generation. */
export function createSceneSkeletonChangeSet(
  projectId: string,
  candidate: InitialSceneSkeletonCandidate,
): Promise<ChangeSet> {
  return postJson<ChangeSet>(
    `/projects/${projectId}/scene-skeleton/change-sets`,
    candidate,
  )
}
