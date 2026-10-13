import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { CraftLevel } from 'contract'
import { candidatesUrl } from '../api/client'
import { streamSse } from '../api/sse'
import {
  INITIAL_SESSION,
  sessionReducer,
  toStreamEvent,
  type CandidateSession,
  type CandidateSlot,
} from './candidateReducer'
import type { FlushResult } from './useWriteQueue'

export interface GenerateRequest {
  afterBeatId: string | null
  instruction?: string
  craftLevel?: CraftLevel
}

/**
 * Drives the 3-card generation session (`POST .../scenes/{sid}/candidates`)
 * through the shared SSE transport (api/sse.ts) and the pure `sessionReducer`
 * (candidateReducer.ts). This is the "explicit writer gesture" call site
 * (CLAUDE.md rule 8) — `generate` only ever runs from Next Beat / command-bar
 * submit, never on a timer or on mount.
 *
 * `beforeGenerate` (Write's autosave flush) runs first and is awaited
 * (`saving` is true meanwhile): the server must generate from the writer's
 * latest text, so a failed save (`false`) means no generation — the save
 * failure line says why. The request is built only *after* the flush, by
 * `buildRequest`, so its anchor (`afterBeatId`) reflects whatever the queue
 * just landed (an Accept, a refetch); Retry rebuilds it the same way.
 */
export function useCandidateSession(
  projectId: string,
  sceneId: string,
  beforeGenerate?: () => FlushResult,
) {
  const [session, dispatch] = useReducer(sessionReducer, INITIAL_SESSION)
  const [saving, setSaving] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const lastBuildRef = useRef<(() => GenerateRequest) | null>(null)

  const generate = useCallback(
    (buildRequest: () => GenerateRequest) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      lastBuildRef.current = buildRequest
      void (async () => {
        const flushed = beforeGenerate?.()
        if (flushed) {
          setSaving(true)
          const ok = await flushed
          setSaving(false)
          if (!ok) return
        }
        if (controller.signal.aborted) return
        const request = buildRequest()
        dispatch({ type: 'start' })
        let sawDone = false
        try {
          const frames = streamSse(
            candidatesUrl(projectId, sceneId),
            {
              afterBeatId: request.afterBeatId,
              instruction: request.instruction,
              craftLevel: request.craftLevel,
            },
            controller.signal,
          )
          for await (const raw of frames) {
            const event = toStreamEvent(raw)
            if (!event) continue
            if (event.type === 'done') sawDone = true
            dispatch(event)
          }
          // Clean EOF without a terminal `done` (partial SSE body) — same
          // Retry surface as a thrown mid-stream drop; never auto-regenerate
          // (CLAUDE.md rule 8).
          if (!controller.signal.aborted && !sawDone) {
            dispatch({
              type: 'connection_error',
              message: 'connection lost',
            })
          }
        } catch (err) {
          if (controller.signal.aborted) return
          dispatch({
            type: 'connection_error',
            message: err instanceof Error ? err.message : 'connection lost',
          })
        }
      })()
    },
    [projectId, sceneId, beforeGenerate],
  )

  const retry = useCallback(() => {
    if (lastBuildRef.current) generate(lastBuildRef.current)
  }, [generate])

  const skip = useCallback(
    (index: number) => dispatch({ type: 'skip', index }),
    [],
  )

  const replaceSlot = useCallback(
    (index: number, slot: CandidateSlot) =>
      dispatch({ type: 'replaceSlot', index, slot }),
    [],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: 'reset' })
  }, [])

  // Abort any in-flight stream on unmount (scene switch, navigation) so a
  // stale response can't dispatch into an unmounted session.
  useEffect(() => () => abortRef.current?.abort(), [])

  return { session, saving, generate, retry, skip, replaceSlot, reset }
}

export type { CandidateSession }
