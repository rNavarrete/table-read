// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Beat,
  Character,
  ConsistencyFlag,
  Episode,
  Motivation,
  Project,
  Scene,
  Secret,
  StoryThread,
} from 'contract'
import { boardModel } from '../story'
import { EpisodeView, type EpisodeViewProps } from './EpisodeView'
import { WithDrafts } from './testDrafts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// "The Long Pour" (docs/tableread-fixture.json): acts, places, wants and the
// audience lines of its six scenes.

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

function beat(id: string, index: number, scriptText = ''): Beat {
  return {
    id,
    index,
    locked: false,
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    scriptText,
    scriptLocked: false,
  }
}

function scene(
  n: number,
  act: number,
  location: string,
  wants: string[],
  overrides: Partial<Scene> = {},
): Scene {
  return {
    id: `scene-${n}`,
    index: n - 1,
    act,
    storyline: 'A',
    locked: false,
    location,
    time: 'Night',
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: wants.map(want),
    beats: [beat(`beat-${n}-1`, 0)],
    ...overrides,
  }
}

function longPourScenes(script = false): Scene[] {
  const text = (n: number) => (script ? 'x'.repeat(n * 100) : '')
  return [
    scene(1, 0, 'INT. THE LONG POUR - NIGHT', ['char-marta', 'char-dan'], {
      beats: [beat('beat-1-1', 0, text(1))],
    }),
    scene(2, 1, 'INT. THE LONG POUR - BASEMENT - NIGHT', ['char-dan'], {
      beats: [beat('beat-2-1', 0, text(2))],
    }),
    scene(3, 1, 'INT. THE LONG POUR - BAR - DAY', ['char-marta', 'char-dan'], {
      audienceLearns:
        'The bar is two months from foreclosure; Dan is lying by omission to her face.',
      audienceFeels:
        "The sick tension of watching someone fail a test they don't know they're taking.",
      beats: [beat('beat-3-1', 0, text(3))],
    }),
    scene(4, 2, 'INT. THE LONG POUR - VARIOUS - NIGHT', ['char-marta'], {
      beats: [beat('beat-4-1', 0, text(4)), beat('beat-4-2', 1)],
    }),
    scene(5, 3, 'INT. THE LONG POUR - KITCHEN - NIGHT', [
      'char-marta',
      'char-dan',
    ]),
    scene(6, 4, 'INT. THE LONG POUR - BAR - DAY', ['char-reyes', 'char-dan']),
  ]
}

function character(id: string, name: string): Character {
  return {
    id,
    name,
    locked: false,
    aliases: [],
    embodiment: '',
    presentation: '',
    hiding: '',
    traits: '',
    seriesArc: '',
    summary: '',
    bio: '',
  }
}

const CHARACTERS = [
  character('char-marta', 'Marta Vega'),
  character('char-dan', 'Dan Vega'),
  character('char-reyes', 'Detective Ana Reyes'),
  character('char-luz', 'Luz Vega'),
]

function thread(
  id: string,
  label: string,
  setupSceneId: string,
  payoffSceneId: string | null,
  status: StoryThread['status'] = payoffSceneId ? 'paid_off' : 'open',
): StoryThread {
  return {
    id,
    label,
    summary: '',
    status,
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
    id: 'secret-money',
    summary: 'Dan took the money and hid it in the building.',
    factId: null,
    holderCharacterIds: ['char-dan'],
    concealedFromCharacterIds: ['char-marta', 'char-reyes'],
    audienceKnows: true,
    establishedSceneId: 'scene-2',
    revealedSceneId: null,
    concealmentSceneIds: ['scene-3', 'scene-4', 'scene-5'],
    establishedQuote: '',
    revealedQuote: '',
    establishedBeatId: null,
    revealedBeatId: null,
    provenance: 'inferred',
    locked: false,
    ...overrides,
  }
}

function flag(overrides: Partial<ConsistencyFlag>): ConsistencyFlag {
  return {
    id: 'flag-1',
    objectType: 'scene',
    objectId: 'scene-5',
    factId: null,
    explanation: 'Marta already knows about the safe from fact-04. Check it.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-1',
    ...overrides,
  }
}

const FLAGS = [
  flag({ id: 'flag-story' }),
  flag({
    id: 'flag-import',
    objectType: 'beat',
    objectId: 'beat-4-1',
    explanation:
      '[model_unassigned] Imported source lines 12-14 could not be assigned to a beat.',
  }),
]

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: 'Episode premise text.',
    seasonFunction: '',
    storylines: [],
    scenes: longPourScenes(true),
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads: [
      thread('thread-hole', 'The hole in the books', 'scene-1', null),
      thread('thread-safe', 'The emptied safe', 'scene-2', 'scene-4'),
      thread('thread-old', 'The old lease', 'scene-3', null, 'abandoned'),
    ],
    secrets: [secret()],
    storyOverview: {
      logline: 'A daughter comes home to run the bar and finds a hole in it.',
      outline: [],
      beatSheet: [
        {
          beatId: 'beat-3-1',
          label: 'Act One Turn',
          summary: '',
          sceneId: 'scene-3',
          act: 1,
        },
      ],
      summary: '',
      provenance: 'inferred',
      locked: false,
    },
    narrativeMap: null,
    structureChecks: [],
    ...overrides,
  }
}

