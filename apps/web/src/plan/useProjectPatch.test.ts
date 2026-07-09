// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from 'contract'
import { ApiError } from '../api/errors'
import { useProjectPatch } from './useProjectPatch'

const { patchProjectMock } = vi.hoisted(() => ({ patchProjectMock: vi.fn() }))
vi.mock('../api/client', () => ({ patchProject: patchProjectMock }))

function project(title: string): Project {
  return {
    id: 'proj-x',
    title,
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
    headSnapshotId: 'snap-root',
  }
}

describe('useProjectPatch', () => {
  beforeEach(() => {
    patchProjectMock.mockReset()
  })

  it('applies the optimistic project immediately, then replaces it with the server response on success', async () => {
    const before = project('Before')
    const optimistic = project('Optimistic')
    const server = project('Server Truth')
    patchProjectMock.mockResolvedValue(server)

    let current = before
    const setProject = vi.fn((p: Project) => {
      current = p
    })
    const { result } = renderHook(() =>
      useProjectPatch('proj-x', before, setProject),
    )

    let ok = false
    await act(async () => {
      ok = await result.current.patch(
        [{ op: 'replace', path: '/title', value: 'x' }],
        optimistic,
      )
    })

    expect(ok).toBe(true)
    // First call: the optimistic guess. Second call: the server's authoritative reply.
    expect(setProject).toHaveBeenNthCalledWith(1, optimistic)
    expect(setProject).toHaveBeenNthCalledWith(2, server)
    expect(current).toBe(server)
    expect(result.current.error).toBeNull()
    expect(result.current.pending).toBe(false)
  })

  it('rolls back to the exact pre-patch project on a 4xx/5xx, and surfaces the error', async () => {
    const before = project('Before')
    const optimistic = project('Optimistic')
    patchProjectMock.mockRejectedValue(
      new ApiError(409, { code: 'LOCKED_OBJECT', message: 'locked' }),
    )

    let current = before
    const setProject = vi.fn((p: Project) => {
      current = p
    })
    const { result } = renderHook(() =>
      useProjectPatch('proj-x', before, setProject),
    )

    let ok = true
    await act(async () => {
      ok = await result.current.patch(
        [{ op: 'replace', path: '/title', value: 'x' }],
        optimistic,
      )
    })

    expect(ok).toBe(false)
    // First call: the optimistic guess. Second call: the rollback, byte-identical to `before`.
    expect(setProject).toHaveBeenNthCalledWith(1, optimistic)
    expect(setProject).toHaveBeenNthCalledWith(2, before)
    expect(current).toBe(before)
    expect(result.current.error).toEqual({
      code: 'LOCKED_OBJECT',
      message: 'locked',
    })
    expect(result.current.pending).toBe(false)
  })

  it('refuses a second mutation while the first is in flight (concurrent-mutation guard)', async () => {
    const before = project('Before')
    const optimisticFirst = project('Optimistic 1')
    const optimisticSecond = project('Optimistic 2')
    const server = project('Server Truth')

    // First PATCH hangs until we resolve it — the window in which a second
    // mutation could otherwise start and later be erased by the first's
    // rollback (useProjectPatch restores the exact pre-patch doc).
    let resolveFirst!: (p: Project) => void
    patchProjectMock.mockImplementation(
      () => new Promise<Project>((resolve) => (resolveFirst = resolve)),
    )

    const setProject = vi.fn()
    const { result } = renderHook(() =>
      useProjectPatch('proj-x', before, setProject),
    )

    let first!: Promise<boolean>
    act(() => {
      first = result.current.patch(
        [{ op: 'replace', path: '/title', value: '1' }],
        optimisticFirst,
      )
    })

    // Same-tick second call: refused before anything is sent or shown.
    let second = true
    await act(async () => {
      second = await result.current.patch(
        [{ op: 'replace', path: '/title', value: '2' }],
        optimisticSecond,
      )
    })

    expect(second).toBe(false)
    expect(patchProjectMock).toHaveBeenCalledTimes(1) // second never sent
    expect(setProject).toHaveBeenCalledTimes(1) // only the first optimistic shown
    expect(setProject).toHaveBeenCalledWith(optimisticFirst)

    // The first mutation completes normally, unaffected by the refusal.
    await act(async () => {
      resolveFirst(server)
      await expect(first).resolves.toBe(true)
    })
    expect(setProject).toHaveBeenLastCalledWith(server)

    // And once settled, the guard releases — a new mutation goes through.
    patchProjectMock.mockResolvedValue(server)
    let third = false
    await act(async () => {
      third = await result.current.patch(
        [{ op: 'replace', path: '/title', value: '3' }],
        optimisticSecond,
      )
    })
    expect(third).toBe(true)
  })

  it('is a no-op when there is no project loaded yet', async () => {
    const setProject = vi.fn()
    const { result } = renderHook(() =>
      useProjectPatch('proj-x', null, setProject),
    )

    let ok = true
    await act(async () => {
      ok = await result.current.patch(
        [{ op: 'replace', path: '/title', value: 'x' }],
        project('x'),
      )
    })

    expect(ok).toBe(false)
    expect(setProject).not.toHaveBeenCalled()
    expect(patchProjectMock).not.toHaveBeenCalled()
  })

  it('dismissError clears a surfaced error', async () => {
    const before = project('Before')
    patchProjectMock.mockRejectedValue(
      new ApiError(500, { code: 'UNKNOWN', message: 'boom' }),
    )
    const { result } = renderHook(() =>
      useProjectPatch('proj-x', before, vi.fn()),
    )

    await act(async () => {
      await result.current.patch(
        [{ op: 'replace', path: '/title', value: 'x' }],
        project('x'),
      )
    })
    expect(result.current.error).not.toBeNull()

    act(() => result.current.dismissError())
    expect(result.current.error).toBeNull()
  })
})
