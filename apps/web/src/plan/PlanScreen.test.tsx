// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  Character,
  ConsistencyFlag,
  Episode,
  Project,
  Scene,
} from 'contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors'
import { loadResume, saveResume } from '../projects/resumeContext'
import { PlanScreen } from './PlanScreen'
import {
  applySceneMove,
  withBeatField,
  withSceneField,
  type SceneMove,
} from './planTree'
import { UNDO_MOVE_STALE } from './useUndoMove'

const {
  createChangeSetMock,
  dismissConsistencyFlagMock,
  getConsistencyFlagsMock,
  getLedgerMock,
  getProjectMock,
  navigateToReviewMock,
  patchProjectMock,
  suggestInstructionsMock,
  undoProjectMock,
} = vi.hoisted(() => ({
  createChangeSetMock: vi.fn(),
  dismissConsistencyFlagMock: vi.fn(),
  getConsistencyFlagsMock: vi.fn(),
  getLedgerMock: vi.fn(),
  getProjectMock: vi.fn(),
  navigateToReviewMock: vi.fn(),
  patchProjectMock: vi.fn(),
  suggestInstructionsMock: vi.fn(),
  undoProjectMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  createChangeSet: createChangeSetMock,
  dismissConsistencyFlag: dismissConsistencyFlagMock,
  exportFountain: vi.fn(),
  getConsistencyFlags: getConsistencyFlagsMock,
  getLedger: getLedgerMock,
  getProject: getProjectMock,
  patchProject: patchProjectMock,
  suggestInstructions: suggestInstructionsMock,
  undoProject: undoProjectMock,
}))

vi.mock('../review/changeSetSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../review/changeSetSession')>()),
  navigateToReview: navigateToReviewMock,
  stashChangeSet: vi.fn(),
}))

// jsdom 29 has no showModal/close (LeavePlanDialog).
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(
    this: HTMLDialogElement,
  ) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
  }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.resetAllMocks()
  window.history.pushState(null, '', '/')
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: '',
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
    whatHappens: 'Marta walks back into the bar.',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    // A usable scene skeleton needs at least one beat (data contract §9.1
    // setupState) — this fixture represents an already-planned project, not
    // one that should show Guided setup.
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
        actorCharacterId: null,
        actionVerb: '',
        targetCharacterId: null,
        reaction: '',
      },
    ],
    ...overrides,
  }
}

function episode(scenes: Scene[]): Episode {
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
    characterArcs: [],
  }
}

function project(): Project {
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
          episode([
            scene(),
            scene({ id: 'scene-2', index: 1, location: 'INT. BACK ROOM' }),
          ]),
        ],
      },
    ],
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
  }
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

/** project() with a cast (Marta wants in scene 1, Dan in scene 2) and one
 * thread set up in scene 1 and never paid off. */
function storyProject(): Project {
  const p = project()
  p.seriesBible.characters = [
    character('char-marta', 'Marta Vega'),
    character('char-dan', 'Dan Vega'),
  ]
  const ep = p.seasons[0].episodes[0]
  const want = (characterId: string) => ({
    characterId,
    objective: 'Keep the bar open',
    stakes: '',
    obstacle: '',
    statedObjective: '',
    concealed: false,
  })
  ep.scenes[0].motivations = [want('char-marta')]
  ep.scenes[1].motivations = [want('char-dan')]
  ep.threads = [
    {
      id: 'thread-1',
      label: 'The missing money',
      summary: '',
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
    },
  ]
  return p
}

/** Loads Plan on scene-1 (no resume stored) and resolves to the panel. */
function loadPlan(p: Project = project()) {
  getProjectMock.mockResolvedValue(p)
  getLedgerMock.mockResolvedValue([])
  getConsistencyFlagsMock.mockResolvedValue([])
  window.history.pushState(null, '', '/plan?project=proj-longpour')
  render(<PlanScreen />)
  return screen.findByTestId('inspector')
}

