import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from 'contract'
import { getProject, patchProject } from '../api/client'
import { ApiError } from '../api/errors'
import { buildBeatPatch, findScene } from '../plan/planTree'
import { setBeforeModeSwitch } from '../shell/modeNavigation'

export const SAVE_DEBOUNCE_MS = 1000

export type WriteQueueRun = <T>(op: (head: Project) => Promise<T>) => Promise<T>

interface PendingEdit {
  sceneId: string
  text: string
}

/**
 * Write mode's project state plus its ONE serial mutation queue (UI spec §4
 * "Saving"). Every Write mutation that compare-and-swaps on the head —
 * autosave, Accept, the craft-level default — goes through `run`, which
 * starts each operation only after the previous one settles and hands it the
 * latest head *at execution time*. Two CAS writes can never race, so neither
 * can fail `CONFLICT_STALE_HEAD` against the other and roll back to the wrong
 * version.
 *
 * Autosave: `editBeat` records a beat's typed text (latest wins per beat) and
 * saves it through `PATCH /projects/{pid}` (the same path Plan's inspector
 * uses) ~1 s after typing stops. `flush` saves immediately and resolves
 * `false` if any edit is still unsaved — callers gate generation and Undo on
 * it. A stale head refetches the project and retries that edit once; any
 * other failure keeps the edit pending and sets `saveFailed`. The editor
 * never loses the text: it lives in the beat row, not here.
 */
export function useWriteQueue(projectId: string) {
  const [project, setProjectState] = useState<Project | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
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

  const sync = useCallback(() => {
    setDirty(pendingRef.current.size > 0 || depthRef.current > 0)
    setSaveFailed(failedRef.current.size > 0)
  }, [])

  const run = useCallback<WriteQueueRun>(
    (op) => {
      depthRef.current += 1
      sync()
      const result = tailRef.current.then(() => op(headRef.current as Project))
      tailRef.current = result
        .catch(() => {})
        .then(() => {
          depthRef.current -= 1
          sync()
        })
      return result
    },
    [sync],
  )

  const saveBeat = useCallback(
    async (beatId: string, head: Project) => {
      queuedRef.current.delete(beatId)
      const edit = pendingRef.current.get(beatId)
      if (!edit) return
      pendingRef.current.delete(beatId)

      const attempt = async (base: Project) => {
        const saved = findScene(base, edit.sceneId)?.beats.find(
          (b) => b.id === beatId,
        )
        if (saved?.scriptText === edit.text) return
        const ops = buildBeatPatch(
          base,
          edit.sceneId,
          beatId,
          'scriptText',
          edit.text,
        )
        if (!ops) throw new Error('beat not found')
        const result = await patchProject(projectId, ops, {
          expectedHeadSnapshotId: base.headSnapshotId,
        })
        setProject(result.project)
      }

      try {
        try {
          await attempt(head)
        } catch (err) {
          if (!(err instanceof ApiError && err.code === 'CONFLICT_STALE_HEAD'))
            throw err
          const fresh = await getProject(projectId)
          setProject(fresh)
          await attempt(fresh)
        }
        failedRef.current.delete(beatId)
      } catch {
        if (!pendingRef.current.has(beatId))
          pendingRef.current.set(beatId, edit)
        failedRef.current.add(beatId)
      }
    },
    [projectId, setProject],
  )

  const flush = useCallback(async () => {
    window.clearTimeout(timerRef.current)
    for (const beatId of pendingRef.current.keys()) {
      if (queuedRef.current.has(beatId)) continue // coalesce: reads latest text
      queuedRef.current.add(beatId)
      void run((head) => saveBeat(beatId, head))
    }
    await tailRef.current
    return failedRef.current.size === 0
  }, [run, saveBeat])

  const editBeat = useCallback(
    (sceneId: string, beatId: string, text: string) => {
      pendingRef.current.set(beatId, { sceneId, text })
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
      sync()
    },
    [flush, sync],
  )

  // Unmount (and every mode switch, which is a full navigation) flushes.
  useEffect(() => {
    setBeforeModeSwitch(flush)
    return () => {
      setBeforeModeSwitch(null)
      void flush()
    }
  }, [flush])

  // Native prompt only while an edit is unsaved or a mutation is in flight.
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = '' // legacy Chrome needs it set
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  return { project, setProject, run, editBeat, flush, saveFailed }
}
