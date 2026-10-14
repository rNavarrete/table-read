import { describe, expect, it } from 'vitest'
import type {
  Beat,
  Character,
  ConsistencyFlag,
  Episode,
  LedgerFact,
  Motivation,
  Project,
  Scene,
  Secret,
  ShowFormat,
  StoryOverview,
  StoryOverviewBeatItem,
  StoryThread,
} from 'contract'
import {
  boardModel,
  boardOrder,
  cardTag,
  castFromDialogue,
  factsForScene,
  flagKind,
  importNoteText,
  landmarksForScene,
  linkifyNote,
  noteSentence,
  notesForScene,
  placeTitle,
  relationTape,
  secretsForScene,
  selectionAnnouncement,
  threadsForScene,
} from './story'

function beat(id: string, index: number, overrides: Partial<Beat> = {}): Beat {
  return {
    id,
    index,
    locked: false,
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    scriptText: '',
    scriptLocked: false,
    ...overrides,
  }
}

function scene(
  id: string,
  index: number,
  overrides: Partial<Scene> = {},
): Scene {
  return {
    id,
    index,
    act: 1,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
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

function episode(scenes: Scene[], overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
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
    ...overrides,
  }
}

function flag(overrides: Partial<ConsistencyFlag> = {}): ConsistencyFlag {
  return {
    id: 'flag-1',
    objectType: 'scene',
    objectId: 'scene-5',
    factId: null,
    explanation: 'The stakes here no longer match the ledger.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-1',
    ...overrides,
  }
}

function fact(
  id: string,
  sceneId: string,
  status: LedgerFact['status'],
): LedgerFact {
  return {
    id,
    fact: `Fact ${id}`,
    factType: 'state',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId,
      beatId: `beat-${sceneId}`,
      startLine: null,
      endLine: null,
      charStart: null,
      charEnd: null,
    },
    sourceText: '',
    knownBy: [],
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.9,
    status,
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
  }
}

function character(
  id: string,
  name: string,
  aliases: string[] = [],
): Character {
  return {
    id,
    name,
    locked: false,
    aliases,
    embodiment: '',
    presentation: '',
    hiding: '',
    traits: '',
    seriesArc: '',
    summary: '',
    bio: '',
  }
}

function thread(
  id: string,
  setupSceneId: string,
  payoffSceneId: string | null,
): StoryThread {
  return {
    id,
    label: id,
    summary: '',
    status: payoffSceneId ? 'paid_off' : 'open',
    ownerCharacterIds: [],
    setupSceneId,
    payoffSceneId,
    setupQuote: '',
    payoffQuote: '',
    setupBeatId: null,
    payoffBeatId: null,
    locked: false,
  }
}

function secret(overrides: Partial<Secret> = {}): Secret {
  return {
    id: 'secret-transfer',
    summary: 'Marta saw the transfer.',
    factId: null,
    holderCharacterIds: ['char-marta'],
    concealedFromCharacterIds: [],
    audienceKnows: true,
    establishedSceneId: 'scene-1',
    revealedSceneId: null,
    concealmentSceneIds: [],
    establishedQuote: '',
    revealedQuote: '',
    establishedBeatId: null,
    revealedBeatId: null,
    provenance: 'inferred',
    locked: false,
    ...overrides,
  }
}

function landmark(
  beatId: string,
  label: string,
  sceneId: string | null,
): StoryOverviewBeatItem {
  return { beatId, label, summary: `${label} summary`, sceneId, act: null }
}

function project(
  ep: Episode,
  format: Partial<ShowFormat> = {},
  characters: Character[] = [],
): Project {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: false,
      serialization: 0.5,
      ...format,
    },
    enabledComponents: [],
    premise: '',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters,
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
        episodes: [ep],
      },
    ],
    headSnapshotId: null,
    defaultCraftLevel: 'standard',
  }
}

function overview(beatSheet: StoryOverviewBeatItem[]): StoryOverview {
  return {
    logline: '',
    outline: [],
    beatSheet,
    summary: '',
    provenance: 'inferred',
    locked: false,
  }
}

function want(characterId: string): Motivation {
  return {
    characterId,
    objective: 'Keep the bar open',
    stakes: '',
    obstacle: '',
    statedObjective: '',
    concealed: false,
  }
}

const IMPORT_CODES = [
  'model_unassigned',
  'duplicate_start',
  'missing_initial_start',
  'empty_output',
  'no_valid_segments',
  'out_of_bounds_start',
  'no_beats_returned',
  'empty_beat_fields',
  'tool_markup',
  'unordered_segments',
  'segmentation_failed',
  'extraction_failed',
  'merge_proposal',
]

