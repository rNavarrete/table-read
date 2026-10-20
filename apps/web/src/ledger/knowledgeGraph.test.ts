import { describe, expect, it } from 'vitest'
import type { LedgerFact, Project } from 'contract'
import {
  buildKnowledgeGraph,
  buildRelatedEdges,
  layoutFactArc,
  layoutFactNodes,
  relatedFactIds,
  beliefStateFor,
  tallyBeliefs,
} from './knowledgeGraph'

const project = {
  id: 'proj-longpour',
  title: 'The Long Pour',
  seriesBible: {
    characters: [
      { id: 'char-reyes', name: 'Detective Ana Reyes' },
      { id: 'char-marta', name: 'Marta Vega' },
      { id: 'char-doc', name: 'Doc' },
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
    expect(model.overflowCount).toBe(0)
    expect(model.matchCount).toBe(1)
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

  it('caps visible fact nodes at 24 and reports overflow', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      fact({
        id: `fact-${i}`,
        knownBy: ['char-reyes'],
        factType: 'event',
      }),
    )

    const model = buildKnowledgeGraph(many, project, 'char-reyes')
    expect(model.factNodes).toHaveLength(24)
    expect(model.matchCount).toBe(30)
    expect(model.overflowCount).toBe(6)
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

  it('builds related edges for shared knowers among visible nodes', () => {
    const model = buildKnowledgeGraph(
      [
        fact({
          id: 'a',
          knownBy: ['char-reyes', 'char-marta'],
          factType: 'knowledge',
        }),
        fact({
          id: 'b',
          knownBy: ['char-reyes'],
          factType: 'knowledge',
        }),
        fact({
          id: 'c',
          knownBy: ['char-doc'],
          factType: 'knowledge',
          fact: 'Doc alone knows this',
        }),
      ],
      project,
      'char-reyes',
    )

    expect(
      model.relatedEdges.some((edge) => edge.kind === 'shared_knower'),
    ).toBe(true)
    expect(
      model.relatedEdges.some(
        (edge) =>
          (edge.fromFactId === 'a' && edge.toFactId === 'b') ||
          (edge.fromFactId === 'b' && edge.toFactId === 'a'),
      ),
    ).toBe(true)
  })
})

describe('buildRelatedEdges', () => {
  it('links relationship facts that co-mention the same character', () => {
    const nodes = [
      fact({
        id: 'rel-1',
        factType: 'relationship',
        fact: 'Doc distrusts Marta Vega after the pier.',
        knownBy: ['char-doc'],
      }),
      fact({
        id: 'rel-2',
        factType: 'relationship',
        fact: 'Marta Vega owes Doc a favor.',
        knownBy: ['char-marta'],
      }),
    ]

    const edges = buildRelatedEdges(nodes, project)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.kind).toBe('relationship')
  })
})

describe('relatedFactIds', () => {
  it('returns neighbor fact ids for a selected fact', () => {
    const edges = buildRelatedEdges(
      [
        fact({
          id: 'a',
          knownBy: ['char-reyes', 'char-marta'],
          factType: 'knowledge',
        }),
        fact({
          id: 'b',
          knownBy: ['char-reyes', 'char-marta'],
          factType: 'knowledge',
        }),
        fact({
          id: 'c',
          knownBy: ['char-reyes'],
          factType: 'knowledge',
        }),
      ],
      project,
    )

    expect(relatedFactIds('a', edges).has('b')).toBe(true)
    expect(relatedFactIds('a', edges).has('a')).toBe(false)
    expect(relatedFactIds(null, edges).size).toBe(0)
  })
})

describe('layoutFactArc (optional marker layout helper)', () => {
  it('returns empty for zero nodes', () => {
    expect(layoutFactArc(0)).toEqual([])
  })

  it('places a single node to the right of focus', () => {
    const [point] = layoutFactArc(1, { focusX: 100, focusY: 200, radius: 100 })
    expect(point!.x).toBeGreaterThan(100)
    expect(point!.y).toBeCloseTo(200, 5)
  })

  it('spreads multiple nodes across an arc with distinct positions', () => {
    const points = layoutFactArc(5, { focusX: 100, focusY: 200 })
    expect(points).toHaveLength(5)
    const ys = points.map((p) => p.y)
    expect(Math.min(...ys)).toBeLessThan(200)
    expect(Math.max(...ys)).toBeGreaterThan(200)
    const keys = new Set(
      points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    )
    expect(keys.size).toBe(5)
  })

  it('layoutFactNodes aligns ids to arc points', () => {
    const nodes = [
      fact({ id: 'one', knownBy: ['char-reyes'] }),
      fact({ id: 'two', knownBy: ['char-reyes'] }),
    ]
    const layout = layoutFactNodes(nodes)
    expect(layout.map((entry) => entry.factId)).toEqual(['one', 'two'])
    expect(layout[0]!.y).not.toBe(layout[1]!.y)
  })
})

describe('belief state (knows vs suspects vs misinformed)', () => {
  function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
    return {
      id: 'fact-1',
      fact: 'The books are forged.',
      factType: 'knowledge',
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
      confidence: 0.9,
      status: 'active',
      supersedes: null,
      supersededBy: null,
      knownByAsOf: null,
      ...overrides,
    } as LedgerFact
  }

  it('reports a suspecting character as suspects, not knows', () => {
    const f = fact({
      knowledgeEvents: [
        {
          sceneId: 'scene-2',
          characterIds: ['char-marta'],
          kind: 'suspects',
          quote: '',
          belief: '',
        },
      ],
    })
    expect(beliefStateFor(f, 'char-marta')).toBe('suspects')
    // And crucially it did NOT leak into the knower set.
    expect(f.knownBy).toEqual([])
  })

  it('lets knowing win over an earlier suspicion', () => {
    const f = fact({
      knownBy: ['char-marta'],
      knowledgeEvents: [
        {
          sceneId: 'scene-2',
          characterIds: ['char-marta'],
          kind: 'suspects',
          quote: '',
          belief: '',
        },
      ],
    })
    expect(beliefStateFor(f, 'char-marta')).toBe('knows')
  })

  it('reports a misled character as misinformed', () => {
    const f = fact({
      knowledgeEvents: [
        {
          sceneId: 'scene-3',
          characterIds: ['char-dan'],
          kind: 'misinformed',
          quote: '',
          belief: '',
        },
      ],
    })
    expect(beliefStateFor(f, 'char-dan')).toBe('misinformed')
  })

  it('ignores events belonging to other characters', () => {
    const f = fact({
      knowledgeEvents: [
        {
          sceneId: 'scene-2',
          characterIds: ['char-dan'],
          kind: 'suspects',
          quote: '',
          belief: '',
        },
      ],
    })
    expect(beliefStateFor(f, 'char-marta')).toBe('unaware')
  })

  it('tallies beliefs across facts', () => {
    const facts = [
      fact({ id: 'f1', knownBy: ['char-marta'] }),
      fact({
        id: 'f2',
        knowledgeEvents: [
          {
            sceneId: 'scene-2',
            characterIds: ['char-marta'],
            kind: 'suspects',
            quote: '',
            belief: '',
          },
        ],
      }),
      fact({
        id: 'f3',
        knowledgeEvents: [
          {
            sceneId: 'scene-2',
            characterIds: ['char-marta'],
            kind: 'misinformed',
            quote: '',
            belief: '',
          },
        ],
      }),
      fact({ id: 'f4' }),
    ]
    expect(tallyBeliefs(facts, 'char-marta')).toEqual({
      knows: 1,
      suspects: 1,
      misinformed: 1,
    })
  })
})
