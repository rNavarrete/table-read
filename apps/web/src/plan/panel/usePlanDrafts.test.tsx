// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WithDrafts } from './testDrafts'
import {
  draftKey,
  useFieldDraft,
  usePlanDraftStore,
  usePlanDrafts,
} from './usePlanDrafts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('draftKey', () => {
  it('joins the object id and the field', () => {
    expect(draftKey('scene-2', 'audienceLearns')).toBe('scene-2:audienceLearns')
    expect(draftKey('project', 'premise')).toBe('project:premise')
  })
})

describe('usePlanDraftStore', () => {
  it('sets, reads, clears one and clears all', () => {
    const { result } = renderHook(() => usePlanDraftStore())
    act(() => {
      result.current.set('scene-2:audienceLearns', 'scene-2', 'Dan has a key.')
      result.current.set('ep-1:premise', null, 'A bar on the edge.')
    })
    expect(result.current.get('scene-2:audienceLearns')).toBe('Dan has a key.')
    expect(result.current.size).toBe(2)

    act(() => result.current.clear('scene-2:audienceLearns'))
    expect(result.current.get('scene-2:audienceLearns')).toBeUndefined()
    expect(result.current.size).toBe(1)

    act(() => result.current.clearAll())
    expect(result.current.size).toBe(0)
  })

  it('size and get are current before React re-renders', () => {
    const { result } = renderHook(() => usePlanDraftStore())
    const drafts = result.current
    let sizeInHandler = -1
    act(() => {
      drafts.set('scene-3:time', 'scene-3', 'Dawn')
      sizeInHandler = drafts.size
    })
    expect(sizeInHandler).toBe(1)
    expect(drafts.get('scene-3:time')).toBe('Dawn')
  })

  it('publishes a new value per change; only scene fields mark a scene unsaved', () => {
    const { result } = renderHook(() => usePlanDraftStore())
    const first = result.current
    act(() => {
      result.current.set('scene-2:location', 'scene-2', 'INT. BACK ROOM')
      result.current.set('beat-2-1:whatHappens', 'scene-2', 'Dan counts.')
      result.current.set('project:premise', null, 'Two siblings, one bar.')
    })
    expect(result.current).not.toBe(first)
    expect([...result.current.dirtySceneIds]).toEqual(['scene-2'])
  })
})

describe('usePlanDrafts', () => {
  it('throws without a provider', () => {
    // React reports the render error to console and window 'error'; keep the run quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const quiet = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener('error', quiet)
    try {
      expect(() => renderHook(() => usePlanDrafts())).toThrow(
        'PlanDraftsContext missing',
      )
    } finally {
      window.removeEventListener('error', quiet)
    }
  })
})

describe('useFieldDraft', () => {
  function setup(value: string, key = 'scene-2:audienceLearns') {
    return renderHook(
      (props: { value: string; key: string }) => ({
        field: useFieldDraft(props.key, 'scene-2', props.value),
        drafts: usePlanDrafts(),
      }),
      { wrapper: WithDrafts, initialProps: { value, key } },
    )
  }

  it('shows the server value until edited; typing back to it is not unsaved', () => {
    const { result } = setup('The money is gone.')
    expect(result.current.field).toMatchObject({
      text: 'The money is gone.',
      dirty: false,
    })

    act(() => result.current.field.set('The money is in the basement.'))
    expect(result.current.field).toMatchObject({
      text: 'The money is in the basement.',
      dirty: true,
    })
    expect(result.current.drafts.dirtySceneIds.has('scene-2')).toBe(true)

    act(() => result.current.field.set('The money is gone.'))
    expect(result.current.field.dirty).toBe(false)
    expect(result.current.drafts.size).toBe(0)
  })

  it('keeps the typed text through a failed save (optimistic value, then rollback)', () => {
    const { result, rerender } = setup('Old')
    act(() => result.current.field.set('New'))

    rerender({ value: 'New', key: 'scene-2:audienceLearns' }) // optimistic setProject
    expect(result.current.field).toMatchObject({ text: 'New', dirty: false })

    rerender({ value: 'Old', key: 'scene-2:audienceLearns' }) // rollback on 409/5xx
    expect(result.current.field).toMatchObject({ text: 'New', dirty: true })
  })

  it('restores the draft when the panel comes back to the scene', () => {
    const { result, rerender } = setup('Old')
    act(() => result.current.field.set('New'))

    rerender({ value: 'Other', key: 'scene-3:audienceLearns' })
    expect(result.current.field).toMatchObject({ text: 'Other', dirty: false })

    rerender({ value: 'Old', key: 'scene-2:audienceLearns' })
    expect(result.current.field).toMatchObject({ text: 'New', dirty: true })
  })

  it('discard drops the draft and shows the server value', () => {
    const { result } = setup('Old')
    act(() => result.current.field.set('New'))
    act(() => result.current.field.discard())
    expect(result.current.field).toMatchObject({ text: 'Old', dirty: false })
    expect(result.current.drafts.size).toBe(0)
  })
})
