import type {
  BeatCandidate,
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

export function getLedger(projectId: string): Promise<LedgerFact[]> {
  return getJson<LedgerFact[]>(`/projects/${projectId}/ledger`)
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