describe('flagKind', () => {
  it.each(IMPORT_CODES)('[%s] is an import note', (code) => {
    expect(
      flagKind(
        flag({
          explanation: `[${code}] The server repaired the scene segmentation; review the boundary.`,
        }),
      ),
    ).toBe('import')
  })

  it('reads the pre-code unassigned-lines text (imports before the repair codes) as an import note', () => {
    expect(
      flagKind(
        flag({
          explanation:
            'Imported source lines 40-44 could not be assigned to a beat during segmentation and were merged into this beat; review.',
        }),
      ),
    ).toBe('import')
  })

  it('reads an act-split note', () => {
    expect(
      flagKind(
        flag({
          explanation:
            'This scene plays like an act out, but the episode has no ACT THREE break before it.',
        }),
      ),
    ).toBe('act_split')
    expect(
      flagKind(
        flag({
          explanation: 'The act structure puts both reversals in one act.',
        }),
      ),
    ).toBe('act_split')
  })

  it('reads everything else as continuity', () => {
    expect(
      flagKind(
        flag({
          explanation:
            "The argument's stakes reference the bar as the money's hiding place, which is no longer true.",
        }),
      ),
    ).toBe('continuity')
    expect(
      flagKind(
        flag({
          explanation:
            'The cash box was last placed in "the office" (scene-2) but this scene places it in "the kitchen".',
        }),
      ),
    ).toBe('continuity')
  })
})

describe('notesForScene', () => {
  it('keeps open flags on the scene or its beats: story first, then import, each in beat order', () => {
    const s = scene('scene-5', 4, {
      beats: [beat('beat-5-1', 0), beat('beat-5-2', 1)],
    })
    const notes = notesForScene(
      [
        flag({
          id: 'import-b2',
          objectType: 'beat',
          objectId: 'beat-5-2',
          explanation: '[empty_beat_fields] The beat came back empty.',
        }),
        flag({ id: 'story-b2', objectType: 'beat', objectId: 'beat-5-2' }),
        flag({ id: 'story-scene' }),
        flag({
          id: 'import-b1',
          objectType: 'beat',
          objectId: 'beat-5-1',
          explanation: '[model_unassigned] The model marked source lines 1-4.',
        }),
        flag({ id: 'story-b1', objectType: 'beat', objectId: 'beat-5-1' }),
        flag({ id: 'other-scene', objectId: 'scene-4' }),
        flag({ id: 'gone-beat', objectType: 'beat', objectId: 'beat-5-9' }),
        flag({ id: 'dismissed', status: 'dismissed' }),
      ],
      s,
    )
    expect(notes.map((n) => n.flag.id)).toEqual([
      'story-scene',
      'story-b1',
      'story-b2',
      'import-b1',
      'import-b2',
    ])
    expect(notes[0].beat).toBeNull()
    expect(notes[1].beat?.id).toBe('beat-5-1')
    expect(notes.map((n) => n.kind)).toEqual([
      'continuity',
      'continuity',
      'continuity',
      'import',
      'import',
    ])
  })
})

