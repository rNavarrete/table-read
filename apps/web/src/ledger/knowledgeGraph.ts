import type { LedgerFact, Project } from 'contract'

export interface KnowledgeGraphModel {
  focusId: string | null
  focusLabel: string
  factNodes: LedgerFact[]
}

const DEFAULT_CAP = 24

const TYPE_PRIORITY: Record<LedgerFact['factType'], number> = {
  knowledge: 0,
  relationship: 1,
  event: 2,
  state: 3,
  world_rule: 4,
}

function focusLabel(project: Project, characterId: string | null): string {
  if (!characterId) return 'Audience'
  const character = project.seriesBible.characters.find(
    (entry) => entry.id === characterId,
  )
  return character?.name ?? characterId
}

function matchesFocus(
  fact: LedgerFact,
  project: Project,
  characterId: string | null,
): boolean {
  if (characterId) {
    if (fact.knownBy.includes(characterId)) return true
    const characterName = project.seriesBible.characters
      .find((entry) => entry.id === characterId)
      ?.name.trim()
    return Boolean(
      characterName &&
      fact.fact.toLocaleLowerCase().includes(characterName.toLocaleLowerCase()),
    )
  }
  return fact.knownBy.length === 0
}

function compareFactPriority(a: LedgerFact, b: LedgerFact): number {
  const typeDiff = TYPE_PRIORITY[a.factType] - TYPE_PRIORITY[b.factType]
  if (typeDiff !== 0) return typeDiff
  return a.id.localeCompare(b.id)
}

export function buildKnowledgeGraph(
  facts: LedgerFact[],
  project: Project,
  characterId: string | null,
  cap = DEFAULT_CAP,
): KnowledgeGraphModel {
  const factNodes = facts
    .filter((fact) => matchesFocus(fact, project, characterId))
    .sort(compareFactPriority)
    .slice(0, cap)

  return {
    focusId: characterId,
    focusLabel: focusLabel(project, characterId),
    factNodes,
  }
}
