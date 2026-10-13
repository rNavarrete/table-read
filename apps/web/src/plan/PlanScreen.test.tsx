// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ConsistencyFlag, Episode, Project, Scene } from 'contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadResume, saveResume } from '../projects/resumeContext'
import { PlanScreen } from './PlanScreen'
import { withBeatField } from './planTree'

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
    expect(screen.getByTestId('scene-card-scene-1').className).not.toContain(
      'bg-tr-coral-soft',
    )
  })

  // Task 3's test, carried over unchanged.
  it('fills the height the shell leaves and scrolls the board and both side panels on their own', async () => {
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
    expect(screen.getByTestId('story-layers-panel').className).toContain(
      'overflow-y-auto',
    )
    expect(screen.getByTestId('inspector').className).toContain(
      'overflow-y-auto',
    )
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
})
