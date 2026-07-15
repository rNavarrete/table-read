// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWriteKeyboard } from './useWriteKeyboard'

function press(key: string, target?: HTMLElement) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true })
  Object.defineProperty(event, 'target', {
    value: target ?? document.body,
  })
  document.dispatchEvent(event)
}

describe('useWriteKeyboard', () => {
  it('fires Q to generate when not quiet and not typing', () => {
    const onGenerate = vi.fn()
    renderHook(() =>
      useWriteKeyboard({
        quiet: false,
        streaming: false,
        onGenerate,
        onFocusCommandBar: vi.fn(),
        onCycleFocus: vi.fn(),
        onAcceptFocused: vi.fn(),
        onDismissDock: vi.fn(),
        onSelectCard: vi.fn(),
        hasCards: false,
      }),
    )
    press('q')
    expect(onGenerate).toHaveBeenCalledOnce()
  })

  it('ignores Q while the script canvas is quiet (focused)', () => {
    const onGenerate = vi.fn()
    renderHook(() =>
      useWriteKeyboard({
        quiet: true,
        streaming: false,
        onGenerate,
        onFocusCommandBar: vi.fn(),
        onCycleFocus: vi.fn(),
        onAcceptFocused: vi.fn(),
        onDismissDock: vi.fn(),
        onSelectCard: vi.fn(),
        hasCards: false,
      }),
    )
    press('q')
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('ignores shortcuts while typing in a textarea', () => {
    const onGenerate = vi.fn()
    renderHook(() =>
      useWriteKeyboard({
        quiet: false,
        streaming: false,
        onGenerate,
        onFocusCommandBar: vi.fn(),
        onCycleFocus: vi.fn(),
        onAcceptFocused: vi.fn(),
        onDismissDock: vi.fn(),
        onSelectCard: vi.fn(),
        hasCards: true,
      }),
    )
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    press('q', textarea)
    press('Enter', textarea)
    expect(onGenerate).not.toHaveBeenCalled()
    textarea.remove()
  })

  it('cycles and accepts when cards are present', () => {
    const onCycleFocus = vi.fn()
    const onAcceptFocused = vi.fn()
    const onSelectCard = vi.fn()
    renderHook(() =>
      useWriteKeyboard({
        quiet: false,
        streaming: false,
        onGenerate: vi.fn(),
        onFocusCommandBar: vi.fn(),
        onCycleFocus,
        onAcceptFocused,
        onDismissDock: vi.fn(),
        onSelectCard,
        hasCards: true,
      }),
    )
    press('Tab')
    press('Enter')
    press('2')
    expect(onCycleFocus).toHaveBeenCalledWith(1)
    expect(onAcceptFocused).toHaveBeenCalledOnce()
    expect(onSelectCard).toHaveBeenCalledWith(1)
  })

  it('W focuses the command bar', () => {
    const onFocusCommandBar = vi.fn()
    renderHook(() =>
      useWriteKeyboard({
        quiet: false,
        streaming: false,
        onGenerate: vi.fn(),
        onFocusCommandBar,
        onCycleFocus: vi.fn(),
        onAcceptFocused: vi.fn(),
        onDismissDock: vi.fn(),
        onSelectCard: vi.fn(),
        hasCards: false,
      }),
    )
    press('w')
    expect(onFocusCommandBar).toHaveBeenCalledOnce()
  })

  it('bracket keys step previous/next scene', () => {
    const onPrevScene = vi.fn()
    const onNextScene = vi.fn()
    renderHook(() =>
      useWriteKeyboard({
        quiet: false,
        streaming: false,
        onGenerate: vi.fn(),
        onFocusCommandBar: vi.fn(),
        onCycleFocus: vi.fn(),
        onAcceptFocused: vi.fn(),
        onDismissDock: vi.fn(),
        onSelectCard: vi.fn(),
        hasCards: false,
        onPrevScene,
        onNextScene,
      }),
    )
    press('[')
    press(']')
    expect(onPrevScene).toHaveBeenCalledOnce()
    expect(onNextScene).toHaveBeenCalledOnce()
  })
})
