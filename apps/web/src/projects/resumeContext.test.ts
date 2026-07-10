// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { loadResume, saveResume } from './resumeContext'

afterEach(() => {
  localStorage.clear()
})

describe('resume context', () => {
  it('saves last mode and scene under a project-versioned localStorage key', () => {
    saveResume('proj-longpour', { mode: 'Write', sceneId: 'scene-3' })

    expect(localStorage.getItem('tr.resume.v1.proj-longpour')).toBe(
      '{"mode":"Write","sceneId":"scene-3"}',
    )
    expect(loadResume('proj-longpour', ['scene-1', 'scene-3'])).toEqual({
      mode: 'Write',
      sceneId: 'scene-3',
    })
  })

  it('falls back to the first scene when the stored scene is stale', () => {
    localStorage.setItem(
      'tr.resume.v1.proj-longpour',
      JSON.stringify({ mode: 'Write', sceneId: 'scene-missing' }),
    )

    expect(loadResume('proj-longpour', ['scene-1', 'scene-2'])).toEqual({
      mode: 'Write',
      sceneId: 'scene-1',
    })
  })

  it('falls back to Write when the stored mode is unavailable', () => {
    localStorage.setItem(
      'tr.resume.v1.proj-longpour',
      JSON.stringify({ mode: 'Draft', sceneId: 'scene-2' }),
    )

    expect(loadResume('proj-longpour', ['scene-1', 'scene-2'])).toEqual({
      mode: 'Write',
      sceneId: 'scene-2',
    })
  })
})
