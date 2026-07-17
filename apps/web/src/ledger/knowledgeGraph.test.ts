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
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.5,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
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

  it('T7.23: prefers knownByAsOf over knownBy when set, for character focus', () => {
    const asOfFacts = [
      fact({
        id: 'reyes-learns-later',
        knownBy: ['char-marta'],
        knownByAsOf: ['char-marta', 'char-reyes'],
        factType: 'knowledge',
      }),
    ]

    const model = buildKnowledgeGraph(asOfFacts, project, 'char-reyes')

    expect(model.factNodes.map((f) => f.id)).toEqual(['reyes-learns-later'])
  })

  it('T7.23: prefers knownByAsOf over knownBy when set, for audience focus', () => {
    const asOfFacts = [
      // Baseline knownBy is non-empty, but knownByAsOf says nobody knows it
      // yet as of this scene — audience focus (knownBy.length === 0) must
      // follow knownByAsOf, not baseline knownBy.
      fact({
        id: 'not-yet-known',
        knownBy: ['char-marta'],
        knownByAsOf: [],
        factType: 'knowledge',
      }),
    ]

    const model = buildKnowledgeGraph(asOfFacts, project, null)

    expect(model.factNodes.map((f) => f.id)).toEqual(['not-yet-known'])
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
