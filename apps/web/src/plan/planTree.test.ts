import { describe, expect, it } from 'vitest'
import type {
  Beat,
  Character,
  LedgerFact,
  Project,
  Scene,
  ShowFormat,
} from 'contract'
import type { ScenePanelProps } from './panel/ScenePanel'
import {
  actLabel,
  actNumbersForBoard,
  actNumbersForFormat,
  affectedFacts,
  applySceneMove,
  boardOrder,
  buildBeatPatch,
  buildScenePatch,
  characterName,
  findScenePointer,
  groupScenesByAct,
  isBeatEffectivelyLocked,
  type SceneMove,
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
    actorCharacterId: null,
    actionVerb: '',
    targetCharacterId: null,
    reaction: '',
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
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
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
            timelineAnchors: [],
            relationshipStates: [],
            objectStates: [],
            threads: [],
            secrets: [],
            storyOverview: null,
            narrativeMap: null,
            structureChecks: [],
          },
        ],
      },
    ],
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
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

describe('applySceneMove (insert model: index = board position)', () => {
  const P = '/seasons/0/episodes/0/scenes'
  const rep = (sceneIdx: number, field: string, value: number) => ({
    op: 'replace',
    path: `${P}/${sceneIdx}/${field}`,
    value,
  })
  const scenesOf = (p: Project) => p.seasons[0].episodes[0].scenes
  const ids = (p: Project) => boardOrder(scenesOf(p)).map((s) => s.id)
  const applied = (p: Project, move: SceneMove) => {
    const result = applySceneMove(p, move)
    if (!result || !('ops' in result)) throw new Error('expected a move')
    return result
  }
  const insert = (sceneId: string, targetSceneId: string, after: boolean) =>
    ({ type: 'insert', sceneId, targetSceneId, after }) as const
  const act = (sceneId: string, n: number) =>
    ({ type: 'act', sceneId, act: n }) as const
  const step = (sceneId: string, dir: 1 | -1) =>
    ({ type: 'step', sceneId, dir }) as const
  // Act 2 empty: scene-4 sits in act 3 with scene-5.
  const emptyActTwo = () =>
    project(
      fixtureLikeScenes().map((s) =>
        s.id === 'scene-4' ? { ...s, act: 3 } : s,
      ),
    )

  it('an insert renumbers to board position and sends only what changed', () => {
    const p = project(fixtureLikeScenes())
    const { ops, next } = applied(p, insert('scene-5', 'scene-2', false))
    expect(ops).toEqual([
      rep(1, 'index', 2),
      rep(2, 'index', 3),
      rep(3, 'index', 4),
      rep(4, 'index', 1),
      rep(4, 'act', 1),
    ])
    expect(ids(next)).toEqual([
      'scene-1',
      'scene-5',
      'scene-2',
      'scene-3',
      'scene-4',
      'scene-6',
    ])
    expect(scenesOf(next).map((s) => s.id)).toEqual(
      scenesOf(p).map((s) => s.id),
    )
    expect(scenesOf(next)[0]).toBe(scenesOf(p)[0])
    expect(scenesOf(next)[5]).toBe(scenesOf(p)[5])
  })

  it("an insert after a card takes its act; the right half of an act's last card ends that act", () => {
    const p = project(fixtureLikeScenes())
    const { ops, next } = applied(p, insert('scene-5', 'scene-3', true))
    expect(ops).toEqual([
      rep(3, 'index', 4),
      rep(4, 'index', 3),
      rep(4, 'act', 1),
    ])
    expect(scenesOf(next)[4]).toMatchObject({ index: 3, act: 1 })
    expect(scenesOf(next)[3]).toMatchObject({ index: 4 })
    expect(applied(p, insert('scene-2', 'scene-1', true)).ops).toEqual([
      rep(1, 'act', 0),
    ])
  })

  it('a drop beside itself, on itself, or on an unknown card is null', () => {
    const p = project(fixtureLikeScenes())
    expect(applySceneMove(p, insert('scene-2', 'scene-3', false))).toBeNull()
    expect(applySceneMove(p, insert('scene-3', 'scene-2', true))).toBeNull()
    expect(applySceneMove(p, insert('scene-3', 'scene-3', true))).toBeNull()
    expect(applySceneMove(p, insert('scene-3', 'scene-nope', true))).toBeNull()
    expect(applySceneMove(p, insert('scene-nope', 'scene-3', true))).toBeNull()
  })

  it('an Act move lands on the nearest edge: the start of a later act, the end of an earlier one', () => {
    const p = project(fixtureLikeScenes())
    const toColdOpen = applied(p, act('scene-5', 0))
    expect(toColdOpen.ops).toEqual([
      rep(1, 'index', 2),
      rep(2, 'index', 3),
      rep(3, 'index', 4),
      rep(4, 'index', 1),
      rep(4, 'act', 0),
    ])
    expect(ids(toColdOpen.next)).toEqual([
      'scene-1',
      'scene-5',
      'scene-2',
      'scene-3',
      'scene-4',
      'scene-6',
    ])
    const later = applied(p, act('scene-2', 3))
    expect(ids(later.next)).toEqual([
      'scene-1',
      'scene-3',
      'scene-4',
      'scene-2',
      'scene-5',
      'scene-6',
    ])
    expect(scenesOf(later.next)[1].act).toBe(3)
    // The end of act 2 is where scene-5 already is.
    expect(applied(p, act('scene-5', 2)).ops).toEqual([rep(4, 'act', 2)])
    expect(applySceneMove(p, act('scene-3', 1))).toBeNull()
    expect(applySceneMove(p, act('scene-2', 1))).toBeNull()
    expect(applySceneMove(p, act('scene-nope', 0))).toBeNull()
  })

  it('an empty act takes the scene in place when nothing lies between', () => {
    expect(applied(emptyActTwo(), act('scene-3', 2)).ops).toEqual([
      rep(2, 'act', 2),
    ])
  })

  it("a step passes one neighbour, and at an act's edge crosses into the next act in place", () => {
    const p = project(fixtureLikeScenes())
    expect(applied(p, step('scene-3', -1)).ops).toEqual([
      rep(1, 'index', 2),
      rep(2, 'index', 1),
    ])
    expect(applied(p, step('scene-3', 1)).ops).toEqual([rep(2, 'act', 2)])

    const intoEmpty = applied(emptyActTwo(), step('scene-3', 1))
    expect(intoEmpty.ops).toEqual([rep(2, 'act', 2)])
    const intoActThree = applied(intoEmpty.next, step('scene-3', 1))
    expect(intoActThree.ops).toEqual([rep(2, 'act', 3)])
    expect(applied(intoActThree.next, step('scene-3', 1)).ops).toEqual([
      rep(2, 'index', 3),
      rep(3, 'index', 2),
    ])
  })

  it('a step off the first or last act is null', () => {
    const p = project(fixtureLikeScenes())
    expect(applySceneMove(p, step('scene-1', -1))).toBeNull()
    expect(applySceneMove(p, step('scene-6', 1))).toBeNull()
  })

  it('a move that leaves a locked scene in place is allowed', () => {
    const lock = (id: string) =>
      project(
        fixtureLikeScenes().map((s) =>
          s.id === id ? { ...s, locked: true } : s,
        ),
      )
    expect(applied(lock('scene-6'), step('scene-5', 1)).ops).toEqual([
      rep(4, 'act', 4),
    ])
    const { ops, next } = applied(
      lock('scene-3'),
      insert('scene-1', 'scene-3', false),
    )
    expect(ops).toEqual([
      rep(0, 'index', 1),
      rep(0, 'act', 1),
      rep(1, 'index', 0),
    ])
    expect(scenesOf(next)[2].index).toBe(2)
  })

  it('indices out of board order are renumbered by the first move', () => {
    // Defaults 2. Board: s1 s3 s4 s2 s5 (act, then index).
    const p = project([
      scene({ id: 's1', index: 0, act: 0 }),
      scene({ id: 's2', index: 1, act: 3 }),
      scene({ id: 's3', index: 2, act: 1 }),
      scene({ id: 's4', index: 3, act: 2 }),
      scene({ id: 's5', index: 4, act: 3 }),
    ])
    expect(applied(p, insert('s4', 's3', false)).ops).toEqual([
      rep(1, 'index', 3),
      rep(3, 'index', 1),
      rep(3, 'act', 1),
    ])
    // Dropping beside itself still moves nothing: no renumber-only PATCH.
    expect(applySceneMove(p, insert('s2', 's5', false))).toBeNull()
  })
})

