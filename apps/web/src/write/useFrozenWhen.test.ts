// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFrozenWhen } from './useFrozenWhen'

describe('useFrozenWhen', () => {
  it('tracks the live value while not frozen', () => {
    const { result, rerender } = renderHook(
      ({ value, freeze }) => useFrozenWhen(value, freeze),
      { initialProps: { value: 1, freeze: false } },
    )
    expect(result.current).toBe(1)
    rerender({ value: 2, freeze: false })
    expect(result.current).toBe(2)
  })

  it('stops updating the instant freeze becomes true, ignoring further value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, freeze }) => useFrozenWhen(value, freeze),
      { initialProps: { value: 'a', freeze: false } },
    )
    rerender({ value: 'b', freeze: true }) // freezes at the value present when freeze flips true
    expect(result.current).toBe('b')
    rerender({ value: 'c', freeze: true }) // ignored — still frozen
    expect(result.current).toBe('b')
    rerender({ value: 'd', freeze: true }) // still ignored
    expect(result.current).toBe('b')
  })

  it('resumes tracking live values once freeze goes false again', () => {
    const { result, rerender } = renderHook(
      ({ value, freeze }) => useFrozenWhen(value, freeze),
      { initialProps: { value: 1, freeze: true } },
    )
    rerender({ value: 2, freeze: true })
    expect(result.current).toBe(1)
    rerender({ value: 3, freeze: false })
    expect(result.current).toBe(3)
  })
})
