import { describe, expect, it } from 'vitest'
import {
  InferredActBreaks,
  NarrativePromises,
  ProjectImportStageName,
  StoryThread,
  WorldRule,
} from './index'

// Placeholder scaffold test — real schema tests land in T0.2.
describe('contract scaffold', () => {
  it('runs the test harness', () => {
    expect(true).toBe(true)
  })

  it('accepts non-negative integral JSON numbers for inferred act starts', () => {
    expect(
      InferredActBreaks.parse({
        starts: [
          { act: 0, startSceneIndex: 0 },
          { act: 1.0, startSceneIndex: 3.0 },
        ],
      }),
    ).toEqual({
      starts: [
        { act: 0, startSceneIndex: 0 },
        { act: 1, startSceneIndex: 3 },
      ],
    })
  })

  it.each([
    ['numeric strings', { act: '1', startSceneIndex: 0 }],
    ['numeric index strings', { act: 1, startSceneIndex: '0' }],
    ['booleans', { act: true, startSceneIndex: 0 }],
    ['boolean indices', { act: 1, startSceneIndex: false }],
    ['fractional acts', { act: 1.5, startSceneIndex: 0 }],
    ['fractional scene indices', { act: 1, startSceneIndex: 0.5 }],
    ['negative acts', { act: -1, startSceneIndex: 0 }],
    ['negative scene indices', { act: 1, startSceneIndex: -1 }],
  ])('rejects %s in inferred act starts', (_label, start) => {
    expect(() => InferredActBreaks.parse({ starts: [start] })).toThrow()
  })

  it('rejects empty inferred act starts', () => {
    expect(() => InferredActBreaks.parse({ starts: [] })).toThrow()
  })
})

// T7.19 — WorldRule/StoryThread/NarrativePromises contract shapes.
describe('WorldRule', () => {
  it('defaults every field beyond the original {text, locked} shape', () => {
    expect(WorldRule.parse({ text: 'No magic without a cost.' })).toEqual({
      text: 'No magic without a cost.',
      locked: false,
      limit: '',
      cost: '',
      exception: '',
      evidenceSceneId: null,
      evidenceQuote: '',
    })
  })

  it('accepts the fully structured shape', () => {
    const rule = {
      text: 'No magic without a cost.',
      locked: true,
      limit: 'Only works at midnight.',
      cost: 'Ages the caster a year.',
      exception: 'Unless the moon is full.',
      evidenceSceneId: 'scene-1',
      evidenceQuote: 'The old woman pays for every spell in years.',
    }
    expect(WorldRule.parse(rule)).toEqual(rule)
  })
})

describe('StoryThread', () => {
  it('mints with only the required fields, defaulting the rest', () => {
    expect(
      StoryThread.parse({
        id: 'thread-1',
        label: 'Sports Almanac temptation',
        summary: 'Marty finds the almanac; will he use it?',
        status: 'open',
        setupSceneId: 'scene-1',
      }),
    ).toEqual({
      id: 'thread-1',
      label: 'Sports Almanac temptation',
      summary: 'Marty finds the almanac; will he use it?',
      status: 'open',
      ownerCharacterIds: [],
      setupSceneId: 'scene-1',
      payoffSceneId: null,
      setupQuote: '',
      payoffQuote: '',
      locked: false,
    })
  })

  it('rejects a status outside open/paid_off/abandoned', () => {
    expect(() =>
      StoryThread.parse({
        id: 'thread-1',
        label: 'x',
        summary: 'x',
        status: 'resolved',
        setupSceneId: 'scene-1',
      }),
    ).toThrow()
  })
})

describe('NarrativePromises', () => {
  it('parses a full op-shaped payload (threads/sceneMotivations/worldRules)', () => {
    const payload = {
      threads: [
        {
          label: 'Sports Almanac temptation',
          summary: 'Marty finds the almanac; will he use it?',
          status: 'open',
          ownerNames: ['Marty'],
          setupSceneId: 'scene-1',
          payoffSceneId: null,
          setupQuote: 'quote',
          payoffQuote: '',
        },
      ],
      sceneMotivations: [
        {
          sceneId: 'scene-1',
          motivations: [
            {
              characterName: 'Marty',
              objective: 'o',
              stakes: 's',
              obstacle: 'b',
            },
          ],
        },
      ],
      worldRules: [
        {
          text: 'No magic without a cost.',
          limit: '',
          cost: '',
          exception: '',
          evidenceSceneId: null,
          evidenceQuote: '',
        },
      ],
    }
    expect(NarrativePromises.parse(payload)).toEqual(payload)
  })
})

describe('ProjectImportStageName', () => {
  it('places inferring_promises right after inferring_entities', () => {
    const stages = ProjectImportStageName.options
    expect(stages.indexOf('inferring_promises')).toBe(
      stages.indexOf('inferring_entities') + 1,
    )
  })
})
