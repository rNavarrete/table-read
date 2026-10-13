import { useCallback, useEffect, useState } from 'react'
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
  dialog: LeavePlanDialogProps
} {
  const [answer, setAnswer] = useState<((ok: boolean) => void) | null>(null)

  const confirmLeave = useCallback((): Promise<boolean> => {
    if (drafts.size === 0) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => setAnswer(() => resolve))
  }, [drafts])

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

  function finish(ok: boolean) {
    // Clear before resolving: the navigation that follows must not trip
    // beforeunload as well.
    if (ok) drafts.clearAll()
    answer?.(ok)
    setAnswer(null)
  }

  return {
    confirmLeave,
    dialog: {
      open: answer !== null,
      draftCount: drafts.size,
      onStay: () => finish(false),
      onDiscard: () => finish(true),
    },
  }
}
