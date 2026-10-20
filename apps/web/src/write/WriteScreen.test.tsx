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
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
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
        actorCharacterId: null,
        actionVerb: '',
        targetCharacterId: null,
        reaction: '',
        kernel: null,
        pressureChoice: null,
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

describe('WriteScreen story order', () => {
  it('outline, canvas, scene numbers and ] follow (act, index), not the array', async () => {
    const user = userEvent.setup()
    // A Plan move rewrote act / index and left the array alone: story order
    // is scene-c, scene-a, scene-b.
    vi.mocked(getProject).mockResolvedValue(
      project([
        makeScene({ id: 'scene-b', act: 1, index: 2, location: 'B' }),
        makeScene({ id: 'scene-a', act: 1, index: 1, location: 'A' }),
        makeScene({ id: 'scene-c', act: 0, index: 3, location: 'C' }),
      ]),
    )
    vi.mocked(getLedger).mockResolvedValue([])
    window.history.pushState({}, '', '/?project=proj-1')

    render(<WriteScreen />)

    const outline = await screen.findByTestId('write-scene-outline')
    const rows = Array.from(
      outline.querySelectorAll<HTMLElement>('[data-testid^="write-outline-"]'),
    )
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'write-outline-scene-c',
      'write-outline-scene-a',
      'write-outline-scene-b',
    ])
    expect(rows.map((r) => r.textContent?.match(/^\d+/)?.[0])).toEqual([
      '1',
      '2',
      '3',
    ])
    const sections = Array.from(
      screen
        .getByTestId('script-canvas')
        .querySelectorAll<HTMLElement>('section[data-scene-id]'),
    )
    expect(sections.map((s) => s.dataset.sceneId)).toEqual([
      'scene-c',
      'scene-a',
      'scene-b',
    ])
    expect(screen.getByTestId('script-scene-number-scene-b').textContent).toBe(
      '3',
    )
    // Opens on the first scene in story order; ] steps to the next one.
    expect(rows[0].getAttribute('aria-current')).toBe('true')
    await user.keyboard(']')
    expect(
      screen.getByTestId('write-outline-scene-a').getAttribute('aria-current'),
    ).toBe('true')
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

  it('a save that can never succeed says why once, with Dismiss, and keeps the text', async () => {
    const user = userEvent.setup()
    vi.mocked(getProject).mockResolvedValue(project())
    vi.mocked(getLedger).mockResolvedValue([])
    vi.mocked(patchProject).mockRejectedValueOnce(
      new ApiError(409, { code: 'LOCKED_OBJECT', message: 'locked' }),
    )
    window.history.pushState({}, '', '/?project=proj-1&scene=scene-1')

    render(<WriteScreen />)
    const row = await screen.findByTestId('beat-row-beat-scene-1')
    await user.click(row.querySelector('[data-testid="formatted-script"]')!)
    await user.type(screen.getByTestId('beat-beat-scene-1'), ' More.')
    await user.tab()

    const line = await screen.findByTestId('write-save-failed')
    expect(line.textContent).toContain("Couldn't save: this beat is locked.")
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(row.textContent).toContain('Script for scene-1 More.')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('write-save-failed')).toBeNull()
    expect(patchProject).toHaveBeenCalledOnce()
  })
})

describe('WriteScreen craft level', () => {
  it('saves without If-Match and rolls back to the server value, not the click-time one', async () => {
    const user = userEvent.setup()
    vi.mocked(getProject).mockResolvedValue(project())
    vi.mocked(getLedger).mockResolvedValue([])
    let failFirst!: (err: unknown) => void
    vi.mocked(patchProject)
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => (failFirst = reject)),
      )
      .mockRejectedValueOnce(new Error('offline'))
    window.history.pushState({}, '', '/?project=proj-1')

    render(<WriteScreen />)
    const fast = await screen.findByRole('button', { name: /Fast draft/ })
    await user.click(fast)
    await user.click(screen.getByRole('button', { name: /Considered/ }))
    failFirst(new Error('offline'))

    const standard = screen.getByRole('button', { name: /Standard/ })
    await waitFor(() => expect(patchProject).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(standard.getAttribute('aria-pressed')).toBe('true'),
    )
    expect(vi.mocked(patchProject).mock.calls[0]).toEqual([
      'proj-1',
      [{ op: 'add', path: '/defaultCraftLevel', value: 'fast' }],
    ])
  })
})
