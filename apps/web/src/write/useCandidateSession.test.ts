// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCandidateSession } from './useCandidateSession'

vi.mock('../api/client', () => ({ candidatesUrl: () => '/candidates' }))
vi.mock('../api/sse', () => ({
  // eslint-disable-next-line require-yield
  streamSse: vi.fn(async function* () {
    return
  }),
}))

import { streamSse } from '../api/sse'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function heldFlush() {
  let release!: (ok: boolean) => void
  const flush = vi.fn(
    () => new Promise<boolean>((resolve) => (release = resolve)),
  )
  return { flush, release: (ok: boolean) => release(ok) }
}

describe('useCandidateSession generate (Next Beat / command bar)', () => {
  it('waits for the autosave flush ("Saving…") and builds the request after it', async () => {
    const { flush, release } = heldFlush()
    let anchor = 'beat-1'
    const build = vi.fn(() => ({ afterBeatId: anchor }))
    const { result } = renderHook(() =>
      useCandidateSession('proj-1', 'scene-1', flush),
    )

    act(() => result.current.generate(build))
    expect(flush).toHaveBeenCalledOnce()
    await act(() => Promise.resolve())
    expect(result.current.saving).toBe(true)
    expect(build).not.toHaveBeenCalled()
    expect(streamSse).not.toHaveBeenCalled()
    expect(result.current.session.phase).toBe('idle')

    anchor = 'beat-2' // e.g. a queued Accept landed during the flush
    await act(async () => release(true))
    expect(result.current.saving).toBe(false)
    expect(build).toHaveBeenCalledOnce()
    expect(vi.mocked(streamSse).mock.calls[0][1]).toMatchObject({
      afterBeatId: 'beat-2',
    })
  })

  it('does not generate when the save fails', async () => {
    const flush = vi.fn(() => Promise.resolve(false))
    const build = vi.fn(() => ({ afterBeatId: null }))
    const { result } = renderHook(() =>
      useCandidateSession('proj-1', 'scene-1', flush),
    )

    await act(async () => result.current.generate(build))
    expect(flush).toHaveBeenCalledOnce()
    expect(build).not.toHaveBeenCalled()
    expect(streamSse).not.toHaveBeenCalled()
    expect(result.current.session.phase).toBe('idle')
  })

  it('Retry rebuilds the request (fresh anchor), and an idle queue skips the wait', async () => {
    const flush = vi.fn(() => null)
    let anchor = 'beat-1'
    const build = vi.fn(() => ({ afterBeatId: anchor }))
    const { result } = renderHook(() =>
      useCandidateSession('proj-1', 'scene-1', flush),
    )

    await act(async () => result.current.generate(build))
    anchor = 'beat-3'
    await act(async () => result.current.retry())
    expect(build).toHaveBeenCalledTimes(2)
    expect(vi.mocked(streamSse).mock.calls[1][1]).toMatchObject({
      afterBeatId: 'beat-3',
    })
    expect(result.current.saving).toBe(false)
  })
})
