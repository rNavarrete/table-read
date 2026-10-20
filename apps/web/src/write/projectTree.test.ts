import { describe, expect, it } from 'vitest'
import type { Project, Scene } from 'contract'
import {
  allScenes,
  boardOrder,
  isUnusableScene,
  pickDefaultScene,
  sceneNumber,
} from './projectTree'

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
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
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
            title: '1',
            premise: '',
            seasonFunction: '',
            storylines: [],
            scenes,
            timelineAnchors: [],
            relationshipStates: [],
            objectStates: [],
            threads: [],
            secrets: [],
            storyOverview: null,
            narrativeMap: null,
            structureChecks: [],
            craftCheckedAt: null,
            characterArcs: [],
          },
        ],
      },
    ],
    headSnapshotId: 'snap-1',
    defaultCraftLevel: 'standard',
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
          actorCharacterId: null,
          actionVerb: '',
          targetCharacterId: null,
          reaction: '',
          kernel: null,
          pressureChoice: null,
        },
      ],
    })
    expect(pickDefaultScene(project([junk, good]))?.id).toBe('scene-good')
  })

  it('honors an explicit preferred id even when that scene is thin (deep link)', () => {
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
      'scene-junk',
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

// A Plan move rewrites act / index and leaves the scenes array alone, so the
// array here is out of story order on purpose: story order is c, a, b.
const moved = [
  scene({ id: 'scene-b', act: 1, index: 2 }),
  scene({ id: 'scene-a', act: 1, index: 1 }),
  scene({ id: 'scene-c', act: 0, index: 3 }),
]

describe('story order (act, then index — never array position)', () => {
  it('allScenes, boardOrder and sceneNumber follow it', () => {
    expect(allScenes(project(moved)).map((s) => s.id)).toEqual([
      'scene-c',
      'scene-a',
      'scene-b',
    ])
    expect(boardOrder(moved).map((s) => s.id)).toEqual([
      'scene-c',
      'scene-a',
      'scene-b',
    ])
    expect(sceneNumber(project(moved), 'scene-c')).toBe(1)
    expect(sceneNumber(project(moved), 'scene-b')).toBe(3)
    expect(sceneNumber(project(moved), 'scene-nope')).toBeNull()
  })

  it('keeps array order on an (act, index) tie', () => {
    const tied = [scene({ id: 'scene-y' }), scene({ id: 'scene-x' })]
    expect(boardOrder(tied).map((s) => s.id)).toEqual(['scene-y', 'scene-x'])
  })

  it('pickDefaultScene opens the first scene with beats in story order', () => {
    const beat = {
      id: 'beat-1',
      index: 0,
      locked: false,
      whatHappens: 'Coffee.',
      audienceLearns: '',
      audienceFeels: '',
      scriptText: '',
      scriptLocked: false,
      actorCharacterId: null,
      actionVerb: '',
      targetCharacterId: null,
      reaction: '',
      kernel: null,
      pressureChoice: null,
    }
    const withBeats = moved.map((s) => ({ ...s, beats: [beat] }))
    expect(pickDefaultScene(project(withBeats))?.id).toBe('scene-c')
  })
})
