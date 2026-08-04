import { isModeBuilt, navigateToMode } from './modeNavigation'

export type Mode = 'Write' | 'Plan' | 'Review' | 'Ledger'

export interface ModeSwitcherProps {
  active: Mode
  /** Review-queue count (`pending_review` facts), shown as an amber badge on
   * the Ledger segment when non-empty (UI spec §2). */
  ledgerCount: number
  /** Amber dot on Review when a draft Change Set exists (UI spec §2). */
  hasDraftChangeSet?: boolean
}

const MODES: Mode[] = ['Write', 'Plan', 'Review', 'Ledger']

/**
 * Mode tabs (UI spec §3): freestanding pills. Active = soft selected surface
 * (chrome, not primary action — coral reserved for CTAs).
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
      data-testid="mode-switcher"
      className="flex items-center gap-0.5"
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
              'flex items-center gap-1.5 rounded-[8px] px-3.5 py-1.5 text-13 transition-colors duration-standard ease-standard motion-reduce:transition-none' +
              (isActive
                ? ' bg-tr-ledger-selected font-medium text-tr-text-primary'
                : disabled
                  ? ' cursor-not-allowed text-tr-text-muted'
                  : ' text-tr-text-secondary hover:bg-tr-surface-clay')
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
