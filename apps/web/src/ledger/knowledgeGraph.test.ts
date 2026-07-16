import { describe, expect, it } from 'vitest'
import type { LedgerFact, Project } from 'contract'
import { buildKnowledgeGraph } from './knowledgeGraph'

const project = {
  id: 'proj-longpour',
  title: 'The Long Pour',
  seriesBible: {
    characters: [
      { id: 'char-reyes', name: 'Detective Ana Reyes' },
      { id: 'char-marta', name: 'Marta Vega' },
    ],
  },
} as unknown as Project

function fact(
  partial: Partial<LedgerFact> & Pick<LedgerFact, 'id'>,
): LedgerFact {
  return {
    fact: `text for ${partial.id}`,
    factType: 'state',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-1',
      beatId: 'beat-1-1',
      startLine: null,
      endLine: null,
      charStart: null,
      charEnd: null,
    },
    sourceText: '',
    knownBy: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.5,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    ...partial,
  }
}

describe('buildKnowledgeGraph', () => {
  const facts = [
    fact({ id: 'audience-only', knownBy: [], factType: 'knowledge' }),
    fact({
      id: 'reyes-state',
      knownBy: ['char-reyes'],
      factType: 'state',
    }),
    fact({
      id: 'reyes-knowledge',
      knownBy: ['char-reyes'],
      factType: 'knowledge',
    }),
    fact({
      id: 'reyes-rel',
      knownBy: ['char-reyes'],
      factType: 'relationship',
    }),
    fact({
      id: 'marta-only',
      knownBy: ['char-marta'],
      factType: 'knowledge',
    }),
  ]

  it('uses Audience focus and audience-only facts when characterId is null', () => {
    const model = buildKnowledgeGraph(facts, project, null)

    expect(model.focusId).toBeNull()
    expect(model.focusLabel).toBe('Audience')
    expect(model.factNodes.map((f) => f.id)).toEqual(['audience-only'])
  })

  it('uses character focus and known-by facts, preferring knowledge and relationship', () => {
    const model = buildKnowledgeGraph(facts, project, 'char-reyes')

    expect(model.focusId).toBe('char-reyes')
    expect(model.focusLabel).toBe('Detective Ana Reyes')
    expect(model.factNodes.map((f) => f.id)).toEqual([
      'reyes-knowledge',
      'reyes-rel',
      'reyes-state',
    ])
  })

  it('includes facts that mention the focused character by name', () => {
    const model = buildKnowledgeGraph(
      [
        fact({
          id: 'mentioned-reyes',
          fact: 'Marta lies to detective ana reyes.',
          knownBy: ['char-marta'],
          factType: 'event',
        }),
      ],
      project,
      'char-reyes',
    )

    expect(model.factNodes.map((entry) => entry.id)).toEqual([
      'mentioned-reyes',
    ])
  })

  it('caps visible fact nodes at 24 by default', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      fact({
        id: `fact-${i}`,
        knownBy: ['char-reyes'],
        factType: 'event',
      }),
    )

    expect(
      buildKnowledgeGraph(many, project, 'char-reyes').factNodes,
    ).toHaveLength(24)
  })

  it('respects a custom cap', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      fact({
        id: `fact-${i}`,
        knownBy: ['char-reyes'],
        factType: 'event',
      }),
    )

    expect(
      buildKnowledgeGraph(many, project, 'char-reyes', 3).factNodes,
    ).toHaveLength(3)
  })
})