describe('PlanScreen', () => {
  it('preserves a stored Plan scene while project loading is still pending', () => {
    const request = deferred<Project>()
    getProjectMock.mockReturnValue(request.promise)
    getLedgerMock.mockResolvedValue([])
    getConsistencyFlagsMock.mockResolvedValue([])
    window.history.pushState(null, '', '/plan?project=proj-longpour')
    saveResume('proj-longpour', { mode: 'Plan', sceneId: 'scene-2' })

    render(<PlanScreen />)

    expect(screen.getByText('Loading…')).not.toBeNull()
    expect(loadResume('proj-longpour').sceneId).toBe('scene-2')
  })

  it('keeps the selected scene in Plan resume after project load completes', async () => {
    getProjectMock.mockResolvedValue(project())
    getLedgerMock.mockResolvedValue([])
    getConsistencyFlagsMock.mockResolvedValue([])
    window.history.pushState(null, '', '/plan?project=proj-longpour')
    saveResume('proj-longpour', { mode: 'Plan', sceneId: 'scene-2' })

    render(<PlanScreen />)

    expect(await screen.findByTestId('scene-card-scene-2')).not.toBeNull()
    expect(loadResume('proj-longpour').sceneId).toBe('scene-2')
  })

  it('shows the selected scene in the panel with its beats in the ladder, and never asks for suggestions on its own', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()

    expect(within(panel).getByTestId('lock-toggle')).not.toBeNull()
    expect(within(panel).getByTestId('beat-card-beat-1-1')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand beats' })).toBeNull()

    await user.click(within(panel).getByLabelText('What happens'))
    expect(suggestInstructionsMock).not.toHaveBeenCalled()
  })

  it('the Beat lock in the ladder sends one PATCH for beat.locked', async () => {
    const user = userEvent.setup()
    const p = project()
    patchProjectMock.mockResolvedValue({
      project: withBeatField(p, 'scene-1', 'beat-1-1', 'locked', true),
      consistencyFlags: [],
    })
    const panel = await loadPlan(p)

    await user.click(within(panel).getByTestId('beat-card-beat-1-1'))
    await user.click(within(panel).getByTestId('beat-lock-toggle-beat-1-1'))

    expect(patchProjectMock).toHaveBeenCalledTimes(1)
    expect(patchProjectMock).toHaveBeenCalledWith(
      'proj-longpour',
      [
        {
          op: 'replace',
          path: '/seasons/0/episodes/0/scenes/0/beats/0/locked',
          value: true,
        },
      ],
      { expectedHeadSnapshotId: 'snap-root' },
    )
    await waitFor(() =>
      expect(
        within(panel).getByTestId('beat-card-beat-1-1').textContent,
      ).toContain('Locked'),
    )
  })

  it('a failed save keeps what the writer typed (the draft survives the rollback)', async () => {
    const user = userEvent.setup()
    patchProjectMock.mockRejectedValue(new Error('network down'))
    const panel = await loadPlan()

    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'She is not staying.',
    )
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('save failed')).not.toBeNull()
    expect(
      (within(panel).getByLabelText('Audience learns') as HTMLTextAreaElement)
        .value,
    ).toBe('She is not staying.')
    expect(within(panel).getByRole('button', { name: 'Save' })).not.toBeNull()
  })

  it('a failed Open Review shows a danger toast, not a line above the board', async () => {
    const user = userEvent.setup()
    createChangeSetMock.mockRejectedValue(new Error('review is down'))
    const panel = await loadPlan()

    await user.type(within(panel).getByLabelText('What happens'), ' Again.')
    await user.click(within(panel).getByRole('button', { name: 'Open Review' }))

    const message = await screen.findByText('review is down')
    expect(message.closest('[data-testid="toast"]')).not.toBeNull()
  })

  it('← Episode switches the panel to the episode view and clears the card selection', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()

    await user.click(within(panel).getByRole('button', { name: '← Episode' }))

    expect(
      within(screen.getByTestId('inspector')).queryByTestId('lock-toggle'),
    ).toBeNull()
    expect(
      screen.getByTestId('scene-card-scene-1').getAttribute('aria-pressed'),
    ).toBe('false')
    // Focus was in the panel: it lands on the Episode view's heading.
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe('Episode 1: Last Call'),
    )
  })

  it('an empty-act drop sends one act PATCH and nothing else', async () => {
    const p = project()
    const moved = structuredClone(p)
    // The end of act 4, renumbered: scene-2 is now first.
    Object.assign(moved.seasons[0].episodes[0].scenes[0], { act: 4, index: 1 })
    moved.seasons[0].episodes[0].scenes[1].index = 0
    patchProjectMock.mockResolvedValue({ project: moved, consistencyFlags: [] })
    await loadPlan(p)
    const dataTransfer = {
      setData: () => {},
      getData: () => '',
      effectAllowed: 'move',
    } as unknown as DataTransfer
    const empty = within(screen.getByTestId('act-frame-4')).getByText(
      /^No scenes yet/,
    )

    fireEvent.dragStart(screen.getByTestId('scene-card-scene-1'), {
      dataTransfer,
    })
    fireEvent.dragOver(empty, { dataTransfer })
    fireEvent.drop(empty, { dataTransfer })

    expect(patchProjectMock).toHaveBeenCalledTimes(1)
    expect(patchProjectMock).toHaveBeenCalledWith(
      'proj-longpour',
      sceneOps([0, 'index', 1], [0, 'act', 4], [1, 'index', 0]),
      { expectedHeadSnapshotId: 'snap-root' },
    )
    await waitFor(() =>
      expect(
        within(screen.getByTestId('act-frame-4')).getByTestId(
          'scene-card-scene-1',
        ),
      ).not.toBeNull(),
    )
    expect(suggestInstructionsMock).not.toHaveBeenCalled()
    expect(createChangeSetMock).not.toHaveBeenCalled()
  })

  it('act collapse survives a remount (per project)', async () => {
    const user = userEvent.setup()
    await loadPlan()
    const coldOpen = () => screen.getByTestId('act-frame-0')
    await user.click(
      within(coldOpen()).getByRole('button', { name: 'Hide COLD OPEN' }),
    )
    expect(screen.queryByTestId('scene-card-scene-1')).toBeNull()

    cleanup()
    await loadPlan()
    expect(within(coldOpen()).getByText('2 scenes hidden')).not.toBeNull()
    expect(screen.queryByTestId('scene-card-scene-1')).toBeNull()

    cleanup()
    getProjectMock.mockResolvedValue({ ...project(), id: 'proj-other' })
    window.history.pushState(null, '', '/plan?project=proj-other')
    render(<PlanScreen />)
    expect(await screen.findByTestId('scene-card-scene-1')).not.toBeNull()
  })

  it('selecting a scene in a collapsed act opens that act', async () => {
    const user = userEvent.setup()
    const p = project()
    p.seasons[0].episodes[0].scenes[1].act = 1
    const panel = await loadPlan(p)
    await user.click(
      within(screen.getByTestId('act-frame-1')).getByRole('button', {
        name: 'Hide ACT ONE',
      }),
    )
    expect(screen.queryByTestId('scene-card-scene-2')).toBeNull()

    await user.click(within(panel).getByRole('button', { name: 'Next scene' }))

    expect(
      within(screen.getByTestId('act-frame-1')).getByTestId(
        'scene-card-scene-2',
      ),
    ).not.toBeNull()
    expect(localStorage.getItem('tr.plan.collapsedActs.v1.proj-longpour')).toBe(
      '[]',
    )
  })

  it('Enter on the selected card puts focus on the panel heading', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    act(() => screen.getByTestId('scene-card-scene-1').focus())

    await user.keyboard('{Enter}')

    const heading = panel.querySelector('h2')
    expect(heading?.textContent).toContain('1 · ')
    expect(document.activeElement).toBe(heading)
  })

  it('fills the height the shell leaves; the board and the panel scroll on their own; Story Layers is gone', async () => {
    getProjectMock.mockResolvedValue(project())
    getLedgerMock.mockResolvedValue([])
    getConsistencyFlagsMock.mockResolvedValue([])
    window.history.pushState(null, '', '/plan?project=proj-longpour')

    render(<PlanScreen />)

    const board = await screen.findByLabelText('Plan board')
    expect(board.className).toContain('overflow-y-auto')
    expect(board.className).toContain('min-w-0')
    // A flex column, not 100vh minus the header: the shell can render rows
    // above Plan (the demo banner), and the row still ends at the viewport.
    const main = screen.getByRole('main')
    expect(main.parentElement?.className).toContain('h-screen')
    expect(main.parentElement?.className).toContain('flex-col')
    expect(main.className).toContain('min-h-0 flex-1')
    const row = board.parentElement as HTMLElement
    expect(row.className).toContain('min-h-0 flex-1 overflow-hidden')
    expect(row.className).not.toContain('100vh')
    expect(row.parentElement?.className).toContain('h-full flex-col')
    expect(screen.getByTestId('inspector').className).toContain(
      'overflow-y-auto',
    )
    // The row is the board and the panel, nothing else.
    expect([...row.children]).toEqual([board, screen.getByTestId('inspector')])
    expect(screen.queryByTestId('story-layers-panel')).toBeNull()
    expect(
      document.querySelector('.w-panel-story-layers, .w-card-scene'),
    ).toBeNull()
  })

  const OPEN_FLAG: ConsistencyFlag = {
    id: 'flag-1',
    objectType: 'scene',
    objectId: 'scene-1',
    factId: null,
    explanation: 'Scene 2 still has the money in the bar.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-root',
  }

  function unloadPrevented(): boolean {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('shows the scene note; Dismiss refetches the head and flags, and Undo brings the note back', async () => {
    const user = userEvent.setup()
    // Queued replies win over loadPlan's defaults: load, then the dismiss
    // refetch, then the undo refetch.
    getProjectMock
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce({ ...project(), headSnapshotId: 'snap-dismiss' })
    getConsistencyFlagsMock
      .mockResolvedValueOnce([OPEN_FLAG])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([OPEN_FLAG])
    dismissConsistencyFlagMock.mockResolvedValue({
      ...OPEN_FLAG,
      status: 'dismissed',
    })
    undoProjectMock.mockResolvedValue(project())
    await loadPlan()

    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    await user.click(
      within(screen.getByTestId('note-flag-1')).getByRole('button', {
        name: 'Dismiss',
      }),
    )

    expect(dismissConsistencyFlagMock).toHaveBeenCalledWith('flag-1', {
      expectedHeadSnapshotId: 'snap-root',
    })
    expect(await screen.findByText('Note dismissed.')).not.toBeNull()
    expect(screen.queryByTestId('notes-strip')).toBeNull()

    await user.click(
      within(screen.getByTestId('toast')).getByRole('button', {
        name: 'Undo',
      }),
    )
    expect(undoProjectMock).toHaveBeenCalledWith('proj-longpour', {
      expectedHeadSnapshotId: 'snap-dismiss',
    })
    expect(await screen.findByTestId('notes-strip')).not.toBeNull()
    expect(screen.queryByText('Note dismissed.')).toBeNull()
  })

  it('a draft typed before a Dismiss is still there after its Undo', async () => {
    const user = userEvent.setup()
    getProjectMock
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce({ ...project(), headSnapshotId: 'snap-dismiss' })
    getConsistencyFlagsMock
      .mockResolvedValueOnce([OPEN_FLAG])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([OPEN_FLAG])
    dismissConsistencyFlagMock.mockResolvedValue({
      ...OPEN_FLAG,
      status: 'dismissed',
    })
    undoProjectMock.mockResolvedValue(project())
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    await user.click(
      within(screen.getByTestId('note-flag-1')).getByRole('button', {
        name: 'Dismiss',
      }),
    )
    await user.click(
      within(await screen.findByTestId('toast')).getByRole('button', {
        name: 'Undo',
      }),
    )

    expect(await screen.findByTestId('notes-strip')).not.toBeNull()
    expect(
      (within(panel).getByLabelText('Audience learns') as HTMLTextAreaElement)
        .value,
    ).toBe('Dan has a second key.')
    expect(within(panel).getByTestId('unsaved-chip')).not.toBeNull()
  })

  it('leaving Plan with an unsaved edit asks first, and Stay keeps the edit', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    await user.click(screen.getByRole('tab', { name: 'Write' }))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(unloadPrevented()).toBe(true)

    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )
    expect(dialog.open).toBe(false)
    expect(window.location.pathname).toBe('/plan')
    expect(
      (within(panel).getByLabelText('Audience learns') as HTMLTextAreaElement)
        .value,
    ).toBe('Dan has a second key.')
  })

  it('Open Review sends its own draft without asking and leaves no unload prompt behind', async () => {
    const user = userEvent.setup()
    createChangeSetMock.mockResolvedValue({ id: 'cs-1' })
    const panel = await loadPlan()
    const whatHappens = within(panel).getByLabelText('What happens')
    await user.clear(whatHappens)
    await user.type(whatHappens, 'Marta comes home for good.')

    await user.click(within(panel).getByRole('button', { name: 'Open Review' }))

    await waitFor(() =>
      expect(navigateToReviewMock).toHaveBeenCalledWith(
        'proj-longpour',
        'cs-1',
      ),
    )
    expect(createChangeSetMock).toHaveBeenCalledWith('proj-longpour', {
      targetObjectId: 'scene-1',
      instruction: 'Marta comes home for good.',
    })
    expect(
      (screen.getByTestId('leave-plan-dialog') as HTMLDialogElement).open,
    ).toBe(false)
    expect(unloadPrevented()).toBe(false)
  })

  it('Open Review with another unsaved field asks first; Stay sends nothing', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )
    const whatHappens = within(panel).getByLabelText('What happens')
    await user.clear(whatHappens)
    await user.type(whatHappens, 'Marta comes home for good.')

    await user.click(within(panel).getByRole('button', { name: 'Open Review' }))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )

    expect(createChangeSetMock).not.toHaveBeenCalled()
    expect(
      (within(panel).getByLabelText('What happens') as HTMLTextAreaElement)
        .value,
    ).toBe('Marta comes home for good.')
  })

  it('a field save right after a dismiss sends the head the dismiss left, not the stale one', async () => {
    const user = userEvent.setup()
    getProjectMock
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce({ ...project(), headSnapshotId: 'snap-dismiss' })
    getConsistencyFlagsMock
      .mockResolvedValueOnce([OPEN_FLAG])
      .mockResolvedValueOnce([])
    dismissConsistencyFlagMock.mockResolvedValue({
      ...OPEN_FLAG,
      status: 'dismissed',
    })
    patchProjectMock.mockResolvedValue({
      project: { ...project(), headSnapshotId: 'snap-save' },
      consistencyFlags: [],
    })
    const panel = await loadPlan()

    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    await user.click(
      within(screen.getByTestId('note-flag-1')).getByRole('button', {
        name: 'Dismiss',
      }),
    )
    expect(await screen.findByText('Note dismissed.')).not.toBeNull()

    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(patchProjectMock).toHaveBeenCalledWith(
        'proj-longpour',
        expect.any(Array),
        { expectedHeadSnapshotId: 'snap-dismiss' },
      ),
    )
  })

  it('a locked scene still shows its notes, and Dismiss stays available', async () => {
    const user = userEvent.setup()
    const p = project()
    p.seasons[0].episodes[0].scenes[0].locked = true
    getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
    const panel = await loadPlan(p)

    expect(
      within(panel).getByText(
        'Locked — unlock to edit. Review will never change this scene.',
      ),
    ).not.toBeNull()
    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    const dismiss = within(screen.getByTestId('note-flag-1')).getByRole(
      'button',
      { name: 'Dismiss' },
    ) as HTMLButtonElement
    expect(dismiss.disabled).toBe(false)
  })

  it.each(['scene', 'episode'] as const)(
    'Draft a fix in Review… is never offered on a locked %s (rule 2)',
    async (lock) => {
      const user = userEvent.setup()
      const p = project()
      const ep = p.seasons[0].episodes[0]
      if (lock === 'scene') ep.scenes[0].locked = true
      else ep.locked = true
      getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
      await loadPlan(p)

      const strip = await screen.findByTestId('notes-strip')
      await user.click(within(strip).getByRole('button', { name: 'Show' }))
      const note = screen.getByTestId('note-flag-1')
      // The card and its other verbs render: the absence below is the lock's doing.
      expect(
        within(note).getByRole('button', { name: 'Dismiss' }),
      ).not.toBeNull()
      expect(
        within(note).queryByRole('button', { name: 'Draft a fix in Review…' }),
      ).toBeNull()
      expect(within(note).queryByLabelText('Fix instruction')).toBeNull()
    },
  )

  it('double-clicking a card with an unsaved edit asks before opening Write', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    await user.dblClick(screen.getByTestId('scene-card-scene-2'))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )

    expect(dialog.open).toBe(false)
    expect(loadResume('proj-longpour').mode).toBe('Plan')
  })

  it('shell Undo with an unsaved edit asks first; Stay sends no undo', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    await user.click(screen.getByTestId('undo-button'))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )

    expect(undoProjectMock).not.toHaveBeenCalled()
    expect(
      (within(panel).getByLabelText('Audience learns') as HTMLTextAreaElement)
        .value,
    ).toBe('Dan has a second key.')
  })
  function failing<T>() {
    let reject!: (err: Error) => void
    const promise = new Promise<T>((_, rej) => {
      reject = rej
    })
    return { promise, reject }
  }

  const value = (panel: HTMLElement, label: string) =>
    (within(panel).getByLabelText(label) as HTMLTextAreaElement).value

  it('while Open Review is in flight the whole panel waits, so no new draft can block the way to Review', async () => {
    const user = userEvent.setup()
    const reply = deferred<{ id: string }>()
    createChangeSetMock.mockReturnValue(reply.promise)
    const panel = await loadPlan()
    const whatHappens = within(panel).getByLabelText('What happens')
    await user.clear(whatHappens)
    await user.type(whatHappens, 'Marta comes home for good.')
    await user.click(within(panel).getByRole('button', { name: 'Open Review' }))

    expect(
      (within(panel).getByLabelText('Audience learns') as HTMLTextAreaElement)
        .disabled,
    ).toBe(true)
    expect(
      (within(panel).getByTestId('lock-toggle') as HTMLButtonElement).disabled,
    ).toBe(true)
    // Opening, not saving.
    expect(
      within(panel).getByRole('button', { name: 'Save field only' }),
    ).not.toBeNull()

    reply.resolve({ id: 'cs-1' })
    await waitFor(() => expect(navigateToReviewMock).toHaveBeenCalled())
  })

  it('Discard and leave, then a failed Open Review: every draft comes back, and the sent text never left the box', async () => {
    const user = userEvent.setup()
    const reply = failing<{ id: string }>()
    createChangeSetMock.mockReturnValue(reply.promise)
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )
    const whatHappens = within(panel).getByLabelText('What happens')
    await user.clear(whatHappens)
    await user.type(whatHappens, 'Marta comes home for good.')

    await user.click(within(panel).getByRole('button', { name: 'Open Review' }))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Discard and leave' }),
    )
    await waitFor(() => expect(createChangeSetMock).toHaveBeenCalled())
    expect(value(panel, 'What happens')).toBe('Marta comes home for good.')

    reply.reject(new Error('review is down'))
    expect(await screen.findByText('review is down')).not.toBeNull()
    expect(value(panel, 'Audience learns')).toBe('Dan has a second key.')
    expect(value(panel, 'What happens')).toBe('Marta comes home for good.')
  })

  const PREFILL =
    'Fix this continuity note in the Long Pour scene (1st on the board): the Back Room scene (2nd on the board) still has the money in the bar.'

  /** Opens Draft a fix on OPEN_FLAG (scene-1); returns its note card. */
  async function openFix(user: ReturnType<typeof userEvent.setup>) {
    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    const note = screen.getByTestId('note-flag-1')
    await user.click(
      within(note).getByRole('button', { name: 'Draft a fix in Review…' }),
    )
    return note
  }

  it('Draft a fix sends nothing until Open Review, then one create for the scene and Review', async () => {
    const user = userEvent.setup()
    createChangeSetMock.mockResolvedValue({ id: 'cs-1' })
    getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
    await loadPlan()

    const note = await openFix(user)
    expect(value(note, 'Fix instruction')).toBe(PREFILL)
    expect(createChangeSetMock).not.toHaveBeenCalled()
    expect(suggestInstructionsMock).not.toHaveBeenCalled()

    await user.type(
      within(note).getByRole('textbox', { name: 'Fix instruction' }),
      ' Keep the bar.',
    )
    await user.click(within(note).getByRole('button', { name: 'Open Review' }))

    await waitFor(() =>
      expect(navigateToReviewMock).toHaveBeenCalledWith(
        'proj-longpour',
        'cs-1',
      ),
    )
    expect(createChangeSetMock).toHaveBeenCalledTimes(1)
    expect(createChangeSetMock).toHaveBeenCalledWith('proj-longpour', {
      targetObjectId: 'scene-1',
      instruction: `${PREFILL} Keep the bar.`,
    })
    expect(
      (screen.getByTestId('leave-plan-dialog') as HTMLDialogElement).open,
    ).toBe(false)
  })

  it('while a drafted fix is on its way the strip waits: Opening…, Dismiss disabled', async () => {
    const user = userEvent.setup()
    const reply = deferred<{ id: string }>()
    createChangeSetMock.mockReturnValue(reply.promise)
    getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
    await loadPlan()

    const note = await openFix(user)
    await user.click(within(note).getByRole('button', { name: 'Open Review' }))

    const button = (name: string) =>
      within(note).getByRole('button', { name }) as HTMLButtonElement
    expect(button('Opening…').disabled).toBe(true)
    expect(button('Dismiss').disabled).toBe(true)

    reply.resolve({ id: 'cs-1' })
    await waitFor(() =>
      expect(navigateToReviewMock).toHaveBeenCalledWith(
        'proj-longpour',
        'cs-1',
      ),
    )
  })

  it('a failed Draft a fix shows the error in the editor, keeps the edited text, and raises no toast', async () => {
    const user = userEvent.setup()
    const reply = failing<{ id: string }>()
    createChangeSetMock.mockReturnValue(reply.promise)
    getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
    await loadPlan()

    const note = await openFix(user)
    await user.type(
      within(note).getByRole('textbox', { name: 'Fix instruction' }),
      ' Keep the bar.',
    )
    await user.click(within(note).getByRole('button', { name: 'Open Review' }))
    reply.reject(new Error('review is down'))

    expect((await within(note).findByRole('alert')).textContent).toBe(
      "Couldn't open Review. Nothing changed; try again.",
    )
    expect(value(note, 'Fix instruction')).toBe(`${PREFILL} Keep the bar.`)
    expect(screen.queryByTestId('toast')).toBeNull()
    expect(navigateToReviewMock).not.toHaveBeenCalled()
  })

  it('with an unsaved field, Draft a fix asks first; Stay sends nothing and keeps the editor', async () => {
    const user = userEvent.setup()
    getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    const note = await openFix(user)
    await user.click(within(note).getByRole('button', { name: 'Open Review' }))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )

    expect(createChangeSetMock).not.toHaveBeenCalled()
    expect(value(note, 'Fix instruction')).toBe(PREFILL)
    await waitFor(() =>
      expect(
        (
          within(note).getByRole('button', {
            name: 'Open Review',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    expect(value(panel, 'Audience learns')).toBe('Dan has a second key.')
  })

  it('Discard and leave, then a failed Draft a fix: the drafts come back and the error shows inline', async () => {
    const user = userEvent.setup()
    const reply = failing<{ id: string }>()
    createChangeSetMock.mockReturnValue(reply.promise)
    getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    const note = await openFix(user)
    await user.click(within(note).getByRole('button', { name: 'Open Review' }))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Discard and leave' }),
    )
    await waitFor(() =>
      expect(createChangeSetMock).toHaveBeenCalledWith('proj-longpour', {
        targetObjectId: 'scene-1',
        instruction: PREFILL,
      }),
    )

    reply.reject(new Error('review is down'))
    expect((await within(note).findByRole('alert')).textContent).toBe(
      "Couldn't open Review. Nothing changed; try again.",
    )
    expect(value(panel, 'Audience learns')).toBe('Dan has a second key.')
    expect(value(note, 'Fix instruction')).toBe(PREFILL)
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('Discard and leave, then a failed shell Undo: the drafts come back', async () => {
    const user = userEvent.setup()
    undoProjectMock.mockRejectedValue(new Error('Nothing to undo'))
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )

    await user.click(screen.getByTestId('undo-button'))
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Discard and leave' }),
    )

    expect(await screen.findByText('Nothing to undo')).not.toBeNull()
    expect(value(panel, 'Audience learns')).toBe('Dan has a second key.')
  })

  it('the top-bar Undo waits while a dismiss is in flight', async () => {
    const user = userEvent.setup()
    const request = deferred<ConsistencyFlag>()
    dismissConsistencyFlagMock.mockReturnValue(request.promise)
    getConsistencyFlagsMock
      .mockResolvedValueOnce([OPEN_FLAG])
      .mockResolvedValueOnce([])
    await loadPlan()
    const undo = screen.getByTestId('undo-button') as HTMLButtonElement
    expect(undo.disabled).toBe(false)

    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    await user.click(
      within(screen.getByTestId('note-flag-1')).getByRole('button', {
        name: 'Dismiss',
      }),
    )
    expect(undo.disabled).toBe(true)

    request.resolve({ ...OPEN_FLAG, status: 'dismissed' })
    await waitFor(() => expect(undo.disabled).toBe(false))
  })

  it('Dismiss lands focus on the toast Undo when the strip goes; Undo lands it on the strip again', async () => {
    const user = userEvent.setup()
    getProjectMock
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce({ ...project(), headSnapshotId: 'snap-dismiss' })
    getConsistencyFlagsMock
      .mockResolvedValueOnce([OPEN_FLAG])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([OPEN_FLAG])
    dismissConsistencyFlagMock.mockResolvedValue({
      ...OPEN_FLAG,
      status: 'dismissed',
    })
    undoProjectMock.mockResolvedValue(project())
    await loadPlan()

    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    await user.click(
      within(screen.getByTestId('note-flag-1')).getByRole('button', {
        name: 'Dismiss',
      }),
    )
    const undo = within(await screen.findByTestId('toast')).getByRole(
      'button',
      { name: 'Undo' },
    )
    await waitFor(() => expect(document.activeElement).toBe(undo))

    await user.click(undo)
    const back = await screen.findByTestId('notes-strip')
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(back).getByRole('button', { name: /^(Show|Hide)$/ }),
      ),
    )
  })

  it('Change the act scrolls the Act select clear of the sticky header, then focuses it', async () => {
    const user = userEvent.setup()
    getConsistencyFlagsMock.mockResolvedValueOnce([
      {
        ...OPEN_FLAG,
        explanation: 'The act structure puts this scene in the wrong act.',
      },
    ])
    const scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    await loadPlan()
    const strip = await screen.findByTestId('notes-strip')
    await user.click(within(strip).getByRole('button', { name: 'Show' }))
    const select = screen.getByRole('combobox', { name: 'Act' })
    const focus = vi.spyOn(select, 'focus')

    await user.click(screen.getByRole('button', { name: 'Change the act' }))

    expect(scrollIntoView.mock.contexts).toContain(select)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('nothing is announced on first load', async () => {
    await loadPlan()
    expect(screen.getByTestId('plan-live').textContent).toBe('')
  })

  it('the live region announces a selection from ‹ ›, but not one on a focused card (its name says it)', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    const live = screen.getByTestId('plan-live')
    expect(live.getAttribute('role')).toBe('status')
    expect(live.getAttribute('aria-live')).toBe('polite')

    await user.click(within(panel).getByRole('button', { name: 'Next scene' }))
    expect(live.textContent).toBe('Scene 2, Back Room. No notes.')

    await user.click(screen.getByTestId('scene-card-scene-1'))
    expect(
      screen.getByTestId('scene-card-scene-1').getAttribute('aria-pressed'),
    ).toBe('true')
    expect(live.textContent).toBe('Scene 2, Back Room. No notes.')
  })

  it('a note on the scene is part of the announcement', async () => {
    const user = userEvent.setup()
    getConsistencyFlagsMock.mockResolvedValueOnce([
      { ...OPEN_FLAG, objectId: 'scene-2' },
    ])
    const panel = await loadPlan()

    await user.click(within(panel).getByRole('button', { name: 'Next scene' }))

    expect(screen.getByTestId('plan-live').textContent).toBe(
      'Scene 2, Back Room. 1 note.',
    )
  })

  it('a ?scene= link into a collapsed act opens the act, so the card is there to scroll to', async () => {
    localStorage.setItem('tr.plan.collapsedActs.v1.proj-longpour', '[0]')
    getProjectMock.mockResolvedValue(project())
    getLedgerMock.mockResolvedValue([])
    getConsistencyFlagsMock.mockResolvedValue([])
    window.history.pushState(
      null,
      '',
      '/plan?project=proj-longpour&scene=scene-2',
    )
    render(<PlanScreen />)

    const linked = await screen.findByTestId('scene-card-scene-2')
    expect(linked.getAttribute('aria-pressed')).toBe('true')
    expect(linked.className).toContain('outline-tr-coral')
  })

  it('choosing a scene in the Episode view puts focus on the scene panel heading', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.click(within(panel).getByRole('button', { name: '← Episode' }))
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe('Episode 1: Last Call'),
    )

    await user.click(
      within(screen.getByTestId('inspector')).getByRole('button', {
        name: /^Act out · scene 2 ·/,
      }),
    )

    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'))
    expect(document.activeElement?.textContent).toContain('2 · ')
  })

  it('Esc in the panel opens a collapsed act to get back to the card', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.click(
      within(screen.getByTestId('act-frame-0')).getByRole('button', {
        name: 'Hide COLD OPEN',
      }),
    )
    within(panel).getByRole('button', { name: 'Next scene' }).focus()

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId('scene-card-scene-1'),
      ),
    )
  })

  const focusCard = (id: string) =>
    act(() => screen.getByTestId(`scene-card-${id}`).focus())

  it('Esc from the board shows the Episode view and announces it', async () => {
    const user = userEvent.setup()
    await loadPlan()
    focusCard('scene-1')

    await user.keyboard('{Escape}')

    const panel = screen.getByTestId('inspector')
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe(
      'Episode 1: Last Call',
    )
    expect(within(panel).queryByTestId('lock-toggle')).toBeNull()
    expect(
      screen.getByTestId('scene-card-scene-1').getAttribute('aria-pressed'),
    ).toBe('false')
    expect(screen.getByTestId('plan-live').textContent).toBe('Episode view')
  })

  it('choosing a highlight announces it; highlights, fold and keys make no request', async () => {
    const user = userEvent.setup()
    getConsistencyFlagsMock.mockResolvedValueOnce([OPEN_FLAG])
    await loadPlan(storyProject())
    const bar = screen.getByRole('group', { name: 'Highlight' })
    const live = screen.getByTestId('plan-live')

    await user.click(within(bar).getByRole('button', { name: /^Act shape/ }))
    expect(live.textContent).toBe('Highlight: Act shape. 1 scene matches.')
    for (const name of [
      /^Setups & payoffs/,
      /^Continuity/,
      /^Who's in it/,
      /^None/,
    ])
      await user.click(within(bar).getByRole('button', { name }))
    expect(live.textContent).toBe('Highlight off.')
    await user.click(screen.getByRole('button', { name: /Fold the rest/ }))
    expect(live.textContent).toBe("Folded the scenes that don't match.")
    await user.click(screen.getByRole('button', { name: /Fold the rest/ }))
    expect(live.textContent).toBe('Unfolded.')
    focusCard('scene-1')
    await user.keyboard('nNjk{Escape}')

    expect(suggestInstructionsMock).not.toHaveBeenCalled()
    expect(createChangeSetMock).not.toHaveBeenCalled()
    expect(patchProjectMock).not.toHaveBeenCalled()
    expect(getProjectMock).toHaveBeenCalledTimes(1)
  })

  it('N on a card selects and focuses the next match; the card speaks, the live region stays quiet', async () => {
    const user = userEvent.setup()
    getConsistencyFlagsMock.mockResolvedValueOnce([
      { ...OPEN_FLAG, objectId: 'scene-2' },
    ])
    await loadPlan()
    focusCard('scene-1')

    await user.keyboard('n')

    const next = screen.getByTestId('scene-card-scene-2')
    expect(next.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(next))
    expect(screen.getByTestId('plan-live').textContent).toBe('')
  })

  it('Next note in the bar selects the next match, scrolls its card into view and announces it', async () => {
    const user = userEvent.setup()
    getConsistencyFlagsMock.mockResolvedValueOnce([
      { ...OPEN_FLAG, objectId: 'scene-2' },
    ])
    await loadPlan()
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const button = screen.getByRole('button', { name: 'Next note' })

    await user.click(button)

    const next = screen.getByTestId('scene-card-scene-2')
    expect(next.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('plan-live').textContent).toBe(
      'Scene 2, Back Room. 1 note.',
    )
    await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(next))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(document.activeElement).toBe(button)
  })

  it('Esc on a card that then folds away keeps focus on the board', async () => {
    const user = userEvent.setup()
    await loadPlan(storyProject())
    await user.click(screen.getByTestId('scene-card-scene-2'))
    // Marta (bible order wins the tie) is in scene 1 only.
    await user.click(screen.getByRole('button', { name: /^Who's in it/ }))
    await user.click(screen.getByRole('button', { name: 'Fold the rest' }))
    focusCard('scene-2')

    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('scene-card-scene-2')).toBeNull()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId('scene-card-scene-1'),
      ),
    )
  })

  it("a Who's in it chip in the Episode view switches the board highlight", async () => {
    const user = userEvent.setup()
    const panel = await loadPlan(storyProject())
    await user.click(within(panel).getByRole('button', { name: '← Episode' }))

    const cast = document.getElementById('plan-section-ep-cast') as HTMLElement
    await user.click(within(cast).getByRole('button', { name: /^Dan Vega/ }))

    const bar = screen.getByRole('group', { name: 'Highlight' })
    expect(
      within(bar)
        .getByRole('button', { name: /^Who's in it/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      (screen.getByLabelText('Character to highlight') as HTMLSelectElement)
        .value,
    ).toBe('char-dan')
    expect(
      screen.getByTestId('scene-card-scene-2').getAttribute('data-match'),
    ).toBe('true')
  })

  it('⌘↵ with unsaved edits asks before opening Write', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan()
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )
    focusCard('scene-1')

    await user.keyboard('{Meta>}{Enter}{/Meta}')
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )

    expect(loadResume('proj-longpour').mode).toBe('Plan')
  })

  it('See all in Ledger → Threads asks first with drafts, then saves the Threads view', async () => {
    const user = userEvent.setup()
    const panel = await loadPlan(storyProject())
    await user.type(
      within(panel).getByLabelText('Audience learns'),
      'Dan has a second key.',
    )
    await user.click(within(panel).getByRole('button', { name: '← Episode' }))
    const seeAll = screen.getByRole('button', {
      name: 'See all 1 in Ledger → Threads',
    })
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement

    await user.click(seeAll)
    await waitFor(() => expect(dialog.open).toBe(true))
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay in Plan' }),
    )
    expect(localStorage.getItem('tr.ledger.view.proj-longpour')).toBeNull()

    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      value: { ...original, href: original.href, assign },
      writable: true,
    })
    try {
      await user.click(seeAll)
      await waitFor(() => expect(dialog.open).toBe(true))
      await user.click(
        within(dialog).getByRole('button', { name: 'Discard and leave' }),
      )
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
      expect(new URL(String(assign.mock.calls[0][0])).pathname).toBe('/ledger')
      expect(localStorage.getItem('tr.ledger.view.proj-longpour')).toBe(
        'threads',
      )
    } finally {
      Object.defineProperty(window, 'location', {
        value: original,
        writable: true,
      })
    }
  })
})

