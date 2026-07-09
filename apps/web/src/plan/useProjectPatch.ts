import { useCallback, useState } from 'react'
import type { Project } from 'contract'
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
 * `project`/`setProject` are owned by the caller (plan/PlanScreen.tsx), same
 * "server is source of truth" convention as useAcceptBeat: the value that
 * survives is whichever one the server returns, never the optimistic guess.
 */
export function useProjectPatch(
  projectId: string,
  project: Project | null,
  setProject: (project: Project) => void,
) {
  const [error, setError] = useState<PatchErrorState | null>(null)
  const [pending, setPending] = useState(false)

  const patch = useCallback(
    async (ops: JsonPatchOp[], optimisticNext: Project): Promise<boolean> => {
      if (!project) return false
      const before = project
      setError(null)
      setPending(true)
      setProject(optimisticNext)

      try {
        const next = await patchProject(projectId, ops)
        setProject(next)
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
      }
    },
    [project, projectId, setProject],
  )

  const dismissError = useCallback(() => setError(null), [])

  return { patch, pending, error, dismissError }
}
