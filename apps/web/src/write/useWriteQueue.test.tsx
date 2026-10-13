// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { BeatCandidate, Project } from 'contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors'
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
    let ok = false
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
    let ok = false
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

  it('LOCKED_OBJECT surfaces the failure, keeps the edit, and Retry re-saves it', async () => {
    vi.mocked(patchProject).mockRejectedValueOnce(
      new ApiError(409, { code: 'LOCKED_OBJECT', message: 'locked' }),
    )
    const { result } = setup()

    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    let ok = true
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(false)
    expect(result.current.saveFailed).toBe(true)
    expect(getProject).not.toHaveBeenCalled()
    expect(patchProject).toHaveBeenCalledOnce()

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

  it('unmount flushes a pending edit', () => {
    vi.mocked(patchProject).mockResolvedValue(patched(project('snap-2')))
    const { result, unmount } = setup()
    act(() => result.current.editBeat('scene-1', 'beat-1', 'New'))
    unmount()
    return vi.waitFor(() => expect(patchProject).toHaveBeenCalledOnce())
  })

  it('beforeunload is only active while an edit is unsaved or in flight', async () => {
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
})
