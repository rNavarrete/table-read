import type { LedgerFact, Project } from 'contract'
import type { ChipHue } from '../plan/Chip'

/** Collapsed Atlas rows omit chapter-redundant type cues; this is the
 * discriminating chip (research: Atlas browse clarity R1). */
export interface AtlasCollapsedCue {
  label: string
  hue: ChipHue
}

/** Auto-subhead when a chapter is this large (research R3). */
export const KNOWER_GROUP_THRESHOLD = 20

export interface KnowerFactGroup {
  /** Null = flat list (below threshold). */
  title: string | null
  facts: LedgerFact[]
}

function characterInitials(project: Project, id: string): string {
  const found = project.seriesBible.characters.find((c) => c.id === id)
  if (!found) return id.slice(0, 2).toUpperCase()
  const parts = found.name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function characterName(project: Project, id: string): string {
  return project.seriesBible.characters.find((c) => c.id === id)?.name ?? id
}

/**
 * Discriminating collapsed-row cue from existing who-knows fields only —
 * never a second factType tag (UI spec §7d / Atlas browse clarity).
 */
export function atlasCollapsedCue(
  fact: LedgerFact,
  project: Project,
): AtlasCollapsedCue {
  if (fact.knownBy.length === 0) {
    return { label: 'Audience', hue: 'sky' }
  }
  if (!fact.audienceKnows) {
    return { label: 'Secret', hue: 'amber' }
  }
  if (fact.knownBy.length === 1) {
    return {
      label: characterInitials(project, fact.knownBy[0]!),
      hue: 'neutral',
    }
  }
  return { label: `${fact.knownBy.length} knowers`, hue: 'neutral' }
}

/**
 * Subhead large chapters by knower. Empty knownBy → Audience; multi-knower
 * → Shared (no card duplication). Below threshold → one untitled group.
 */
export function groupChapterFactsByKnower(
  facts: LedgerFact[],
  project: Project,
): KnowerFactGroup[] {
  if (facts.length < KNOWER_GROUP_THRESHOLD) {
    return [{ title: null, facts }]
  }

  const audience: LedgerFact[] = []
  const shared: LedgerFact[] = []
  const byKnower = new Map<string, LedgerFact[]>()

  for (const fact of facts) {
    if (fact.knownBy.length === 0) {
      audience.push(fact)
      continue
    }
    if (fact.knownBy.length > 1) {
      shared.push(fact)
      continue
    }
    const id = fact.knownBy[0]!
    const bucket = byKnower.get(id)
    if (bucket) bucket.push(fact)
    else byKnower.set(id, [fact])
  }

  const groups: KnowerFactGroup[] = []
  if (audience.length) groups.push({ title: 'Audience', facts: audience })

  // Cast order for single-knower buckets; unknown ids after named cast.
  const castIds = project.seriesBible.characters.map((c) => c.id)
  for (const id of castIds) {
    const bucket = byKnower.get(id)
    if (bucket?.length) {
      groups.push({ title: characterName(project, id), facts: bucket })
      byKnower.delete(id)
    }
  }
  for (const [id, bucket] of byKnower) {
    if (bucket.length) {
      groups.push({ title: characterName(project, id), facts: bucket })
    }
  }

  if (shared.length) groups.push({ title: 'Shared', facts: shared })
  return groups
}
