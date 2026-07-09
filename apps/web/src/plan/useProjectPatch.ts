import { useCallback, useRef, useState } from 'react'
import type { ConsistencyFlag, Project } from 'contract'
import { patchProject, type JsonPatchOp } from '../api/client'
import { ApiError } from '../api/errors'

export interface PatchErrorState {
  code: string
  message: string
}

/**
 * The one optimistic-PATCH-with-rollback primitive Plan mode's mutations
 * share: drag reorder, the scene/beat lock toggles, and the inspector's
 * "Save field only" affordance are all, at bottom, "compute the next
 * `Project` locally, show it immediately, PATCH the ops that describe the
 * same change, and roll back to the exact pre-patch doc on a 4xx/5xx"
 * (brief obligation 5). Modeled on write/useAcceptBeat.ts's accept flow —
 * same shape, generalized past one specific mutation.
 *
 * **One mutation at a time.** A second `patch()` while one is in flight is
 * refused (returns false, sends nothing): the first one's failure path
 * restores the exact pre-patch doc, which would silently erase the second
 * one's optimistic change (and its `before` snapshot would predate the
 * first's outcome — either way, corruption). The UI entry points also
 * disable themselves on `pending` (LockToggle/save via `disabled`, drag
 * initiation via SceneCard's `draggable`), but `pending` is React state and
 * lags a render — this ref guard is the authoritative, same-tick check.
 *
 * `project`/`setProject` are owned by the caller (plan/PlanScreen.tsx), same
 * "server is source of truth" convention as useAcceptBeat: the value that
 * survives is whichever one the server returns, never the optimistic guess.
 *
 * Optional `onConsistencyFlags` receives any new flags a structural PATCH
 * returned (T4.4a amber badges). Silent (non-structural) edits pass `[]`.
 */
export function useProjectPatch(
  projectId: string,
  project: Project | null,
  setProject: (project: Project) => void,
  onConsistencyFlags?: (flags: ConsistencyFlag[]) => void,
) {
  const [error, setError] = useState<PatchErrorState | null>(null)
  const [pending, setPending] = useState(false)
  const inFlightRef = useRef(false)

  const patch = useCallback(
    async (ops: JsonPatchOp[], optimisticNext: Project): Promise<boolean> => {
      if (!project) return false
      if (inFlightRef.current) return false // concurrent-mutation guard
      inFlightRef.current = true
      const before = project
      setError(null)
      setPending(true)
      setProject(optimisticNext)

      try {
        // Polymorphic response (data contract §4): a structural-field edit
        // returns {project, consistencyFlags}; patchProject normalizes both to
        // PatchResult. We adopt the authoritative `project` and hand any new
        // flags to the caller for Plan amber badges (T4.4a).
        const { project: next, consistencyFlags } = await patchProject(
          projectId,
          ops,
          { expectedHeadSnapshotId: before.headSnapshotId },
        )
        setProject(next)
        onConsistencyFlags?.(consistencyFlags)
        setPending(false)
        return true
      } catch (err) {
        setProject(before) // rollback: byte-for-byte the pre-patch doc
        setPending(false)
        setError(
          err instanceof ApiError
            ? { code: err.code, message: err.message }
            : { code: 'UNKNOWN', message: 'save failed' },
        )
        return false
      } finally {
        inFlightRef.current = false
      }
    },
    [project, projectId, setProject, onConsistencyFlags],
  )

  const dismissError = useCallback(() => setError(null), [])

  return { patch, pending, error, dismissError }
}
