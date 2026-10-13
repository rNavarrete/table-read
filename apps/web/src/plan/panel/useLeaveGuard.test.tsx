// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WithDrafts } from './testDrafts'
import { useLeaveGuard } from './useLeaveGuard'
import { usePlanDrafts } from './usePlanDrafts'

const { setLeaveGuardMock } = vi.hoisted(() => ({
  setLeaveGuardMock: vi.fn(),
}))
vi.mock('../../shell/modeNavigation', () => ({
  setLeaveGuard: setLeaveGuardMock,
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const KEY = 'scene-2:audienceLearns'

function setup() {
  return renderHook(
    () => {
      const drafts = usePlanDrafts()
      return { drafts, ...useLeaveGuard(drafts) }
    },
    { wrapper: WithDrafts },
  )
}

function unloadPrevented(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useLeaveGuard', () => {
  it('with no drafts, leaving is allowed at once and nothing is armed', async () => {
    const { result } = setup()
    await expect(result.current.confirmLeave()).resolves.toBe(true)
    expect(result.current.dialog.open).toBe(false)
    expect(unloadPrevented()).toBe(false)
  })

  it('with a draft, the dialog opens; Stay answers no and keeps the draft', async () => {
    const { result } = setup()
    act(() => result.current.drafts.set(KEY, 'scene-2', 'Dan has a key.'))
    expect(unloadPrevented()).toBe(true)

    let leaving!: Promise<boolean>
    act(() => {
      leaving = result.current.confirmLeave()
    })
    expect(result.current.dialog).toMatchObject({ open: true, draftCount: 1 })

    act(() => result.current.dialog.onStay())
    await expect(leaving).resolves.toBe(false)
    expect(result.current.dialog.open).toBe(false)
    expect(result.current.drafts.get(KEY)).toBe('Dan has a key.')
  })

  it('Discard and leave clears every draft before answering yes, so beforeunload stays quiet', async () => {
    const { result } = setup()
    act(() => {
      result.current.drafts.set(KEY, 'scene-2', 'Dan has a key.')
      result.current.drafts.set('ep-1:premise', null, 'A bar on the edge.')
    })

    let leaving!: Promise<{ ok: boolean; size: number; prevented: boolean }>
    act(() => {
      leaving = result.current.confirmLeave().then((ok) => ({
        ok,
        size: result.current.drafts.size,
        prevented: unloadPrevented(),
      }))
    })
    act(() => result.current.dialog.onDiscard())
    await expect(leaving).resolves.toEqual({
      ok: true,
      size: 0,
      prevented: false,
    })
  })

  it('is the navigation guard while mounted, and stops being one on unmount', async () => {
    const { result, unmount } = setup()
    const guard = setLeaveGuardMock.mock.lastCall?.[0] as () => Promise<boolean>
    await expect(guard()).resolves.toBe(true)

    act(() => result.current.drafts.set(KEY, 'scene-2', 'Dan has a key.'))
    const latest = setLeaveGuardMock.mock
      .lastCall?.[0] as () => Promise<boolean>
    act(() => {
      void latest()
    })
    expect(result.current.dialog.open).toBe(true)

    unmount()
    expect(setLeaveGuardMock).toHaveBeenLastCalledWith(null)
  })
})
