import { describe, expect, it } from 'vitest'
import type { Project, Scene } from 'contract'
import { isUnusableScene, pickDefaultScene } from './projectTree'

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 1,
    storyline: 'A',
    locked: false,
    location: 'INT. BAR',
    time: 'NIGHT',
    socialSituation: '',
    whatHappens: 'Something happens.',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...overrides,
  }
}

function project(scenes: Scene[]): Project {
  return {
    id: 'proj-x',
    title: 'X',
    format: {
      genre: 'drama',
      runtimeMinutes: 30,
      actCount: 3,
      coldOpen: false,
      tag: false,
      serialization: 0.5,
    },
    premise: '',
    seriesBible: {
      characters: [],
      relationships: [],
      existentialQuestion: { text: '', locked: false },
      storiesToAvoid: [],
    },
    seasons: [
      {
        id: 'season-1',
        index: 0,
        locked: false,
        seasonArc: '',
        characterArcs: [],
        episodes: [
          {
            id: 'ep-1',
            index: 0,
            title: '1',
            locked: false,
            A: '',
            B: '',
            C: '',
            scenes,
          },
        ],
      },
    ],
    headSnapshotId: 'snap-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('pickDefaultScene', () => {
  it('skips placeholder scenes in favor of a usable scene with beats', () => {
    const junk = scene({
      id: 'scene-junk',
      location: 'placeholder',
      whatHappens: 'placeholder',
    })
    const good = scene({
      id: 'scene-good',
      index: 1,
      location: "INT. RODNEY'S APARTMENT",
      whatHappens: 'Rodney finds an envelope.',
      beats: [
        {
          id: 'beat-1',
          index: 0,
          locked: false,
          whatHappens: 'Coffee.',
          audienceLearns: '',
          audienceFeels: '',
          scriptText: '',
          scriptLocked: false,
        },
      ],
    })
    expect(pickDefaultScene(project([junk, good]))?.id).toBe('scene-good')
  })

  it('ignores a preferred id when that scene is unusable', () => {
    const junk = scene({
      id: 'scene-junk',
      location: 'placeholder',
      whatHappens: 'placeholder',
    })
    const good = scene({
      id: 'scene-good',
      location: 'EXT. STREET',
      whatHappens: 'Ju Li clocks a car.',
    })
    expect(pickDefaultScene(project([junk, good]), 'scene-junk')?.id).toBe(
      'scene-good',
    )
  })

  it('flags thin location/whatHappens as unusable', () => {
    expect(
      isUnusableScene(
        scene({ location: 'placeholder', whatHappens: 'placeholder' }),
      ),
    ).toBe(true)
    expect(isUnusableScene(scene())).toBe(false)
  })
})
