import type { LedgerFact, Project } from 'contract'
import { describe, expect, it } from 'vitest'
import { atlasCollapsedCue, groupChapterFactsByKnower } from './atlasRowCue'

function project(): Project {
  return {
    id: 'proj-1',
    title: 'Test',
    headSnapshotId: 'snap-1',
    seriesBible: {
      characters: [
        { id: 'char-marta', name: 'Marta Vega' },
        { id: 'char-dan', name: 'Dan Vega' },
      ],
    },
    seasons: [],
  } as unknown as Project
}

function fact(
  partial: Partial<LedgerFact> & Pick<LedgerFact, 'id'>,
): LedgerFact {
  return {
    factType: 'knowledge',
    fact: 'something true',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-3',
      beatId: 'beat-3-1',
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
    confidence: 0.8,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
    ...partial,
  }
}

describe('atlasCollapsedCue', () => {
  it('returns Audience when knownBy is empty', () => {
    expect(
      atlasCollapsedCue(fact({ id: 'f1', knownBy: [] }), project()),
    ).toEqual({
      label: 'Audience',
      hue: 'sky',
    })
  })

  it('returns Secret when knowers exist but audience does not know', () => {
    expect(
      atlasCollapsedCue(
        fact({
          id: 'f1',
          knownBy: ['char-marta'],
          audienceKnows: false,
        }),
        project(),
      ),
    ).toEqual({ label: 'Secret', hue: 'amber' })
  })

  it('returns primary knower initials for a single knower shared with audience', () => {
    expect(
      atlasCollapsedCue(
        fact({
          id: 'f1',
          knownBy: ['char-marta'],
          audienceKnows: true,
        }),
        project(),
      ),
    ).toEqual({ label: 'MV', hue: 'neutral' })
  })

  it('returns N knowers for multi-knower shared facts', () => {
    expect(
      atlasCollapsedCue(
        fact({
          id: 'f1',
          knownBy: ['char-marta', 'char-dan'],
          audienceKnows: true,
        }),
        project(),
      ),
    ).toEqual({ label: '2 knowers', hue: 'neutral' })
  })
})

describe('groupChapterFactsByKnower', () => {
  it('returns a single untitled group below the threshold', () => {
    const facts = Array.from({ length: 19 }, (_, i) =>
      fact({ id: `f-${i}`, knownBy: ['char-marta'] }),
    )
    const groups = groupChapterFactsByKnower(facts, project())
    expect(groups).toHaveLength(1)
    expect(groups[0]!.title).toBeNull()
    expect(groups[0]!.facts).toHaveLength(19)
  })

  it('groups into Audience, Shared, and per-knower buckets at threshold', () => {
    const facts = [
      ...Array.from({ length: 8 }, (_, i) =>
        fact({ id: `aud-${i}`, knownBy: [] }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        fact({
          id: `shared-${i}`,
          knownBy: ['char-marta', 'char-dan'],
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        fact({ id: `marta-${i}`, knownBy: ['char-marta'] }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        fact({ id: `dan-${i}`, knownBy: ['char-dan'] }),
      ),
    ]
    expect(facts).toHaveLength(20)

    const groups = groupChapterFactsByKnower(facts, project())
    expect(groups.map((g) => g.title)).toEqual([
      'Audience',
      'Marta Vega',
      'Dan Vega',
      'Shared',
    ])
    expect(groups.find((g) => g.title === 'Audience')!.facts).toHaveLength(8)
    expect(groups.find((g) => g.title === 'Shared')!.facts).toHaveLength(6)
    expect(groups.find((g) => g.title === 'Marta Vega')!.facts).toHaveLength(4)
    expect(groups.find((g) => g.title === 'Dan Vega')!.facts).toHaveLength(2)
  })
})
