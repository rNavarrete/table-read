import { useEffect, useRef } from 'react'

export interface LeavePlanDialogProps {
  open: boolean
  draftCount: number
  onStay: () => void
  onDiscard: () => void
}

const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'

/** Leaving Plan with unsaved edits (redesign spec §4.9): a native modal
 * dialog. Esc means Stay. "Stay in Plan" is the first control, so
 * showModal() focuses it. */
export function LeavePlanDialog({
  open,
  draftCount,
  onStay,
  onDiscard,
}: LeavePlanDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      data-testid="leave-plan-dialog"
      aria-labelledby="leave-plan-title"
      onCancel={(event) => {
        event.preventDefault()
        onStay()
      }}
      className="w-96 max-w-full rounded-card border border-tr-border bg-tr-surface-raised p-6 text-tr-text-primary shadow-lift"
    >
      <h2 id="leave-plan-title" className="font-display text-17">
        You have unsaved edits in Plan.
      </h2>
      <p className="mt-2 text-13">
        {draftCount === 1 ? 'One field has' : `${draftCount} fields have`}{' '}
        changes that aren&apos;t saved. Leaving discards them.
      </p>
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onStay}
          className={`rounded-card bg-tr-coral px-3 py-1.5 text-13 text-tr-surface-raised hover:bg-tr-coral-hover ${FOCUS}`}
        >
          Stay in Plan
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className={`rounded-card px-3 py-1.5 text-13 text-tr-danger hover:bg-tr-surface-clay ${FOCUS}`}
        >
          Discard and leave
        </button>
      </div>
    </dialog>
  )
}
