import { describe, expect, it } from 'vitest'
import type { Project, Scene } from 'contract'
import { needsGuidedSetup } from './needsGuidedSetup'

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
    beats: [],
    ...overrides,
  }
}

function project(seasons: Project['seasons']): Project {
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
    seasons,
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
  }
}

function episodeWith(scenes: Scene[]): Project['seasons'] {
  return [
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
          relationshipStates: [],
          objectStates: [],
          threads: [],
          secrets: [],
          storyOverview: null,
          narrativeMap: null,
        },
      ],
    },
  ]
}

describe('needsGuidedSetup', () => {
  it('is true for a fresh idea-path project with zero seasons', () => {
    expect(needsGuidedSetup(project([]))).toBe(true)
  })

  it('is true when the episode has scenes but none with a beat', () => {
    expect(needsGuidedSetup(project(episodeWith([scene({ beats: [] })])))).toBe(
      true,
    )
  })

  it('is false once at least one scene has at least one beat', () => {
    const withBeat = scene({
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
    })
    expect(needsGuidedSetup(project(episodeWith([withBeat])))).toBe(false)
  })
})
