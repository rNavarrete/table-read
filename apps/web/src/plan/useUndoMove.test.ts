// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from 'contract'
import { ApiError } from '../api/errors'
import { UNDO_MOVE_STALE, useUndoMove, type LastMove } from './useUndoMove'

const { undoMock } = vi.hoisted(() => ({ undoMock: vi.fn() }))
vi.mock('../api/client', () => ({ undoProject: undoMock }))

function project(headSnapshotId: string): Project {
  return {
    id: 'proj-a',
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
    seasons: [],
    headSnapshotId,
    defaultCraftLevel: 'standard',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const MOVE: LastMove = { issueIds: ['order-thread-1'], head: 'snap-2' }

function setup(headSnapshotId: string | null = 'snap-2') {
  const onProject = vi.fn()
  const hook = renderHook(
    ({ head }: { head: string | null }) =>
      useUndoMove({ projectId: 'proj-a', headSnapshotId: head, onProject }),
    { initialProps: { head: headSnapshotId } },
  )
  return { ...hook, onProject }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useUndoMove', () => {
  it("offers Undo the move only while the move's snapshot is the head", () => {
    const { result, rerender } = setup('snap-2')
    expect(result.current.undoable).toBe(false) // no move yet

    act(() => result.current.setMove({ issueIds: [], head: null }))
    expect(result.current.undoable).toBe(false) // not saved yet

    act(() => result.current.setMove(MOVE))
    expect(result.current.undoable).toBe(true)

    rerender({ head: 'snap-3' }) // another edit moved the head
    expect(result.current.undoable).toBe(false)
  })

  it("undo posts with If-Match = the move's head and hands back the restored project", async () => {
    undoMock.mockResolvedValue(project('snap-1'))
    const { result, onProject } = setup()
    act(() => result.current.setMove(MOVE))

    let ok = false
    await act(async () => {
      ok = await result.current.undo()
    })

    expect(undoMock).toHaveBeenCalledTimes(1)
    expect(undoMock).toHaveBeenCalledWith('proj-a', {
      expectedHeadSnapshotId: 'snap-2',
    })
    expect(onProject).toHaveBeenCalledWith(project('snap-1'))
    expect(ok).toBe(true)
    expect(result.current.move).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('a stale head shows the Plan-changed copy and drops the offer', async () => {
    undoMock.mockRejectedValue(
      new ApiError(409, { code: 'CONFLICT_STALE_HEAD', message: 'head moved' }),
    )
    const { result, onProject } = setup()
    act(() => result.current.setMove(MOVE))

    let ok = true
    await act(async () => {
      ok = await result.current.undo()
    })

    expect(ok).toBe(false)
    expect(result.current.error).toBe(UNDO_MOVE_STALE)
    expect(result.current.undoable).toBe(false)
    expect(result.current.move).toBeNull()
    expect(onProject).not.toHaveBeenCalled()

    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })

  it("busy covers the round trip, and undo does nothing when the move isn't the head", async () => {
    // Not the head: no request, nothing busy.
    const stale = setup('snap-3')
    act(() => stale.result.current.setMove(MOVE))
    let ok = true
    await act(async () => {
      ok = await stale.result.current.undo()
    })
    expect(ok).toBe(false)
    expect(undoMock).not.toHaveBeenCalled()
    expect(stale.result.current.busy).toBe(false)

    // The head: busy until the server answers.
    const request = deferred<Project>()
    undoMock.mockReturnValue(request.promise)
    const { result } = setup('snap-2')
    act(() => result.current.setMove(MOVE))

    let done!: Promise<boolean>
    act(() => {
      done = result.current.undo()
    })
    expect(result.current.busy).toBe(true)

    request.resolve(project('snap-1'))
    await act(() => done)
    expect(result.current.busy).toBe(false)
  })
})
