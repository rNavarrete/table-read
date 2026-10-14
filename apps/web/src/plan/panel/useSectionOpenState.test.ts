// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSectionOpenState } from './useSectionOpenState'

const KEY = 'tr.plan.sections.v1'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useSectionOpenState', () => {
  it('opens every section except Details by default', () => {
    const { result } = renderHook(() => useSectionOpenState())
    expect(result.current.open).toEqual({
      scene: true,
      wants: true,
      touches: true,
      beats: true,
      details: false,
    })
  })

  it('remembers a toggle per viewer and reads it back in a new panel', () => {
    const first = renderHook(() => useSectionOpenState())
    act(() => first.result.current.setOpen('details', true))
    act(() => first.result.current.setOpen('wants', false))
    expect(first.result.current.open.details).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({
      details: true,
      wants: false,
    })
    first.unmount()

    const second = renderHook(() => useSectionOpenState())
    expect(second.result.current.open).toMatchObject({
      scene: true,
      wants: false,
      details: true,
    })
  })

  it('ignores a corrupt or partly invalid stored value', () => {
    localStorage.setItem(KEY, '{not json')
    expect(
      renderHook(() => useSectionOpenState()).result.current.open.details,
    ).toBe(false)

    localStorage.setItem(
      KEY,
      JSON.stringify({ details: 'yes', beats: false, extra: true }),
    )
    expect(renderHook(() => useSectionOpenState()).result.current.open).toEqual(
      { scene: true, wants: true, touches: true, beats: false, details: false },
    )
  })

  it('still toggles in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useSectionOpenState())
    expect(result.current.open.details).toBe(false)
    act(() => result.current.setOpen('details', true))
    expect(result.current.open.details).toBe(true)
  })
})
