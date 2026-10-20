// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type {
  ConsistencyFlag,
  Episode,
  Project,
  Scene,
  Secret,
  ShowFormat,
  StoryThread,
} from 'contract'
import {
  chartLayout,
  chartMarks,
  chartSummary,
  EpisodeChart,
} from './EpisodeChart'
import { boardModel, NO_HIGHLIGHT, type BoardModel } from './story'

afterEach(cleanup)

function scene(
  id: string,
  index: number,
  act: number,
  scriptLength = 0,
  overrides: Partial<Scene> = {},
): Scene {
  return {
    id,
    index,
    act,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - BAR - NIGHT',
    time: 'Night',
    socialSituation: '',
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: scriptLength
      ? [
          {
            id: `beat-${index + 1}-1`,
            index: 0,
            locked: false,
            whatHappens: '',
            audienceLearns: '',
            audienceFeels: '',
            scriptText: 'x'.repeat(scriptLength),
            scriptLocked: false,
            actorCharacterId: null,
            actionVerb: '',
            targetCharacterId: null,
            reaction: '',
            kernel: null,
            pressureChoice: null,
          },
        ]
      : [],
    ...overrides,
  }
}

function thread(
  id: string,
  setupSceneId: string,
  payoffSceneId: string | null,
  overrides: Partial<StoryThread> = {},
): StoryThread {
  return {
    id,
    label: 'The spare key',
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
    storyline: null,
    movements: [],
    closureLevel: null,
    secondJob: '',
    ...overrides,
  }
}

function secret(overrides: Partial<Secret> = {}): Secret {
  return {
    id: 'secret-1',
    summary: 'Marta moved the cash.',
    factId: null,
    holderCharacterIds: [],
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

function storyFlag(objectId: string): ConsistencyFlag {
  return {
    id: `flag-${objectId}`,
    objectType: 'scene',
    objectId,
    factId: null,
    explanation: 'The cash is still in the bar here.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-root',
  }
}

function model(
  scenes: Scene[],
  extra: Partial<Episode> = {},
  flags: ConsistencyFlag[] = [],
  format: Partial<ShowFormat> = {},
): BoardModel {
  const episode: Episode = {
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
    craftCheckedAt: null,
    characterArcs: [],
    ...extra,
  }
  const project: Project = {
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
        episodes: [episode],
      },
    ],
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
  }
  return boardModel(project, episode, flags)
}

/** Six scenes in five acts (cold open + acts one to four), stored out of
 * board order. */
function six(scriptLengths: number[] = []): Scene[] {
  const acts = [0, 1, 1, 2, 3, 4]
  return acts
    .map((act, i) => scene(`scene-${i + 1}`, i, act, scriptLengths[i] ?? 0))
    .reverse()
}

const SIX_IDS = [
  'scene-1',
  'scene-2',
  'scene-3',
  'scene-4',
  'scene-5',
  'scene-6',
]

