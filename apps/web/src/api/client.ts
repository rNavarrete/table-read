import type {
  BeatCandidate,
  ChangeSet,
  ConsistencyFlag,
  LedgerExtraction,
  LedgerFact,
  Project,
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as T
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
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
): Promise<PatchResult> {
  const body = await patchJson<Project | PatchResult>(
    `/projects/${projectId}`,
    ops,
  )
  // Structural edits return {project, consistencyFlags}; other edits the bare
  // Project (which has no `project` key). Normalize to PatchResult.
  return 'project' in body
    ? { project: body.project, consistencyFlags: body.consistencyFlags }
    : { project: body, consistencyFlags: [] }
}

export function getProject(projectId: string): Promise<Project> {
  return getJson<Project>(`/projects/${projectId}`)
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
export function confirmLedgerFact(factId: string): Promise<LedgerFact> {
  return postJson<LedgerFact>(`/ledger/${factId}/confirm`, {})
}

/** `POST /ledger/{factId}/reject` — pending_review → rejected (prompt-ineligible). */
export function rejectLedgerFact(factId: string): Promise<LedgerFact> {
  return postJson<LedgerFact>(`/ledger/${factId}/reject`, {})
}

/** `PATCH /ledger/{factId}` — edit text/knownBy → writer_authored (and
 * activates pending_review per T5.1 accept). */
export function editLedgerFact(
  factId: string,
  body: { fact?: string; knownBy?: string[] },
): Promise<LedgerFact> {
  return patchJson<LedgerFact>(`/ledger/${factId}`, body)
}

/** `POST /projects/{pid}/ledger/batch` — one snapshot for the whole batch. */
export function batchLedgerReview(
  projectId: string,
  body: { confirmIds: string[]; rejectIds: string[] },
): Promise<{ ledger: LedgerFact[] }> {
  return postJson<{ ledger: LedgerFact[] }>(
    `/projects/${projectId}/ledger/batch`,
    body,
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
): Promise<ConsistencyFlag> {
  return postJson<ConsistencyFlag>(`/consistency-flags/${flagId}/dismiss`, {})
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
): Promise<AcceptResponse> {
  return postJson<AcceptResponse>(
    `/projects/${projectId}/scenes/${sceneId}/beats`,
    {
      candidate,
      afterBeatId,
    },
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

/** `POST /change-sets/{cid}/preview` — regenerate approved rows into the
 * typed preview payload; does not mutate the project. */
export function previewChangeSet(
  changeSetId: string,
  body: { approvedObjectIds: string[] },
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
): Promise<ApplyChangeSetResponse> {
  return postJson<ApplyChangeSetResponse>(
    `/change-sets/${changeSetId}/apply`,
    body,
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
