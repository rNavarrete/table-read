import { saveLedgerView, type LedgerViewId } from './viewPreference'

export interface LedgerViewSwitcherProps {
  projectId: string
  value: LedgerViewId
  onChange: (view: LedgerViewId) => void
}

const OPTIONS: { value: LedgerViewId; label: string }[] = [
  { value: 'atlas', label: 'Atlas' },
  { value: 'web', label: 'Web' },
]

/**
 * Quiet Tool segmented control — Story Atlas vs Knowledge Web.
 * Matches ModeSwitcher clay track + coral-soft active segment.
 */
export function LedgerViewSwitcher({
  projectId,
  value,
  onChange,
}: LedgerViewSwitcherProps) {
  const handleChange = (view: LedgerViewId) => {
    saveLedgerView(projectId, view)
    onChange(view)
  }

  return (
    <div
      role="group"
      aria-label="Ledger view"
      className="flex flex-wrap gap-1 rounded-card bg-tr-surface-clay p-1"
      data-testid="ledger-view-switcher"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => handleChange(opt.value)}
            className={
              'rounded-card px-3 py-1.5 text-13 transition-colors duration-standard ease-standard motion-reduce:transition-none focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral' +
              (active
                ? ' bg-tr-coral-soft font-medium text-tr-accent-ink shadow-raised'
                : ' text-tr-text-secondary hover:bg-tr-surface-raised hover:text-tr-text-primary')
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
