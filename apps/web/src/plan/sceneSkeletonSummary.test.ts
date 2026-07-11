import { describe, expect, it } from 'vitest'
import type { SceneAddition } from 'contract'
import {
  sceneCharacterNames,
  sceneCountLabel,
  sceneHeading,
  scenePitch,
} from './sceneSkeletonSummary'

const base: SceneAddition = {
  proposalId: 'proposal-1',
  act: 1,
  storyline: 'A',
  location: 'INT. BAR',
  time: 'NIGHT',
  socialSituation: 'After hours.',
  whatHappens: 'Marta confronts Dan.',
  audienceLearns: 'Dan lied.',
  audienceFeels: 'Tension.',
  motivations: [
    {
      characterId: 'char-marta',
      objective: 'Get the truth',
      stakes: 'The bar',
      obstacle: 'Dan',
    },
  ],
  beatPlanSeeds: [],
}

describe('sceneSkeletonSummary', () => {
  it('builds a location — time heading and falls back sensibly', () => {
    expect(sceneHeading(base)).toBe('INT. BAR — NIGHT')
    expect(sceneHeading({ location: '', time: 'DAY' })).toBe('DAY')
    expect(sceneHeading({ location: '', time: '' })).toBe('Untitled scene')
  })

  it('ignores placeholder whatHappens when pitching', () => {
    expect(scenePitch(base)).toBe('Marta confronts Dan.')
    expect(
      scenePitch({
        ...base,
        whatHappens: 'placeholder',
        socialSituation: 'Quiet.',
      }),
    ).toBe('Quiet.')
  })

  it('resolves motivation character names', () => {
    expect(
      sceneCharacterNames(base, [{ id: 'char-marta', name: 'Marta' }]),
    ).toEqual(['Marta'])
  })

  it('pluralizes scene counts', () => {
    expect(sceneCountLabel(1)).toBe('1 scene')
    expect(sceneCountLabel(3)).toBe('3 scenes')
  })
})
