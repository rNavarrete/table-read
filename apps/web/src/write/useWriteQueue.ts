import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from 'contract'
import { getProject, patchProject } from '../api/client'
import { ApiError } from '../api/errors'
import { buildBeatPatch, findScene } from '../plan/planTree'
import { setBeforeModeSwitch } from '../shell/modeNavigation'

export const SAVE_DEBOUNCE_MS = 1000

export type WriteQueueRun = <T>(op: (head: Project) => Promise<T>) => Promise<T>

/** `null` when nothing is pending or in flight — callers can skip waiting. */
export type FlushResult = Promise<boolean> | null

interface PendingEdit {
  sceneId: string
  text: string
}

// Saves that can never succeed: the edit is dropped (the text stays in the
// row) and the writer gets one specific notice instead of an endless Retry.
const UNSAVEABLE = {
  locked: "Couldn't save: this beat is locked.",
  removed: "Couldn't save: this beat was removed.",
  changed: "Couldn't save: this beat changed in another window.",
}

class UnsaveableEdit extends Error {
  readonly reason: keyof typeof UNSAVEABLE
  constructor(reason: keyof typeof UNSAVEABLE) {
    super(reason)
    this.reason = reason
  }
}

function isApiCode(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.code === code
}

/**
 * Write mode's project state plus its ONE serial mutation queue (UI spec §4
 * "Saving"). Every Write mutation that moves the head — autosave, Accept, the
 * craft-level default, Undo/restore — goes through `run`, which starts each
 * operation only after the previous one settles and hands it the latest head
 * *at execution time*, so two CAS writes never race into
 * `CONFLICT_STALE_HEAD`.
 *
 * Autosave: `editBeat` records a beat's typed text (latest wins per beat) and
 * saves it through `PATCH /projects/{pid}` (the path Plan's inspector uses)
 * ~1 s after typing stops. `flush` saves now and resolves `false` while a
 * retryable failure (network, 5xx) is outstanding — callers gate generation
 * on it. A stale head refetches and retries once, unless the beat's text
 * changed in the refetch (another window's edit wins). Locked / removed /
 * changed beats can never save: the edit is dropped and `notice` says why.
 * The text itself lives in the beat row and is never cleared from here.
 */
export function useWriteQueue(projectId: string) {
  const [project, setProjectState] = useState<Project | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const headRef = useRef<Project | null>(null)
  const tailRef = useRef<Promise<unknown>>(Promise.resolve())
  const depthRef = useRef(0)
  const pendingRef = useRef(new Map<string, PendingEdit>())
  const queuedRef = useRef(new Set<string>())
  const failedRef = useRef(new Set<string>())
  const timerRef = useRef<number | undefined>(undefined)

  const setProject = useCallback((next: Project) => {
    headRef.current = next
    setProjectState(next)
  }, [])

  const getHead = useCallback(() => headRef.current, [])

  const run = useCallback<WriteQueueRun>((op) => {
    depthRef.current += 1
    // `finally` settles before the caller's await resumes, so a caller that
    // reloads right after (Undo) never trips the beforeunload check.
    const result = tailRef.current
      .then(() => op(headRef.current as Project))
      .finally(() => {
        depthRef.current -= 1
      })
    tailRef.current = result.catch(() => {})
    return result
  }, [])

  const saveBeat = useCallback(
    async (beatId: string, head: Project) => {
      queuedRef.current.delete(beatId)
      const edit = pendingRef.current.get(beatId)
      if (!edit) return
      pendingRef.current.delete(beatId)
      const textIn = (p: Project) =>
        findScene(p, edit.sceneId)?.beats.find((b) => b.id === beatId)
          ?.scriptText

      const attempt = async (base: Project) => {
        const ops = buildBeatPatch(
          base,
          edit.sceneId,
          beatId,
          'scriptText',
          edit.text,
        )
        if (!ops) throw new UnsaveableEdit('removed')
        if (textIn(base) === edit.text) return
        const result = await patchProject(projectId, ops, {
          expectedHeadSnapshotId: base.headSnapshotId,
        })
        setProject(result.project)
      }

      try {
        try {
          await attempt(head)
        } catch (err) {
          if (!isApiCode(err, 'CONFLICT_STALE_HEAD')) throw err
          const fresh = await getProject(projectId)
          setProject(fresh)
          const now = textIn(fresh)
          if (now !== undefined && now !== textIn(head))
            throw new UnsaveableEdit('changed')
          await attempt(fresh)
        }
        failedRef.current.delete(beatId)
      } catch (err) {
        const reason =
          err instanceof UnsaveableEdit
            ? err.reason
            : isApiCode(err, 'LOCKED_OBJECT')
              ? 'locked'
              : null
        if (reason) {
          failedRef.current.delete(beatId) // dropped: never blocks the session
          setNotice(UNSAVEABLE[reason])
          // Locked elsewhere: pick up the lock so the row turns read-only.
          if (reason === 'locked')
            await getProject(projectId).then(setProject, () => {})
        } else {
          if (!pendingRef.current.has(beatId))
            pendingRef.current.set(beatId, edit)
          failedRef.current.add(beatId)
        }
      }
      setSaveFailed(failedRef.current.size > 0)
    },
    [projectId, setProject],
  )

  const flush = useCallback((): FlushResult => {
    window.clearTimeout(timerRef.current)
    if (pendingRef.current.size === 0 && depthRef.current === 0) return null
    for (const beatId of pendingRef.current.keys()) {
      if (queuedRef.current.has(beatId)) continue // coalesce: reads latest text
      queuedRef.current.add(beatId)
      void run((head) => saveBeat(beatId, head))
    }
    return tailRef.current.then(() => failedRef.current.size === 0)
  }, [run, saveBeat])

  /** Undo / history restore: save every pending edit and then run `action`
   * inside ONE queued op, so no save can land between the two. Resolves
   * `false` (action skipped) if a retryable save failure is outstanding. */
  const runAfterSaves = useCallback(
    (action: () => Promise<unknown>) => {
      window.clearTimeout(timerRef.current)
      return run(async () => {
        for (const beatId of [...pendingRef.current.keys()])
          await saveBeat(beatId, headRef.current as Project)
        if (failedRef.current.size > 0) return false
        await action()
        return true
      })
    },
    [run, saveBeat],
  )

  const editBeat = useCallback(
    (sceneId: string, beatId: string, text: string) => {
      pendingRef.current.set(beatId, { sceneId, text })
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  const dismissNotice = useCallback(() => setNotice(null), [])

  // Unmount (and every mode switch, which is a full navigation) flushes.
  useEffect(() => {
    setBeforeModeSwitch(flush)
    return () => {
      setBeforeModeSwitch(null)
      void flush()
    }
  }, [flush])

  // One listener for the hook's lifetime; it decides from refs, so it is
  // right the instant a save lands — no render needed to disarm it. Armed
  // while an edit is unsaved or any queued op (save, Accept, craft) runs.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (pendingRef.current.size === 0 && depthRef.current === 0) return
      event.preventDefault()
      event.returnValue = '' // legacy Chrome needs it set
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return {
    project,
    setProject,
    getHead,
    run,
    runAfterSaves,
    editBeat,
    flush,
    saveFailed,
    notice,
    dismissNotice,
  }
}
