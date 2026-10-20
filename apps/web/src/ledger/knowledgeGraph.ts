import type { LedgerFact, Project } from 'contract'

export type KnowledgeEdgeKind = 'shared_knower' | 'relationship'

export interface KnowledgeEdge {
  id: string
  fromFactId: string
  toFactId: string
  kind: KnowledgeEdgeKind
}

export interface RadialPoint {
  x: number
  y: number
}

export interface FactRadialLayout {
  factId: string
  x: number
  y: number
}

export interface KnowledgeGraphModel {
  focusId: string | null
  focusLabel: string
  factNodes: LedgerFact[]
  /** Matching facts beyond the visible cap (for “+N more”). */
  overflowCount: number
  matchCount: number
  relatedEdges: KnowledgeEdge[]
}

export const DEFAULT_CAP = 24

/** Default SVG viewBox size for the Knowledge Web canvas. */
export const WEB_VIEW = { width: 720, height: 520 } as const
export const WEB_FOCUS = { x: 132, y: WEB_VIEW.height / 2 } as const

const TYPE_PRIORITY: Record<LedgerFact['factType'], number> = {
  knowledge: 0,
  relationship: 1,
  event: 2,
  state: 3,
  world_rule: 4,
}

const MAX_RELATED_EDGES = 36
const MAX_DEGREE = 3

function focusLabel(project: Project, characterId: string | null): string {
  if (!characterId) return 'Audience'
  const character = project.seriesBible.characters.find(
    (entry) => entry.id === characterId,
  )
  return character?.name ?? characterId
}

/** T7.23: `knownByAsOf` takes precedence over baseline `knownBy`. */
export function knownByForFocus(fact: LedgerFact): string[] {
  return fact.knownByAsOf ?? fact.knownBy
}

/** Does this character have a suspects/misinformed event on this fact? */
function hasBeliefEvent(fact: LedgerFact, characterId: string): boolean {
  return (fact.knowledgeEvents ?? []).some(
    (event) =>
      (event.kind === 'suspects' || event.kind === 'misinformed') &&
      event.characterIds.includes(characterId),
  )
}

function matchesFocus(
  fact: LedgerFact,
  project: Project,
  characterId: string | null,
): boolean {
  if (characterId) {
    if (knownByForFocus(fact).includes(characterId)) return true
    // A fact this character suspects, or has been misled about, belongs on
    // their web too — it is not in knownBy by design, but "Marta suspects
    // but cannot prove it" is precisely what a writer came here to see.
    if (hasBeliefEvent(fact, characterId)) return true
    const characterName = project.seriesBible.characters
      .find((entry) => entry.id === characterId)
      ?.name.trim()
    return Boolean(
      characterName &&
      fact.fact.toLocaleLowerCase().includes(characterName.toLocaleLowerCase()),
    )
  }
  return knownByForFocus(fact).length === 0
}

function compareFactPriority(a: LedgerFact, b: LedgerFact): number {
  const typeDiff = TYPE_PRIORITY[a.factType] - TYPE_PRIORITY[b.factType]
  if (typeDiff !== 0) return typeDiff
  return a.id.localeCompare(b.id)
}

function mentionedCharacterIds(
  fact: LedgerFact,
  project: Project,
): Set<string> {
  const text = fact.fact.toLocaleLowerCase()
  const ids = new Set<string>()
  for (const character of project.seriesBible.characters) {
    const name = character.name.trim()
    if (name && text.includes(name.toLocaleLowerCase())) {
      ids.add(character.id)
    }
  }
  return ids
}

function sharedCount(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  let count = 0
  for (const id of a) {
    if (setB.has(id)) count += 1
  }
  return count
}

/**
 * Light focus-centric mini-edges between visible facts:
 * - shared_knower when effective known-by sets intersect
 * - relationship when at least one fact is relationship-typed and both
 *   co-mention the same character name
 */
export function buildRelatedEdges(
  factNodes: LedgerFact[],
  project: Project,
): KnowledgeEdge[] {
  type Candidate = KnowledgeEdge & { score: number }
  const candidates: Candidate[] = []

  for (let i = 0; i < factNodes.length; i += 1) {
    const a = factNodes[i]!
    const knowersA = knownByForFocus(a)
    const mentionsA = mentionedCharacterIds(a, project)

    for (let j = i + 1; j < factNodes.length; j += 1) {
      const b = factNodes[j]!
      const knowersB = knownByForFocus(b)
      const sharedKnowers = sharedCount(knowersA, knowersB)
      if (sharedKnowers > 0) {
        candidates.push({
          id: `edge-sk-${a.id}-${b.id}`,
          fromFactId: a.id,
          toFactId: b.id,
          kind: 'shared_knower',
          score: 100 + sharedKnowers,
        })
        continue
      }

      const relationshipPair =
        a.factType === 'relationship' || b.factType === 'relationship'
      if (!relationshipPair) continue

      const mentionsB = mentionedCharacterIds(b, project)
      let coMentions = 0
      for (const id of mentionsA) {
        if (mentionsB.has(id)) coMentions += 1
      }
      if (coMentions === 0) continue

      candidates.push({
        id: `edge-rel-${a.id}-${b.id}`,
        fromFactId: a.id,
        toFactId: b.id,
        kind: 'relationship',
        score: 10 + coMentions,
      })
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return left.id.localeCompare(right.id)
  })

  const degree = new Map<string, number>()
  const edges: KnowledgeEdge[] = []

  for (const candidate of candidates) {
    if (edges.length >= MAX_RELATED_EDGES) break
    const fromDegree = degree.get(candidate.fromFactId) ?? 0
    const toDegree = degree.get(candidate.toFactId) ?? 0
    if (fromDegree >= MAX_DEGREE || toDegree >= MAX_DEGREE) continue
    edges.push({
      id: candidate.id,
      fromFactId: candidate.fromFactId,
      toFactId: candidate.toFactId,
      kind: candidate.kind,
    })
    degree.set(candidate.fromFactId, fromDegree + 1)
    degree.set(candidate.toFactId, toDegree + 1)
  }

  return edges
}

