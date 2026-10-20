import { describe, expect, it } from 'vitest'
import {
  InferredNarrativeMap,
  InferredActBreaks,
  NarrativeMap,
  NarrativePromises,
  ProjectImportProgressEvent,
  ProjectImportStageName,
  StoryThread,
  WorldRule,
  Episode,
  KnowledgeEvent,
  Motivation,
  Secret,
  StructureCheck,
  StructureStage,
  Scene,
  SegmentedScene,
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
      // Omitted: the import was given a format, so the model returns none.
      format: null,
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

describe('InferredNarrativeMap', () => {
  it('requires grounded macro and per-scene analysis rows', () => {
    const payload = {
      dramaticQuestion: 'Can Marta make Dan tell the truth?',
      centralConflict: 'Marta seeks proof while Dan hides it.',
      controllingIdea: 'Loyalty makes truth costly.',
      themes: [
        {
          label: 'Loyalty',
          statement: 'Loyalty can hide the truth.',
          evidence: [{ beatId: 'beat-1' }],
        },
      ],
      acts: [
        {
          act: 0,
          dramaticQuestion: 'Will Marta get an answer?',
          escalation: 'The proof makes silence untenable.',
          escalationEvidence: [{ beatId: 'beat-1' }],
          turnBeatId: 'beat-1',
        },
      ],
      heroJourney: {
        applies: false,
        protagonistName: null,
        rationale: 'A short ensemble fragment does not support this lens.',
        stages: [],
      },
      characterArcs: [],
      sceneTurns: [
        {
          sceneId: 'scene-1',
          focalCharacterName: 'Marta',
          dramaticFunction: 'Introduce the conflict.',
          conflict: 'Marta presses Dan.',
          stakes: 'The proof could disappear.',
          turnBeatId: 'beat-1',
          turn: 'Marta makes the accusation explicit.',
        },
      ],
      threadMovements: [],
    }

    expect(InferredNarrativeMap.parse(payload)).toEqual(payload)
  })
})

describe('NarrativeMap.unanalyzedSceneIds', () => {
  const map = {
    dramaticQuestion: 'Can Marta make Dan tell the truth?',
    centralConflict: 'Marta seeks proof while Dan hides it.',
    controllingIdea: 'Loyalty makes truth costly.',
    themes: [
      {
        label: 'Loyalty',
        statement: 'Loyalty can hide the truth.',
        evidence: [{ beatId: 'beat-1', quote: 'Marta waits.' }],
      },
    ],
    acts: [
      {
        act: 0,
        dramaticQuestion: 'Will Marta get an answer?',
        escalation: '',
        escalationEvidence: [],
        turnBeatId: 'beat-1',
        evidenceQuote: 'Marta waits.',
      },
    ],
    heroJourney: {
      applies: false,
      protagonistCharacterId: null,
      rationale: 'An ensemble fragment.',
      stages: [],
    },
    characterArcs: [],
    sceneTurns: [
      {
        sceneId: 'scene-1',
        focalCharacterId: null,
        dramaticFunction: '',
        conflict: '',
        stakes: '',
        turnBeatId: 'beat-1',
        turn: 'Marta makes the accusation explicit.',
        evidenceQuote: 'Marta waits.',
      },
    ],
    threadMovements: [],
  }

  it('defaults to none so maps saved before it still parse', () => {
    expect(NarrativeMap.parse(map).unanalyzedSceneIds).toEqual([])
  })

  it('keeps the scenes listed as unanalysed', () => {
    expect(
      NarrativeMap.parse({ ...map, unanalyzedSceneIds: ['scene-2'] })
        .unanalyzedSceneIds,
    ).toEqual(['scene-2'])
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
      evidenceQuote: 'Great Scott!',
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
      // Server-derived on merge; null until a quote resolves to a beat.
      setupBeatId: null,
      payoffBeatId: null,
      locked: false,
      // T10.2: untagged until an import merge keeps its storyline.
      storyline: null,
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
  it('parses a pre-0.53.0 payload (threads/sceneMotivations/worldRules), defaulting storylines', () => {
    const payload = {
      threads: [
        {
          label: 'Sports Almanac temptation',
          summary: 'Marty finds the almanac; will he use it?',
          status: 'open',
          ownerNames: ['Marty'],
          setupSceneId: 'scene-1',
          payoffSceneId: null,
          setupBeatId: 'beat-1-1',
          payoffBeatId: null,
        },
      ],
      secrets: [
        {
          summary: 'Marty is hiding the almanac from Doc.',
          holderNames: ['Marty'],
          concealedFromNames: ['Doc'],
          audienceKnows: true,
          establishedSceneId: 'scene-1',
          revealedSceneId: null,
          concealmentSceneIds: [],
          establishedBeatId: 'beat-1-1',
          revealedBeatId: null,
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
              statedObjective: '',
              concealed: false,
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
          evidenceBeatId: 'beat-1-1',
        },
      ],
    }
    expect(NarrativePromises.parse(payload)).toEqual({
      ...payload,
      threads: [{ ...payload.threads[0], storyline: null }],
      storylines: [],
    })
  })

  it('round-trips storylines A-D and a thread storyline letter (T10.2)', () => {
    const payload = {
      threads: [
        {
          label: 'x',
          summary: 'x',
          status: 'open',
          ownerNames: [],
          setupSceneId: 'scene-1',
          payoffSceneId: null,
          setupBeatId: null,
          payoffBeatId: null,
          storyline: 'D',
        },
      ],
      storylines: [
        {
          letter: 'A',
          summary: 'Marty tries to get home.',
          characterNames: ['Marty'],
          sceneIds: ['scene-1'],
        },
        {
          letter: 'D',
          summary: 'Biff keeps losing his car.',
          characterNames: ['Biff'],
          sceneIds: ['scene-2'],
        },
      ],
      secrets: [],
      sceneMotivations: [],
      worldRules: [],
    }
    expect(NarrativePromises.parse(payload)).toEqual(payload)
    expect(() =>
      NarrativePromises.parse({
        ...payload,
        storylines: [{ ...payload.storylines[0], letter: 'E' }],
      }),
    ).toThrow()
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

describe('ProjectImportProgressEvent found', () => {
  const format = {
    genre: 'drama',
    runtimeMinutes: 60,
    actCount: 4,
    coldOpen: true,
    tag: false,
    serialization: 0.5,
  }
  const examples = [
    {
      kind: 'scenes',
      scenes: [
        {
          index: 0,
          slugline: 'INT. BAR - NIGHT',
          lineCount: 12,
          intExt: 'int',
        },
      ],
    },
    {
      kind: 'scene',
      index: 3,
      beatCount: 5,
      whatHappens: 'Marta finds the transfer.',
      failed: false,
      beats: [
        {
          whatHappens: 'Marta opens the ledger.',
          audienceLearns: 'The money moved.',
          audienceFeels: 'Dread',
        },
      ],
    },
    { kind: 'acts', format, sceneActs: [1, 1, 2] },
    { kind: 'castRead', sceneIndexes: [0, 1, 2] },
    { kind: 'cast', total: 7, characters: [{ name: 'MARTA', sceneCount: 9 }] },
    {
      kind: 'threads',
      threads: [
        {
          label: 'The money',
          status: 'open',
          setupSceneIndex: 1,
          payoffSceneIndex: null,
        },
      ],
    },
    {
      kind: 'overview',
      logline: 'A bartender learns her brother moved the money.',
      beatSheet: [{ label: 'Catalyst', sceneIndex: null }],
    },
    { kind: 'facts', index: 2, factCount: 4, secretCount: 1, failed: false },
    { kind: 'flags', contradictions: 1, tensions: 2, other: 0 },
  ]

  it.each(examples)('accepts a $kind frame', (data) => {
    const event = { type: 'found', stage: 'parsing_scenes', data }
    expect(ProjectImportProgressEvent.parse(event)).toEqual({
      ...event,
      cached: false,
    })
  })

  it("defaults a 'scene' frame's beats to none (additive, T9.17)", () => {
    const data = {
      kind: 'scene',
      index: 0,
      beatCount: 1,
      whatHappens: '',
      failed: true,
    }
    const event = { type: 'found', stage: 'segmenting_beats', data }
    expect(ProjectImportProgressEvent.parse(event)).toEqual({
      ...event,
      cached: false,
      data: { ...data, beats: [] },
    })
  })

  it('rejects a negative index and an unknown kind', () => {
    const frame = (data: unknown) => ({
      type: 'found',
      stage: 'segmenting_beats',
      data,
    })
    expect(() =>
      ProjectImportProgressEvent.parse(
        frame({
          kind: 'scene',
          index: -1,
          beatCount: 1,
          whatHappens: '',
          failed: false,
        }),
      ),
    ).toThrow()
    expect(() =>
      ProjectImportProgressEvent.parse(frame({ kind: 'mystery' })),
    ).toThrow()
  })
})

describe('Motivation stated vs actual', () => {
  it('defaults to no stated/actual gap so existing docs validate', () => {
    const parsed = Motivation.parse({
      characterId: 'char-marta',
      objective: 'Get Dan to admit he moved the money.',
      stakes: 'Trusting her brother.',
      obstacle: 'Dan deflects.',
    })
    expect(parsed.statedObjective).toBe('')
    expect(parsed.concealed).toBe(false)
  })

  it('carries an ulterior motive as the gap between stated and actual', () => {
    const parsed = Motivation.parse({
      characterId: 'char-dan',
      objective: 'Keep Marta away from the ice machine.',
      stakes: 'The money.',
      obstacle: 'She already saw the transfer.',
      statedObjective: 'Close up the bar.',
      concealed: true,
    })
    expect(parsed.statedObjective).not.toBe(parsed.objective)
    expect(parsed.concealed).toBe(true)
  })
})

describe('KnowledgeEvent kinds', () => {
  it('accepts belief states distinct from knowing', () => {
    for (const kind of [
      'learns',
      'confirms',
      'forgets',
      'suspects',
      'misinformed',
    ]) {
      expect(KnowledgeEvent.parse({ sceneId: 'scene-2', kind }).kind).toBe(kind)
    }
  })

  it('rejects a kind the fold has no semantics for', () => {
    expect(() =>
      KnowledgeEvent.parse({ sceneId: 'scene-2', kind: 'overhears' }),
    ).toThrow()
  })
})

describe('Secret', () => {
  it('treats a null revealedSceneId as still concealed', () => {
    const parsed = Secret.parse({
      id: 'secret-01',
      summary: "Dan hid the money in the bar's ice machine.",
      holderCharacterIds: ['char-dan'],
      concealedFromCharacterIds: ['char-marta'],
      establishedSceneId: 'scene-2',
    })
    expect(parsed.revealedSceneId).toBeNull()
    expect(parsed.factId).toBeNull()
    expect(parsed.audienceKnows).toBe(true)
    expect(parsed.provenance).toBe('inferred')
    expect(parsed.locked).toBe(false)
  })

  it('requires the concealment asymmetry to be expressible', () => {
    // A fact everyone knows is not a secret: holder and concealed-from are
    // what distinguish one from a plain ledger fact.
    const parsed = Secret.parse({
      id: 'secret-01',
      summary: 'x',
      establishedSceneId: 'scene-1',
      holderCharacterIds: ['char-dan'],
      concealedFromCharacterIds: ['char-marta'],
      concealmentSceneIds: ['scene-3'],
      revealedSceneId: 'scene-9',
    })
    expect(parsed.holderCharacterIds).toEqual(['char-dan'])
    expect(parsed.concealedFromCharacterIds).toEqual(['char-marta'])
    expect(parsed.concealmentSceneIds).toEqual(['scene-3'])
  })
})

describe('Episode.secrets', () => {
  it('defaults to [] so pre-existing docs validate', () => {
    const episode = Episode.parse({
      id: 'ep-1',
      index: 0,
      title: 'Pilot',
      premise: '',
      storylines: [],
      scenes: [],
    })
    expect(episode.secrets).toEqual([])
  })

  it('accepts a D storyline on the episode and its scenes (T10.2)', () => {
    const episode = Episode.parse({
      id: 'ep-1',
      index: 0,
      title: 'Pilot',
      premise: '',
      storylines: [{ id: 'D', summary: 'The runner.', characterIds: [] }],
      scenes: [
        {
          id: 'scene-1',
          index: 0,
          act: 1,
          storyline: 'D',
          location: '',
          time: '',
          socialSituation: '',
          whatHappens: '',
          audienceLearns: '',
          audienceFeels: '',
          motivations: [],
          beats: [],
        },
      ],
    })
    expect(episode.storylines[0].id).toBe('D')
    expect(episode.scenes[0].storyline).toBe('D')
  })
})

describe('StructureCheck', () => {
  const stage = {
    stage: 'circle_you',
    status: 'hit',
    beatId: 'beat-1-1',
    sceneId: 'scene-1',
    reason: 'Marta at the bar.',
    evidenceQuote: 'Marta pours.',
  }
  const check = {
    lens: 'story_circle',
    applies: true,
    rationale: 'Fits.',
    stages: [stage],
    sourceHash: 'abc',
    checkedAt: '2026-10-11T00:00:00Z',
    promptVersion: '0.51.0',
  }
  it('accepts a check and a missing stage with null beat and quote', () => {
    expect(StructureCheck.safeParse(check).success).toBe(true)
    expect(
      StructureStage.safeParse({
        ...stage,
        status: 'missing',
        beatId: null,
        sceneId: null,
        evidenceQuote: null,
      }).success,
    ).toBe(true)
  })
  it('rejects tv_act_structure as a stored lens and an unknown stage', () => {
    expect(
      StructureCheck.safeParse({ ...check, lens: 'tv_act_structure' }).success,
    ).toBe(false)
    expect(StructureStage.safeParse({ ...stage, stage: 'you' }).success).toBe(
      false,
    )
  })
  it('loads a pre-T10.5 stage with null position fields', () => {
    expect(StructureStage.parse(stage)).toMatchObject({
      positionPct: null,
      expectedPct: null,
      windowPct: null,
      placement: null,
    })
  })
  it('accepts a placed Turning Points stage and bounds positionPct', () => {
    const placed = {
      ...stage,
      stage: 'tp_point_of_no_return',
      positionPct: 48.2,
      expectedPct: 51,
      windowPct: 12,
      placement: 'in_window',
    }
    expect(
      StructureCheck.safeParse({
        ...check,
        lens: 'turning_points',
        stages: [placed],
      }).success,
    ).toBe(true)
    expect(
      StructureStage.safeParse({ ...placed, positionPct: 101 }).success,
    ).toBe(false)
    expect(
      StructureStage.safeParse({ ...placed, placement: 'on_time' }).success,
    ).toBe(false)
  })
  it('defaults Episode.structureChecks to []', () => {
    const episode = Episode.parse({
      id: 'ep-1',
      index: 0,
      title: 'Pilot',
      premise: '',
      storylines: [],
      scenes: [],
    })
    expect(episode.structureChecks).toEqual([])
  })
})

describe('T10.1 scene turn and beat actions', () => {
  const beat = {
    id: 'beat-3-1',
    index: 0,
    whatHappens: 'w',
    audienceLearns: 'l',
    audienceFeels: 'f',
  }
  const scene = {
    id: 'scene-3',
    index: 2,
    act: 1,
    location: 'INT. BAR - NIGHT',
    time: 'NIGHT',
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [beat],
  }
  it('defaults the new fields on a pre-T10.1 scene', () => {
    const parsed = Scene.parse(scene)
    expect(parsed).toMatchObject({
      valueAtStake: '',
      chargeIn: null,
      chargeOut: null,
      whyNow: '',
    })
    expect(parsed.beats[0]).toMatchObject({
      actorCharacterId: null,
      actionVerb: '',
      targetCharacterId: null,
      reaction: '',
    })
  })
  it('round-trips the new fields and rejects an unknown charge', () => {
    const full = {
      ...scene,
      valueAtStake: 'trust',
      chargeIn: 'negative',
      chargeOut: 'mixed',
      whyNow: 'The audit lands tomorrow.',
      beats: [
        {
          ...beat,
          actorCharacterId: 'char-marta',
          actionVerb: 'probes',
          targetCharacterId: 'char-dan',
          reaction: 'deflects',
        },
      ],
    }
    expect(Scene.parse(full)).toMatchObject(full)
    expect(Scene.safeParse({ ...full, chargeIn: 'up' }).success).toBe(false)
  })
  it('parses a pre-0.54.0 segment_scene response with defaults', () => {
    const parsed = SegmentedScene.parse({
      segments: [
        {
          kind: 'beat',
          startLine: 1,
          whatHappens: 'w',
          audienceLearns: 'l',
          audienceFeels: 'f',
        },
      ],
    })
    expect(parsed.segments[0]).toMatchObject({
      actor: '',
      actionVerb: '',
      target: '',
      reaction: '',
    })
    expect(parsed).toMatchObject({
      sceneValueAtStake: '',
      sceneChargeIn: null,
      sceneChargeOut: null,
      sceneWhyNow: '',
    })
  })
})