const SCENES = '/seasons/0/episodes/0/scenes'
/** `replace` ops on `scenes/<array position>/<field>`. */
const sceneOps = (...ops: [number, 'index' | 'act', number][]) =>
  ops.map(([at, field, value]) => ({
    op: 'replace',
    path: `${SCENES}/${at}/${field}`,
    value,
  }))

/** The optimistic doc applySceneMove builds for `move` (the server's echo). */
function nextOf(p: Project, move: SceneMove) {
  const applied = applySceneMove(p, move)
  if (!applied || 'blockedBy' in applied) throw new Error('no move')
  return applied.next
}

/** Five scenes (array position = index): the cold open, two in act 1, one
 * each in acts 2 and 3; one thread set up in scene 2 and paid off in scene 5. */
function orderProject(): Project {
  const p = project()
  const ep = p.seasons[0].episodes[0]
  ep.scenes = [0, 1, 1, 2, 3].map((act, index) => {
    const base = scene()
    return scene({
      id: `scene-${index + 1}`,
      index,
      act,
      beats: [{ ...base.beats[0], id: `beat-${index + 1}-1` }],
    })
  })
  ep.threads = [
    {
      ...storyProject().seasons[0].episodes[0].threads[0],
      id: 'thread-1',
      label: 'The spare key',
      setupSceneId: 'scene-2',
      payoffSceneId: 'scene-5',
      status: 'paid_off',
    },
  ]
  return p
}

