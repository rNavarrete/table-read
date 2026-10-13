// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project, Scene } from 'contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WriteScreen } from './WriteScreen'

vi.mock('../api/client', () => ({
  getProject: vi.fn(),
  getLedger: vi.fn(),
  patchProject: vi.fn(),
  exportFountain: vi.fn(),
  listProjectSnapshots: vi.fn(),
  restoreProject: vi.fn(),
  undoProject: vi.fn(),
  generateBeatCandidates: vi.fn(),
  acceptBeatCandidate: vi.fn(),
  suggest: vi.fn(),
}))

vi.mock('../projects/resumeContext', () => ({
  loadResume: vi.fn(() => ({ mode: 'Write' as const, sceneId: null })),
  saveResume: vi.fn(),
}))

vi.mock('./useCandidateSession', () => ({
  useCandidateSession: () => ({
    session: { phase: 'idle', slots: [] },
    generate: vi.fn(),
    skip: vi.fn(),
    reset: vi.fn(),
    retry: vi.fn(),
    replaceSlot: vi.fn(),
  }),
}))

vi.mock('./useAcceptBeat', () => ({
  useAcceptBeat: () => ({
    accept: vi.fn(),
    acceptingIndex: null,
    errorByIndex: {},
    dismissError: vi.fn(),
  }),
}))

import { getLedger, getProject, patchProject } from '../api/client'
import { ApiError } from '../api/errors'

beforeEach(() => {
  class FakeIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

function makeScene(partial: Partial<Scene> & { id: string }): Scene {
  return {
    index: 0,
    act: 1,
    storyline: 'A',
    locked: false,
    location: 'OVAL OFFICE',
    time: 'DAY',
    socialSituation: '',
    whatHappens: 'Something happens',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [
      {
        id: `beat-${partial.id}`,
        index: 0,
        locked: false,
        scriptLocked: false,
        whatHappens: '',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: `Script for ${partial.id}`,
      },
    ],
    ...partial,
  }
}

function project(scenes?: Scene[]): Project {
  return {
    id: 'proj-1',
    title: 'West Wing Pilot',
    headSnapshotId: 'snap-1',
    seasons: [
      {
        episodes: [
          {
            id: 'ep-1',
            index: 0,
            scenes: scenes ?? [
              makeScene({
                id: 'scene-1',
                location: 'OVAL OFFICE',
                whatHappens: 'Josh presses Leo',
              }),
              makeScene({
                id: 'scene-2',
                location: "JOSH'S OFFICE",
                whatHappens: 'Donna interrupts',
              }),
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

describe('WriteScreen script home', () => {
  it('renders a scrollport, outline, and stacked scenes', async () => {
    vi.mocked(getProject).mockResolvedValue(project())
    vi.mocked(getLedger).mockResolvedValue([])
    window.history.pushState({}, '', '/?project=proj-1')

    render(<WriteScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('write-scrollport')).not.toBeNull()
    })
    const scrollport = screen.getByTestId('write-scrollport')
    expect(scrollport.className).toContain('overflow-y-auto')
    expect(screen.getByTestId('write-scene-outline')).not.toBeNull()
    expect(screen.getByTestId('write-scene-scene-1')).not.toBeNull()
    expect(screen.getByTestId('write-scene-scene-2')).not.toBeNull()
    const rail = screen.getByTestId('write-candidate-rail')
    expect(rail.className).toContain('min-h-0')
    expect(rail.className).toContain('overflow-hidden')
  })

  it('outline click marks the active scene', async () => {
    const user = userEvent.setup()
    vi.mocked(getProject).mockResolvedValue(project())
    vi.mocked(getLedger).mockResolvedValue([])
    window.history.pushState({}, '', '/?project=proj-1')

    render(<WriteScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('write-outline-scene-2')).not.toBeNull()
    })

    await user.click(screen.getByTestId('write-outline-scene-2'))
    expect(
      screen.getByTestId('write-outline-scene-2').getAttribute('aria-current'),
    ).toBe('true')
    expect(window.location.search).toContain('scene=scene-2')
  })

  it('?scene= deep link activates and scrolls that scene (even if thin plan fields)', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    vi.mocked(getProject).mockResolvedValue(
      project([
        makeScene({ id: 'scene-1', location: '', whatHappens: '' }),
        makeScene({
          id: 'scene-24',
          location: 'INT. WHITE HOUSE - NIGHT',
          whatHappens: '',
        }),
      ]),
    )
    vi.mocked(getLedger).mockResolvedValue([])
    window.history.pushState({}, '', '/?project=proj-1&scene=scene-24')

    render(<WriteScreen />)

    await waitFor(() => {
      expect(
        screen
          .getByTestId('write-outline-scene-24')
          .getAttribute('aria-current'),
      ).toBe('true')
    })
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled()
    })
  })
})

describe('WriteScreen autosave', () => {
  it('a failed save keeps the typed text and Retry saves it again', async () => {
    const user = userEvent.setup()
    vi.mocked(getProject).mockResolvedValue(project())
    vi.mocked(getLedger).mockResolvedValue([])
    vi.mocked(patchProject).mockRejectedValueOnce(
      new ApiError(503, { code: 'UNKNOWN', message: 'offline' }),
    )
    window.history.pushState({}, '', '/?project=proj-1&scene=scene-1')

    render(<WriteScreen />)
    const row = await screen.findByTestId('beat-row-beat-scene-1')
    await user.click(row.querySelector('[data-testid="formatted-script"]')!)
    await user.type(screen.getByTestId('beat-beat-scene-1'), ' More.')
    await user.tab() // blur saves now

    const failure = await screen.findByTestId('write-save-failed')
    expect(failure.textContent).toContain("Couldn't save your last edit.")
    expect(failure.className).toContain('text-tr-danger')
    expect(row.textContent).toContain('Script for scene-1 More.')
    const ops = [
      {
        op: 'replace',
        path: '/seasons/0/episodes/0/scenes/0/beats/0/scriptText',
        value: 'Script for scene-1 More.',
      },
    ]
    expect(patchProject).toHaveBeenCalledWith('proj-1', ops, {
      expectedHeadSnapshotId: 'snap-1',
    })

    vi.mocked(patchProject).mockResolvedValueOnce({
      project: { ...project(), headSnapshotId: 'snap-2' },
      consistencyFlags: [],
    })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(screen.queryByTestId('write-save-failed')).toBeNull()
    })
    expect(patchProject).toHaveBeenCalledTimes(2)
    expect(vi.mocked(patchProject).mock.calls[1][1]).toEqual(ops)
    expect(row.textContent).toContain('Script for scene-1 More.')
  })
})
