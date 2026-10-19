// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { BeatCandidate } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTuneSession } from './useTuneSession'

vi.mock('../api/client', () => ({ tuneUrl: () => '/tune' }))
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

const candidate = { scriptText: 'x' } as unknown as BeatCandidate

describe('useTuneSession tune', () => {
  it('waits for the autosave flush ("Saving…") before tuning', async () => {
    let release!: (ok: boolean) => void
    const flush = vi.fn(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    )
    const { result } = renderHook(() =>
      useTuneSession('proj-1', 'scene-1', flush),
    )

    act(() => result.current.tune(candidate, 'shorter'))
    expect(flush).toHaveBeenCalledOnce()
    await act(() => Promise.resolve())
    expect(result.current.saving).toBe(true)
    expect(streamSse).not.toHaveBeenCalled()
    expect(result.current.session.phase).toBe('idle')

    await act(async () => release(true))
    expect(result.current.saving).toBe(false)
    expect(streamSse).toHaveBeenCalledOnce()
  })

  it('does not tune when the save fails', async () => {
    const flush = vi.fn(() => Promise.resolve(false))
    const { result } = renderHook(() =>
      useTuneSession('proj-1', 'scene-1', flush),
    )

    await act(async () => result.current.tune(candidate, 'shorter'))
    expect(flush).toHaveBeenCalledOnce()
    expect(streamSse).not.toHaveBeenCalled()
    expect(result.current.session.phase).toBe('idle')
  })
})
