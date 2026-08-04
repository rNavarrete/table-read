import type { LedgerFact } from 'contract'

export type FactStatusFilter =
  'all' | 'pending_review' | 'active' | 'superseded' | 'stale' | 'rejected'

export type FactTypeFilter =
  'all' | 'event' | 'state' | 'knowledge' | 'relationship' | 'world_rule'

export interface LedgerFilters {
  status: FactStatusFilter
  characterId: string | null
  factType: FactTypeFilter
  /** When true, only facts the audience does not know (secrets). */
  secretsOnly: boolean
  /** Keep replaced facts out of day-to-day browsing without deleting history. */
  hideSuperseded?: boolean
}

export const DEFAULT_FILTERS: LedgerFilters = {
  status: 'all',
  characterId: null,
  factType: 'all',
  secretsOnly: false,
  hideSuperseded: false,
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
    if (filters.secretsOnly && fact.audienceKnows) {
      return false
    }
    if (filters.hideSuperseded && fact.status === 'superseded') {
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

/** Group pending facts by sourceSpan.sceneId for per-scene batch review
 * (UI spec §6). Scene order follows first appearance in `facts`. */
export function groupPendingByScene(
  facts: LedgerFact[],
): Array<{ sceneId: string; facts: LedgerFact[] }> {
  const pending = pendingReviewFacts(facts)
  const order: string[] = []
  const byScene = new Map<string, LedgerFact[]>()
  for (const fact of pending) {
    const sceneId = fact.sourceSpan.sceneId
    if (!byScene.has(sceneId)) {
      byScene.set(sceneId, [])
      order.push(sceneId)
    }
    byScene.get(sceneId)!.push(fact)
  }
  return order.map((sceneId) => ({
    sceneId,
    facts: byScene.get(sceneId)!,
  }))
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
