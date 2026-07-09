import { isModeBuilt, navigateToMode } from './modeNavigation'

export type Mode = 'Write' | 'Plan' | 'Review' | 'Ledger'

export interface ModeSwitcherProps {
  active: Mode
  /** Total ledger fact count, shown as a badge on the Ledger segment.
   * Simplification (flagged in the task report): UI spec §2 specifies this
   * badge as the *review-queue* count (facts `pending_review`), which needs
   * Ledger mode's status filtering (not built yet — Ledger mode is T5.1).
   * Until then this shows the total fact count, which is what makes "ledger
   * badge increments" (the T2.3 accept-flow acceptance criterion) observable
   * today; it becomes the review-queue count once Ledger mode lands. */
  ledgerCount: number
  /** Amber dot on Review when a draft Change Set exists (UI spec §2). */
  hasDraftChangeSet?: boolean
}

const MODES: Mode[] = ['Write', 'Plan', 'Review', 'Ledger']

/**
 * The segmented mode control (UI spec §2). Write, Plan, and Review are built
 * (T4.3); Ledger still renders disabled (T5.1 / Agent F). Clicking an inactive
 * built mode navigates (`navigateToMode`); the active tab and unbuilt modes
 * are inert.
 */
export function ModeSwitcher({
  active,
  ledgerCount,
  hasDraftChangeSet = false,
}: ModeSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="Mode"
      className="flex items-center gap-1 rounded-card bg-tr-surface-clay p-1"
    >
      {MODES.map((mode) => {
        const isActive = mode === active
        const builtElsewhere = !isActive && isModeBuilt(mode)
        const disabled = !isActive && !builtElsewhere
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={disabled}
            title={disabled ? `${mode} mode is not built yet` : undefined}
            onClick={builtElsewhere ? () => navigateToMode(mode) : undefined}
            className={
              'flex items-center gap-1.5 rounded-card px-3 py-1 text-13 transition-colors motion-reduce:transition-none' +
              (isActive
                ? ' bg-tr-coral-soft text-tr-text-primary'
                : disabled
                  ? ' cursor-not-allowed text-tr-text-muted'
                  : ' text-tr-text-secondary hover:bg-tr-surface-raised')
            }
          >
            {mode}
            {mode === 'Review' && hasDraftChangeSet && (
              <span
                aria-label="Draft Change Set"
                className="inline-block size-1.5 rounded-chip bg-tr-amber"
              />
            )}
            {mode === 'Ledger' && ledgerCount > 0 && (
              <span className="rounded-chip bg-tr-amber-soft px-1.5 text-12 text-tr-text-primary">
                {ledgerCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
