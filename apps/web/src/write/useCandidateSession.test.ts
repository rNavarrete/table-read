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

describe('useCandidateSession generate (Next Beat / command bar)', () => {
  it('waits for the autosave flush before generating', async () => {
    let release!: (ok: boolean) => void
    const flush = vi.fn(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    )
    const { result } = renderHook(() =>
      useCandidateSession('proj-1', 'scene-1', flush),
    )

    act(() => result.current.generate({ afterBeatId: null }))
    expect(flush).toHaveBeenCalledOnce()
    await act(() => Promise.resolve())
    expect(streamSse).not.toHaveBeenCalled()
    expect(result.current.session.phase).toBe('idle')

    await act(async () => release(true))
    expect(streamSse).toHaveBeenCalledOnce()
  })

  it('does not generate when the save fails', async () => {
    const flush = vi.fn(() => Promise.resolve(false))
    const { result } = renderHook(() =>
      useCandidateSession('proj-1', 'scene-1', flush),
    )

    await act(async () => result.current.generate({ afterBeatId: null }))
    expect(flush).toHaveBeenCalledOnce()
    expect(streamSse).not.toHaveBeenCalled()
    expect(result.current.session.phase).toBe('idle')
  })
})
