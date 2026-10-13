// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { BeatCandidate, Project } from 'contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors'
import { navigateToMode } from '../shell/modeNavigation'
import { useAcceptBeat } from './useAcceptBeat'
import { SAVE_DEBOUNCE_MS, useWriteQueue } from './useWriteQueue'

vi.mock('../api/client', () => ({
  patchProject: vi.fn(),
  getProject: vi.fn(),
  acceptBeat: vi.fn(),
}))

import { acceptBeat, getProject, patchProject } from '../api/client'

function project(head: string, scriptText = 'Old text.'): Project {
  return {
    id: 'proj-1',
    title: 'T',
    headSnapshotId: head,
    seasons: [
      {
        episodes: [
          {
            id: 'ep-1',
            scenes: [
              {
                id: 'scene-1',
                beats: [{ id: 'beat-1', scriptText }],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

const BEAT_PATH = '/seasons/0/episodes/0/scenes/0/beats/0/scriptText'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function patched(p: Project) {
  return { project: p, consistencyFlags: [] }
}

function setup(initial = project('snap-1')) {
  const hook = renderHook(() => useWriteQueue('proj-1'))
  act(() => hook.result.current.setProject(initial))
  return hook
}

function unloadPrevented(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('useWriteQueue autosave', () => {
  it('saves once, ~1 s after typing stops, with the latest text', async () => {
    vi.mocked(patchProject).mockResolvedValue(patched(project('snap-2')))
    const { result } = setup()

    act(() => result.current.editBeat('scene-1', 'beat-1', 'N'))
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100))
    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100))
    expect(patchProject).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(patchProject).toHaveBeenCalledOnce()
    expect(patchProject).toHaveBeenCalledWith(
      'proj-1',
      [{ op: 'replace', path: BEAT_PATH, value: 'New' }],
      { expectedHeadSnapshotId: 'snap-1' },
    )
    expect(result.current.project?.headSnapshotId).toBe('snap-2')
  })

  it('flush (blur, scene change, generation) saves immediately', async () => {
    vi.mocked(patchProject).mockResolvedValue(patched(project('snap-2')))
    const { result } = setup()

    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    let ok: boolean | null = false
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(true)
    expect(patchProject).toHaveBeenCalledOnce()
    // The debounce timer was cancelled: no second save later.
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2))
    expect(patchProject).toHaveBeenCalledOnce()
  })

  it('skips the PATCH when the text matches the saved text', async () => {
    const { result } = setup()
    act(() => result.current.editBeat('scene-1', 'beat-1', 'Old text.'))
    await act(() => result.current.flush())
    expect(patchProject).not.toHaveBeenCalled()
  })

  it('coalesces edits made while a save is in flight into one follow-up save', async () => {
    const first = deferred<ReturnType<typeof patched>>()
    vi.mocked(patchProject)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(patched(project('snap-3')))
    const { result } = setup()

    act(() => result.current.editBeat('scene-1', 'beat-1', 'One'))
    act(() => void result.current.flush())
    await act(() => vi.advanceTimersByTimeAsync(0))
    act(() => result.current.editBeat('scene-1', 'beat-1', 'One two'))
    act(() => void result.current.flush())
    act(() => result.current.editBeat('scene-1', 'beat-1', 'One two three'))
    act(() => void result.current.flush())

    first.resolve(patched(project('snap-2', 'One')))
    await act(() => result.current.flush())

    expect(patchProject).toHaveBeenCalledTimes(2)
    expect(vi.mocked(patchProject).mock.calls[1]).toEqual([
      'proj-1',
      [{ op: 'replace', path: BEAT_PATH, value: 'One two three' }],
      { expectedHeadSnapshotId: 'snap-2' },
    ])
  })

  it('a stale head refetches the project and retries the edit once', async () => {
    vi.mocked(patchProject)
      .mockRejectedValueOnce(
        new ApiError(409, { code: 'CONFLICT_STALE_HEAD', message: 'stale' }),
      )
      .mockResolvedValueOnce(patched(project('snap-9')))
    vi.mocked(getProject).mockResolvedValue(project('snap-8'))
    const { result } = setup()

    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    let ok: boolean | null = false
    await act(async () => {
      ok = await result.current.flush()
    })

    expect(ok).toBe(true)
    expect(getProject).toHaveBeenCalledWith('proj-1')
    expect(vi.mocked(patchProject).mock.calls[1][2]).toEqual({
      expectedHeadSnapshotId: 'snap-8',
    })
    expect(result.current.saveFailed).toBe(false)
  })

  it('a retryable failure (5xx) keeps the edit, blocks flush, and Retry re-saves it', async () => {
    vi.mocked(patchProject).mockRejectedValueOnce(
      new ApiError(503, { code: 'UNKNOWN', message: 'offline' }),
    )
    const { result } = setup()

    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    let ok: boolean | null = true
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(false)
    expect(result.current.saveFailed).toBe(true)
    expect(result.current.notice).toBeNull()

    vi.mocked(patchProject).mockResolvedValueOnce(patched(project('snap-2')))
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(true)
    expect(result.current.saveFailed).toBe(false)
    expect(vi.mocked(patchProject).mock.calls[1][1]).toEqual([
      { op: 'replace', path: BEAT_PATH, value: 'New' },
    ])
  })

  it('LOCKED_OBJECT drops the edit with one notice, picks up the lock, and unblocks flush', async () => {
    vi.mocked(patchProject).mockRejectedValueOnce(
      new ApiError(409, { code: 'LOCKED_OBJECT', message: 'locked' }),
    )
    vi.mocked(getProject).mockResolvedValue(project('snap-5'))
    const { result } = setup()

    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    let ok: boolean | null = false
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(true)
    expect(result.current.saveFailed).toBe(false)
    expect(result.current.notice).toBe("Couldn't save: this beat is locked.")
    expect(result.current.project?.headSnapshotId).toBe('snap-5')
    // Dropped, not retried: nothing left to flush.
    expect(result.current.flush()).toBeNull()
    expect(patchProject).toHaveBeenCalledOnce()

    act(() => result.current.dismissNotice())
    expect(result.current.notice).toBeNull()
  })

  it('a beat missing from the head drops the edit with "removed"', async () => {
    const { result } = setup()
    act(() => result.current.editBeat('scene-1', 'beat-gone', 'New'))
    let ok: boolean | null = false
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(true)
    expect(patchProject).not.toHaveBeenCalled()
    expect(result.current.notice).toBe("Couldn't save: this beat was removed.")
  })

  it('a stale head whose refetch changed the beat does not retry (the other window wins)', async () => {
    vi.mocked(patchProject).mockRejectedValueOnce(
      new ApiError(409, { code: 'CONFLICT_STALE_HEAD', message: 'stale' }),
    )
    vi.mocked(getProject).mockResolvedValue(
      project('snap-8', 'Edited in another window.'),
    )
    const { result } = setup()

    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    let ok: boolean | null = false
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(true)
    expect(patchProject).toHaveBeenCalledOnce()
    expect(result.current.notice).toBe(
      "Couldn't save: this beat changed in another window.",
    )
    expect(result.current.project?.headSnapshotId).toBe('snap-8')
  })

  it('unmount flushes a pending edit', () => {
    vi.mocked(patchProject).mockResolvedValue(patched(project('snap-2')))
    const { result, unmount } = setup()
    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    unmount()
    return vi.waitFor(() => expect(patchProject).toHaveBeenCalledOnce())
  })

  it('beforeunload is armed while an edit is unsaved or in flight, and only then', async () => {
    const save = deferred<ReturnType<typeof patched>>()
    vi.mocked(patchProject).mockReturnValueOnce(save.promise)
    const { result } = setup()
    expect(unloadPrevented()).toBe(false)

    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    expect(unloadPrevented()).toBe(true)

    act(() => void result.current.flush())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(patchProject).toHaveBeenCalledOnce()
    expect(unloadPrevented()).toBe(true) // in flight

    save.resolve(patched(project('snap-2')))
    await act(() => result.current.flush())
    expect(unloadPrevented()).toBe(false)
  })

  it('a mode switch right after a successful save leaves without a prompt (no render needed)', async () => {
    vi.mocked(patchProject).mockResolvedValue(patched(project('snap-2')))
    const { result } = setup()
    const original = window.location
    const prompted: boolean[] = []
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...original,
        href: 'http://localhost/?project=proj-1',
        // Checked at the instant navigation starts, outside act — exactly
        // when the browser would ask.
        assign: () => prompted.push(unloadPrevented()),
      },
    })
    try {
      act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
      navigateToMode('Plan')
      await vi.waitFor(() => expect(prompted).toHaveLength(1))
      expect(patchProject).toHaveBeenCalledOnce()
      expect(prompted).toEqual([false])
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      })
    }
  })

  it('runAfterSaves (Undo/restore) saves pending edits and then runs the request in one op', async () => {
    const order: string[] = []
    vi.mocked(patchProject).mockImplementation(async () => {
      order.push('save')
      return patched(project('snap-2'))
    })
    const { result } = setup()
    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))

    let ran: boolean | undefined
    await act(async () => {
      ran = await result.current.runAfterSaves(async () => {
        order.push('undo')
      })
    })
    expect(ran).toBe(true)
    expect(order).toEqual(['save', 'undo'])
    expect(unloadPrevented()).toBe(false)
  })

  it('runAfterSaves skips the request while a save keeps failing', async () => {
    vi.mocked(patchProject).mockRejectedValue(
      new ApiError(503, { code: 'UNKNOWN', message: 'offline' }),
    )
    const { result } = setup()
    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    const undo = vi.fn(async () => {})

    let ran: boolean | undefined
    await act(async () => {
      ran = await result.current.runAfterSaves(undo)
    })
    expect(ran).toBe(false)
    expect(undo).not.toHaveBeenCalled()
    expect(result.current.saveFailed).toBe(true)
  })
})

