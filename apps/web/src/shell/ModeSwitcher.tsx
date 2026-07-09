import { isModeBuilt, navigateToMode } from './modeNavigation'

export type Mode = 'Write' | 'Plan' | 'Review' | 'Ledger'

export interface ModeSwitcherProps {
  active: Mode
  /** Review-queue count (`pending_review` facts), shown as an amber badge on
   * the Ledger segment when non-empty (UI spec §2). */
  ledgerCount: number
}

const MODES: Mode[] = ['Write', 'Plan', 'Review', 'Ledger']

/**
 * The segmented mode control (UI spec §2). Write, Plan, and Ledger are built
 * (T5.1); Review still renders disabled (Agent E / T4.3). Clicking an
 * inactive built mode navigates (`navigateToMode`); the active tab and
 * unbuilt modes are inert.
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
