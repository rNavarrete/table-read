import { useCallback, useEffect, useReducer, useRef } from 'react'
import { candidatesUrl } from '../api/client'
import { streamSse } from '../api/sse'
import {
  INITIAL_SESSION,
  sessionReducer,
  toStreamEvent,
  type CandidateSession,
  type CandidateSlot,
} from './candidateReducer'

export interface GenerateRequest {
  afterBeatId: string | null
  instruction?: string
}

/**
 * Drives the 3-card generation session (`POST .../scenes/{sid}/candidates`)
 * through the shared SSE transport (api/sse.ts) and the pure `sessionReducer`
 * (candidateReducer.ts). This is the "explicit writer gesture" call site
 * (CLAUDE.md rule 8) — `generate` only ever runs from Next Beat / command-bar
 * submit, never on a timer or on mount.
 */
export function useCandidateSession(projectId: string, sceneId: string) {
  const [session, dispatch] = useReducer(sessionReducer, INITIAL_SESSION)
  const abortRef = useRef<AbortController | null>(null)
  const lastRequestRef = useRef<GenerateRequest | null>(null)

  const generate = useCallback(
    (request: GenerateRequest) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      lastRequestRef.current = request
      dispatch({ type: 'start' })
      void (async () => {
        try {
          const frames = streamSse(
            candidatesUrl(projectId, sceneId),
            {
              afterBeatId: request.afterBeatId,
              instruction: request.instruction,
            },
            controller.signal,
          )
          for await (const raw of frames) {
            const event = toStreamEvent(raw)
            if (event) dispatch(event)
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
    [projectId, sceneId],
  )

  const retry = useCallback(() => {
    if (lastRequestRef.current) generate(lastRequestRef.current)
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

  return { session, generate, retry, skip, replaceSlot, reset }
}

export type { CandidateSession }