describe('chartLayout', () => {
  it('lays blocks out in board order with act gaps of 12 and block gaps of 2, ending at the width', () => {
    const scenes = [
      scene('scene-1', 0, 0),
      scene('scene-2', 1, 0),
      scene('scene-3', 2, 1),
      scene('scene-4', 3, 1),
      scene('scene-5', 4, 2),
      scene('scene-6', 5, 2),
    ].reverse()
    const layout = chartLayout(model(scenes), 600)
    const { blocks } = layout
    expect(blocks.map((b) => b.sceneId)).toEqual(SIX_IDS)
    const gaps = blocks
      .slice(1)
      .map((b, i) => +(b.x - (blocks[i].x + blocks[i].w)).toFixed(6))
    expect(gaps).toEqual([2, 12, 2, 12, 2])
    const last = blocks[blocks.length - 1]
    expect(Math.abs(last.x + last.w - 600)).toBeLessThanOrEqual(0.5)
    expect(blocks.every((b) => b.cx === b.x + b.w / 2)).toBe(true)
    expect(blocks.map((b) => b.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(layout.byId.get('scene-4')).toBe(blocks[3])
  })

  it('a block is the minimum plus its share of the script text', () => {
    const layout = chartLayout(
      model([scene('scene-1', 0, 1, 300), scene('scene-2', 1, 1, 100)]),
      600,
    )
    // min = min(12, floor(600 / 2) - 2) = 12
    const [a, b] = layout.blocks
    expect((a.w - 12) / (b.w - 12)).toBeCloseTo(3)
  })

  it('equal widths without script', () => {
    const { blocks } = chartLayout(model(six()), 700)
    expect(new Set(blocks.map((b) => b.w.toFixed(6))).size).toBe(1)
  })

  it('70 scenes fit 1,000px with blocks of at least 6px', () => {
    const scenes = Array.from({ length: 70 }, (_, i) =>
      // Only the first scene has script, so the others sit at the minimum.
      scene(`scene-${i + 1}`, i, Math.floor(i / 14), i === 0 ? 500 : 0),
    )
    const { blocks } = chartLayout(model(scenes), 1000)
    expect(blocks).toHaveLength(70)
    const last = blocks[69]
    expect(last.x + last.w).toBeLessThanOrEqual(1000.5)
    expect(blocks.every((b) => b.w >= 6)).toBe(true)
    expect(Math.min(...blocks.map((b) => b.w))).toBe(Math.floor(952 / 70) - 2)
  })

  it('bands cover their act blocks, empty acts get none, and a band under 72px reads its short label', () => {
    const scenes = [
      scene('scene-1', 0, 0),
      scene('scene-2', 1, 1),
      scene('scene-3', 2, 1),
      scene('scene-4', 3, 1),
      scene('scene-5', 4, 2),
      scene('scene-6', 5, 2),
    ]
    const { bands, byId } = chartLayout(model(scenes), 300)
    // Acts 3 and 4 have no scenes.
    expect(bands.map((b) => b.act)).toEqual([0, 1, 2])
    expect(bands[0]).toMatchObject({ text: 'CO', title: 'COLD OPEN' })
    expect(bands[1]).toMatchObject({ text: 'ACT ONE', title: 'ACT ONE' })
    const s2 = byId.get('scene-2')!
    const s4 = byId.get('scene-4')!
    expect(bands[1].x0).toBe(s2.x)
    expect(bands[1].x1).toBeCloseTo(s4.x + s4.w)
  })

  it('a band over 170px adds its scene count and ≈ share after the label', () => {
    const { bands } = chartLayout(
      model(six([100, 100, 100, 100, 100, 100])),
      960,
    )
    // Act One has two of the six (equal) scenes: ~305px; the others ~152px.
    expect(bands.map((b) => b.detail)).toEqual([
      null,
      ' · 2 scenes · ≈33%',
      null,
      null,
      null,
    ])
    // No script: no share.
    expect(chartLayout(model(six()), 960).bands[1].detail).toBe(' · 2 scenes')
  })
})

describe('chartLayout in story order (T10.6)', () => {
  it('runs the blocks by story rank in one band; unranked scenes follow in board order', () => {
    const rank = new Map([
      ['scene-4', 0],
      ['scene-1', 1],
      ['scene-2', 2],
    ])
    const layout = chartLayout(model(six()), 600, rank)
    expect(layout.blocks.map((b) => b.sceneId)).toEqual([
      'scene-4',
      'scene-1',
      'scene-2',
      'scene-3',
      'scene-5',
      'scene-6',
    ])
    // Blocks keep their script numbers, so the jumble shows.
    expect(layout.blocks.map((b) => b.number)).toEqual([4, 1, 2, 3, 5, 6])
    expect(layout.bands.map((b) => b.title)).toEqual(['STORY ORDER'])
  })
})

describe('chartMarks', () => {
  it('an arc joins a setup to its payoff and turns amber when the payoff plays first', () => {
    const m = model(six(), {
      threads: [
        thread('thread-1', 'scene-2', 'scene-4'),
        thread('thread-2', 'scene-5', 'scene-3'),
      ],
    })
    const layout = chartLayout(m, 960)
    const { arcs } = chartMarks(m, layout)
    const cx = (id: string) => layout.byId.get(id)!.cx
    expect(arcs).toEqual([
      {
        threadId: 'thread-1',
        setupSceneId: 'scene-2',
        payoffSceneId: 'scene-4',
        x1: cx('scene-2'),
        x2: cx('scene-4'),
        amber: false,
      },
      {
        threadId: 'thread-2',
        setupSceneId: 'scene-5',
        payoffSceneId: 'scene-3',
        x1: cx('scene-5'),
        x2: cx('scene-3'),
        amber: true,
      },
    ])
  })

  it('an open thread ends 120px to the right, inside the width', () => {
    const m = model(six(), {
      threads: [
        thread('thread-1', 'scene-1', null),
        thread('thread-2', 'scene-6', null),
        thread('thread-3', 'scene-2', 'scene-99'),
      ],
    })
    const width = 600
    const { arcs } = chartMarks(m, chartLayout(m, width))
    expect(arcs).toHaveLength(3)
    for (const arc of arcs) {
      expect(arc.payoffSceneId).toBeNull()
      expect(arc.x2).toBe(Math.min(width - 8, arc.x1 + 120))
    }
    // scene-6 is the last block: its arc stops at the edge.
    expect(arcs[1].x2).toBe(width - 8)
  })

  it('skips abandoned threads, a payoff in its own setup scene and a setup off the board', () => {
    const m = model(six(), {
      threads: [
        thread('thread-1', 'scene-2', 'scene-4', { status: 'abandoned' }),
        thread('thread-2', 'scene-3', 'scene-3'),
        thread('thread-3', 'scene-99', 'scene-4'),
        thread('thread-4', 'scene-1', 'scene-5'),
      ],
    })
    const { arcs } = chartMarks(m, chartLayout(m, 960))
    expect(arcs.map((a) => a.threadId)).toEqual(['thread-4'])
  })

  it('the secret lane spans set, kept and out; it is amber when the secret is out of order; it runs to the right edge when never revealed', () => {
    const m = model(six(), {
      secrets: [
        // Kept in scene-5 after it comes out in scene-4: out of order.
        secret({
          id: 'secret-1',
          establishedSceneId: 'scene-2',
          revealedSceneId: 'scene-4',
          concealmentSceneIds: ['scene-3', 'scene-5', 'scene-99'],
        }),
        secret({
          id: 'secret-2',
          establishedSceneId: 'scene-1',
          concealmentSceneIds: ['scene-3'],
        }),
        secret({ id: 'secret-3', establishedSceneId: 'scene-99' }),
      ],
    })
    const width = 700
    const layout = chartLayout(m, width)
    const cx = (id: string) => layout.byId.get(id)!.cx
    const { lanes } = chartMarks(m, layout)
    expect(lanes).toEqual([
      {
        secretId: 'secret-1',
        sceneIds: ['scene-2', 'scene-3', 'scene-5', 'scene-4'],
        set: cx('scene-2'),
        kept: [cx('scene-3'), cx('scene-5')],
        out: cx('scene-4'),
        x0: cx('scene-2'),
        x1: cx('scene-5'),
        amber: true,
      },
      {
        secretId: 'secret-2',
        sceneIds: ['scene-1', 'scene-3'],
        set: cx('scene-1'),
        kept: [cx('scene-3')],
        out: null,
        x0: cx('scene-1'),
        x1: width - 4,
        amber: false,
      },
    ])
  })
})

describe('chartSummary', () => {
  it('reads the scenes, acts and the parts that exist in one sentence', () => {
    const m = model(six(), {
      threads: [
        thread('thread-1', 'scene-2', 'scene-4'),
        thread('thread-2', 'scene-3', null),
      ],
      secrets: [
        secret({
          establishedSceneId: 'scene-1',
          revealedSceneId: 'scene-3',
          concealmentSceneIds: ['scene-4'],
        }),
      ],
    })
    expect(chartSummary(m)).toBe(
      'Episode chart of 6 scenes in 5 acts, with 2 setup-payoff threads (1 open), 1 secret and 1 order problem; the board below lists every scene.',
    )
  })

  it('an idea-born episode reads its scenes and acts only', () => {
    const m = model(
      [scene('scene-1', 0, 0), scene('scene-2', 1, 0), scene('scene-3', 2, 1)],
      {},
      [],
      { coldOpen: false },
    )
    expect(chartSummary(m)).toBe(
      'Episode chart of 3 scenes in 2 acts; the board below lists every scene.',
    )
  })
})

function renderChart(props: Partial<ComponentProps<typeof EpisodeChart>> = {}) {
  const onSelectScene = vi.fn()
  const result = render(
    <EpisodeChart
      model={model(six())}
      selectedId={null}
      highlight={NO_HIGHLIGHT}
      draftSceneIds={new Set()}
      episodeLocked={false}
      onSelectScene={onSelectScene}
      {...props}
    />,
  )
  return { ...result, onSelectScene }
}

const chart = () => screen.getByTestId('episode-chart')
const block = (id: string) => screen.getByTestId(`chart-block-${id}`)
const flagged = (attr: string) =>
  [...chart().querySelectorAll(`[data-chart-block][${attr}]`)].map((el) =>
    el.getAttribute('data-scene-id'),
  )

describe('EpisodeChart', () => {
  it('draws one block per scene in board order inside act bands', () => {
    renderChart()
    expect(flagged('data-chart-block')).toEqual(SIX_IDS)
    const bands = [...chart().querySelectorAll('[data-chart-band]')].map((el) =>
      [...el.childNodes]
        .filter((n) => n.nodeName !== 'title')
        .map((n) => n.textContent)
        .join(''),
    )
    expect(bands).toEqual([
      'COLD OPEN',
      'ACT ONE · 2 scenes',
      'ACT TWO',
      'ACT THREE',
      'ACT FOUR',
    ])
  })

  it('the SVG is hidden from assistive tech and a one-sentence summary sits beside it', () => {
    const m = model(six())
    renderChart({ model: m })
    const svgs = chart().querySelectorAll('svg')
    expect(svgs).toHaveLength(1)
    expect(svgs[0].getAttribute('aria-hidden')).toBe('true')
    expect(
      svgs[0].querySelectorAll(
        'a, button, input, select, textarea, [tabindex]',
      ),
    ).toHaveLength(0)
    expect(chart().querySelector('.sr-only')?.textContent).toBe(chartSummary(m))
  })

  it('a block click selects its scene', () => {
    const { onSelectScene } = renderChart()
    fireEvent.click(block('scene-3'))
    expect(onSelectScene).toHaveBeenCalledWith('scene-3')
    expect(onSelectScene).toHaveBeenCalledTimes(1)
  })

  it("sky arcs join setups to payoffs, the selected scene's arcs are bold, an out-of-order arc is amber", () => {
    const m = model(six(), {
      threads: [
        thread('thread-1', 'scene-2', 'scene-4'),
        thread('thread-2', 'scene-5', 'scene-3'),
      ],
    })
    renderChart({ model: m, selectedId: 'scene-2' })
    const arc = screen.getByTestId('chart-arc-thread-1')
    expect(arc.getAttribute('data-tone')).toBe('sky')
    expect(arc.getAttribute('stroke-width')).toBe('2')
    expect(arc.hasAttribute('data-open')).toBe(false)
    expect(block('scene-2').getAttribute('data-selected')).not.toBeNull()
    expect(
      screen.getByTestId('chart-arc-thread-2').getAttribute('data-tone'),
    ).toBe('amber')
    cleanup()
    renderChart({ model: m, selectedId: 'scene-6' })
    expect(
      screen.getByTestId('chart-arc-thread-1').getAttribute('stroke-width'),
    ).toBe('1.25')
  })

  it('an open thread is a dashed amber arc ending in ?', () => {
    const m = model(six(), { threads: [thread('thread-1', 'scene-2', null)] })
    renderChart({ model: m })
    const arc = screen.getByTestId('chart-arc-thread-1')
    expect(arc.hasAttribute('data-open')).toBe(true)
    expect(arc.getAttribute('data-tone')).toBe('amber')
    expect(arc.getAttribute('stroke-dasharray')).toBe('3 3')
    const texts = [...chart().querySelectorAll('svg text')].map(
      (t) => t.textContent,
    )
    expect(texts).toContain('?')
  })

  it('the secret lane: ◆ set, a dot per kept scene, ◇ out', () => {
    const m = model(six(), {
      secrets: [
        secret({
          establishedSceneId: 'scene-1',
          revealedSceneId: 'scene-5',
          concealmentSceneIds: ['scene-2', 'scene-3'],
        }),
      ],
    })
    renderChart({ model: m })
    const lane = screen.getByTestId('chart-lane-secret-1')
    expect(lane.getAttribute('data-tone')).toBe('secret')
    expect(
      [...lane.querySelectorAll('text')].map((t) => t.textContent),
    ).toEqual(['◆', '◇'])
    expect(lane.querySelectorAll('circle')).toHaveLength(2)
    expect(lane.querySelector('line')?.hasAttribute('stroke-dasharray')).toBe(
      false,
    )
    cleanup()
    renderChart({
      model: model(six(), {
        secrets: [
          secret({
            establishedSceneId: 'scene-2',
            revealedSceneId: 'scene-1',
          }),
        ],
      }),
    })
    expect(
      screen.getByTestId('chart-lane-secret-1').getAttribute('data-tone'),
    ).toBe('amber')
  })

  it('each secret gets its own lane, the chart grows to fit, and an amber lane paints last', () => {
    renderChart({
      model: model(six(), {
        secrets: [
          // Kept after it is out: amber.
          secret({
            id: 'secret-a',
            establishedSceneId: 'scene-1',
            revealedSceneId: 'scene-3',
            concealmentSceneIds: ['scene-5'],
          }),
          secret({ id: 'secret-b', establishedSceneId: 'scene-2' }),
        ],
      }),
    })
    const y = (id: string) =>
      screen
        .getByTestId(`chart-lane-${id}`)
        .querySelector('line')
        ?.getAttribute('y1')
    expect([y('secret-a'), y('secret-b')]).toEqual(['74', '82'])
    const svg = chart().querySelector('svg')!
    expect(svg.getAttribute('height')).toBe('92')
    expect(svg.getAttribute('viewBox')).toBe('0 0 960 92')
    expect(
      [...svg.querySelectorAll('[data-testid^="chart-lane-"]')].map((el) =>
        el.getAttribute('data-tone'),
      ),
    ).toEqual(['secret', 'amber'])
  })

  it('measures its width before the first paint', () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(840)
    try {
      renderChart()
      expect(chart().querySelector('svg')?.getAttribute('viewBox')).toBe(
        '0 0 840 84',
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('a story note or an order problem draws an amber top rule; a draft draws a coral dot; a locked scene is underlined', () => {
    const scenes = six().map((s) =>
      s.id === 'scene-5' ? { ...s, locked: true } : s,
    )
    // thread-1 pays off in scene-3 before its setup in scene-4: an Order
    // note on both.
    const m = model(
      scenes,
      { threads: [thread('thread-1', 'scene-4', 'scene-3')] },
      [storyFlag('scene-1')],
    )
    renderChart({ model: m, draftSceneIds: new Set(['scene-6']) })
    expect(flagged('data-note')).toEqual(['scene-1', 'scene-3', 'scene-4'])
    expect(flagged('data-draft')).toEqual(['scene-6'])
    expect(flagged('data-locked')).toEqual(['scene-5'])
    expect(block('scene-6').querySelector('circle')).not.toBeNull()
    cleanup()
    renderChart({ model: m, episodeLocked: true })
    expect(flagged('data-locked')).toEqual(SIX_IDS)
  })

  it('under a highlight, matching blocks are lit', () => {
    const m = model(
      six(),
      { threads: [thread('thread-1', 'scene-2', 'scene-4')] },
      [storyFlag('scene-6')],
    )
    renderChart({ model: m, highlight: { kind: 'threads', who: null } })
    expect(flagged('data-match')).toEqual(['scene-2', 'scene-4'])
    cleanup()
    renderChart({ model: m })
    expect(flagged('data-match')).toEqual([])
  })

  it('never animates', () => {
    const m = model(
      six([100, 200]),
      {
        threads: [
          thread('thread-1', 'scene-2', 'scene-4'),
          thread('thread-2', 'scene-3', null),
        ],
        secrets: [secret({ concealmentSceneIds: ['scene-2'] })],
      },
      [storyFlag('scene-1')],
    )
    renderChart({
      model: m,
      selectedId: 'scene-2',
      highlight: { kind: 'secret', who: null },
      draftSceneIds: new Set(['scene-3']),
    })
    const all = [chart(), ...chart().querySelectorAll('*')]
    expect(
      all.filter((el) =>
        /transition|animate/.test(el.getAttribute('class') ?? ''),
      ),
    ).toEqual([])
    expect(
      chart().querySelectorAll('animate, animateTransform, animateMotion, set'),
    ).toHaveLength(0)
  })

  it('Story order: hidden without a story order, but a flashback is still marked', () => {
    renderChart({
      outline: [
        {
          sceneId: 'scene-2',
          summary: '',
          storyOrder: null,
          storyTime: 'That afternoon',
          anachrony: 'flashback',
        },
      ],
    })
    expect(screen.queryByRole('button', { name: 'Story order' })).toBeNull()
    expect(flagged('data-anachrony')).toEqual(['scene-2'])
    expect(block('scene-2').querySelector('title')?.textContent).toContain(
      'That afternoon — flashback',
    )
    expect(chart().textContent).toContain('↶ flashback')
  })

  it('Story order: the toggle reorders the blocks and marks the anachronies; the board order is untouched', () => {
    const row = (
      sceneId: string,
      storyOrder: number,
      anachrony: 'none' | 'flashback' | 'flashforward' = 'none',
    ) => ({ sceneId, summary: '', storyOrder, storyTime: '', anachrony })
    const m = model(six())
    renderChart({
      model: m,
      outline: [
        row('scene-1', 1),
        row('scene-2', 0, 'flashback'),
        row('scene-3', 2),
        row('scene-4', 3),
        row('scene-5', 5, 'flashforward'),
        row('scene-6', 4),
      ],
    })
    const toggle = screen.getByRole('button', { name: 'Story order' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(flagged('data-chart-block')).toEqual(SIX_IDS)

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(flagged('data-chart-block')).toEqual([
      'scene-2',
      'scene-1',
      'scene-3',
      'scene-4',
      'scene-6',
      'scene-5',
    ])
    expect(flagged('data-anachrony')).toEqual(['scene-2', 'scene-5'])
    expect(chart().querySelector('.sr-only')?.textContent).toContain(
      'The blocks are in story order.',
    )
    expect(m.order.map((s) => s.id)).toEqual(SIX_IDS)
  })

  it('renders nothing without scenes', () => {
    const { container } = renderChart({ model: model([]) })
    expect(container.firstChild).toBeNull()
  })
})