describe('applySceneMove refuses moves that shift a locked scene (rule 2)', () => {
  const locked = (...ids: string[]) =>
    fixtureLikeScenes().map((s) => ({ ...s, locked: ids.includes(s.id) }))

  it('refuses an insert that would shift a locked scene: blockedBy, no ops', () => {
    // scene-2 after scene-4: locked scene-3 would move from index 2 to 1.
    const p = project(locked('scene-3'))
    const insert = {
      type: 'insert',
      sceneId: 'scene-2',
      targetSceneId: 'scene-4',
      after: true,
    } as const
    expect(applySceneMove(p, insert)).toEqual({ blockedBy: 'scene-3' })
  })

  it('refuses an Act move past a locked scene', () => {
    // scene-2 (act 1) to the start of act 3 passes locked scene-4 (act 2).
    const p = project(locked('scene-4'))
    expect(
      applySceneMove(p, { type: 'act', sceneId: 'scene-2', act: 3 }),
    ).toEqual({ blockedBy: 'scene-4' })
  })

  it('a locked scene left in place but out of board order refuses with renumber', () => {
    // Phase 3's act-only change: scene-2 to act 3 kept index 1. Board:
    // s1 0/0 · s3 1/2 · s4 2/3 · s2 3/1 · s5 3/4 · s6 4/5 (position/index).
    const p = project(
      locked('scene-3').map((s) => (s.id === 'scene-2' ? { ...s, act: 3 } : s)),
    )
    const renumber = { blockedBy: 'scene-3', renumber: true }
    expect(
      applySceneMove(p, { type: 'step', sceneId: 'scene-5', dir: 1 }),
    ).toEqual(renumber)
    expect(
      applySceneMove(p, { type: 'step', sceneId: 'scene-6', dir: -1 }),
    ).toEqual(renumber)
    // A move that does pass it still says so.
    expect(
      applySceneMove(p, {
        type: 'insert',
        sceneId: 'scene-1',
        targetSceneId: 'scene-3',
        after: true,
      }),
    ).toEqual({ blockedBy: 'scene-3' })
  })

  it('refuses moving a locked scene, and any move in a locked episode', () => {
    const step = { type: 'step', sceneId: 'scene-3', dir: -1 } as const
    expect(applySceneMove(project(locked('scene-3')), step)).toEqual({
      blockedBy: 'scene-3',
    })
    const p = project(fixtureLikeScenes())
    p.seasons[0].episodes[0].locked = true
    expect(
      applySceneMove(p, { type: 'act', sceneId: 'scene-5', act: 4 }),
    ).toEqual({ blockedBy: 'scene-5' })
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

  it('keeps scene field names correlated with their value types', () => {
    const p = project(fixtureLikeScenes())
    const saveSceneField: ScenePanelProps['onSaveSceneField'] = () =>
      Promise.resolve(true)

    withSceneField(p, 'scene-1', 'act', 2)
    buildScenePatch(p, 'scene-1', 'location', 'INT. BAR - NIGHT')
    saveSceneField('scene-1', 'locked', true)

    const assertInvalidCallsFailToTypecheck = () => {
      // @ts-expect-error An act update cannot carry a string.
      withSceneField(p, 'scene-1', 'act', '2')
      // @ts-expect-error A lock patch cannot carry a string.
      buildScenePatch(p, 'scene-1', 'locked', 'true')
      // @ts-expect-error Panel callbacks preserve the selected field's type.
      saveSceneField('scene-1', 'act', '2')
    }
    void assertInvalidCallsFailToTypecheck

    expect(true).toBe(true)
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

  it('a tag is act actCount + 1, labelled TAG and listed only when the format has one (T10.7)', () => {
    const tagged = { ...format, tag: true }
    expect(actLabel(5, tagged)).toBe('TAG')
    expect(actLabel(4, tagged)).toBe('ACT FOUR')
    expect(actNumbersForFormat(tagged)).toEqual([0, 1, 2, 3, 4, 5])
    expect(actNumbersForBoard(tagged, [])).toEqual([0, 1, 2, 3, 4, 5])
    // No cold open: acts 0-3, the tag is still actCount + 1.
    const noCold = { ...tagged, coldOpen: false }
    expect(actNumbersForFormat(noCold)).toEqual([0, 1, 2, 3, 5])
    expect(actLabel(5, noCold)).toBe('TAG')
    expect(actLabel(3, noCold)).toBe('ACT FOUR')
    // Without a tag, act actCount + 1 is just an out-of-range act.
    expect(actLabel(5, format)).toBe('ACT FIVE')
    expect(actNumbersForFormat(format)).not.toContain(5)
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
      knowledgeEvents: [],
      audienceKnows: true,
      provenance: 'writer_confirmed',
      confidence: 0.9,
      status: 'active',
      supersedes: null,
      supersededBy: null,
      knownByAsOf: null,
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
        aliases: [],
        embodiment: '',
        presentation: '',
        hiding: '',
        traits: '',
        seriesArc: '',
        summary: '',
        bio: '',
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
