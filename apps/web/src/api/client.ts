import type {
  BeatCandidate,
  ConsistencyFlag,
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

export function getProject(projectId: string): Promise<Project> {
  return getJson<Project>(`/projects/${projectId}`)
}

export function getLedger(projectId: string): Promise<LedgerFact[]> {
  return getJson<LedgerFact[]>(`/projects/${projectId}/ledger`)
}

export interface AcceptResponse {
  project: Project
  newFacts: LedgerFact[]
  contradictions: Array<{
    existingFactId: string
    explanation: string
    proposedReplacement: string | null
  }>
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
