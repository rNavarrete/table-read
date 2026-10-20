// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Episode, LedgerFact, Project, Scene } from 'contract'
import { ScenePanel, type ScenePanelProps } from './ScenePanel'
import { WithDrafts } from './testDrafts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: 'Alone',
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
    whatHappens: 'Marta walks back in.',
    audienceLearns: 'Eight years away.',
    audienceFeels: 'Unease.',
    motivations: [
      {
        characterId: 'char-marta',
        objective: 'Come home',
        stakes: 'Everything',
        obstacle: 'Dan',
        statedObjective: '',
        concealed: false,
      },
    ],
    beats: [
      {
        id: 'beat-1-1',
        index: 0,
        locked: false,
        whatHappens: 'Dan covers his shock.',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: false,
        actorCharacterId: null,
        actionVerb: '',
        targetCharacterId: null,
        reaction: '',
      },
      {
        id: 'beat-1-2',
        index: 1,
        locked: true,
        whatHappens: 'Marta opens the books.',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: true,
        actorCharacterId: null,
        actionVerb: '',
        targetCharacterId: null,
        reaction: '',
      },
    ],
    ...overrides,
  }
}

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: '',
    seasonFunction: '',
    storylines: [],
    scenes: [
      scene(),
      scene({
        id: 'scene-2',
        index: 1,
        act: 1,
        location: 'INT. THE LONG POUR - BASEMENT - NIGHT',
        motivations: [],
        beats: [],
      }),
    ],
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads: [],
    secrets: [],
    storyOverview: null,
    narrativeMap: null,
    structureChecks: [],
    characterArcs: [],
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
    premise: '',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters: [
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
      ],
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

function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: 'fact-01',
    fact: 'Marta has been away for eight years',
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

function props(overrides: Partial<ScenePanelProps> = {}): ScenePanelProps {
  const ep = overrides.episode ?? episode()
  return {
    project: project(ep),
    episode: ep,
    scene: ep.scenes[0],
    selectedBeatId: null,
    ledger: [],
    flags: [],
    pending: false,
    openingReview: false,
    onBack: vi.fn(),
    onEscape: vi.fn(),
    onSelectScene: vi.fn(),
    onSelectBeat: vi.fn(),
    onToggleSceneLock: vi.fn(),
    onToggleBeatLock: vi.fn(),
    onToggleBeatScriptLock: vi.fn(),
    onSaveSceneField: vi.fn().mockResolvedValue(true),
    onSaveBeatField: vi.fn().mockResolvedValue(true),
    onOpenReview: vi.fn(),
    onSuggest: vi.fn().mockResolvedValue([]),
    onOpenInWrite: vi.fn(),
    onOpenBeatInWrite: vi.fn(),
    onOpenFact: vi.fn(),
    onOpenLedger: vi.fn(),
    ...overrides,
  }
}

function renderPanel(overrides: Partial<ScenePanelProps> = {}) {
  const p = props(overrides)
  return { props: p, ...render(<ScenePanel {...p} />, { wrapper: WithDrafts }) }
}

function sectionOrder(): (string | undefined)[] {
  return Array.from(
    screen
      .getByTestId('inspector')
      .querySelectorAll<HTMLElement>('[data-plan-section]'),
  ).map((el) => el.dataset.planSection)
}

function jumpLabels(): (string | null)[] {
  return within(screen.getByTestId('jump-bar'))
    .getAllByRole('button')
    .map((el) => el.textContent)
}

