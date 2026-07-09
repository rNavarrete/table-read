import { describe, expect, it } from 'vitest'
import type { LedgerFact } from 'contract'
import {
  DEFAULT_FILTERS,
  filterFacts,
  groupPendingByScene,
  highConfidencePending,
  pendingReviewFacts,
  supersedeChain,
} from './filters'

function fact(
  partial: Partial<LedgerFact> & Pick<LedgerFact, 'id'>,
): LedgerFact {
  return {
    fact: 'text',
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

describe('ledger filters', () => {
  const facts = [
    fact({
      id: 'fact-06',
      status: 'pending_review',
      confidence: 0.72,
      knownBy: ['char-reyes'],
      factType: 'state',
    }),
    fact({
      id: 'fact-hi',
      status: 'pending_review',
      confidence: 0.9,
      knownBy: ['char-marta'],
      factType: 'event',
    }),
    fact({
      id: 'fact-01',
      status: 'active',
      confidence: 0.95,
      knownBy: ['char-marta'],
      factType: 'event',
    }),
  ]

  it('pendingReviewFacts returns only pending_review', () => {
    expect(pendingReviewFacts(facts).map((f) => f.id)).toEqual([
      'fact-06',
      'fact-hi',
    ])
  })

  it('highConfidencePending is ≥0.8 pending only', () => {
    expect(highConfidencePending(facts).map((f) => f.id)).toEqual(['fact-hi'])
  })

  it('groupPendingByScene groups by sourceSpan.sceneId', () => {
    const mixed = [
      fact({
        id: 'a',
        status: 'pending_review',
        sourceSpan: {
          episodeId: 'ep-1',
          sceneId: 'scene-2',
          beatId: 'beat-2-1',
          startLine: null,
          endLine: null,
          charStart: null,
          charEnd: null,
        },
      }),
      fact({
        id: 'b',
        status: 'pending_review',
        sourceSpan: {
          episodeId: 'ep-1',
          sceneId: 'scene-1',
          beatId: 'beat-1-1',
          startLine: null,
          endLine: null,
          charStart: null,
          charEnd: null,
        },
      }),
      fact({
        id: 'c',
        status: 'pending_review',
        sourceSpan: {
          episodeId: 'ep-1',
          sceneId: 'scene-2',
          beatId: 'beat-2-2',
          startLine: null,
          endLine: null,
          charStart: null,
          charEnd: null,
        },
      }),
      fact({ id: 'active', status: 'active' }),
    ]
    expect(groupPendingByScene(mixed)).toEqual([
      { sceneId: 'scene-2', facts: [mixed[0], mixed[2]] },
      { sceneId: 'scene-1', facts: [mixed[1]] },
    ])
  })

  it('filterFacts applies status, character, and type', () => {
    expect(
      filterFacts(facts, {
        ...DEFAULT_FILTERS,
        status: 'pending_review',
      }).map((f) => f.id),
    ).toEqual(['fact-06', 'fact-hi'])

    expect(
      filterFacts(facts, {
        ...DEFAULT_FILTERS,
        characterId: 'char-reyes',
      }).map((f) => f.id),
    ).toEqual(['fact-06'])

    expect(
      filterFacts(facts, {
        ...DEFAULT_FILTERS,
        factType: 'event',
      }).map((f) => f.id),
    ).toEqual(['fact-hi', 'fact-01'])
  })

  it('supersedeChain walks supersededBy links', () => {
    const chainFacts = [
      fact({
        id: 'a',
        status: 'superseded',
        supersededBy: 'b',
      }),
      fact({
        id: 'b',
        status: 'active',
        supersedes: 'a',
        supersededBy: null,
      }),
    ]
    expect(supersedeChain(chainFacts, 'a').map((f) => f.id)).toEqual(['a', 'b'])
  })
})
