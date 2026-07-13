import { describe, expect, it } from 'vitest'
import type {
  Beat,
  Character,
  LedgerFact,
  Project,
  Scene,
  ShowFormat,
} from 'contract'
import {
  actLabel,
  actNumbersForBoard,
  actNumbersForFormat,
  affectedFacts,
  buildBeatPatch,
  buildScenePatch,
  buildSceneSwapPatch,
  characterName,
  findScenePointer,
  groupScenesByAct,
  isBeatEffectivelyLocked,
  swapScenesLocally,
  withBeatField,
  withSceneField,
} from './planTree'

function beat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: 'beat-x',
    index: 0,
    locked: false,
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    scriptText: '',
    scriptLocked: false,
    ...overrides,
  }
}

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-x',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: '',
    time: '',
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...overrides,
  }
}

// Mirrors the fixture's shape closely enough to exercise real array-index
// pointer construction (data contract §1 nesting) without importing the
// whole fixture file.
function project(scenes: Scene[]): Project {
  return {
    id: 'proj-x',
    title: 'Test Project',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: false,
      serialization: 0.8,
    },
    enabledComponents: [],
    premise: 'A premise.',
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
            title: 'Ep 1',
            premise: 'Episode premise.',
            seasonFunction: '',
            storylines: [],
            scenes,
          },
        ],
      },
    ],
    headSnapshotId: 'snap-root',
  }
}

// The fixture's scene-3/scene-4 shape: same as docs/tableread-fixture.json —
// scene-3 is Act One (index 2), scene-4 is Act Two (index 3).
function fixtureLikeScenes(): Scene[] {
  return [
    scene({ id: 'scene-1', index: 0, act: 0 }),
    scene({ id: 'scene-2', index: 1, act: 1 }),
    scene({ id: 'scene-3', index: 2, act: 1 }),
    scene({ id: 'scene-4', index: 3, act: 2 }),
    scene({ id: 'scene-5', index: 4, act: 3 }),
    scene({ id: 'scene-6', index: 5, act: 4 }),
  ]
}

describe('findScenePointer', () => {
  it('locates a scene by its array position across season/episode nesting', () => {
    const p = project(fixtureLikeScenes())
    expect(findScenePointer(p, 'scene-4')).toEqual({
      seasonIdx: 0,
      episodeIdx: 0,
      sceneIdx: 3,
    })
  })

  it('returns null for an unknown scene id', () => {
    const p = project(fixtureLikeScenes())
    expect(findScenePointer(p, 'scene-nope')).toBeNull()
  })
})

describe('buildSceneSwapPatch (obligation 3: index swap semantics)', () => {
  it('same-act drag: swaps index only, no act op', () => {
    const p = project(fixtureLikeScenes())
    const ops = buildSceneSwapPatch(p, 'scene-2', 'scene-3')
    expect(ops).toEqual([
      { op: 'replace', path: '/seasons/0/episodes/0/scenes/1/index', value: 2 },
      { op: 'replace', path: '/seasons/0/episodes/0/scenes/2/index', value: 1 },
    ])
  })

  it('cross-act drag (scene-4 onto scene-3): dragged scene adopts the target act; target act unchanged', () => {
    const p = project(fixtureLikeScenes())
    const ops = buildSceneSwapPatch(p, 'scene-4', 'scene-3')
    expect(ops).toEqual([
      { op: 'replace', path: '/seasons/0/episodes/0/scenes/3/index', value: 2 },
      { op: 'replace', path: '/seasons/0/episodes/0/scenes/2/index', value: 3 },
      { op: 'replace', path: '/seasons/0/episodes/0/scenes/3/act', value: 1 },
    ])
  })

  it('returns null when dragging a scene onto itself', () => {
    const p = project(fixtureLikeScenes())
    expect(buildSceneSwapPatch(p, 'scene-3', 'scene-3')).toBeNull()
  })

  it('returns null when either scene is missing', () => {
    const p = project(fixtureLikeScenes())
    expect(buildSceneSwapPatch(p, 'scene-3', 'scene-nope')).toBeNull()
    expect(buildSceneSwapPatch(p, 'scene-nope', 'scene-3')).toBeNull()
  })
})

