// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlanKeys } from './usePlanKeys'

function setup() {
  const handlers = {
    onStep: vi.fn(),
    onNext: vi.fn(),
    onEpisodeView: vi.fn(),
    onOpenInWrite: vi.fn(),
  }
  renderHook(() => usePlanKeys(handlers))
  const calls = () =>
    Object.values(handlers).reduce((n, fn) => n + fn.mock.calls.length, 0)
  return { handlers, calls }
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('usePlanKeys', () => {
  it('j/k step, n/N go to the next and previous match, ⌘↵ and Ctrl+↵ open in Write, Esc shows the episode', () => {
    const { handlers } = setup()
    const card = mount('<div tabindex="0"></div>').firstElementChild!

    fireEvent.keyDown(card, { key: 'j' })
    fireEvent.keyDown(card, { key: 'k' })
    expect(handlers.onStep.mock.calls).toEqual([[1], [-1]])

    fireEvent.keyDown(card, { key: 'n' })
    fireEvent.keyDown(card, { key: 'N', shiftKey: true })
    expect(handlers.onNext.mock.calls).toEqual([[1], [-1]])

    fireEvent.keyDown(card, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(card, { key: 'Enter', ctrlKey: true })
    expect(handlers.onOpenInWrite).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(card, { key: 'Escape' })
    expect(handlers.onEpisodeView).toHaveBeenCalledTimes(1)
  })

  it('ignores fields, selects, contentEditable, dialogs, handled events and modifier chords', () => {
    const { calls } = setup()
    const host = mount(`
      <input /><textarea></textarea><select><option>a</option></select>
      <div contenteditable="true"></div>
      <dialog open><button type="button">ok</button></dialog>
      <aside role="dialog" aria-modal="true"><button type="button">Close</button></aside>
      <div id="card" tabindex="0"></div>
    `)
    for (const target of host.querySelectorAll(
      'input, textarea, select, [contenteditable], dialog button, [role="dialog"] button',
    )) {
      for (const key of ['j', 'n', 'Escape']) fireEvent.keyDown(target, { key })
      fireEvent.keyDown(target, { key: 'Enter', metaKey: true })
    }

    const card = host.querySelector('#card')!
    card.addEventListener('keydown', (e) => e.preventDefault())
    fireEvent.keyDown(card, { key: 'j' })
    card.replaceWith(card.cloneNode())
    const plain = host.querySelector('#card')!
    fireEvent.keyDown(plain, { key: 'j', altKey: true })
    fireEvent.keyDown(plain, { key: 'j', ctrlKey: true })
    fireEvent.keyDown(plain, { key: 'n', metaKey: true })

    expect(calls()).toBe(0)
  })

  it('leaves Esc inside the inspector to the panel', () => {
    const { handlers } = setup()
    const host = mount(
      '<aside data-testid="inspector"><h2 tabindex="-1">Scene</h2></aside>',
    )

    fireEvent.keyDown(host.querySelector('h2')!, { key: 'Escape' })

    expect(handlers.onEpisodeView).not.toHaveBeenCalled()
  })
})
