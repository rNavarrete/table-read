// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsistencyFlag, Project } from 'contract'
import { ApiError } from '../../api/errors'
import { staleHeadMessage } from '../../shell/toastCopy'
import { useDismissNote } from './useDismissNote'

const { dismissMock, getFlagsMock, getProjectMock, undoMock } = vi.hoisted(
  () => ({
    dismissMock: vi.fn(),
    getFlagsMock: vi.fn(),
    getProjectMock: vi.fn(),
    undoMock: vi.fn(),
  }),
)
vi.mock('../../api/client', () => ({
  dismissConsistencyFlag: dismissMock,
  getConsistencyFlags: getFlagsMock,
  getProject: getProjectMock,
  undoProject: undoMock,
}))

function project(headSnapshotId: string): Project {
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
    seasons: [],
    headSnapshotId,
    defaultCraftLevel: 'standard',
  }
}

const FLAG: ConsistencyFlag = {
  id: 'flag-1',
  objectType: 'scene',
  objectId: 'scene-5',
  factId: null,
  explanation:
    "The argument's stakes reference the bar as the money's hiding place, which is no longer true.",
  severity: 'tension',
  status: 'open',
  sourceChange: 'snap-0',
}

const STALE = () =>
  new ApiError(409, { code: 'CONFLICT_STALE_HEAD', message: 'head moved' })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function setup() {
  const onProject = vi.fn()
  const onFlags = vi.fn()
  const hook = renderHook(() =>
    useDismissNote({
      projectId: 'proj-longpour',
      headSnapshotId: 'snap-1',
      onProject,
      onFlags,
    }),
  )
  return { ...hook, onProject, onFlags }
}

function dismissSucceeds() {
  dismissMock.mockResolvedValue({ ...FLAG, status: 'dismissed' })
  getProjectMock.mockResolvedValue(project('snap-2'))
  getFlagsMock.mockResolvedValue([])
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useDismissNote', () => {
  it('dismisses with If-Match, then refetches the project (new head) and the open flags', async () => {
    dismissSucceeds()
    const { result, onProject, onFlags } = setup()

    await act(() => result.current.dismiss('flag-1'))

    expect(dismissMock).toHaveBeenCalledWith('flag-1', {
      expectedHeadSnapshotId: 'snap-1',
    })
    expect(getProjectMock).toHaveBeenCalledWith('proj-longpour')
    expect(getFlagsMock).toHaveBeenCalledWith('proj-longpour', 'open')
    expect(onProject).toHaveBeenCalledWith(project('snap-2'))
    expect(onFlags).toHaveBeenCalledWith([])
    expect(result.current).toMatchObject({
      undoable: true,
      busy: false,
      error: null,
    })
  })

  it('is busy while the dismiss is in flight', async () => {
    const request = deferred<ConsistencyFlag>()
    dismissMock.mockReturnValue(request.promise)
    getProjectMock.mockResolvedValue(project('snap-2'))
    getFlagsMock.mockResolvedValue([])
    const { result } = setup()

    let done!: Promise<void>
    act(() => {
      done = result.current.dismiss('flag-1')
    })
    expect(result.current.busy).toBe(true)

    request.resolve({ ...FLAG, status: 'dismissed' })
    await act(() => done)
    expect(result.current.busy).toBe(false)
  })

  it('undo sends If-Match = the head after the dismiss and brings the note back', async () => {
    dismissSucceeds()
    const { result, onProject, onFlags } = setup()
    await act(() => result.current.dismiss('flag-1'))

    undoMock.mockResolvedValue(project('snap-1'))
    getFlagsMock.mockResolvedValue([FLAG])
    await act(() => result.current.undo())

    expect(undoMock).toHaveBeenCalledWith('proj-longpour', {
      expectedHeadSnapshotId: 'snap-2',
    })
    expect(onProject).toHaveBeenLastCalledWith(project('snap-1'))
    expect(onFlags).toHaveBeenLastCalledWith([FLAG])
    expect(result.current.undoable).toBe(false)
  })

  it('a stale head on dismiss shows the shared stale-head copy and changes nothing', async () => {
    dismissMock.mockRejectedValue(STALE())
    const { result, onProject } = setup()

    await act(() => result.current.dismiss('flag-1'))

    expect(result.current.error).toBe(staleHeadMessage)
    expect(getProjectMock).not.toHaveBeenCalled()
    expect(onProject).not.toHaveBeenCalled()
    expect(result.current.undoable).toBe(false)
  })

  it('undo after another edit fails safely with the Plan-changed copy', async () => {
    dismissSucceeds()
    const { result, onProject } = setup()
    await act(() => result.current.dismiss('flag-1'))

    undoMock.mockRejectedValue(STALE())
    await act(() => result.current.undo())

    expect(result.current.error).toBe(
      "Can't undo the dismiss — Plan changed since. Use Undo in the top bar.",
    )
    expect(onProject).toHaveBeenCalledTimes(1)
    expect(result.current.undoable).toBe(false)
  })

  it('a dismiss that lands but whose refetch fails drops the note and asks for a reload', async () => {
    dismissMock.mockResolvedValue({ ...FLAG, status: 'dismissed' })
    getProjectMock.mockRejectedValue(new Error('offline'))
    getFlagsMock.mockResolvedValue([])
    const { result, onFlags } = setup()

    await act(() => result.current.dismiss('flag-1'))

    const other = { ...FLAG, id: 'flag-2' }
    const update = onFlags.mock.calls[0][0] as (
      prev: ConsistencyFlag[],
    ) => ConsistencyFlag[]
    expect(update([FLAG, other])).toEqual([other])
    expect(result.current.error).toMatch(/^Note dismissed.*Reload/)
    expect(result.current).toMatchObject({ busy: false, undoable: false })
  })

  it('clearUndo and clearError reset the toast state', async () => {
    dismissSucceeds()
    const { result } = setup()
    await act(() => result.current.dismiss('flag-1'))
    act(() => result.current.clearUndo())
    expect(result.current.undoable).toBe(false)

    dismissMock.mockRejectedValue(new Error('network down'))
    await act(() => result.current.dismiss('flag-1'))
    expect(result.current.error).toBe('network down')
    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })
})