describe('PlanScreen order check (T3.7)', () => {
  type Saved = { project: Project; consistencyFlags: ConsistencyFlag[] }
  /** The server's reply to scene-5 → the cold open (act 0). */
  const moved = (p: Project, head = 'snap-moved'): Saved => ({
    project: {
      ...nextOf(p, { type: 'act', sceneId: 'scene-5', act: 0 }),
      headSnapshotId: head,
    },
    consistencyFlags: [],
  })
  const dataTransfer = {
    setData: () => {},
    getData: () => '',
    effectAllowed: 'move',
  } as unknown as DataTransfer
  const strip = () => screen.getByTestId('notes-strip')
  const card = (id: string) => screen.getByTestId(`scene-card-${id}`)
  /** An act frame's scene ids, in board order. */
  const actIds = (n: number) =>
    [
      ...screen
        .getByTestId(`act-frame-${n}`)
        .querySelectorAll('[data-scene-card]'),
    ].map((el) => el.getAttribute('data-scene-id'))
  /** The server's echo of `move` on `p`. */
  const echo = (p: Project, move: SceneMove): Saved => ({
    project: { ...nextOf(p, move), headSnapshotId: 'snap-moved' },
    consistencyFlags: [],
  })
  const undoButton = () =>
    screen.queryByRole('button', { name: 'Undo the move' })
  const NOTE = 'Pays off “The spare key” before its setup in scene 3.'

  // Rule 2: the lock-violation tests come before the move feature tests.
  it('a drop that would shift a locked scene sends no PATCH and says why (rule 2)', async () => {
    const p = orderProject()
    p.seasons[0].episodes[0].scenes[2].locked = true
    await loadPlan(p)

    // jsdom rects are all zero: the drop lands on scene-1's left half.
    fireEvent.dragStart(card('scene-5'), { dataTransfer })
    fireEvent.dragOver(card('scene-1'), { dataTransfer })
    expect(card('scene-1').querySelector('[data-tape]')?.textContent).toBe(
      "Can't move past scene 3: it's locked",
    )
    expect(document.querySelector('[data-insert-bar]')).toBeNull()
    fireEvent.drop(card('scene-1'), { dataTransfer })

    expect(patchProjectMock).not.toHaveBeenCalled()
    expect(actIds(0)).toEqual(['scene-1'])
    expect(actIds(3)).toEqual(['scene-5'])
  })

  it('⌥→ on a locked card sends no PATCH and says why', async () => {
    const p = orderProject()
    p.seasons[0].episodes[0].scenes[1].locked = true
    await loadPlan(p)

    fireEvent.keyDown(card('scene-2'), { key: 'ArrowRight', altKey: true })

    expect(patchProjectMock).not.toHaveBeenCalled()
    expect((await screen.findByTestId('toast')).textContent).toContain(
      "Can't move scene 2: it's locked",
    )
    // The toast is an alert: plan-live doesn't say it a second time.
    expect(screen.getByTestId('plan-live').textContent).not.toContain(
      "Can't move",
    )
  })

  it('a repeated refusal remounts its alert, so it is spoken again', async () => {
    const p = orderProject()
    p.seasons[0].episodes[0].scenes[1].locked = true
    await loadPlan(p)

    fireEvent.keyDown(card('scene-2'), { key: 'ArrowRight', altKey: true })
    const first = await screen.findByTestId('toast')
    fireEvent.keyDown(card('scene-2'), { key: 'ArrowRight', altKey: true })

    const second = screen.getByTestId('toast')
    expect(second.textContent).toContain("Can't move scene 2: it's locked")
    expect(second).not.toBe(first)
  })

  it('a refusal shows on top of an open toast', async () => {
    const user = userEvent.setup()
    const p = orderProject()
    p.seasons[0].episodes[0].scenes[1].locked = true
    const flag: ConsistencyFlag = {
      id: 'flag-1',
      objectType: 'scene',
      objectId: 'scene-1',
      factId: null,
      explanation: 'Scene 2 still has the money in the bar.',
      severity: 'tension',
      status: 'open',
      sourceChange: 'snap-root',
    }
    getProjectMock
      .mockResolvedValueOnce(p)
      .mockResolvedValueOnce({ ...p, headSnapshotId: 'snap-dismiss' })
    getConsistencyFlagsMock.mockResolvedValueOnce([flag])
    dismissConsistencyFlagMock.mockResolvedValue({
      ...flag,
      status: 'dismissed',
    })
    await loadPlan(p)
    await user.click(within(strip()).getByRole('button', { name: 'Show' }))
    await user.click(
      within(screen.getByTestId('note-flag-1')).getByRole('button', {
        name: 'Dismiss',
      }),
    )
    expect(await screen.findByText('Note dismissed.')).not.toBeNull()

    fireEvent.keyDown(card('scene-2'), { key: 'ArrowRight', altKey: true })

    // Same fixed spot: the last toast paints on top.
    expect(screen.getAllByTestId('toast').at(-1)?.textContent).toContain(
      "Can't move scene 2: it's locked",
    )
  })

  it('a refusal goes once the head moves, e.g. its scene is unlocked', async () => {
    const user = userEvent.setup()
    const p = orderProject()
    p.seasons[0].episodes[0].scenes[1].locked = true
    patchProjectMock.mockResolvedValue({
      project: {
        ...withSceneField(p, 'scene-2', 'locked', false),
        headSnapshotId: 'snap-unlocked',
      },
      consistencyFlags: [],
    })
    await loadPlan(p)
    fireEvent.keyDown(card('scene-2'), { key: 'ArrowRight', altKey: true })
    expect((await screen.findByTestId('toast')).textContent).toContain(
      "Can't move scene 2: it's locked",
    )

    await user.click(card('scene-2'))
    await user.click(
      within(screen.getByTestId('inspector')).getByTestId('lock-toggle'),
    )

    await waitFor(() =>
      expect(screen.queryByText("Can't move scene 2: it's locked")).toBeNull(),
    )
  })

  /** Loads orderProject(), selects scene-5 and moves it to the cold open. */
  async function moveScene5ToColdOpen(
    user: ReturnType<typeof userEvent.setup>,
  ) {
    const p = orderProject()
    await loadPlan(p)
    await user.click(screen.getByTestId('scene-card-scene-5'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Act' }), '0')
    return p
  }

  it('an act change that plays a payoff first shows the Order note at once and opens the strip', async () => {
    const user = userEvent.setup()
    const save = deferred<Saved>()
    patchProjectMock.mockReturnValue(save.promise)

    const p = await moveScene5ToColdOpen(user)

    expect(
      within(strip())
        .getByRole('button', { name: 'Hide' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
    expect(strip().textContent).toContain(NOTE)
    expect(undoButton()).toBeNull()
    expect(screen.getByTestId('plan-live').textContent).toBe(
      'Moved to COLD OPEN, scene 2 of 5. 1 new order problem.',
    )

    await act(async () => save.resolve(moved(p)))
    expect(undoButton()).not.toBeNull()
  })

  it('an act change sends one PATCH; the prediction and the chart send nothing', async () => {
    const user = userEvent.setup()
    const p = orderProject()
    patchProjectMock.mockResolvedValue(moved(p))
    await loadPlan(p)

    fireEvent.dragStart(screen.getByTestId('scene-card-scene-5'), {
      dataTransfer,
    })
    fireEvent.dragOver(screen.getByTestId('scene-card-scene-1'), {
      dataTransfer,
    })
    fireEvent.dragEnd(screen.getByTestId('scene-card-scene-5'), {
      dataTransfer,
    })
    await user.click(screen.getByTestId('chart-block-scene-5'))
    expect(patchProjectMock).not.toHaveBeenCalled()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Act' }), '0')

    expect(patchProjectMock).toHaveBeenCalledTimes(1)
    // The start of act 1, renumbered: index = board position.
    expect(patchProjectMock).toHaveBeenCalledWith(
      'proj-longpour',
      sceneOps(
        [1, 'index', 2],
        [2, 'index', 3],
        [3, 'index', 4],
        [4, 'index', 1],
        [4, 'act', 0],
      ),
      { expectedHeadSnapshotId: 'snap-root' },
    )
    expect(suggestInstructionsMock).not.toHaveBeenCalled()
    expect(createChangeSetMock).not.toHaveBeenCalled()
    expect(dismissConsistencyFlagMock).not.toHaveBeenCalled()
  })

  it('an act change scrolls the moved card into view without moving focus', async () => {
    const user = userEvent.setup()
    const p = orderProject()
    patchProjectMock.mockResolvedValue(moved(p))
    await loadPlan(p)
    await user.click(screen.getByTestId('scene-card-scene-5'))
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const select = screen.getByRole('combobox', { name: 'Act' })

    await user.selectOptions(select, '0')

    await waitFor(() =>
      expect(scrollIntoView.mock.contexts).toContain(
        screen.getByTestId('scene-card-scene-5'),
      ),
    )
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(document.activeElement).toBe(select)
  })

  it("Undo the move posts /undo with If-Match = the move's head and clears the Order note", async () => {
    const user = userEvent.setup()
    patchProjectMock.mockResolvedValue(moved(orderProject()))
    undoProjectMock.mockResolvedValue(orderProject())
    await moveScene5ToColdOpen(user)

    await user.click(
      await within(strip()).findByRole('button', { name: 'Undo the move' }),
    )

    expect(undoProjectMock).toHaveBeenCalledWith('proj-longpour', {
      expectedHeadSnapshotId: 'snap-moved',
    })
    await waitFor(() => expect(screen.queryByTestId(/^order-note-/)).toBeNull())
    expect(
      within(screen.getByTestId('act-frame-3')).getByTestId(
        'scene-card-scene-5',
      ),
    ).not.toBeNull()
    expect(screen.getByTestId('plan-live').textContent).toBe('Move undone.')
    expect(getProjectMock).toHaveBeenCalledTimes(1)
    // Its button is gone with the note: focus lands in the panel, not <body>.
    await waitFor(() =>
      expect(
        screen.getByTestId('inspector').contains(document.activeElement),
      ).toBe(true),
    )
  })

  it('Undo the move keeps an open fix editor and its edited text (the strip is keyed by scene only)', async () => {
    const user = userEvent.setup()
    patchProjectMock.mockResolvedValue(moved(orderProject()))
    undoProjectMock.mockResolvedValue(orderProject())
    getConsistencyFlagsMock.mockResolvedValueOnce([
      {
        id: 'flag-5',
        objectType: 'scene',
        objectId: 'scene-5',
        factId: null,
        explanation: 'The key turns up before anyone loses it.',
        severity: 'tension',
        status: 'open',
        sourceChange: 'snap-root',
      },
    ])
    await moveScene5ToColdOpen(user)
    const undo = await within(strip()).findByRole('button', {
      name: 'Undo the move',
    })
    const note = screen.getByTestId('note-flag-5')
    await user.click(
      within(note).getByRole('button', { name: 'Draft a fix in Review…' }),
    )
    const box = within(note).getByRole('textbox', { name: 'Fix instruction' })
    await user.type(box, ' Keep the key.')
    const typed = (box as HTMLTextAreaElement).value

    await user.click(undo)
    await waitFor(() => expect(screen.queryByTestId(/^order-note-/)).toBeNull())

    expect(
      (
        within(screen.getByTestId('note-flag-5')).getByRole('textbox', {
          name: 'Fix instruction',
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(typed)
    expect(typed).toMatch(/ Keep the key\.$/)
  })

  it('Undo the move leaves focus where the writer put it while it ran', async () => {
    const user = userEvent.setup()
    patchProjectMock.mockResolvedValue(moved(orderProject()))
    const request = deferred<Project>()
    undoProjectMock.mockReturnValue(request.promise)
    await moveScene5ToColdOpen(user)

    await user.click(
      await within(strip()).findByRole('button', { name: 'Undo the move' }),
    )
    const card = screen.getByTestId('scene-card-scene-3')
    act(() => card.focus())
    await act(async () => request.resolve(orderProject()))
    await act(() => new Promise((r) => requestAnimationFrame(r)))

    expect(screen.getByTestId('plan-live').textContent).toBe('Move undone.')
    expect(document.activeElement).toBe(card)
  })

  it('a failed move gives the previous move its Undo back', async () => {
    const user = userEvent.setup()
    patchProjectMock
      .mockResolvedValueOnce(moved(orderProject()))
      .mockRejectedValueOnce(new Error('network down'))
    await moveScene5ToColdOpen(user)
    await within(strip()).findByRole('button', { name: 'Undo the move' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Act' }), '2')

    expect(await screen.findByText('save failed')).not.toBeNull()
    expect(patchProjectMock).toHaveBeenCalledTimes(2)
    expect(strip().textContent).toContain(NOTE)
    expect(
      await within(strip()).findByRole('button', { name: 'Undo the move' }),
    ).not.toBeNull()
  })

  it('Undo the move is gone once another edit moves the head; Go to scene n still selects', async () => {
    const user = userEvent.setup()
    const p = orderProject()
    const after = moved(p)
    patchProjectMock.mockResolvedValueOnce(after).mockResolvedValueOnce({
      project: {
        ...withSceneField(after.project, 'scene-5', 'locked', true),
        headSnapshotId: 'snap-later',
      },
      consistencyFlags: [],
    })
    await moveScene5ToColdOpen(user)
    await within(strip()).findByRole('button', { name: 'Undo the move' })

    await user.click(
      within(screen.getByTestId('inspector')).getByTestId('lock-toggle'),
    )

    await waitFor(() => expect(undoButton()).toBeNull())
    expect(strip().textContent).toContain(NOTE)
    await user.click(
      within(strip()).getByRole('button', { name: 'Go to scene 3' }),
    )
    expect(
      screen.getByTestId('scene-card-scene-2').getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('a failed move rolls back and offers nothing', async () => {
    const user = userEvent.setup()
    patchProjectMock.mockRejectedValue(new Error('network down'))

    await moveScene5ToColdOpen(user)

    await waitFor(() =>
      expect(
        within(screen.getByTestId('act-frame-3')).queryByTestId(
          'scene-card-scene-5',
        ),
      ).not.toBeNull(),
    )
    expect(screen.queryByTestId(/^order-note-/)).toBeNull()
    expect(undoButton()).toBeNull()
  })

  it("a drag predicts on the target with the save's own transform", async () => {
    await loadPlan(orderProject())

    fireEvent.dragStart(screen.getByTestId('scene-card-scene-5'), {
      dataTransfer,
    })
    fireEvent.dragOver(screen.getByTestId('scene-card-scene-1'), {
      dataTransfer,
    })

    expect(
      screen.getByTestId('scene-card-scene-1').querySelector('[data-tape]')
        ?.textContent,
    ).toBe('⚠ 5 would pay off before 2')
    expect(patchProjectMock).not.toHaveBeenCalled()
  })

  it('Undo the move 409 shows the stale copy and drops the offer', async () => {
    const user = userEvent.setup()
    patchProjectMock.mockResolvedValue(moved(orderProject()))
    undoProjectMock.mockRejectedValue(
      new ApiError(409, { code: 'CONFLICT_STALE_HEAD', message: 'stale' }),
    )
    await moveScene5ToColdOpen(user)

    await user.click(
      await within(strip()).findByRole('button', { name: 'Undo the move' }),
    )

    expect(await screen.findByText(UNDO_MOVE_STALE)).not.toBeNull()
    expect(undoButton()).toBeNull()
    // The focused button went with the offer: focus lands on the strip.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(strip()).getByRole('button', { name: /^(Show|Hide)$/ }),
      ),
    )
  })

  it("the chart sits in the board's sticky header and a block click selects its scene", async () => {
    const user = userEvent.setup()
    await loadPlan(orderProject())
    const chart = screen.getByTestId('episode-chart')
    expect(
      chart.closest('.sticky')?.closest('[aria-label="Plan board"]'),
    ).not.toBeNull()

    await user.click(screen.getByTestId('chart-block-scene-3'))

    expect(
      screen.getByTestId('scene-card-scene-3').getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByTestId('plan-live').textContent).toMatch(/^Scene 3\b/)
  })

  it('a Continuity count and N include order problems', async () => {
    const user = userEvent.setup()
    patchProjectMock.mockResolvedValue(moved(orderProject()))
    await moveScene5ToColdOpen(user)
    await within(strip()).findByRole('button', { name: 'Undo the move' })

    expect(
      within(screen.getByRole('group', { name: 'Highlight' })).getByRole(
        'button',
        { name: /^Continuity/ },
      ).textContent,
    ).toBe('Continuity 2')
    await user.click(screen.getByTestId('scene-card-scene-1'))
    act(() => screen.getByTestId('scene-card-scene-1').focus())
    await user.keyboard('n')
    expect(
      screen.getByTestId('scene-card-scene-5').getAttribute('aria-pressed'),
    ).toBe('true')
    await user.keyboard('n')
    expect(
      screen.getByTestId('scene-card-scene-2').getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('a drop inserts before the card: one PATCH, and Undo the move restores the order', async () => {
    const user = userEvent.setup()
    const p = orderProject()
    const save = deferred<Saved>()
    patchProjectMock.mockReturnValue(save.promise)
    undoProjectMock.mockResolvedValue(orderProject())
    await loadPlan(p)
    // Undo the move lives on the selected scene's Order note.
    await user.click(card('scene-5'))

    fireEvent.dragStart(card('scene-5'), { dataTransfer })
    fireEvent.dragOver(card('scene-2'), { dataTransfer })
    fireEvent.drop(card('scene-2'), { dataTransfer })

    expect(patchProjectMock).toHaveBeenCalledTimes(1)
    expect(patchProjectMock).toHaveBeenCalledWith(
      'proj-longpour',
      sceneOps(
        [1, 'index', 2],
        [2, 'index', 3],
        [3, 'index', 4],
        [4, 'index', 1],
        [4, 'act', 1],
      ),
      { expectedHeadSnapshotId: 'snap-root' },
    )
    expect(actIds(1)).toEqual(['scene-5', 'scene-2', 'scene-3'])

    await act(async () =>
      save.resolve(
        echo(p, {
          type: 'insert',
          sceneId: 'scene-5',
          targetSceneId: 'scene-2',
          after: false,
        }),
      ),
    )
    await user.click(
      await within(strip()).findByRole('button', { name: 'Undo the move' }),
    )

    expect(undoProjectMock).toHaveBeenCalledWith('proj-longpour', {
      expectedHeadSnapshotId: 'snap-moved',
    })
    await waitFor(() => expect(actIds(1)).toEqual(['scene-2', 'scene-3']))
    expect(screen.getByTestId('plan-live').textContent).toBe('Move undone.')
  })

  it('⌥→ moves the focused card one slot and keeps focus on it', async () => {
    const p = orderProject()
    patchProjectMock.mockResolvedValue(
      echo(p, { type: 'step', sceneId: 'scene-2', dir: 1 }),
    )
    await loadPlan(p)
    act(() => card('scene-2').focus())

    fireEvent.keyDown(card('scene-2'), { key: 'ArrowRight', altKey: true })

    expect(patchProjectMock).toHaveBeenCalledWith(
      'proj-longpour',
      sceneOps([1, 'index', 2], [2, 'index', 1]),
      { expectedHeadSnapshotId: 'snap-root' },
    )
    expect(actIds(1)).toEqual(['scene-3', 'scene-2'])
    expect(screen.getByTestId('plan-live').textContent).toBe(
      'Moved to ACT ONE, scene 3 of 5.',
    )
    await waitFor(() => expect(document.activeElement).toBe(card('scene-2')))
  })

  it('a move into a collapsed act opens it and scrolls the card into view', async () => {
    const user = userEvent.setup()
    const p = orderProject()
    patchProjectMock.mockResolvedValue(
      echo(p, { type: 'step', sceneId: 'scene-3', dir: 1 }),
    )
    await loadPlan(p)
    const chevron = () =>
      within(screen.getByTestId('act-frame-2')).getByRole('button', {
        name: /ACT TWO$/,
      })
    await user.click(chevron())
    expect(chevron().getAttribute('aria-expanded')).toBe('false')
    await user.click(card('scene-3'))
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

    fireEvent.keyDown(card('scene-3'), { key: 'ArrowRight', altKey: true })

    // The last card of act 1 crosses the break in place: only its act.
    expect(patchProjectMock).toHaveBeenCalledTimes(1)
    expect(patchProjectMock).toHaveBeenCalledWith(
      'proj-longpour',
      sceneOps([2, 'act', 2]),
      { expectedHeadSnapshotId: 'snap-root' },
    )
    expect(actIds(2)).toEqual(['scene-3', 'scene-4'])
    expect(chevron().getAttribute('aria-label')).toBe('Hide ACT TWO')
    expect(chevron().getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(card('scene-3')))
    expect(scrollIntoView.mock.contexts).toContain(card('scene-3'))
  })

  it('the Act select into a collapsed act opens it, and focus stays on the select', async () => {
    const user = userEvent.setup()
    const p = orderProject()
    patchProjectMock.mockResolvedValue(
      echo(p, { type: 'act', sceneId: 'scene-5', act: 2 }),
    )
    await loadPlan(p)
    await user.click(
      within(screen.getByTestId('act-frame-2')).getByRole('button', {
        name: 'Hide ACT TWO',
      }),
    )
    await user.click(card('scene-5'))
    const select = screen.getByRole('combobox', { name: 'Act' })

    await user.selectOptions(select, '2')

    expect(actIds(2)).toEqual(['scene-4', 'scene-5'])
    expect(
      within(screen.getByTestId('act-frame-2'))
        .getByRole('button', { name: 'Hide ACT TWO' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
    await act(() => new Promise((r) => requestAnimationFrame(r)))
    expect(document.activeElement).toBe(select)
  })

  it('a refusal toast clears on the next move', async () => {
    const p = orderProject()
    p.seasons[0].episodes[0].scenes[1].locked = true
    patchProjectMock.mockResolvedValue(
      echo(p, { type: 'step', sceneId: 'scene-4', dir: 1 }),
    )
    await loadPlan(p)
    fireEvent.keyDown(card('scene-2'), { key: 'ArrowRight', altKey: true })
    expect((await screen.findByTestId('toast')).textContent).toContain(
      "Can't move scene 2: it's locked",
    )

    fireEvent.keyDown(card('scene-4'), { key: 'ArrowRight', altKey: true })

    expect(patchProjectMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('toast')).toBeNull()
  })
})