describe('ScenePanel', () => {
  it('is the inspector aside, 400px, scrolling on its own, sections in the new order', () => {
    renderPanel()
    const aside = screen.getByTestId('inspector')
    expect(aside.tagName).toBe('ASIDE')
    expect(aside.className).toContain('w-panel-plan')
    expect(aside.className).toContain('overflow-y-auto')
    expect(sectionOrder()).toEqual([
      'scene',
      'wants',
      'touches',
      'beats',
      'details',
    ])
  })

  it('header: scene number and cleaned place, the full slug below', () => {
    renderPanel()
    expect(screen.getByText('Scene 1 of 2')).not.toBeNull()
    expect(
      within(screen.getByTestId('panel-header')).getByRole('heading', {
        level: 2,
      }).textContent,
    ).toBe('1 · The Long Pour')
    expect(screen.getByText('INT. THE LONG POUR - NIGHT')).not.toBeNull()
  })

  it('identifying header text meets AA: no secondary or muted text on the slug, title or jump labels', () => {
    renderPanel()
    const header = screen.getByTestId('panel-header')
    const identifying = [
      within(header).getByRole('heading', { level: 2 }),
      screen.getByText('INT. THE LONG POUR - NIGHT'),
      ...within(screen.getByTestId('jump-bar')).getAllByRole('button'),
    ]
    for (const el of identifying) {
      expect(el.className).toContain('text-tr-text-primary')
      expect(el.className).not.toMatch(/text-tr-text-(secondary|muted)/)
    }
  })

  it('the secret callout labels someone placed only by dialogue cues', () => {
    const ep = episode({
      secrets: [
        {
          id: 'secret-1',
          summary: 'Dan took the $40,000.',
          factId: null,
          holderCharacterIds: [],
          concealedFromCharacterIds: ['char-marta', 'char-luz'],
          audienceKnows: true,
          establishedSceneId: 'scene-2',
          revealedSceneId: null,
          concealmentSceneIds: ['scene-1'],
          establishedQuote: '',
          revealedQuote: '',
          establishedBeatId: null,
          revealedBeatId: null,
          provenance: 'inferred',
          locked: false,
        },
      ],
    })
    ep.scenes[0] = scene({
      beats: [
        {
          ...scene().beats[0],
          scriptText: 'LUZ\nYou came back.',
        },
      ],
    })
    const p = props({ episode: ep, scene: ep.scenes[0] })
    p.project.seriesBible.characters.push({
      ...p.project.seriesBible.characters[0],
      id: 'char-luz',
      name: 'Luz Vega',
    })
    render(<ScenePanel {...p} />, { wrapper: WithDrafts })
    expect(
      screen.getByText('In this scene, Marta Vega is in the dark.'),
    ).not.toBeNull()
    expect(
      screen.getByText(
        'In this scene, Luz Vega is in the dark · from dialogue cues',
      ),
    ).not.toBeNull()
  })

  it("Who wants what: Head at for an arc character present, not one who isn't", () => {
    const arc = (characterId: string, sceneId: string, headAt: string) => ({
      characterId,
      want: '',
      need: '',
      lie: '',
      ghost: '',
      continuumAxis: 'trusting ↔ suspicious',
      stops: [{ sceneId, headAt }],
    })
    renderPanel({
      episode: episode({
        characterArcs: [
          arc('char-marta', 'scene-1', 'Still trusts Dan.'),
          // Dan is not in scene 1 (no want, no dialogue cue).
          arc('char-dan', 'scene-1', 'Cornered.'),
        ],
      }),
    })
    const wants = within(
      document.getElementById('plan-section-wants') as HTMLElement,
    )
    expect(wants.getByText('Head at')).not.toBeNull()
    expect(wants.getByText('Still trusts Dan.')).not.toBeNull()
    expect(wants.queryByText('Cornered.')).toBeNull()
  })

  it('jump bar counts wants, touches and beats; no Notes without notes', () => {
    renderPanel({
      ledger: [
        fact(),
        fact({ id: 'fact-03', status: 'superseded' }),
        fact({
          id: 'fact-02',
          sourceSpan: { ...fact().sourceSpan, sceneId: 'scene-2' },
        }),
      ],
      episode: episode({
        threads: [
          {
            id: 'thread-1',
            label: 'The transfer',
            summary: 'Where did the money go?',
            status: 'paid_off',
            ownerCharacterIds: [],
            setupSceneId: 'scene-1',
            payoffSceneId: 'scene-2',
            setupQuote: '',
            payoffQuote: '',
            setupBeatId: null,
            payoffBeatId: null,
            locked: false,
            storyline: null,
            movements: [],
            closureLevel: null,
            secondJob: '',
          },
        ],
      }),
    })
    // Touches = 1 thread + 1 shown fact (the superseded one and scene-2's don't count).
    expect(jumpLabels()).toEqual([
      'Scene',
      'Wants 1',
      'Touches 2',
      'Beats 2',
      'Details',
    ])
  })

  it('renders the notes slot before the sections and adds Notes n to the jump bar', () => {
    renderPanel({
      noteCount: 2,
      notes: () => (
        <section id="plan-section-notes" data-plan-section="notes">
          Two notes
        </section>
      ),
    })
    expect(sectionOrder()[0]).toBe('notes')
    expect(jumpLabels()[0]).toBe('Notes 2')
    expect(
      within(screen.getByTestId('jump-bar'))
        .getByRole('button', { name: 'Notes 2' })
        .getAttribute('aria-current'),
    ).toBe('true')
  })

  it('‹ › step through scenes in board order, not array order', async () => {
    const user = userEvent.setup()
    const ep = episode({
      scenes: [
        scene({ id: 'scene-a', index: 0, act: 0 }),
        scene({ id: 'scene-b', index: 1, act: 2 }),
        scene({ id: 'scene-c', index: 2, act: 1 }),
      ],
    })
    const { props: p } = renderPanel({ episode: ep, scene: ep.scenes[2] })
    // "n of N" is the position ‹ › step through, not index + 1.
    expect(screen.getByText('Scene 2 of 3')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Previous scene' }))
    expect(p.onSelectScene).toHaveBeenLastCalledWith('scene-a')
    await user.click(screen.getByRole('button', { name: 'Next scene' }))
    expect(p.onSelectScene).toHaveBeenLastCalledWith('scene-b')
  })

  it('‹ is disabled on the first scene in board order', () => {
    renderPanel()
    expect(
      (
        screen.getByRole('button', {
          name: 'Previous scene',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('Esc in the panel asks to go back to the card', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    screen.getByRole('button', { name: 'Next scene' }).focus()

    await user.keyboard('{Escape}')

    expect(p.onEscape).toHaveBeenCalledOnce()
  })

  it('Esc in a text field stays in the field', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    const field = screen.getByLabelText('What happens')
    await user.type(field, '!')

    await user.keyboard('{Escape}')

    expect(p.onEscape).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field)
    expect((field as HTMLTextAreaElement).value).toBe('Marta walks back in.!')
  })

  it('← Episode goes back to the nothing-selected view', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    await user.click(screen.getByRole('button', { name: '← Episode' }))
    expect(p.onBack).toHaveBeenCalled()
  })

  it('shows the unsaved chip while this scene has a draft, and drops it when typed back', async () => {
    const user = userEvent.setup()
    renderPanel()
    expect(screen.queryByTestId('unsaved-chip')).toBeNull()
    const field = screen.getByLabelText('Audience learns')
    await user.type(field, '!')
    expect(screen.getByTestId('unsaved-chip')).not.toBeNull()
    await user.type(field, '{Backspace}')
    expect(screen.queryByTestId('unsaved-chip')).toBeNull()
  })

  it('scene lock toggle calls onToggleSceneLock with the flipped value', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    await user.click(screen.getByTestId('lock-toggle'))
    expect(p.onToggleSceneLock).toHaveBeenCalledWith('scene-1', true)
  })

  it('locked scene: banner, read-only fields, Act disabled; the lock switch still works', () => {
    const ep = episode()
    ep.scenes[0] = scene({ locked: true })
    renderPanel({ episode: ep, scene: ep.scenes[0] })
    expect(
      screen.getByText(
        'Locked — unlock to edit. Review will never change this scene.',
      ),
    ).not.toBeNull()
    expect(
      (screen.getByLabelText('What happens') as HTMLTextAreaElement).readOnly,
    ).toBe(true)
    expect(
      (screen.getByRole('combobox', { name: 'Act' }) as HTMLSelectElement)
        .disabled,
    ).toBe(true)
    const toggle = screen.getByTestId('lock-toggle') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.disabled).toBe(false)
    expect(
      within(screen.getByTestId('panel-header')).getByRole('img', {
        name: 'Locked',
      }),
    ).not.toBeNull()
  })

  it('Act select lists the format acts and saves a change immediately', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    const select = screen.getByRole('combobox', { name: 'Act' })
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['COLD OPEN', 'ACT ONE', 'ACT TWO', 'ACT THREE', 'ACT FOUR'])
    await user.selectOptions(select, '2')
    expect(p.onSaveSceneField).toHaveBeenCalledWith('scene-1', 'act', 2)
  })

  it('Act select is disabled when the episode is locked', () => {
    const ep = episode({ locked: true })
    renderPanel({ episode: ep, scene: ep.scenes[0] })
    expect(
      (screen.getByRole('combobox', { name: 'Act' }) as HTMLSelectElement)
        .disabled,
    ).toBe(true)
  })

  it('the Act select stays focusable while its save is pending and ignores a second change', () => {
    const { props: p } = renderPanel({ pending: true })
    const select = screen.getByRole('combobox', {
      name: 'Act',
    }) as HTMLSelectElement
    expect(select.disabled).toBe(false)
    expect(select.getAttribute('aria-disabled')).toBe('true')
    select.focus()
    fireEvent.change(select, { target: { value: '3' } })
    expect(p.onSaveSceneField).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(select)
    expect(select.value).toBe('0')
  })

  it('the lock switch is disabled while a patch is pending', () => {
    renderPanel({ pending: true })
    expect(
      (screen.getByTestId('lock-toggle') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('Open in Write ↗ opens this scene', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    await user.click(screen.getByRole('button', { name: 'Open in Write ↗' }))
    expect(p.onOpenInWrite).toHaveBeenCalledWith('scene-1')
  })

  it('Open Review on What happens sends the scene id and the draft', async () => {
    const user = userEvent.setup()
    const { props: p } = renderPanel()
    const field = screen.getByLabelText('What happens')
    await user.clear(field)
    await user.type(field, 'Marina rewrite.')
    await user.click(screen.getByRole('button', { name: 'Open Review' }))
    expect(p.onOpenReview).toHaveBeenCalledWith('scene-1', 'Marina rewrite.')
  })

  it('keeps exactly one lock-toggle test id while a beat row is expanded', () => {
    renderPanel({ selectedBeatId: 'beat-1-1' })
    expect(screen.getAllByTestId('lock-toggle')).toHaveLength(1)
  })

  it('never asks for suggestions on render or on a scene change', () => {
    const onSuggest = vi.fn().mockResolvedValue([])
    const ep = episode()
    ep.scenes[0] = scene({ whatHappens: '' })
    const p = props({ episode: ep, scene: ep.scenes[0], onSuggest })
    const { rerender } = render(<ScenePanel {...p} />, { wrapper: WithDrafts })
    rerender(<ScenePanel {...p} scene={ep.scenes[1]} />)
    expect(onSuggest).not.toHaveBeenCalled()
  })

  it('a jump opens a closed section and scrolls the panel to it', async () => {
    const user = userEvent.setup()
    const scrollTo = vi
      .spyOn(Element.prototype, 'scrollTo')
      .mockImplementation(() => {})
    renderPanel()
    const details = document.getElementById(
      'plan-section-details',
    ) as HTMLDetailsElement
    expect(details.open).toBe(false)

    await user.click(
      within(screen.getByTestId('jump-bar')).getByRole('button', {
        name: 'Details',
      }),
    )

    expect(details.open).toBe(true)
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth' }),
      ),
    )
  })

  it('scroll-spy underlines the section under the sticky header', () => {
    renderPanel()
    const aside = screen.getByTestId('inspector')
    const tops: Record<string, number> = {
      scene: 100,
      wants: 300,
      touches: 500,
      beats: 700,
      details: 900,
    }
    aside.querySelectorAll<HTMLElement>('[data-plan-section]').forEach((el) =>
      Object.defineProperty(el, 'offsetTop', {
        value: tops[el.dataset.planSection ?? ''],
      }),
    )
    Object.defineProperty(screen.getByTestId('panel-header'), 'offsetHeight', {
      value: 50,
    })
    Object.defineProperty(aside, 'clientHeight', { value: 400 })
    Object.defineProperty(aside, 'scrollHeight', { value: 2000 })
    Object.defineProperty(aside, 'scrollTop', { value: 280 })

    fireEvent.scroll(aside)

    const current = within(screen.getByTestId('jump-bar'))
      .getAllByRole('button')
      .filter((el) => el.getAttribute('aria-current') === 'true')
      .map((el) => el.textContent)
    expect(current).toEqual(['Wants 1'])
  })

  function currentJump(): (string | null)[] {
    return within(screen.getByTestId('jump-bar'))
      .getAllByRole('button')
      .filter((el) => el.getAttribute('aria-current') === 'true')
      .map((el) => el.textContent)
  }

  it('Show beat opens a closed Beats section and scrolls to the row, on every click', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'tr.plan.sections.v1',
      JSON.stringify({ beats: false }),
    )
    const scrolled: Element[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
    ) {
      // A row inside a closed <details> has no box: nothing scrolls.
      if (!this.closest('details:not([open])')) scrolled.push(this)
    })
    const ep = episode({
      storyOverview: {
        logline: '',
        outline: [],
        summary: '',
        dramaticQuestion: '',
        centralArgument: '',
        antiTheme: '',
        provenance: 'inferred',
        locked: false,
        beatSheet: [
          {
            beatId: 'beat-1-2',
            label: 'Catalyst',
            summary: '',
            sceneId: 'scene-1',
            act: 0,
          },
        ],
      },
    })
    const p = props({ episode: ep, scene: ep.scenes[0] })
    // Selection lives in PlanScreen; this stands in for it.
    function Harness() {
      const [beatId, setBeatId] = useState<string | null>(null)
      return (
        <ScenePanel
          {...p}
          selectedBeatId={beatId}
          onSelectBeat={(_, id) => setBeatId(id)}
        />
      )
    }
    render(<Harness />, { wrapper: WithDrafts })
    const row = screen.getByTestId('beat-card-beat-1-2')
    const link = screen.getByRole('button', { name: 'Beat 1.2' })

    await user.click(link)
    expect(
      (document.getElementById('plan-section-beats') as HTMLDetailsElement)
        .open,
    ).toBe(true)
    await waitFor(() => expect(scrolled).toEqual([row]))

    // Scrolled away, the same link brings the row back.
    await user.click(link)
    await waitFor(() => expect(scrolled).toEqual([row, row]))
  })

  it('a jump keeps the clicked section underlined while its scroll runs, even when it bottoms out', async () => {
    const user = userEvent.setup()
    const scrollTo = vi
      .spyOn(Element.prototype, 'scrollTo')
      .mockImplementation(() => {})
    renderPanel()
    const aside = screen.getByTestId('inspector')
    // A short panel scrolled to the bottom: the spy alone would say Details.
    Object.defineProperty(aside, 'clientHeight', { value: 400 })
    Object.defineProperty(aside, 'scrollHeight', { value: 1000 })
    Object.defineProperty(aside, 'scrollTop', { value: 600 })

    await user.click(
      within(screen.getByTestId('jump-bar')).getByRole('button', {
        name: 'Beats 2',
      }),
    )
    await waitFor(() => expect(scrollTo).toHaveBeenCalled())
    fireEvent.scroll(aside)
    expect(currentJump()).toEqual(['Beats 2'])

    // Once the scroll ends, the spy takes over again.
    fireEvent(aside, new Event('scrollend'))
    fireEvent.scroll(aside)
    expect(currentJump()).toEqual(['Details'])
  })

  it('scrolling within one section does not re-render the panel', () => {
    const onRender = vi.fn()
    render(
      <Profiler id="panel" onRender={onRender}>
        <ScenePanel {...props()} />
      </Profiler>,
      { wrapper: WithDrafts },
    )
    const aside = screen.getByTestId('inspector')
    Object.defineProperty(aside, 'clientHeight', { value: 400 })
    Object.defineProperty(aside, 'scrollHeight', { value: 2000 })
    Object.defineProperty(aside, 'scrollTop', { value: 0 })
    // React may render once more before it bails out on equal state.
    fireEvent.scroll(aside)
    fireEvent.scroll(aside)
    const renders = onRender.mock.calls.length
    fireEvent.scroll(aside)
    fireEvent.scroll(aside)
    fireEvent.scroll(aside)
    expect(onRender.mock.calls.length).toBe(renders)
  })

  it('a scene switch folds the retired facts away again', async () => {
    const user = userEvent.setup()
    const p = props({
      ledger: [
        fact({ id: 'fact-03', status: 'superseded' }),
        fact({
          id: 'fact-04',
          status: 'stale',
          sourceSpan: { ...fact().sourceSpan, sceneId: 'scene-2' },
        }),
      ],
    })
    const { rerender } = render(<ScenePanel {...p} />, { wrapper: WithDrafts })
    await user.click(screen.getByRole('button', { name: 'Show 1 retired' }))
    expect(screen.getByRole('button', { name: 'Hide retired' })).not.toBeNull()

    rerender(<ScenePanel {...p} scene={p.episode.scenes[1]} />)
    expect(
      screen.getByRole('button', { name: 'Show 1 retired' }),
    ).not.toBeNull()
  })

  it('identifying text in What it touches and on beat rows meets AA too', () => {
    const ep = episode({
      threads: [
        {
          id: 'thread-1',
          label: 'The transfer',
          summary: 'Where did the money go?',
          status: 'open',
          ownerCharacterIds: [],
          setupSceneId: 'scene-1',
          payoffSceneId: null,
          setupQuote: '',
          payoffQuote: '',
          setupBeatId: null,
          payoffBeatId: null,
          locked: false,
          storyline: null,
          movements: [],
          closureLevel: null,
          secondJob: '',
        },
      ],
      timelineAnchors: [
        {
          afterSceneId: 'scene-1',
          label: 'Three days later',
          kind: 'relative',
          quote: '',
        },
      ],
    })
    renderPanel({
      episode: ep,
      scene: ep.scenes[0],
      ledger: [fact({ audienceKnows: false, knownBy: ['char-marta'] })],
    })
    const identifying = [
      screen.getByText('↗ Sets up', { exact: false }),
      screen.getByText('Where did the money go?'),
      screen.getByText('◆ hidden from the audience'),
      screen.getByText('Known by Marta Vega'),
      screen.getByText('lands'),
      screen.getByText('↷ Then a time jump: Three days later'),
    ]
    for (const el of identifying) {
      // The nearest text colour wins: the element's own, else an ancestor's.
      const coloured = el.closest('[class*="text-tr-text-"]')
      expect(coloured?.className).toContain('text-tr-text-primary')
      expect(coloured?.className).not.toMatch(/text-tr-text-(secondary|muted)/)
    }
  })

  it('missing story keys and an empty scene render quiet, with zero counts', () => {
    const ep = episode()
    const raw = { ...ep } as Record<string, unknown>
    delete raw.secrets
    delete raw.timelineAnchors
    delete raw.relationshipStates
    delete raw.threads
    delete raw.storyOverview
    const bare = raw as unknown as Episode
    renderPanel({ episode: bare, scene: bare.scenes[1] })
    expect(jumpLabels()).toEqual([
      'Scene',
      'Wants 0',
      'Touches 0',
      'Beats 0',
      'Details',
    ])
    expect(screen.getByText('No wants recorded for this scene.')).not.toBeNull()
    expect(screen.getByText('No beats yet.')).not.toBeNull()
  })
})
