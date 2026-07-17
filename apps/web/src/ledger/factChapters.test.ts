import { describe, expect, it } from 'vitest'
import type { LedgerFact } from 'contract'
import { groupFactsIntoChapters } from './factChapters'

function fact(
  partial: Partial<LedgerFact> & Pick<LedgerFact, 'id' | 'factType'>,
): LedgerFact {
  return {
    fact: `text for ${partial.id}`,
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

describe('groupFactsIntoChapters', () => {
  it('groups facts by type in storytelling order and omits empty chapters', () => {
    const facts = [
      fact({ id: 'f-event', factType: 'event' }),
      fact({ id: 'f-knowledge', factType: 'knowledge' }),
      fact({ id: 'f-state', factType: 'state' }),
      fact({ id: 'f-rel', factType: 'relationship' }),
      fact({ id: 'f-rule', factType: 'world_rule' }),
    ]

    expect(groupFactsIntoChapters(facts)).toEqual([
      {
        id: 'knowledge',
        title: 'People & knowledge',
        facts: [facts[1]],
      },
      {
        id: 'event',
        title: 'Events',
        facts: [facts[0]],
      },
      {
        id: 'state',
        title: 'States',
        facts: [facts[2]],
      },
      {
        id: 'relationship',
        title: 'Relationships',
        facts: [facts[3]],
      },
      {
        id: 'world_rule',
        title: 'World rules',
        facts: [facts[4]],
      },
    ])
  })

  it('returns an empty list when no facts are provided', () => {
    expect(groupFactsIntoChapters([])).toEqual([])
  })
})
