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

import { getLedger, getProject } from '../api/client'

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
