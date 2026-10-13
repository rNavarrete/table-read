import { describe, expect, it } from 'vitest'
import type {
  ConsistencyFlag,
  LedgerFact,
  Project,
  ProjectImportFound,
  ShowFormat,
} from 'contract'
import {
  actGroups,
  applyFound,
  type BoardState,
  emptyBoard,
  reconcileWithResult,
} from './importBoard'

const FORMAT: ShowFormat = {
  genre: 'comedy',
  runtimeMinutes: 22,
  actCount: 2,
  coldOpen: true,
  tag: false,
  serialization: 0.5,
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function apply(state: BoardState, ...frames: ProjectImportFound[]) {
  return frames.reduce(
    (current, frame) => applyFound(deepFreeze(current), frame),
    state,
  )
}

const SCENES: ProjectImportFound = {
  kind: 'scenes',
  scenes: [
    { index: 0, slugline: 'INT. BAR - NIGHT', lineCount: 12, intExt: 'int' },
    { index: 1, slugline: 'EXT. ALLEY', lineCount: 4, intExt: 'ext' },
    { index: 2, slugline: 'INT./EXT. CAR', lineCount: 7, intExt: 'other' },
  ],
}

function scanned() {
  return apply(emptyBoard(), SCENES)
}

describe('import board reducer', () => {
  it('starts empty', () => {
    expect(emptyBoard()).toEqual({
      scenes: [],
      format: null,
      actsKnown: false,
      cast: null,
      threads: null,
      logline: null,
      beatSheet: [],
      flags: null,
      latestIndex: null,
      factTotal: 0,
    })
  })

  it('deals one pending card per parsed scene', () => {
    const state = scanned()
    expect(state.scenes).toHaveLength(3)
    expect(state.scenes[1]).toEqual({
      index: 1,
      slugline: 'EXT. ALLEY',
      lineCount: 4,
      intExt: 'ext',
      read: 'pending',
      beatCount: 0,
      whatHappens: '',
      act: null,
      castRead: false,
      factCount: null,
      secretCount: 0,
      factsFailed: false,
      pins: [],
    })
  })

  it('fills scene readings out of order and marks a failed unit', () => {
    const state = apply(
      scanned(),
      {
        kind: 'scene',
        index: 2,
        beatCount: 4,
        whatHappens: 'Ruth drives.',
        failed: false,
        beats: [],
      },
      {
        kind: 'scene',
        index: 0,
        beatCount: 1,
        whatHappens: '',
        failed: true,
        beats: [],
      },
    )
    expect(state.scenes.map((card) => card.read)).toEqual([
      'failed',
      'pending',
      'read',
    ])
    expect(state.scenes[2]).toMatchObject({
      beatCount: 4,
      whatHappens: 'Ruth drives.',
    })
    expect(state.scenes[0].beatCount).toBe(1)
  })

  it('ignores a frame for a scene the board has no card for', () => {
    const state = scanned()
    expect(
      applyFound(state, {
        kind: 'scene',
        index: 9,
        beatCount: 1,
        whatHappens: 'x',
        failed: false,
        beats: [],
      }),
    ).toBe(state)
  })

  it('sets each card act and groups them under act labels', () => {
    const before = scanned()
    expect(actGroups(before)).toEqual([])

    const state = apply(before, {
      kind: 'acts',
      format: FORMAT,
      sceneActs: [0, 1, 1],
    })
    expect(state.actsKnown).toBe(true)
    expect(state.format).toEqual(FORMAT)
    expect(state.scenes.map((card) => card.act)).toEqual([0, 1, 1])
    expect(actGroups(state)).toEqual([
      { act: 0, label: 'COLD OPEN', sceneIndexes: [0] },
      { act: 1, label: 'ACT ONE', sceneIndexes: [1, 2] },
    ])
  })

  it('marks the cards an entity chunk covered', () => {
    const state = apply(scanned(), { kind: 'castRead', sceneIndexes: [0, 2] })
    expect(state.scenes.map((card) => card.castRead)).toEqual([
      true,
      false,
      true,
    ])
  })

  it('stores the cast as given', () => {
    const cast = {
      total: 14,
      characters: [
        { name: 'Marta', sceneCount: 3 },
        { name: 'Dev', sceneCount: 2 },
      ],
    }
    const state = apply(scanned(), { kind: 'cast', ...cast })
    expect(state.cast).toEqual(cast)
  })

  it('pins each thread by its 1-based number on its setup and payoff cards', () => {
    const threads = [
      {
        label: 'The second ledger',
        status: 'paid_off' as const,
        setupSceneIndex: 0,
        payoffSceneIndex: 2,
      },
      {
        label: 'Back pay',
        status: 'open' as const,
        setupSceneIndex: 2,
        payoffSceneIndex: null,
      },
      {
        label: 'Unplaced',
        status: 'abandoned' as const,
        setupSceneIndex: null,
        payoffSceneIndex: null,
      },
    ]
    const state = apply(scanned(), { kind: 'threads', threads })
    expect(state.threads).toEqual(threads)
    expect(state.scenes.map((card) => card.pins)).toEqual([[1], [], [1, 2]])
  })

  it('pins a thread once when it sets up and pays off in one scene', () => {
    const state = apply(scanned(), {
      kind: 'threads',
      threads: [
        {
          label: 'Same scene',
          status: 'paid_off',
          setupSceneIndex: 1,
          payoffSceneIndex: 1,
        },
      ],
    })
    expect(state.scenes[1].pins).toEqual([1])
  })

  it('sets the logline and beat sheet', () => {
    const beatSheet = [
      { label: 'Catalyst', sceneIndex: 1 },
      { label: 'Theme', sceneIndex: null },
    ]
    const state = apply(scanned(), {
      kind: 'overview',
      logline: 'A bar owner hides the books.',
      beatSheet,
    })
    expect(state.logline).toBe('A bar owner hides the books.')
    expect(state.beatSheet).toEqual(beatSheet)
  })

  it('stamps fact counts per card and totals them', () => {
    const state = apply(
      scanned(),
      { kind: 'facts', index: 2, factCount: 5, secretCount: 1, failed: false },
      { kind: 'facts', index: 0, factCount: 3, secretCount: 0, failed: false },
      { kind: 'facts', index: 1, factCount: 0, secretCount: 0, failed: true },
    )
    expect(state.scenes.map((card) => card.factCount)).toEqual([3, 0, 5])
    expect(state.scenes[2].secretCount).toBe(1)
    expect(state.scenes.map((card) => card.factsFailed)).toEqual([
      false,
      true,
      false,
    ])
    expect(state.factTotal).toBe(8)
  })

  it('stores the flag counts', () => {
    const flags = { contradictions: 2, tensions: 6, other: 1 }
    expect(apply(scanned(), { kind: 'flags', ...flags }).flags).toEqual(flags)
  })

  it('follows the newest scene or facts frame for the lift and lamp', () => {
    let state = apply(scanned(), {
      kind: 'scene',
      index: 2,
      beatCount: 1,
      whatHappens: 'a',
      failed: false,
      beats: [],
    })
    expect(state.latestIndex).toBe(2)
    state = apply(state, {
      kind: 'facts',
      index: 1,
      factCount: 1,
      secretCount: 0,
      failed: false,
    })
    expect(state.latestIndex).toBe(1)
    state = apply(state, { kind: 'castRead', sceneIndexes: [0] })
    expect(state.latestIndex).toBe(1)
  })

  it('starts a fresh board when a new parse arrives', () => {
    const read = apply(
      scanned(),
      {
        kind: 'scene',
        index: 0,
        beatCount: 2,
        whatHappens: 'a',
        failed: false,
        beats: [],
      },
      { kind: 'flags', contradictions: 1, tensions: 0, other: 0 },
    )
    const again = apply(read, SCENES)
    expect(again).toEqual(scanned())
  })

  it('rebuilds the same board from a cached burst in any order', () => {
    const frames: ProjectImportFound[] = [
      {
        kind: 'scene',
        index: 1,
        beatCount: 2,
        whatHappens: 'b',
        failed: false,
        beats: [],
      },
      {
        kind: 'scene',
        index: 0,
        beatCount: 3,
        whatHappens: 'a',
        failed: false,
        beats: [],
      },
      {
        kind: 'scene',
        index: 2,
        beatCount: 1,
        whatHappens: 'c',
        failed: false,
        beats: [],
      },
    ]
    const forward = apply(scanned(), ...frames)
    const backward = apply(scanned(), ...[...frames].reverse())
    expect(forward.scenes).toEqual(backward.scenes)
    expect(forward.scenes.every((card) => card.read === 'read')).toBe(true)
  })
})

describe('reconcileWithResult', () => {
  function fact(id: string, sceneId: string, audienceKnows = true): LedgerFact {
    return {
      id,
      sourceSpan: { sceneId },
      audienceKnows,
    } as unknown as LedgerFact
  }

  function flag(severity: 'contradiction' | 'tension'): ConsistencyFlag {
    return { severity } as unknown as ConsistencyFlag
  }

  const project = {
    id: 'proj-1',
    format: FORMAT,
    seriesBible: {
      characters: [{ id: 'char-marta' }, { id: 'char-dev' }, { id: 'c3' }],
    },
    seasons: [
      {
        episodes: [
          {
            scenes: [
              {
                id: 'scene-1',
                index: 0,
                act: 0,
                location: 'INT. BAR - NIGHT',
                time: 'NIGHT',
                whatHappens: 'Server reading one.',
                beats: [{ scriptText: 'A\nB' }, { scriptText: 'C' }],
              },
              {
                id: 'scene-2',
                index: 1,
                act: 1,
                location: 'EXT. ALLEY',
                time: '',
                whatHappens: 'Server reading two.',
                beats: [{ scriptText: 'D' }],
              },
              {
                id: 'scene-3',
                index: 2,
                act: 1,
                location: 'INT. OFFICE',
                time: '',
                whatHappens: 'Server reading three.',
                beats: [{ scriptText: 'E' }, { scriptText: 'F' }],
              },
            ],
            threads: [
              {
                label: 'The second ledger',
                status: 'paid_off',
                setupSceneId: 'scene-1',
                payoffSceneId: 'scene-3',
              },
            ],
            storyOverview: {
              logline: 'Final logline.',
              beatSheet: [
                { label: 'Catalyst', sceneId: 'scene-2' },
                { label: 'Theme', sceneId: null },
              ],
            },
          },
        ],
      },
    ],
  } as unknown as Project

  const result = {
    project,
    newFacts: [
      fact('fact-01', 'scene-1'),
      fact('fact-02', 'scene-1', false),
      fact('fact-03', 'scene-3'),
    ],
    consistencyFlags: [flag('contradiction'), flag('tension'), flag('tension')],
  }

  it('sets the final counts from the project and keeps the readings it saw', () => {
    const live = deepFreeze(
      apply(
        scanned(),
        {
          kind: 'scene',
          index: 0,
          beatCount: 5,
          whatHappens: 'Live reading.',
          failed: false,
          beats: [],
        },
        {
          kind: 'scene',
          index: 2,
          beatCount: 1,
          whatHappens: '',
          failed: true,
          beats: [],
        },
        { kind: 'castRead', sceneIndexes: [0] },
        {
          kind: 'cast',
          total: 2,
          characters: [{ name: 'Marta', sceneCount: 2 }],
        },
        { kind: 'facts', index: 2, factCount: 0, secretCount: 0, failed: true },
      ),
    )

    const final = reconcileWithResult(live, result)

    expect(final.scenes[0]).toMatchObject({
      read: 'read',
      whatHappens: 'Live reading.',
      beatCount: 2,
      act: 0,
      factCount: 2,
      secretCount: 1,
      pins: [1],
    })
    expect(final.scenes[2]).toMatchObject({
      read: 'failed',
      beatCount: 2,
      factCount: 1,
      factsFailed: true,
      pins: [1],
    })
    expect(final.format).toEqual(FORMAT)
    expect(final.actsKnown).toBe(true)
    expect(final.factTotal).toBe(3)
    expect(final.cast).toEqual({
      total: 3,
      characters: [{ name: 'Marta', sceneCount: 2 }],
    })
    expect(final.threads).toEqual([
      {
        label: 'The second ledger',
        status: 'paid_off',
        setupSceneIndex: 0,
        payoffSceneIndex: 2,
      },
    ])
    expect(final.logline).toBe('Final logline.')
    expect(final.beatSheet).toEqual([
      { label: 'Catalyst', sceneIndex: 1 },
      { label: 'Theme', sceneIndex: null },
    ])
    expect(final.flags).toEqual({ contradictions: 1, tensions: 2, other: 0 })
    expect(final.scenes.every((card) => card.castRead)).toBe(true)
  })

  it('fills cards the client never saw from the project', () => {
    const final = reconcileWithResult(emptyBoard(), result)

    expect(final.scenes).toHaveLength(3)
    expect(final.scenes[1]).toEqual({
      index: 1,
      slugline: 'EXT. ALLEY',
      lineCount: 1,
      intExt: 'ext',
      read: 'read',
      beatCount: 1,
      whatHappens: 'Server reading two.',
      act: 1,
      castRead: true,
      factCount: 0,
      secretCount: 0,
      factsFailed: false,
      pins: [],
    })
    expect(final.scenes[0].lineCount).toBe(3)
    expect(final.cast).toEqual({ total: 3, characters: [] })
    expect(actGroups(final).map((group) => group.label)).toEqual([
      'COLD OPEN',
      'ACT ONE',
    ])
  })

  it('marks failed units the client never saw from their scene flags', () => {
    const unitFlag = (sceneId: string, code: string) =>
      ({
        objectType: 'scene',
        objectId: sceneId,
        severity: 'tension',
        explanation: `[${code}] The model's output failed validation twice.`,
      }) as unknown as ConsistencyFlag
    const final = reconcileWithResult(emptyBoard(), {
      ...result,
      consistencyFlags: [
        unitFlag('scene-2', 'segmentation_failed'),
        unitFlag('scene-3', 'extraction_failed'),
      ],
    })

    expect(final.scenes[0]).toMatchObject({ read: 'read', factsFailed: false })
    expect(final.scenes[1]).toMatchObject({
      read: 'failed',
      factsFailed: false,
    })
    expect(final.scenes[2]).toMatchObject({ read: 'read', factsFailed: true })
  })

  it('turns a pending card into its project reading', () => {
    const final = reconcileWithResult(scanned(), result)
    expect(final.scenes[1]).toMatchObject({
      slugline: 'EXT. ALLEY',
      lineCount: 4,
      read: 'read',
      whatHappens: 'Server reading two.',
    })
  })
})
