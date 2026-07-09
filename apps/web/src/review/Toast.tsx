import type { ReactNode } from 'react'

export type ToastTone = 'danger' | 'neutral'

/**
 * Transient status toast (UI spec §7). Used for the 409 lock conflict
 * ("A locked element was included — nothing was changed") and similar.
 */
export function Toast({
  tone = 'neutral',
  children,
  onDismiss,
}: {
  tone?: ToastTone
  children: ReactNode
  onDismiss?: () => void
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-tr-danger bg-tr-coral-soft text-tr-danger'
      : 'border-tr-border bg-tr-surface-raised text-tr-text-primary'

  return (
    <div
      role="alert"
      data-testid="toast"
      className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-card border px-4 py-3 text-13 shadow-raised ${toneClass}`}
    >
      <span>{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-12 text-tr-text-secondary underline"
        >
          Dismiss
        </button>
      )}
    </div>
  )
}