describe('importNoteText', () => {
  const unassigned = flag({
    explanation:
      '[model_unassigned] The model marked source lines 680-688 as unassigned; the server preserved them in this beat. Review the boundary.',
  })

  it('says which script lines the import kept, and where', () => {
    expect(importNoteText(unassigned, '7.1')).toBe(
      "The import couldn't place script lines 680–688 and kept them in beat 7.1.",
    )
    expect(importNoteText(unassigned, null)).toBe(
      "The import couldn't place script lines 680–688 and kept them in this scene.",
    )
  })

  // The texts the server writes (apps/api fountain/pipeline.py
  // _segmentation_issue_explanation and _UNIT_FAILED_EXPLANATIONS,
  // fountain/characters.py merge_proposal), verbatim apart from the numbers.
  it.each([
    [
      '[model_unassigned] The model marked the scene segmentation as unassigned; the server preserved them in this beat. Review the boundary.',
      '7.1',
      "The import couldn't place some script lines and kept them in beat 7.1.",
    ],
    [
      '[model_unassigned] The model marked source lines 12-12 as unassigned; the server preserved them in this beat. Review the boundary.',
      '7.1',
      "The import couldn't place script line 12 and kept it in beat 7.1.",
    ],
    [
      'Imported source lines 40-44 could not be assigned to a beat during segmentation and were merged into this beat; review.',
      '7.1',
      "The import couldn't place script lines 40–44 and kept them in beat 7.1.",
    ],
    [
      '[duplicate_start] The model returned conflicting segments at scene line 4; the server preserved source lines 120-131 as unassigned and discarded 2 conflicting beat metadata record(s). Review the boundary.',
      '7.2',
      'The import got two beat breaks at the same line and kept script lines 120–131 in beat 7.2. Check where the beat starts.',
    ],
    [
      '[missing_initial_start] No segment began at scene line 1; the server preserved source lines 100-104 as unassigned. Review the boundary.',
      '7.1',
      "The import didn't start a beat at the top of the scene and kept script lines 100–104 in beat 7.1. Check where the beat starts.",
    ],
    [
      '[empty_output] The model returned no usable segment starts; the server preserved source lines 100-140 as unassigned. Review this scene.',
      '7.1',
      "The import couldn't break this scene into beats and kept script lines 100–140 in beat 7.1. Check the beats in this scene.",
    ],
    [
      '[no_valid_segments] The model returned no usable segment starts; the server preserved source lines 100-140 as unassigned. Review this scene.',
      '7.1',
      "The import couldn't break this scene into beats and kept script lines 100–140 in beat 7.1. Check the beats in this scene.",
    ],
    [
      '[out_of_bounds_start] The model returned scene line 90, which is outside this scene; the server discarded that segment and 1 beat metadata record(s). Review the selected beat boundaries.',
      '7.3',
      'The import got a beat break past the end of this scene and dropped it. Check the beats in this scene.',
    ],
    [
      '[unordered_segments] The model returned segment starts out of source order; the server reordered the attached segment objects. Review the boundaries.',
      '7.1',
      "The import got this scene's beat breaks out of order and put them back in script order. Check the beats in this scene.",
    ],
    [
      "[no_beats_returned] The model returned no beats for this scene; the server preserved source lines 100-140 as a single beat with no description. The scene's text is intact, but its beat breakdown is missing. You can write the beat's description yourself in the Plan inspector.",
      '7.1',
      'The import found no beats in this scene and kept script lines 100–140 as one beat with no description. You can write it yourself.',
    ],
    [
      '[empty_beat_fields] The beat covering source lines 100-110 came back with no description; the server kept the boundary but has nothing to show for it. You can write the description yourself in the Plan inspector.',
      '7.1',
      'The import wrote no description for script lines 100–110 in beat 7.1. You can write it yourself.',
    ],
    [
      "[tool_markup] The model's description of this scene contained tool-call markup; the server blanked each affected field rather than store it. The scene's text is intact. You can write the missing description yourself in the Plan inspector.",
      '7.1',
      'The import blanked a garbled description in beat 7.1. The script is intact; you can write the description yourself.',
    ],
    [
      "[segmentation_failed] The model's beat breakdown of this scene failed validation twice, so the server kept the scene's text as a single beat with no description and wrote nothing for it. You can write the description yourself in the Plan inspector.",
      null,
      "The import couldn't break this scene into beats, so it kept the whole scene as one beat with no description. You can write it yourself.",
    ],
    [
      "[extraction_failed] Fact extraction for this scene failed validation twice, so no continuity facts were recorded from it. The scene's text is intact; check it yourself for facts the Ledger should hold.",
      null,
      "The import couldn't read continuity facts from this scene, so the Ledger has none from it. The script is intact; check it for facts the Ledger should hold.",
    ],
    [
      '[merge_proposal] The breakdown names "Ana", which matches more than one cast entry: Ana Reyes, Ana Vega. If they are one person, combine them with Merge into (Ledger, Cast, Manage).',
      null,
      'The breakdown names "Ana", which matches more than one cast entry: Ana Reyes, Ana Vega. If they are one person, combine them with Merge into (Ledger, Cast, Manage).',
    ],
    [
      '[some_new_repair] The server repaired source lines 5-9; review the boundary.',
      '7.1',
      'The import adjusted script lines 5–9 in beat 7.1. Check where the beat starts.',
    ],
  ])('%s', (explanation, beatLabel, text) => {
    const out = importNoteText(flag({ explanation }), beatLabel)
    expect(out).toBe(text)
    expect(out).not.toMatch(/\[|\bserver\b|\bmodel\b|source lines|segment/i)
  })
})

describe('linkifyNote', () => {
  const scenes = [scene('scene-3', 2), scene('scene-12', 11)]
  const facts = [fact('fact-ba9bd699f76c', 'scene-3', 'active')]

  it('links "Scene n" to the id scene-n, keeping the words as written', () => {
    expect(
      linkifyNote('Scene 12 says otherwise; see scene 3.', scenes, facts),
    ).toEqual([
      { type: 'scene', text: 'Scene 12', sceneId: 'scene-12' },
      { type: 'text', text: ' says otherwise; see ' },
      { type: 'scene', text: 'scene 3', sceneId: 'scene-3' },
      { type: 'text', text: '.' },
    ])
  })

  it('reads a raw scene id as "Scene n"', () => {
    expect(
      linkifyNote('Last placed in the office (scene-12).', scenes, facts),
    ).toEqual([
      { type: 'text', text: 'Last placed in the office (' },
      { type: 'scene', text: 'Scene 12', sceneId: 'scene-12' },
      { type: 'text', text: ').' },
    ])
  })

  it('leaves a scene that does not exist as plain text', () => {
    expect(
      linkifyNote('Scene 40 and scene-a1b2c3 both moved.', scenes, facts),
    ).toEqual([{ type: 'text', text: 'Scene 40 and scene-a1b2c3 both moved.' }])
  })

  it('turns a known fact id into "a Ledger fact" and never shows an unknown id', () => {
    expect(
      linkifyNote('fact-ba9bd699f76c contradicts fact-0000.', scenes, facts),
    ).toEqual([
      { type: 'fact', text: 'a Ledger fact', factId: 'fact-ba9bd699f76c' },
      { type: 'text', text: ' contradicts a Ledger fact.' },
    ])
  })
})

describe('placeTitle', () => {
  it.each([
    ['INT. THE LONG POUR - NIGHT', 'The Long Pour'],
    ['INT. THE LONG POUR - BASEMENT - NIGHT', 'The Long Pour - Basement'],
    ['EXT. HARBOR ST', 'Harbor St'],
    ["INT./EXT. MARTA'S CAR - MOVING - DAY", "Marta's Car - Moving"],
    ['I/E. DOCK - DAWN', 'Dock'],
    ['Int. The Long Pour - Night', 'The Long Pour'],
  ])('%s → %s', (location, title) => {
    expect(placeTitle(scene('scene-1', 0, { location }))).toBe(title)
  })

  it('falls back to the scene number', () => {
    expect(placeTitle(scene('scene-3', 2, { location: 'INT.' }))).toBe(
      'Scene 3',
    )
  })
})

describe('boardOrder', () => {
  it('orders by act, then index, like the board frames', () => {
    expect(
      boardOrder([
        scene('scene-4', 3, { act: 1 }),
        scene('scene-6', 5, { act: 4 }),
        scene('scene-1', 0, { act: 0 }),
        scene('scene-3', 2, { act: 1 }),
      ]).map((s) => s.id),
    ).toEqual(['scene-1', 'scene-3', 'scene-4', 'scene-6'])
  })
})

describe('landmarksForScene', () => {
  it('keeps labelled beat-sheet rows that sit in this scene', () => {
    const s = scene('scene-3', 2, { beats: [beat('beat-3-1', 0)] })
    const ep = episode([s], {
      storyOverview: {
        logline: '',
        outline: [],
        beatSheet: [
          landmark('beat-3-1', 'MIDPOINT', null),
          landmark('beat-9-1', 'CATALYST', 'scene-3'),
          landmark('beat-3-1', '', 'scene-3'),
          landmark('beat-4-1', 'BREAK INTO TWO', 'scene-4'),
        ],
        summary: '',
        provenance: 'inferred',
        locked: false,
      },
    })
    expect(landmarksForScene(ep, s).map((row) => row.label)).toEqual([
      'MIDPOINT',
      'CATALYST',
    ])
  })
})

describe('castFromDialogue', () => {
  it('matches dialogue cues to the bible by name, first name or alias, dropping the noise', () => {
    const characters = [
      character('char-marta', 'Marta Vega'),
      character('char-dan', 'Dan Vega'),
      character('char-reyes', 'Detective Ana Reyes', ['Reyes']),
      character('char-luz', 'Luz Vega'),
    ]
    const s = scene('scene-1', 0, {
      beats: [
        beat('beat-1-1', 0, {
          scriptText:
            "INT. THE LONG POUR - NIGHT\n\nDAN (CONT'D)\nWe're closed.\n\nCUT TO:\n\nBARTENDER\nLast call.\n\nBACK TO SCENE",
        }),
        beat('beat-1-2', 1, {
          scriptText:
            'REYES (V.O.)\nStay where you are.\n\nMARTA\nNot tonight.\n\nDAN\nFine.',
        }),
      ],
    })
    expect(castFromDialogue(s, characters).map((c) => c.id)).toEqual([
      'char-marta',
      'char-dan',
      'char-reyes',
    ])
  })
})

describe('threadsForScene', () => {
  const ep = episode(
    [scene('scene-2', 1), scene('scene-5', 4), scene('scene-6', 5)],
    {
      threads: [
        thread('thread-money', 'scene-2', 'scene-5'),
        thread('thread-open', 'scene-2', null),
        thread('thread-cut', 'scene-2', 'scene-40'),
        thread('thread-same', 'scene-6', 'scene-6'),
      ],
    },
  )
  const rows = (sceneId: string) =>
    threadsForScene(ep, sceneId).map((t) => [
      t.thread.id,
      t.role,
      t.otherSceneId,
    ])

  it('lists what a scene sets up, with the payoff scene or null when never paid off', () => {
    expect(rows('scene-2')).toEqual([
      ['thread-money', 'sets_up', 'scene-5'],
      ['thread-open', 'sets_up', null],
      ['thread-cut', 'sets_up', null],
    ])
  })

  it('lists what a scene pays off, with the setup scene', () => {
    expect(rows('scene-5')).toEqual([['thread-money', 'pays_off', 'scene-2']])
  })

  it('a thread set up and paid off in one scene yields two entries', () => {
    expect(rows('scene-6')).toEqual([
      ['thread-same', 'sets_up', 'scene-6'],
      ['thread-same', 'pays_off', 'scene-6'],
    ])
  })
})

describe('secretsForScene', () => {
  const transfer = secret({
    establishedSceneId: 'scene-1',
    revealedSceneId: 'scene-5',
    concealmentSceneIds: ['scene-3'],
    concealedFromCharacterIds: ['char-dan', 'char-luz'],
  })
  const ep = episode([scene('scene-1', 0), scene('scene-3', 2)], {
    secrets: [transfer],
  })

  it('names the role and who is in the dark among the people present', () => {
    expect(
      secretsForScene(ep, 'scene-1', new Set(['char-marta', 'char-dan'])),
    ).toEqual([{ secret: transfer, role: 'set', inTheDark: ['char-dan'] }])
    expect(secretsForScene(ep, 'scene-3', new Set(['char-luz']))).toEqual([
      { secret: transfer, role: 'kept', inTheDark: ['char-luz'] },
    ])
    expect(secretsForScene(ep, 'scene-5', new Set())).toEqual([
      { secret: transfer, role: 'out', inTheDark: [] },
    ])
    expect(secretsForScene(ep, 'scene-6', new Set())).toEqual([])
  })
})

describe('factsForScene', () => {
  it('shows active and pending facts and keeps the rest as retired, in ledger order', () => {
    const { shown, retired } = factsForScene(
      [
        fact('fact-01', 'scene-1', 'active'),
        fact('fact-09', 'scene-1', 'superseded'),
        fact('fact-06', 'scene-1', 'pending_review'),
        fact('fact-02', 'scene-2', 'active'),
        fact('fact-10', 'scene-1', 'stale'),
        fact('fact-11', 'scene-1', 'rejected'),
      ],
      'scene-1',
    )
    expect(shown.map((f) => f.id)).toEqual(['fact-01', 'fact-06'])
    expect(retired.map((f) => f.id)).toEqual(['fact-09', 'fact-10', 'fact-11'])
  })
})

describe('boardModel', () => {
  it('orders scenes like the board and numbers them by index', () => {
    const ep = episode([
      scene('scene-3', 2, { act: 1 }),
      scene('scene-2', 1, { act: 2 }),
      scene('scene-1', 0, { act: 0, location: 'EXT. PARKING LOT - DAY' }),
      scene('scene-4', 3, { act: 1 }),
    ])
    const model = boardModel(project(ep), ep, [])
    expect(model.order.map((s) => s.id)).toEqual([
      'scene-1',
      'scene-3',
      'scene-4',
      'scene-2',
    ])
    expect(model.signals.get('scene-3')?.number).toBe(3)
    expect(model.signals.get('scene-1')?.place).toBe('Parking Lot')
  })

  it('splits a scene’s notes by kind and marks one tick per beat, story over import, at most 12', () => {
    const beats = Array.from({ length: 14 }, (_, i) =>
      beat(`beat-5-${i + 1}`, i),
    )
    const ep = episode([scene('scene-5', 4, { beats: [...beats].reverse() })])
    const model = boardModel(project(ep), ep, [
      flag({ id: 'story-b1', objectType: 'beat', objectId: 'beat-5-1' }),
      flag({
        id: 'import-b1',
        objectType: 'beat',
        objectId: 'beat-5-1',
        explanation: '[empty_beat_fields] The beat came back empty.',
      }),
      flag({
        id: 'import-b3',
        objectType: 'beat',
        objectId: 'beat-5-3',
        explanation: '[empty_beat_fields] The beat came back empty.',
      }),
      flag({ id: 'story-scene' }),
      flag({ id: 'gone-beat', objectType: 'beat', objectId: 'beat-5-99' }),
    ])
    const s = model.signals.get('scene-5')
    expect(s?.storyNotes.map((n) => n.flag.id)).toEqual([
      'story-scene',
      'story-b1',
    ])
    expect(s?.importNotes.map((n) => n.flag.id)).toEqual([
      'import-b1',
      'import-b3',
    ])
    expect(s?.ticks).toHaveLength(12)
    expect(s?.ticks.slice(0, 4)).toEqual(['story', 'plain', 'import', 'plain'])
    expect(s?.ticks.slice(3).every((t) => t === 'plain')).toBe(true)
  })

  it('counts setups and payoffs across scenes, not a thread set up and paid off in one scene, and flags a setup never paid off', () => {
    const ep = episode(
      [
        scene('scene-1', 0, { act: 1 }),
        scene('scene-2', 1, { act: 2 }),
        scene('scene-3', 2, { act: 2 }),
        scene('scene-4', 3, { act: 3 }),
        scene('scene-5', 4, { act: 4 }),
      ],
      {
        threads: [
          thread('thread-across', 'scene-1', 'scene-2'),
          thread('thread-same', 'scene-3', 'scene-3'),
          thread('thread-open', 'scene-3', null),
          thread('thread-cut', 'scene-4', 'scene-99'),
          thread('thread-orphan', 'scene-99', 'scene-5'),
          { ...thread('thread-dropped', 'scene-1', null), status: 'abandoned' },
        ],
      },
    )
    const model = boardModel(project(ep), ep, [])
    const ids = (sceneId: string, key: 'setsUp' | 'paysOff') =>
      model.signals.get(sceneId)?.[key].map((t) => t.id)
    expect(ids('scene-1', 'setsUp')).toEqual(['thread-across'])
    expect(ids('scene-2', 'paysOff')).toEqual(['thread-across'])
    expect(ids('scene-3', 'setsUp')).toEqual(['thread-open'])
    expect(ids('scene-3', 'paysOff')).toEqual([])
    expect(ids('scene-4', 'setsUp')).toEqual(['thread-cut'])
    expect(ids('scene-5', 'paysOff')).toEqual([])
    expect(
      ['scene-1', 'scene-2', 'scene-3', 'scene-4', 'scene-5'].map(
        (id) => model.signals.get(id)?.neverPaidOff,
      ),
    ).toEqual([false, false, true, true, false])
    expect(model.acts.map((a) => [a.act, a.setUp, a.paidOff]).slice(1)).toEqual(
      [
        [1, 1, 0],
        [2, 1, 1],
        [3, 1, 0],
        [4, 0, 0],
      ],
    )
  })

  it('reads the secret role (set, kept, out) and null elsewhere', () => {
    const ep = episode(
      ['scene-1', 'scene-2', 'scene-3', 'scene-4'].map((id, i) => scene(id, i)),
      {
        secrets: [
          secret({
            establishedSceneId: 'scene-1',
            concealmentSceneIds: ['scene-2'],
            revealedSceneId: 'scene-3',
          }),
        ],
      },
    )
    const model = boardModel(project(ep), ep, [])
    expect(model.order.map((s) => model.signals.get(s.id)?.secret)).toEqual([
      'set',
      'kept',
      'out',
      null,
    ])
  })

  it('places only the beat-sheet landmarks tvActStages marks, by scene id or by beat; cardTag reads TURN for a turn and ACT OUT for an act’s last scene', () => {
    const ep = episode(
      [
        scene('scene-1', 0, { act: 1, beats: [beat('beat-1-1', 0)] }),
        scene('scene-2', 1, { act: 1, beats: [beat('beat-2-1', 0)] }),
        scene('scene-3', 2, { act: 1, beats: [beat('beat-3-1', 0)] }),
        scene('scene-4', 3, { act: 2 }),
      ],
      {
        storyOverview: overview([
          landmark('beat-2-1', 'Act One Turn', null),
          landmark('beat-1-1', 'Midpoint', 'scene-1'),
          landmark('beat-3-1', '', 'scene-3'),
          landmark('beat-9-9', 'Act Two Out', 'scene-4'),
        ]),
      },
    )
    const model = boardModel(project(ep), ep, [])
    const sig = (id: string) => model.signals.get(id)!
    expect(model.order.map((s) => sig(s.id).landmark)).toEqual([
      null,
      'Act One Turn',
      null,
      'Act Two Out',
    ])
    expect(model.order.map((s) => sig(s.id).actOut)).toEqual([
      false,
      false,
      true,
      true,
    ])
    expect(model.order.map((s) => cardTag(sig(s.id)))).toEqual([
      null,
      'TURN',
      'ACT OUT',
      'ACT OUT',
    ])
  })

  it('summarises every board act, empty ones included', () => {
    const script = (n: number) => [
      beat(`b-${n}`, 0, { scriptText: 'x'.repeat(n) }),
    ]
    const ep = episode(
      [
        scene('scene-1', 0, {
          act: 0,
          beats: [beat('beat-1-1', 0, { scriptText: 'x'.repeat(10) })],
        }),
        scene('scene-2', 1, {
          act: 1,
          beats: [beat('beat-2-1', 0, { scriptText: 'x'.repeat(30) })],
        }),
        scene('scene-3', 2, { act: 2, beats: script(20) }),
        scene('scene-4', 3, { act: 3, beats: script(40) }),
      ],
      {
        threads: [thread('thread-money', 'scene-2', 'scene-4')],
        storyOverview: overview([
          landmark('beat-1-1', 'Teaser', null),
          landmark('beat-2-1', 'Act One Turn', 'scene-2'),
        ]),
      },
    )
    const model = boardModel(project(ep), ep, [
      flag({
        id: 'act-split',
        objectId: 'scene-3',
        explanation:
          'The episode has no act two break before this scene; see fact-07. It plays long.',
      }),
      flag({ id: 'continuity', objectId: 'scene-3' }),
    ])
    expect(model.hasScript).toBe(true)
    expect(model.hasThreads).toBe(true)
    expect(model.acts.map((a) => a.label)).toEqual([
      'COLD OPEN',
      'ACT ONE',
      'ACT TWO',
      'ACT THREE',
      'ACT FOUR',
    ])
    const [cold, one, two, three, four] = model.acts
    expect(four).toMatchObject({
      act: 4,
      scenes: [],
      share: 0,
      actOutSceneId: null,
    })
    expect(model.acts.map((a) => a.share)).toEqual([0.1, 0.3, 0.2, 0.4, 0])
    expect(model.acts.reduce((n, a) => n + (a.share ?? 0), 0)).toBeCloseTo(1)
    expect([one.setUp, one.paidOff, three.setUp, three.paidOff]).toEqual([
      1, 0, 0, 1,
    ])
    expect(cold.landmarks).toEqual([
      { label: 'Cold Open', short: 'Cold Open', sceneId: 'scene-1', number: 1 },
    ])
    expect(one.landmarks[0]).toEqual({
      label: 'Act One Turn',
      short: 'Turn',
      sceneId: 'scene-2',
      number: 2,
    })
    expect(one.actOutSceneId).toBe('scene-2')
    expect(two.actSplitNotes).toEqual([
      {
        sceneId: 'scene-3',
        number: 3,
        text: 'The episode has no act two break before this scene; see a Ledger fact.',
      },
    ])
    expect(model.acts.flatMap((a) => a.actSplitNotes)).toHaveLength(1)
  })

  it('cast is dialogue cues plus recorded wants, in bible order', () => {
    const characters = [
      character('char-marta', 'Marta Vega'),
      character('char-dan', 'Dan Vega'),
      character('char-reyes', 'Detective Ana Reyes'),
      character('char-luz', 'Luz Vega'),
    ]
    const ep = episode([
      scene('scene-1', 0, {
        motivations: [want('char-luz'), want('char-marta')],
        beats: [
          beat('beat-1-1', 0, {
            scriptText: 'DAN\nWe’re closed.\n\nBARTENDER\nLast call.',
          }),
        ],
      }),
    ])
    const s = boardModel(project(ep, {}, characters), ep, []).signals.get(
      'scene-1',
    )
    expect(s?.castIds).toEqual(['char-marta', 'char-dan', 'char-luz'])
    expect(s?.wantIds).toEqual(['char-luz', 'char-marta'])
  })
})

describe('relationTape', () => {
  it('reads how a card relates to the selected scene through a thread', () => {
    const ep = episode(
      ['scene-2', 'scene-4', 'scene-5', 'scene-6'].map((id) =>
        scene(id, Number(id.slice(6)) - 1),
      ),
      {
        threads: [
          thread('thread-in', 'scene-2', 'scene-4'),
          thread('thread-out', 'scene-4', 'scene-6'),
          {
            ...thread('thread-dropped', 'scene-4', 'scene-5'),
            status: 'abandoned',
          },
        ],
      },
    )
    const model = boardModel(project(ep), ep, [])
    expect(relationTape(model, 'scene-4', 'scene-6')).toEqual({
      text: '↘ pays off 4',
      tone: 'sky',
    })
    expect(relationTape(model, 'scene-4', 'scene-2')).toEqual({
      text: '↗ sets up 4',
      tone: 'sky',
    })
    expect(relationTape(model, 'scene-4', 'scene-4')).toBeNull()
    expect(relationTape(model, 'scene-4', 'scene-5')).toBeNull()
    expect(relationTape(model, null, 'scene-6')).toBeNull()
  })
})

describe('noteSentence', () => {
  const s = scene('scene-5', 4, {
    beats: [beat('beat-5-1', 0), beat('beat-5-2', 1)],
  })
  const scenes = [scene('scene-3', 2), s]
  const story = (explanation: string) =>
    notesForScene([flag({ explanation })], s)[0]

  it('keeps the first sentence, with scene and fact references as plain text', () => {
    expect(
      noteSentence(
        story('This contradicts fact-04 from scene-3! Later it is fine.'),
        s,
        scenes,
      ),
    ).toBe('This contradicts a Ledger fact from Scene 3!')
    expect(
      noteSentence(
        story(
          'Scene 12 places the cash box in the office. It is in the kitchen now.',
        ),
        s,
        scenes,
      ),
    ).toBe('Scene 12 places the cash box in the office.')
    expect(noteSentence(story('No full stop here'), s, scenes)).toBe(
      'No full stop here',
    )
  })

  it('reads an import note in plain words with its beat as n.m', () => {
    const f = flag({
      objectType: 'beat',
      objectId: 'beat-5-2',
      explanation:
        '[model_unassigned] The model marked source lines 3-4 as unassigned; the server preserved them in this beat.',
    })
    const text = noteSentence(notesForScene([f], s)[0], s, scenes)
    expect(text).toBe(importNoteText(f, '5.2'))
    expect(text).toContain('beat 5.2')
  })
})

describe('selectionAnnouncement', () => {
  it('names the scene, the lock and the notes', () => {
    const bar = scene('scene-3', 2, {
      location: 'INT. THE LONG POUR - BAR - NIGHT',
      beats: [beat('beat-3-1', 0)],
    })
    const ep = episode([scene('scene-1', 0), bar])
    const model = boardModel(project(ep), ep, [
      flag({ objectId: 'scene-3' }),
      flag({
        id: 'flag-2',
        objectType: 'beat',
        objectId: 'beat-3-1',
        explanation: '[empty_beat_fields] The beat came back empty.',
      }),
    ])
    expect(selectionAnnouncement(model.signals.get('scene-3')!, true)).toBe(
      'Scene 3, The Long Pour - Bar, locked. 2 notes, 1 from the import.',
    )
    expect(selectionAnnouncement(model.signals.get('scene-1')!, false)).toBe(
      'Scene 1, The Long Pour. No notes.',
    )
  })
})

describe('missing story data', () => {
  it('reads a doc whose defaulted keys are missing as empty (raw PATCH reply, idea-born project)', () => {
    const s = scene('scene-6', 5, {
      beats: [beat('beat-6-1', 0, { scriptText: 'REYES\nHold it.' })],
    })
    const raw = episode([s]) as unknown as Record<string, unknown>
    for (const key of [
      'threads',
      'secrets',
      'timelineAnchors',
      'relationshipStates',
      'storyOverview',
    ]) {
      delete raw[key]
    }
    const ep = raw as unknown as Episode
    const reyes = character(
      'char-reyes',
      'Detective Ana Reyes',
    ) as unknown as Record<string, unknown>
    delete reyes.aliases

    expect(threadsForScene(ep, 'scene-6')).toEqual([])
    expect(secretsForScene(ep, 'scene-6', new Set())).toEqual([])
    expect(landmarksForScene(ep, s)).toEqual([])
    expect(castFromDialogue(s, [reyes as unknown as Character])).toEqual([])

    const bare = secret() as unknown as Record<string, unknown>
    delete bare.concealmentSceneIds
    delete bare.concealedFromCharacterIds
    const withSecret = { ...raw, secrets: [bare] } as unknown as Episode
    expect(secretsForScene(withSecret, 'scene-6', new Set())).toEqual([])
    expect(
      secretsForScene(withSecret, 'scene-1', new Set(['char-dan']))[0]
        .inTheDark,
    ).toEqual([])
  })

  it('boardModel reads a doc with no threads, secrets, overview or script', () => {
    const raw = episode([
      scene('scene-1', 0, { act: 0, beats: [beat('beat-1-1', 0)] }),
      scene('scene-2', 1, { act: 1, beats: [beat('beat-2-1', 0)] }),
    ]) as unknown as Record<string, unknown>
    for (const key of ['threads', 'secrets', 'storyOverview']) delete raw[key]
    for (const s of raw.scenes as Scene[])
      for (const b of s.beats) delete (b as Partial<Beat>).scriptText
    const ep = raw as unknown as Episode

    const model = boardModel(project(ep), ep, [])
    expect(model.hasScript).toBe(false)
    expect(model.hasThreads).toBe(false)
    expect(model.threads).toEqual([])
    expect(model.acts.every((a) => a.share === null)).toBe(true)
    expect(model.acts.flatMap((a) => a.landmarks)).toEqual([])
    for (const s of model.signals.values()) {
      expect(s.ticks.every((t) => t === 'plain')).toBe(true)
      expect([s.setsUp, s.paysOff, s.secret, s.landmark]).toEqual([
        [],
        [],
        null,
        null,
      ])
      expect(s.scriptLength).toBe(0)
    }
  })
})
