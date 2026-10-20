import { useCallback, useRef, useState } from 'react'
import type { Beat, BeatCandidate, Project } from 'contract'
import { acceptBeat, getProject, type AcceptResponse } from '../api/client'
import { ApiError } from '../api/errors'
import {
  findScene,
  OPTIMISTIC_BEAT_ID,
  spliceBeat,
  withSceneBeats,
} from './projectTree'
import type { WriteQueueRun } from './useWriteQueue'

export interface AcceptErrorState {
  code: string
  message: string
}

function withoutIndex<T>(
  record: Record<number, T>,
  index: number,
): Record<number, T> {
  const next = { ...record }
  delete next[index]
  return next
}

/**
 * Drives the accept action (`POST .../scenes/{sid}/beats`, data contract §4)
 * with an optimistic script-canvas update: the candidate's beat appears in
 * the scene immediately, then is overwritten by the server's authoritative
 * `project` on success. On a 4xx/5xx, the optimistic beat is rolled back —
 * the scene reverts byte-for-byte to what it was before the click — and the
 * error is reported for the *specific card* that failed (obligation 7 / the
 * UI spec §3 Error state: a dock card with a danger border, not a full-dock
 * wipe, since the other two cards are unaffected and still actionable).
 *
 * The accept runs on Write's one mutation queue (`run`, write/useWriteQueue.ts):
 * it waits for any in-flight autosave and CAS-es on the head current *when it
 * runs*, so it can't race a save into `CONFLICT_STALE_HEAD` and roll back to
 * a stale doc. The queue owns `setProject`; the only value that survives is
 * the one that came back from the server.
 *
 * One accept at a time: a second call while one is in flight (double click,
 * key repeat, another card) returns `null` and touches nothing. A
 * `CONFLICT_STALE_HEAD` (the head moved outside Write's queue, e.g. Settings)
 * refetches the head so the writer's manual retry can succeed — never an
 * automatic re-accept.
 */
export function useAcceptBeat(
  projectId: string,
  sceneId: string,
  run: WriteQueueRun,
  setProject: (project: Project) => void,
) {
  const [acceptingIndex, setAcceptingIndex] = useState<number | null>(null)
  const [errorByIndex, setErrorByIndex] = useState<
    Record<number, AcceptErrorState>
  >({})
  const inFlightRef = useRef(false)

  const accept = useCallback(
    (
      index: number,
      candidate: BeatCandidate,
      afterBeatId: string | null,
    ): Promise<AcceptResponse | null> => {
      if (inFlightRef.current) return Promise.resolve(null)
      inFlightRef.current = true
      setAcceptingIndex(index)
      setErrorByIndex((prev) => withoutIndex(prev, index))
      return run(async (before) => {
        const scene = findScene(before, sceneId)
        if (!scene) {
          setAcceptingIndex(null)
          return null
        }

        const optimisticBeat: Beat = {
          id: OPTIMISTIC_BEAT_ID,
          index: 0,
          locked: false,
          scriptLocked: false,
          actorCharacterId: null,
          actionVerb: '',
          targetCharacterId: null,
          reaction: '',
          whatHappens: candidate.beatPlan.whatHappens,
          audienceLearns: candidate.beatPlan.audienceLearns,
          audienceFeels: candidate.beatPlan.audienceFeels,
          scriptText: candidate.scriptText,
        }
        setProject(
          withSceneBeats(
            before,
            sceneId,
            spliceBeat(scene.beats, afterBeatId, optimisticBeat),
          ),
        )

        try {
          const response = await acceptBeat(
            projectId,
            sceneId,
            candidate,
            afterBeatId,
            { expectedHeadSnapshotId: before.headSnapshotId },
          )
          setProject(response.project)
          setAcceptingIndex(null)
          return response
        } catch (err) {
          setProject(before) // rollback: scene reverts to its pre-accept state
          if (err instanceof ApiError && err.code === 'CONFLICT_STALE_HEAD') {
            await getProject(projectId).then(setProject, () => {})
          }
          setAcceptingIndex(null)
          setErrorByIndex((prev) => ({
            ...prev,
            [index]:
              err instanceof ApiError
                ? { code: err.code, message: err.message }
                : { code: 'UNKNOWN', message: 'accept failed' },
          }))
          return null
        }
      }).finally(() => {
        inFlightRef.current = false
      })
    },
    [run, projectId, sceneId, setProject],
  )

  const dismissError = useCallback((index: number) => {
    setErrorByIndex((prev) => withoutIndex(prev, index))
  }, [])

  return { accept, acceptingIndex, errorByIndex, dismissError }
}
