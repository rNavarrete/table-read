import { isModeBuilt, navigateToMode } from './modeNavigation'

export type Mode = 'Write' | 'Plan' | 'Review' | 'Ledger'

export interface ModeSwitcherProps {
  active: Mode
  /** Total ledger fact count, shown as a badge on the Ledger segment.
   * Simplification (flagged in the task report): UI spec §2 specifies this
   * badge as the *review-queue* count (facts `pending_review`), which needs
   * Ledger mode's status filtering (not built yet — Ledger mode is T4.x).
   * Until then this shows the total fact count, which is what makes "ledger
   * badge increments" (the T2.3 accept-flow acceptance criterion) observable
   * today; it becomes the review-queue count once Ledger mode lands. */
  ledgerCount: number
}

const MODES: Mode[] = ['Write', 'Plan', 'Review', 'Ledger']

/**
 * The segmented mode control (UI spec §2). Write and Plan are both built now
 * (T3.1); Review/Ledger still render disabled (build plan: T4.x/T5.1).
 * Clicking the inactive one of Write/Plan navigates (`navigateToMode`); the
 * active tab and the two unbuilt modes are inert.
 */
export function ModeSwitcher({ active, ledgerCount }: ModeSwitcherProps) {
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
