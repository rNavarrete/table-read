import { useState } from 'react'
import type { Project } from 'contract'
import { undoProject } from '../api/client'
import { ApiError } from '../api/errors'

export interface LastMove {
  /** OrderIssue ids the move added (may be empty). */
  issueIds: string[]
  /** The head snapshot the move created; null until the server accepts it. */
  head: string | null
}

export const UNDO_MOVE_STALE =
  "Can't undo the move — Plan changed since. Use Undo in the top bar."

/** The last board move, and Undo the move while its snapshot is the head.
 * Runs in place like the Dismiss Undo (panel/useDismissNote.ts). */
export function useUndoMove({
  projectId,
  headSnapshotId,
  onProject,
}: {
  projectId: string
  /** The project's current head. */
  headSnapshotId: string | null
  onProject: (project: Project) => void
}) {
  const [move, setMove] = useState<LastMove | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const undoable = move?.head != null && move.head === headSnapshotId

  async function undo(): Promise<boolean> {
    const head = move?.head
    if (!head || head !== headSnapshotId) return false
    setBusy(true)
    setError(null)
    try {
      // If-Match: after any later edit this fails safely instead of undoing it.
      // No flag refetch: a move isn't structural and the snapshot restores flags.
      onProject(await undoProject(projectId, { expectedHeadSnapshotId: head }))
      return true
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CONFLICT_STALE_HEAD'
          ? UNDO_MOVE_STALE
          : err instanceof Error
            ? err.message
            : 'Undo failed',
      )
      return false
    } finally {
      setMove(null)
      setBusy(false)
    }
  }

  return {
    move,
    setMove,
    undoable,
    undo,
    busy,
    error,
    clearError: () => setError(null),
  }
}
