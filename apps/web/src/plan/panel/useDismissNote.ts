import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ConsistencyFlag, Project } from 'contract'
import {
  dismissConsistencyFlag,
  getConsistencyFlags,
  getProject,
  undoProject,
} from '../../api/client'
import { ApiError } from '../../api/errors'
import { staleHeadMessage } from '../../shell/toastCopy'

const REFRESH_FAILED =
  "Note dismissed, but Plan couldn't refresh. Reload to keep editing."
const UNDO_STALE =
  "Can't undo the dismiss — Plan changed since. Use Undo in the top bar."

function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_HEAD')
    return staleHeadMessage
  return err instanceof Error ? err.message : 'Something went wrong'
}

/** Dismiss a note, with Undo. Not optimistic: `busy` covers the round trip
 * and PlanScreen folds it into `pending`, so no other write overlaps. */
export function useDismissNote({
  projectId,
  headSnapshotId,
  onProject,
  onFlags,
}: {
  projectId: string
  headSnapshotId: string | null
  onProject: (project: Project) => void
  onFlags: Dispatch<SetStateAction<ConsistencyFlag[]>>
}) {
  const [busy, setBusy] = useState(false)
  // The head the dismiss left behind; set = "Undo" is on offer.
  const [headAfter, setHeadAfter] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function dismiss(flagId: string) {
    setBusy(true)
    setError(null)
    setHeadAfter(null)
    try {
      await dismissConsistencyFlag(flagId, {
        expectedHeadSnapshotId: headSnapshotId,
      })
    } catch (err) {
      setError(messageFor(err))
      setBusy(false)
      return
    }
    // Committed: the note goes now, whatever the refetch below does.
    onFlags((prev) => prev.filter((f) => f.id !== flagId))
    try {
      // The dismiss made a snapshot and moved the head but returns only the
      // flag: refetch, or the next field save 409s on a stale If-Match.
      const [next, flags] = await Promise.all([
        getProject(projectId),
        getConsistencyFlags(projectId, 'open'),
      ])
      onProject(next)
      onFlags(flags)
      setHeadAfter(next.headSnapshotId)
    } catch {
      // Plan still holds the old head: every later write would 409.
      setError(REFRESH_FAILED)
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!headAfter) return
    setBusy(true)
    setError(null)
    try {
      // If-Match = the head the dismiss left: after any later edit this
      // fails safely instead of undoing that edit.
      const restored = await undoProject(projectId, {
        expectedHeadSnapshotId: headAfter,
      })
      onProject(restored)
      onFlags(await getConsistencyFlags(projectId, 'open'))
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CONFLICT_STALE_HEAD'
          ? UNDO_STALE
          : messageFor(err),
      )
    } finally {
      setHeadAfter(null)
      setBusy(false)
    }
  }

  return {
    busy,
    undoable: headAfter !== null,
    error,
    dismiss,
    undo,
    clearUndo: () => setHeadAfter(null),
    clearError: () => setError(null),
  }
}
