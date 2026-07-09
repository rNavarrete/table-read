import { useCallback, useState } from 'react'
import type { Beat, BeatCandidate, Project } from 'contract'
import { acceptBeat, type AcceptResponse } from '../api/client'
import { ApiError } from '../api/errors'
import { findScene, spliceBeat, withSceneBeats } from './projectTree'

// A beat id no server ever mints (CLAUDE.md: server assigns ids; clients
// never mint them) — this one is purely a client-local placeholder, replaced
// wholesale by the server's response before anything else can observe it.
const OPTIMISTIC_BEAT_ID = 'optimistic-pending-accept'

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
 * `project`/`setProject` are owned by the caller (write/WriteScreen.tsx) —
 * this hook never fetches; it only computes the optimistic/rollback doc and
 * lets the caller hold it as state, consistent with "server is source of
 * truth" (CLAUDE.md conventions): the only value that survives is the one
 * that came back from the server.
 */
export function useAcceptBeat(
  projectId: string,
  sceneId: string,
  project: Project | null,
  setProject: (project: Project) => void,
) {
  const [acceptingIndex, setAcceptingIndex] = useState<number | null>(null)
  const [errorByIndex, setErrorByIndex] = useState<
    Record<number, AcceptErrorState>
  >({})

  const accept = useCallback(
    async (
      index: number,
      candidate: BeatCandidate,
      afterBeatId: string | null,
    ): Promise<AcceptResponse | null> => {
      if (!project) return null
      const scene = findScene(project, sceneId)
      if (!scene) return null

      const before = project
      const optimisticBeat: Beat = {
        id: OPTIMISTIC_BEAT_ID,
        index: 0,
        locked: false,
        scriptLocked: false,
        whatHappens: candidate.beatPlan.whatHappens,
        audienceLearns: candidate.beatPlan.audienceLearns,
        audienceFeels: candidate.beatPlan.audienceFeels,
        scriptText: candidate.scriptText,
      }
      setAcceptingIndex(index)
      setErrorByIndex((prev) => withoutIndex(prev, index))
      setProject(
        withSceneBeats(
          project,
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
    },
    [project, projectId, sceneId, setProject],
  )

  const dismissError = useCallback((index: number) => {
    setErrorByIndex((prev) => withoutIndex(prev, index))
  }, [])

  return { accept, acceptingIndex, errorByIndex, dismissError }
}
