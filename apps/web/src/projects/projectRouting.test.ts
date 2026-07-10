// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireProjectId } from './projectRouting'

const originalLocation = window.location

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    writable: true,
  })
  vi.restoreAllMocks()
})

describe('project routing', () => {
  it('redirects mode routes without a project id to /projects', () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        search: '?scene=scene-3',
        assign,
      },
      writable: true,
    })

    expect(requireProjectId()).toBeNull()
    expect(assign).toHaveBeenCalledWith('/projects')
  })

  it('returns the project id when the mode route is scoped', () => {
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        search: '?project=proj-longpour&scene=scene-3',
      },
      writable: true,
    })

    expect(requireProjectId()).toBe('proj-longpour')
  })
})