describe('one queue for autosave and Accept', () => {
  const candidate = {
    label: 'Quiet reveal',
    beatPlan: { whatHappens: 'w', audienceLearns: 'l', audienceFeels: 'f' },
    scriptText: 'Accepted text.',
    continuityConflicts: [],
  } as unknown as BeatCandidate

  it('Accept enqueued while a save is in flight runs after it on the new head; both succeed', async () => {
    const save = deferred<ReturnType<typeof patched>>()
    vi.mocked(patchProject).mockReturnValueOnce(save.promise)
    const accepted = project('snap-3', 'Typed.')
    vi.mocked(acceptBeat).mockResolvedValue({
      project: accepted,
      newFacts: [],
      consistencyFlags: [],
    } as never)

    const { result } = renderHook(() => {
      const queue = useWriteQueue('proj-1')
      const accept = useAcceptBeat(
        'proj-1',
        'scene-1',
        queue.run,
        queue.setProject,
      )
      return { queue, accept }
    })
    act(() => result.current.queue.setProject(project('snap-1')))

    act(() => result.current.queue.editBeat('scene-1', 'beat-1', 'Typed.'))
    act(() => void result.current.queue.flush())
    let acceptDone!: Promise<unknown>
    act(() => {
      acceptDone = result.current.accept.accept(0, candidate, 'beat-1')
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(acceptBeat).not.toHaveBeenCalled() // waits for the save

    save.resolve(patched(project('snap-2', 'Typed.')))
    await act(async () => {
      await acceptDone
    })

    expect(vi.mocked(acceptBeat).mock.calls[0][4]).toEqual({
      expectedHeadSnapshotId: 'snap-2',
    })
    expect(result.current.accept.errorByIndex).toEqual({})
    expect(result.current.queue.saveFailed).toBe(false)
    expect(result.current.queue.project).toBe(accepted)
  })

  function acceptHarness() {
    const hook = renderHook(() => {
      const queue = useWriteQueue('proj-1')
      const accept = useAcceptBeat(
        'proj-1',
        'scene-1',
        queue.run,
        queue.setProject,
      )
      return { queue, accept }
    })
    act(() => hook.result.current.queue.setProject(project('snap-1')))
    return hook
  }

  it('a second accept while one is in flight is a no-op (no duplicate beat)', async () => {
    const held = deferred<unknown>()
    vi.mocked(acceptBeat).mockReturnValueOnce(held.promise as never)
    const { result } = acceptHarness()

    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = result.current.accept.accept(0, candidate, 'beat-1')
    })
    act(() => {
      second = result.current.accept.accept(1, candidate, 'beat-1')
    })
    expect(await second).toBeNull()
    expect(result.current.accept.acceptingIndex).toBe(0)

    held.resolve({
      project: project('snap-2'),
      newFacts: [],
      consistencyFlags: [],
    })
    await act(async () => {
      await first
    })
    expect(acceptBeat).toHaveBeenCalledOnce()
    // Released: a later accept goes through.
    vi.mocked(acceptBeat).mockResolvedValueOnce({
      project: project('snap-3'),
      newFacts: [],
      consistencyFlags: [],
    } as never)
    await act(async () => {
      await result.current.accept.accept(0, candidate, 'beat-1')
    })
    expect(acceptBeat).toHaveBeenCalledTimes(2)
  })

  it('Accept CONFLICT_STALE_HEAD refetches the head into the queue, without re-accepting', async () => {
    vi.mocked(acceptBeat).mockRejectedValueOnce(
      new ApiError(409, { code: 'CONFLICT_STALE_HEAD', message: 'stale' }),
    )
    vi.mocked(getProject).mockResolvedValue(project('snap-7'))
    const { result } = acceptHarness()

    await act(async () => {
      await result.current.accept.accept(0, candidate, 'beat-1')
    })
    expect(acceptBeat).toHaveBeenCalledOnce()
    expect(result.current.accept.errorByIndex[0]?.code).toBe(
      'CONFLICT_STALE_HEAD',
    )
    expect(result.current.queue.project?.headSnapshotId).toBe('snap-7')
    expect(result.current.queue.getHead()?.headSnapshotId).toBe('snap-7')
  })
})