describe('swapScenesLocally (optimistic twin of buildSceneSwapPatch)', () => {
  it('produces the same resulting fields the patch ops describe', () => {
    const p = project(fixtureLikeScenes())
    const next = swapScenesLocally(p, 'scene-4', 'scene-3')
    const nextScenes = next.seasons[0].episodes[0].scenes
    const scene4 = nextScenes.find((s) => s.id === 'scene-4')!
    const scene3 = nextScenes.find((s) => s.id === 'scene-3')!
    expect(scene4).toMatchObject({ index: 2, act: 1 })
    expect(scene3).toMatchObject({ index: 3, act: 1 })
    // Everything else is untouched.
    expect(nextScenes.find((s) => s.id === 'scene-2')).toMatchObject({
      index: 1,
      act: 1,
    })
  })

  it('never mutates the input project (structural sharing aside, no aliasing)', () => {
    const p = project(fixtureLikeScenes())
    const before = JSON.stringify(p)
    swapScenesLocally(p, 'scene-4', 'scene-3')
    expect(JSON.stringify(p)).toBe(before)
  })

  it('results in a valid permutation: every index 0..N-1 still appears exactly once', () => {
    const p = project(fixtureLikeScenes())
    const next = swapScenesLocally(p, 'scene-4', 'scene-3')
    const indices = next.seasons[0].episodes[0].scenes
      .map((s) => s.index)
      .sort()
    expect(indices).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('grouping by act after the swap puts scene-4 immediately before scene-3 inside Act One', () => {
    const p = project(fixtureLikeScenes())
    const next = swapScenesLocally(p, 'scene-4', 'scene-3')
    const groups = groupScenesByAct(next.seasons[0].episodes[0].scenes)
    expect(groups.get(1)!.map((s) => s.id)).toEqual([
      'scene-2',
      'scene-4',
      'scene-3',
    ])
    expect(groups.get(2)).toBeUndefined() // Act Two is now empty
  })

  it('is a no-op (returns the same project) for a self-drop', () => {
    const p = project(fixtureLikeScenes())
    expect(swapScenesLocally(p, 'scene-3', 'scene-3')).toBe(p)
  })
})

describe('buildScenePatch / buildBeatPatch (lock toggles, field saves)', () => {
  it('builds a single replace op for a scene field', () => {
    const p = project(fixtureLikeScenes())
    expect(buildScenePatch(p, 'scene-3', 'locked', true)).toEqual([
      {
        op: 'replace',
        path: '/seasons/0/episodes/0/scenes/2/locked',
        value: true,
      },
    ])
  })

  it('builds a single replace op for a beat field, addressed by beat array index', () => {
    const scenes = fixtureLikeScenes()
    scenes[0] = {
      ...scenes[0],
      beats: [beat({ id: 'beat-1-1' }), beat({ id: 'beat-1-2' })],
    }
    const p = project(scenes)
    expect(
      buildBeatPatch(p, 'scene-1', 'beat-1-2', 'scriptLocked', false),
    ).toEqual([
      {
        op: 'replace',
        path: '/seasons/0/episodes/0/scenes/0/beats/1/scriptLocked',
        value: false,
      },
    ])
  })

  it('returns null for an unknown scene or beat', () => {
    const p = project(fixtureLikeScenes())
    expect(buildScenePatch(p, 'scene-nope', 'locked', true)).toBeNull()
    expect(
      buildBeatPatch(p, 'scene-1', 'beat-nope', 'scriptLocked', true),
    ).toBeNull()
  })
})

describe('withSceneField / withBeatField (optimistic twins of the lock/save patches)', () => {
  it('sets one scene field immutably, leaving siblings untouched', () => {
    const p = project(fixtureLikeScenes())
    const next = withSceneField(p, 'scene-3', 'locked', true)
    const nextScenes = next.seasons[0].episodes[0].scenes
    expect(nextScenes.find((s) => s.id === 'scene-3')!.locked).toBe(true)
    expect(nextScenes.find((s) => s.id === 'scene-2')!.locked).toBe(false)
    expect(
      p.seasons[0].episodes[0].scenes.find((s) => s.id === 'scene-3')!.locked,
    ).toBe(false)
  })

  it('sets one beat field immutably, leaving sibling beats untouched', () => {
    const scenes = fixtureLikeScenes()
    scenes[0] = {
      ...scenes[0],
      beats: [
        beat({ id: 'beat-1-1' }),
        beat({ id: 'beat-1-2', scriptLocked: true }),
      ],
    }
    const p = project(scenes)
    const next = withBeatField(p, 'scene-1', 'beat-1-2', 'scriptLocked', false)
    const nextBeats = next.seasons[0].episodes[0].scenes[0].beats
    expect(nextBeats.find((b) => b.id === 'beat-1-2')!.scriptLocked).toBe(false)
    expect(nextBeats.find((b) => b.id === 'beat-1-1')!.scriptLocked).toBe(false)
    expect(
      p.seasons[0].episodes[0].scenes[0].beats.find((b) => b.id === 'beat-1-2')!
        .scriptLocked,
    ).toBe(true)
  })
})

describe('actNumbersForBoard / actLabel', () => {
  const format: ShowFormat = {
    genre: 'drama',
    runtimeMinutes: 60,
    actCount: 4,
    coldOpen: true,
    tag: false,
    serialization: 0.8,
  }

  it('returns every valid act number for formats with and without a cold open', () => {
    expect(
      actNumbersForFormat({
        genre: 'drama',
        runtimeMinutes: 60,
        actCount: 5,
        coldOpen: true,
        tag: false,
        serialization: 0.8,
      }),
    ).toEqual([0, 1, 2, 3, 4, 5])

    expect(
      actNumbersForFormat({
        genre: 'comedy',
        runtimeMinutes: 30,
        actCount: 2,
        coldOpen: false,
        tag: false,
        serialization: 0.2,
      }),
    ).toEqual([0, 1])
  })

  it('renders every act in the format range, cold open through the last act', () => {
    expect(actNumbersForBoard(format, [])).toEqual([0, 1, 2, 3, 4])
  })

  it('still includes an act frame emptied by a drag (present in format range already)', () => {
    const scenes = fixtureLikeScenes().filter((s) => s.act !== 2) // simulate scene-4 having left act 2
    expect(actNumbersForBoard(format, scenes)).toContain(2)
  })

  it('unions in an out-of-range act present on a scene, defensively', () => {
    const scenes = [scene({ act: 9 })]
    expect(actNumbersForBoard(format, scenes)).toContain(9)
  })

  it('labels cold open and acts one..four per the format', () => {
    expect(actLabel(0, format)).toBe('COLD OPEN')
    expect(actLabel(1, format)).toBe('ACT ONE')
    expect(actLabel(4, format)).toBe('ACT FOUR')
  })

  it('without a cold open, act 0 is ACT ONE', () => {
    const noCold = { ...format, coldOpen: false }
    expect(actLabel(0, noCold)).toBe('ACT ONE')
  })
})

describe('groupScenesByAct', () => {
  it('groups and sorts each group by index ascending', () => {
    const scenes = fixtureLikeScenes()
    const groups = groupScenesByAct(scenes)
    expect(groups.get(1)!.map((s) => s.id)).toEqual(['scene-2', 'scene-3'])
    expect(groups.get(0)!.map((s) => s.id)).toEqual(['scene-1'])
  })
})

describe('affectedFacts', () => {
  function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
    return {
      id: 'fact-x',
      fact: 'A fact.',
      factType: 'state',
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
      audienceKnows: true,
      provenance: 'writer_confirmed',
      confidence: 0.9,
      status: 'active',
      supersedes: null,
      supersededBy: null,
      ...overrides,
    }
  }

  it('filters to facts whose sourceSpan.sceneId matches', () => {
    const ledger = [
      fact({ id: 'fact-01' }),
      fact({
        id: 'fact-02',
        sourceSpan: { ...fact().sourceSpan, sceneId: 'scene-2' },
      }),
    ]
    expect(affectedFacts(ledger, 'scene-1').map((f) => f.id)).toEqual([
      'fact-01',
    ])
  })
})

describe('characterName', () => {
  it('resolves a known character id to its name', () => {
    const characters: Character[] = [
      {
        id: 'char-marta',
        name: 'Marta Vega',
        locked: false,
        embodiment: '',
        presentation: '',
        hiding: '',
        traits: '',
        seriesArc: '',
      },
    ]
    expect(characterName(characters, 'char-marta')).toBe('Marta Vega')
  })

  it('falls back to the raw id when unknown', () => {
    expect(characterName([], 'char-nope')).toBe('char-nope')
  })
})

describe('isBeatEffectivelyLocked (mirrors drama_manager/locks.py cascade)', () => {
  it('locked by its own beat.locked', () => {
    expect(
      isBeatEffectivelyLocked(false, scene(), beat({ locked: true })),
    ).toBe(true)
  })

  it('locked by its own beat.scriptLocked', () => {
    expect(
      isBeatEffectivelyLocked(false, scene(), beat({ scriptLocked: true })),
    ).toBe(true)
  })

  it('locked by the containing scene', () => {
    expect(
      isBeatEffectivelyLocked(false, scene({ locked: true }), beat()),
    ).toBe(true)
  })

  it('locked by the containing episode', () => {
    expect(isBeatEffectivelyLocked(true, scene(), beat())).toBe(true)
  })

  it('not locked when nothing in the cascade is locked', () => {
    expect(isBeatEffectivelyLocked(false, scene(), beat())).toBe(false)
  })
})
