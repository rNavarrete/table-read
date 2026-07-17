// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { pickTopIntersectingSceneId } from './scrollSpy'

function entry(
  sceneId: string,
  opts: { intersecting: boolean; top: number },
): IntersectionObserverEntry {
  const target = document.createElement('section')
  target.dataset.sceneId = sceneId
  return {
    target,
    isIntersecting: opts.intersecting,
    boundingClientRect: { top: opts.top } as DOMRectReadOnly,
    intersectionRatio: opts.intersecting ? 0.5 : 0,
    time: 0,
    rootBounds: null,
    intersectionRect: {} as DOMRectReadOnly,
  }
}

describe('pickTopIntersectingSceneId', () => {
  it('picks the topmost intersecting section', () => {
    const id = pickTopIntersectingSceneId([
      entry('scene-1', { intersecting: true, top: 200 }),
      entry('scene-2', { intersecting: true, top: 40 }),
      entry('scene-3', { intersecting: false, top: 400 }),
    ])
    expect(id).toBe('scene-2')
  })

  it('uses accumulated state so a leave-only callback still sees other scenes', () => {
    const byTarget = new Map<Element, IntersectionObserverEntry>()
    const a = entry('scene-4', { intersecting: true, top: 20 })
    const b = entry('scene-5', { intersecting: true, top: 120 })
    byTarget.set(a.target, a)
    byTarget.set(b.target, b)

    // Only scene-4 leaves in this callback — classic IO pitfall without a map.
    const leave = entry('scene-4', { intersecting: false, top: -80 })
    // Same target element as `a`
    leave.target = a.target
    byTarget.set(leave.target, leave)

    expect(pickTopIntersectingSceneId(byTarget.values())).toBe('scene-5')
  })

  it('returns null when nothing intersects', () => {
    expect(
      pickTopIntersectingSceneId([
        entry('scene-1', { intersecting: false, top: -10 }),
      ]),
    ).toBeNull()
  })
})
