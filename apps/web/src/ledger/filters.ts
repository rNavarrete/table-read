import type { LedgerFact } from 'contract'

export type FactStatusFilter =
  | 'all'
  | 'pending_review'
  | 'active'
  | 'superseded'
  | 'stale'
  | 'rejected'

export type FactTypeFilter =
  | 'all'
  | 'event'
  | 'state'
  | 'knowledge'
  | 'relationship'
  | 'world_rule'

export interface LedgerFilters {
  status: FactStatusFilter
  characterId: string | null
  factType: FactTypeFilter
}

export const DEFAULT_FILTERS: LedgerFilters = {
  status: 'all',
  characterId: null,
  factType: 'all',
}

/** Client-side filter for the Ledger grid (UI spec §6). Status/character
 * also exist as GET query params; we filter locally so type + multi-filter
 * stay snappy without refetching on every chip click. */
export function filterFacts(
  facts: LedgerFact[],
  filters: LedgerFilters,
): LedgerFact[] {
  return facts.filter((fact) => {
    if (filters.status !== 'all' && fact.status !== filters.status) return false
    if (
      filters.characterId !== null &&
      !fact.knownBy.includes(filters.characterId)
    ) {
      return false
    }
    if (filters.factType !== 'all' && fact.factType !== filters.factType) {
      return false
    }
    return true
  })
}

export function pendingReviewFacts(facts: LedgerFact[]): LedgerFact[] {
  return facts.filter((f) => f.status === 'pending_review')
}

/** High-confidence queue members (≥0.8) for the batch-accept affordance. */
export function highConfidencePending(facts: LedgerFact[]): LedgerFact[] {
  return pendingReviewFacts(facts).filter((f) => f.confidence >= 0.8)
}

/** Walk supersededBy links into a chain (oldest → newest). */
export function supersedeChain(
  facts: LedgerFact[],
  startId: string,
): LedgerFact[] {
  const byId = new Map(facts.map((f) => [f.id, f]))
  const chain: LedgerFact[] = []
  let current = byId.get(startId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    if (!current.supersededBy) break
    current = byId.get(current.supersededBy)
  }
  return chain
}