/** Neighbor fact ids linked to `selectedId` via related edges (selection cue). */
export function relatedFactIds(
  selectedId: string | null,
  edges: KnowledgeEdge[],
): Set<string> {
  const ids = new Set<string>()
  if (!selectedId) return ids
  for (const edge of edges) {
    if (edge.fromFactId === selectedId) ids.add(edge.toFactId)
    else if (edge.toFactId === selectedId) ids.add(edge.fromFactId)
  }
  return ids
}

/**
 * Optional marker layout: place `count` points on an arc to the right of focus.
 * Kept for a future “Web dots” mode — primary Knowledge Web uses ranked rows.
 */
export function layoutFactArc(
  count: number,
  opts: {
    focusX?: number
    focusY?: number
    radius?: number
    stagger?: number
    startAngle?: number
    endAngle?: number
  } = {},
): RadialPoint[] {
  if (count <= 0) return []

  const focusX = opts.focusX ?? WEB_FOCUS.x
  const focusY = opts.focusY ?? WEB_FOCUS.y
  const radius = opts.radius ?? 248
  const stagger = opts.stagger ?? 36
  const startAngle = opts.startAngle ?? -0.95
  const endAngle = opts.endAngle ?? 0.95

  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1)
    const angle = startAngle + t * (endAngle - startAngle)
    const ring = count > 10 && index % 2 === 1 ? radius + stagger : radius
    return {
      x: focusX + ring * Math.cos(angle),
      y: focusY + ring * Math.sin(angle),
    }
  })
}

export function layoutFactNodes(factNodes: LedgerFact[]): FactRadialLayout[] {
  const points = layoutFactArc(factNodes.length)
  return factNodes.map((fact, index) => ({
    factId: fact.id,
    x: points[index]!.x,
    y: points[index]!.y,
  }))
}

export function buildKnowledgeGraph(
  facts: LedgerFact[],
  project: Project,
  characterId: string | null,
  cap = DEFAULT_CAP,
): KnowledgeGraphModel {
  const matched = facts
    .filter((fact) => matchesFocus(fact, project, characterId))
    .sort(compareFactPriority)
  const factNodes = matched.slice(0, cap)
  const overflowCount = Math.max(0, matched.length - factNodes.length)

  return {
    focusId: characterId,
    focusLabel: focusLabel(project, characterId),
    factNodes,
    overflowCount,
    matchCount: matched.length,
    relatedEdges: buildRelatedEdges(factNodes, project),
  }
}

/**
 * What a character believes about a fact — which is not the same as whether
 * they know it.
 *
 * `knownBy` deliberately means "actually knows the true fact": the server
 * fold only counts `learns`/`confirms`, because folding a hunch or a lie into
 * knownBy would put it into later generation prompts as established fact.
 * That correctness has a UI cost — a character who *suspects* something, or
 * who has been told something false, is invisible to a view that only reads
 * knownBy. Dramatically those are the interesting states: suspicion is
 * tension, and a confidently wrong character is the engine of a whole scene.
 *
 * So the graph reads `knowledgeEvents` directly for the belief layer, and
 * leaves `knownBy` alone.
 */
export type BeliefState = 'knows' | 'suspects' | 'misinformed' | 'unaware'

const BELIEF_FROM_KIND: Record<string, BeliefState> = {
  suspects: 'suspects',
  misinformed: 'misinformed',
}

export function beliefStateFor(
  fact: LedgerFact,
  characterId: string | null,
): BeliefState {
  if (!characterId) return 'unaware'
  // Knowing wins: a character who suspected in scene 3 and confirmed in
  // scene 9 knows it, and the server fold has already said so.
  if (knownByForFocus(fact).includes(characterId)) return 'knows'
  // Otherwise the latest belief-shaped event for this character stands.
  // Events are replayed in list order here; the server owns scene-ordered
  // replay for knownBy, and this layer only reports the softer states.
  let state: BeliefState = 'unaware'
  for (const event of fact.knowledgeEvents ?? []) {
    if (!event.characterIds.includes(characterId)) continue
    const mapped = BELIEF_FROM_KIND[event.kind]
    if (mapped) state = mapped
  }
  return state
}

/** T10.4: "Dan believes: the money went to the bank" — one line per
 * character on each suspects/misinformed event that says what they take to
 * be true instead. */
export function beliefLines(
  fact: LedgerFact,
  nameOf: (characterId: string) => string,
): string[] {
  return (fact.knowledgeEvents ?? []).flatMap((event) =>
    BELIEF_FROM_KIND[event.kind] && event.belief
      ? event.characterIds.map(
          (id) =>
            `${nameOf(id)} ${event.kind === 'suspects' ? 'suspects' : 'believes'}: ${event.belief}`,
        )
      : [],
  )
}

export interface BeliefTally {
  knows: number
  suspects: number
  misinformed: number
}

/** Counts for the focus character across the supplied facts. */
export function tallyBeliefs(
  facts: LedgerFact[],
  characterId: string | null,
): BeliefTally {
  const tally: BeliefTally = { knows: 0, suspects: 0, misinformed: 0 }
  for (const fact of facts) {
    const state = beliefStateFor(fact, characterId)
    if (state !== 'unaware') tally[state] += 1
  }
  return tally
}
