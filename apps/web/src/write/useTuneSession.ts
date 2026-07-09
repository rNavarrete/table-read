import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { BeatCandidate } from 'contract'
import { tuneUrl } from '../api/client'
import { streamSse } from '../api/sse'
import {
  INITIAL_TUNE_SESSION,
  toStreamEvent,
  tuneReducer,
  type TuneSession,
} from './candidateReducer'

/**
 * Drives the 1-card tune session (`POST .../candidates/tune`) — the same SSE
 * transport and slot machine as `useCandidateSession`, scoped to one card
 * (obligation: "SSE client as a hook/module reusable by tune"). Each
 * `CandidateCard` owns one instance; on settle, the card pushes the result
 * back into the parent session via `sessionReducer`'s `replaceSlot`.
 */
export function useTuneSession(projectId: string, sceneId: string) {
  const [session, dispatch] = useReducer(tuneReducer, INITIAL_TUNE_SESSION)
  const abortRef = useRef<AbortController | null>(null)

  const tune = useCallback(
    (candidate: BeatCandidate, instruction: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      dispatch({ type: 'start' })
      void (async () => {
        try {
          const frames = streamSse(
            tuneUrl(projectId, sceneId),
            { candidate, instruction },
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

  const reset = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: 'reset' })
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { session, tune, reset }
}

export type { TuneSession }
