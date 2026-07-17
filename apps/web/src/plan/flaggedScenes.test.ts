import { describe, expect, it } from 'vitest'
import type { ConsistencyFlag, Project, Scene } from 'contract'
import { sceneIdsWithOpenFlags } from './flaggedScenes'

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 1,
    storyline: 'A',
    locked: false,
    location: 'INT. BAR',
    time: 'Night',
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [
      {
        id: 'beat-1-1',
        index: 0,
        locked: false,
        whatHappens: '',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: false,
      },
    ],
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
    enabledComponents: [],
    premise: '',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters: [],
      relationships: [],
      audienceGoals: [],
      narratorGoals: [],
      worldQA: [],
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
            locked: false,
            title: '',
            premise: '',
            seasonFunction: '',
            storylines: [],
            scenes,
            timelineAnchors: [],
          },
        ],
      },
    ],
    headSnapshotId: 'snap-root',
  }
}

function flag(overrides: Partial<ConsistencyFlag>): ConsistencyFlag {
  return {
    id: 'flag-1',
    objectType: 'scene',
    objectId: 'scene-1',
    factId: null,
    explanation: 'tension',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-1',
    ...overrides,
  }
}

describe('sceneIdsWithOpenFlags', () => {
  it('includes scenes with open scene-level flags', () => {
    const ids = sceneIdsWithOpenFlags(
      [
        flag({ objectId: 'scene-5' }),
        flag({ id: 'flag-2', objectId: 'scene-1' }),
      ],
      project([scene({ id: 'scene-1' }), scene({ id: 'scene-5', index: 1 })]),
    )
    expect([...ids].sort()).toEqual(['scene-1', 'scene-5'])
  })

  it('maps open beat-level flags to the parent scene', () => {
    const ids = sceneIdsWithOpenFlags(
      [
        flag({
          id: 'flag-beat',
          objectType: 'beat',
          objectId: 'beat-1-1',
        }),
      ],
      project([scene()]),
    )
    expect([...ids]).toEqual(['scene-1'])
  })

  it('ignores dismissed flags so a dismiss clears the badge set', () => {
    const ids = sceneIdsWithOpenFlags(
      [flag({ status: 'dismissed' })],
      project([scene()]),
    )
    expect(ids.size).toBe(0)
  })
})
