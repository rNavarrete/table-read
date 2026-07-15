// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { navigateToWriteScene } from './modeNavigation'

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
