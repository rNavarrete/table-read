// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  navigateToMode,
  navigateToWriteBeat,
  navigateToWriteScene,
  setBeforeModeSwitch,
} from './modeNavigation'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('navigateToWriteScene', () => {
  it('assigns Write path with scene query, keeping project', () => {
    const assignSpy = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      value: {
        ...original,
        href: 'http://localhost/plan?project=proj-1&changeSet=cs-1&highlightBeat=beat-1',
        assign: assignSpy,
      },
      writable: true,
    })

    navigateToWriteScene('scene-3')

    expect(assignSpy).toHaveBeenCalledOnce()
    const href = String(assignSpy.mock.calls[0][0])
    const url = new URL(href)
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('project')).toBe('proj-1')
    expect(url.searchParams.get('scene')).toBe('scene-3')
    expect(url.searchParams.get('changeSet')).toBeNull()
    expect(url.searchParams.get('highlightBeat')).toBeNull()

    Object.defineProperty(window, 'location', {
      value: original,
      writable: true,
    })
  })
})

describe('navigateToWriteBeat', () => {
  it('assigns Write path with scene and highlightBeat, keeping project', () => {
    const assignSpy = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      value: {
        ...original,
        href: 'http://localhost/ledger?project=proj-1&changeSet=cs-1',
        assign: assignSpy,
      },
      writable: true,
    })

    navigateToWriteBeat('scene-2', 'beat-2-1')

    const url = new URL(String(assignSpy.mock.calls[0][0]))
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('project')).toBe('proj-1')
    expect(url.searchParams.get('scene')).toBe('scene-2')
    expect(url.searchParams.get('highlightBeat')).toBe('beat-2-1')
    expect(url.searchParams.get('changeSet')).toBeNull()

    Object.defineProperty(window, 'location', {
      value: original,
      writable: true,
    })
  })
})

describe('navigateToMode', () => {
  it('waits for the registered before-switch hook (Write autosave flush)', async () => {
    const assignSpy = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      value: {
        ...original,
        href: 'http://localhost/?project=proj-1',
        assign: assignSpy,
      },
      writable: true,
    })
    let release!: () => void
    setBeforeModeSwitch(() => new Promise<void>((r) => (release = r)))

    navigateToMode('Plan')
    await Promise.resolve()
    expect(assignSpy).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(assignSpy).toHaveBeenCalledOnce())
    expect(new URL(String(assignSpy.mock.calls[0][0])).pathname).toBe('/plan')

    setBeforeModeSwitch(null)
    Object.defineProperty(window, 'location', {
      value: original,
      writable: true,
    })
  })
})
