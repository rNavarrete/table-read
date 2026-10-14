// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCollapsedActs } from './useCollapsedActs'

const KEY = 'tr.plan.collapsedActs.v1.proj-a'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useCollapsedActs', () => {
  it('remembers collapsed acts per project across mounts', () => {
    const first = renderHook(() => useCollapsedActs('proj-a'))
    expect(first.result.current.collapsed.size).toBe(0)
    act(() => first.result.current.toggle(2))
    act(() => first.result.current.toggle(0))
    expect([...first.result.current.collapsed].sort()).toEqual([0, 2])
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([2, 0])
    act(() => first.result.current.toggle(0))
    expect([...first.result.current.collapsed]).toEqual([2])
    first.unmount()

    const second = renderHook(() => useCollapsedActs('proj-a'))
    expect([...second.result.current.collapsed]).toEqual([2])

    const other = renderHook(() => useCollapsedActs('proj-b'))
    expect(other.result.current.collapsed.size).toBe(0)
  })

  it('ignores a corrupt or non-numeric stored value', () => {
    localStorage.setItem(KEY, '{not json')
    expect(
      renderHook(() => useCollapsedActs('proj-a')).result.current.collapsed
        .size,
    ).toBe(0)

    localStorage.setItem(KEY, JSON.stringify([1, 'two', null, 3]))
    expect([
      ...renderHook(() => useCollapsedActs('proj-a')).result.current.collapsed,
    ]).toEqual([1, 3])
  })

  it('keeps toggling in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useCollapsedActs('proj-a'))
    expect(result.current.collapsed.size).toBe(0)
    act(() => result.current.toggle(1))
    expect(result.current.collapsed.has(1)).toBe(true)
  })

  it('expand opens a collapsed act and returns the same set when it is already open', () => {
    const { result } = renderHook(() => useCollapsedActs('proj-a'))
    act(() => result.current.toggle(1))
    act(() => result.current.expand(1))
    expect(result.current.collapsed.has(1)).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual([])

    const before = result.current.collapsed
    act(() => result.current.expand(3))
    expect(result.current.collapsed).toBe(before)
  })
})
