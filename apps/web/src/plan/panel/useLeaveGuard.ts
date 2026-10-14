import { useCallback, useEffect, useRef, useState } from 'react'
import { setLeaveGuard } from '../../shell/modeNavigation'
import type { LeavePlanDialogProps } from './LeavePlanDialog'
import type { PlanDrafts } from './usePlanDrafts'

/** Asks before Plan is left with drafts (redesign spec §4.9). Registers
 * `confirmLeave` as the navigation guard for mode tabs, ⌘1–4, Open in Write,
 * Ledger links and the project-title link, and arms `beforeunload` (tab
 * close, reload, browser back) only while a draft exists. Nothing inside
 * Plan is blocked. */
export function useLeaveGuard(drafts: PlanDrafts): {
  confirmLeave: () => Promise<boolean>
  /** The leave failed after "Discard and leave" (Open Review, Undo,
   * restore): put the drafts back, so nothing is discarded silently. */
  undoDiscard: () => void
  dialog: LeavePlanDialogProps
} {
  const [asking, setAsking] = useState(false)
  const answerRef = useRef<((ok: boolean) => void) | null>(null)
  const restoreRef = useRef<(() => void) | null>(null)

  const confirmLeave = useCallback((): Promise<boolean> => {
    if (drafts.size === 0) return Promise.resolve(true)
    // A second leave while asking (⌘1 over the shell Undo) takes the
    // dialog over; the first is answered "stay", so it never hangs.
    answerRef.current?.(false)
    return new Promise<boolean>((resolve) => {
      answerRef.current = resolve
      setAsking(true)
    })
  }, [drafts])

  function finish(ok: boolean) {
    // Clear before resolving: the navigation that follows must not trip
    // beforeunload as well.
    restoreRef.current = ok ? drafts.clearAll() : null
    answerRef.current?.(ok)
    answerRef.current = null
    setAsking(false)
  }

  // A save in flight can land while asking: with nothing left unsaved the
  // dialog closes, and the effect below lets the waiting leave go through
  // (it never unloads mid-save).
  if (asking && drafts.size === 0) setAsking(false)
  useEffect(() => {
    // finish() answers before it closes; only that close leaves an answer.
    if (asking || !answerRef.current) return
    answerRef.current(true)
    answerRef.current = null
    restoreRef.current = null
  }, [asking])

  useEffect(() => {
    setLeaveGuard(confirmLeave)
    return () => setLeaveGuard(null)
  }, [confirmLeave])

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (drafts.size === 0) return
      event.preventDefault()
      event.returnValue = '' // legacy Chrome needs it set
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [drafts])

  const undoDiscard = useCallback(() => {
    restoreRef.current?.()
    restoreRef.current = null
  }, [])

  return {
    confirmLeave,
    undoDiscard,
    dialog: {
      open: asking,
      draftCount: drafts.size,
      onStay: () => finish(false),
      onDiscard: () => finish(true),
    },
  }
}