function project(ep: Episode): Project {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: false,
      serialization: 0.8,
    },
    enabledComponents: [],
    premise: 'Series premise text.',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters: CHARACTERS,
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
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
  }
}

function props(
  ep: Episode = episode(),
  flags: ConsistencyFlag[] = FLAGS,
): EpisodeViewProps {
  const p = project(ep)
  return {
    project: p,
    episode: ep,
    model: boardModel(p, ep, flags),
    pending: false,
    openingReview: false,
    onSelectScene: vi.fn(),
    onHighlight: vi.fn(),
    onOpenLedgerThreads: vi.fn(),
    onSaveEpisodePremise: vi.fn().mockResolvedValue(true),
    onSaveSeriesPremise: vi.fn().mockResolvedValue(true),
  }
}

function section(id: string): HTMLDetailsElement {
  const el = document.getElementById(`plan-section-${id}`)
  if (!(el instanceof HTMLDetailsElement)) throw new Error(`no section ${id}`)
  return el
}

function ideaBorn(): Episode {
  return episode({
    scenes: longPourScenes(false).map((s) => ({ ...s, motivations: [] })),
    threads: [],
    secrets: [],
    storyOverview: null,
  })
}

describe('EpisodeView', () => {
  it('is the inspector aside, titled by the episode, with the logline and a format line', () => {
    render(<EpisodeView {...props()} />, { wrapper: WithDrafts })
    const aside = screen.getByTestId('inspector')
    expect(aside.tagName).toBe('ASIDE')
    expect(aside.className).toContain('w-panel-plan')
    const title = screen.getByRole('heading', {
      level: 2,
      name: 'Episode 1: Last Call',
    })
    expect(title.tabIndex).toBe(-1)
    expect(title.className).not.toContain('outline-none')
    expect(
      screen.getByText(
        'A daughter comes home to run the bar and finds a hole in it.',
      ),
    ).not.toBeNull()
    expect(
      screen.getByText('Drama · 60 min · 4 acts + cold open'),
    ).not.toBeNull()
  })

  it('Acts: one row per act with its share bar, scene count, marked landmarks and act-out scene with what the audience learns and feels; the row selects that scene', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<EpisodeView {...p} />, { wrapper: WithDrafts })
    const acts = within(section('ep-acts'))
    expect(acts.getAllByTitle(/estimated share of the script/)).toHaveLength(5)
    expect(acts.getByText('≈50%')).not.toBeNull()
    expect(acts.getByText('✓ Turn · 3')).not.toBeNull()
    expect(acts.getAllByText('2 scenes')).toHaveLength(1)
    expect(acts.getAllByText('1 scene')).toHaveLength(4)

    const out = acts.getByRole('button', {
      name: /^Act out · scene 3 · Bar/,
    })
    expect(out.textContent).toContain('two months from foreclosure')
    expect(out.textContent).toContain(
      "Feels: The sick tension of watching someone fail a test they don't know they're taking.",
    )
    await user.click(out)
    expect(p.onSelectScene).toHaveBeenCalledWith('scene-3')
    // The cold open's act out records no learns/feels: no empty "Feels:".
    expect(
      acts.getByRole('button', { name: /^Act out · scene 1 · The Long Pour$/ })
        .textContent,
    ).not.toContain('Feels')
    expect(
      acts.getByText('Length is a share of the script text, not pages.'),
    ).not.toBeNull()
  })

  it('Threads: open threads with their setup scene, and See all n in Ledger', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<EpisodeView {...p} />, { wrapper: WithDrafts })
    const threads = section('ep-threads')
    expect(threads.querySelector('summary')?.textContent).toContain(
      '1 open · 1 paid off',
    )
    const row = within(threads).getByRole('button', {
      name: /↗ The hole in the books/,
    })
    expect(row.textContent).toContain('never paid off')
    expect(threads.textContent).not.toContain('The emptied safe')
    expect(threads.textContent).not.toContain('The old lease')
    await user.click(row)
    expect(p.onSelectScene).toHaveBeenCalledWith('scene-1')
    await user.click(
      within(threads).getByRole('button', {
        name: 'See all 3 in Ledger → Threads',
      }),
    )
    expect(p.onOpenLedgerThreads).toHaveBeenCalledTimes(1)
  })

  it('The secret: set, kept in n scenes, out or never revealed, hidden from whom, and Highlight on the board', async () => {
    const user = userEvent.setup()
    const p = props()
    const { rerender } = render(<EpisodeView {...p} />, {
      wrapper: WithDrafts,
    })
    const secretSection = within(section('ep-secret'))
    expect(
      secretSection.getByText('Dan took the money and hid it in the building.'),
    ).not.toBeNull()
    expect(secretSection.getByText(/kept in 3 scenes/)).not.toBeNull()
    expect(secretSection.getByText(/never revealed/)).not.toBeNull()
    expect(
      secretSection.getByText('Hidden from Marta Vega, Detective Ana Reyes.'),
    ).not.toBeNull()
    await user.click(secretSection.getByRole('button', { name: 'Set in 2' }))
    expect(p.onSelectScene).toHaveBeenCalledWith('scene-2')
    await user.click(
      secretSection.getByRole('button', { name: 'Highlight on the board' }),
    )
    expect(p.onHighlight).toHaveBeenCalledWith({ kind: 'secret', who: null })

    const out = props(
      episode({ secrets: [secret({ revealedSceneId: 'scene-5' })] }),
    )
    rerender(<EpisodeView {...out} />)
    await user.click(
      within(section('ep-secret')).getByRole('button', { name: 'out in 5' }),
    )
    expect(out.onSelectScene).toHaveBeenCalledWith('scene-5')
    expect(section('ep-secret').textContent).not.toContain('never revealed')
  })

  it('Notes are grouped by scene, and From the import is a closed group', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<EpisodeView {...p} />, { wrapper: WithDrafts })
    const notes = section('ep-notes')
    expect(notes.querySelector('summary')?.textContent).toContain('Notes (1)')
    const row = within(notes).getByRole('button', {
      name: /^5 · Kitchen/,
    })
    expect(row.textContent).toContain(
      'Marta already knows about the safe from a Ledger fact.',
    )
    await user.click(row)
    expect(p.onSelectScene).toHaveBeenCalledWith('scene-5')

    const imports = within(notes)
      .getByText('From the import · 1')
      .closest('details')
    expect(imports).not.toBeNull()
    expect(imports?.open).toBe(false)
    expect(
      within(imports as HTMLElement).getByRole('button', {
        name: /^4 · Various/,
      }).textContent,
    ).toContain("The import couldn't place script lines 12–14")
    expect(notes.textContent).not.toMatch(/\[[a-z_]+\]/)
    expect(notes.textContent).not.toContain('fact-04')
  })

  it("Who's in it chips switch the board highlight", async () => {
    const user = userEvent.setup()
    const p = props()
    render(<EpisodeView {...p} />, { wrapper: WithDrafts })
    const cast = within(section('ep-cast'))
    expect(cast.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Dan Vega 5',
      'Marta Vega 4',
      'Detective Ana Reyes 1',
    ])
    await user.click(cast.getByRole('button', { name: 'Marta Vega 4' }))
    expect(p.onHighlight).toHaveBeenCalledWith({
      kind: 'who',
      who: 'char-marta',
    })
    expect(
      cast.getByText(/from dialogue cues and recorded wants/),
    ).not.toBeNull()
  })

  it('Premise is closed by default and still saves through the structural footer', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<EpisodeView {...p} />, { wrapper: WithDrafts })
    const premise = section('ep-premise')
    expect(premise.open).toBe(false)
    expect(section('ep-acts').open).toBe(true)
    await user.click(within(premise).getByText('Premise'))
    expect(premise.open).toBe(true)
    expect(screen.getByDisplayValue('Episode premise text.')).not.toBeNull()
    await user.type(screen.getByLabelText('Series premise'), ' More.')
    expect(
      (screen.getByRole('button', { name: 'Open Review' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Save field only' }))
    expect(p.onSaveSeriesPremise).toHaveBeenCalledWith(
      'Series premise text. More.',
    )
  })

  it('a locked episode makes its premise read-only, not the series premise', () => {
    render(<EpisodeView {...props(episode({ locked: true }))} />, {
      wrapper: WithDrafts,
    })
    expect(
      (screen.getByLabelText('Episode premise') as HTMLTextAreaElement)
        .readOnly,
    ).toBe(true)
    expect(
      (screen.getByLabelText('Series premise') as HTMLTextAreaElement).readOnly,
    ).toBe(false)
  })

  it('an idea-born episode shows one quiet line per empty section', () => {
    render(<EpisodeView {...props(ideaBorn(), [])} />, {
      wrapper: WithDrafts,
    })
    expect(screen.getByText('No threads recorded.')).not.toBeNull()
    expect(screen.getByText('No secret recorded.')).not.toBeNull()
    expect(screen.getByText('No open notes.')).not.toBeNull()
    expect(screen.getByText('No cast yet.')).not.toBeNull()
    expect(
      screen.queryAllByTitle(/estimated share of the script/),
    ).toHaveLength(0)
    expect(
      screen.queryByText('Length is a share of the script text, not pages.'),
    ).toBeNull()
    expect(screen.queryByText(/See all/)).toBeNull()
    expect(screen.queryByText(/From the import/)).toBeNull()
  })
})
