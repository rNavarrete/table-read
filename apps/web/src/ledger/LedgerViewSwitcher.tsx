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
              'rounded-card px-2.5 py-1.5 text-13 transition-colors' +
              (active
                ? ' bg-tr-coral-soft font-medium text-tr-accent-ink'
                : ' text-tr-text-secondary hover:text-tr-text-primary')
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
