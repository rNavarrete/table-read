import type { CraftLevel } from 'contract'

export interface CraftLevelPickerProps {
  value: CraftLevel
  onChange: (level: CraftLevel) => void
  disabled?: boolean
}

const OPTIONS: {
  value: CraftLevel
  label: string
  sub: string
}[] = [
  { value: 'fast', label: 'Fast draft', sub: '1 candidate' },
  { value: 'standard', label: 'Standard', sub: '3 candidates' },
  {
    value: 'considered',
    label: 'Considered',
    sub: 'slower, costs more',
  },
]

/**
 * Adoption A3 — craft tier picker (Write dock / Review / Settings).
 * Segmented control; generation stays per-surface (no whole-app lock).
 */
export function CraftLevelPicker({
  value,
  onChange,
  disabled = false,
}: CraftLevelPickerProps) {
  return (
    <div
      role="group"
      aria-label="Craft level"
      className="flex flex-wrap gap-1 rounded-card bg-tr-surface-clay p-1"
      data-testid="craft-level-picker"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={opt.sub}
            onClick={() => onChange(opt.value)}
            className={
              'rounded-card px-2 py-1 text-left text-13 transition-colors disabled:opacity-50' +
              (active
                ? ' bg-tr-coral-soft text-tr-accent-ink'
                : ' text-tr-text-muted hover:text-tr-text-secondary')
            }
          >
            <span className="block font-medium">{opt.label}</span>
            <span className="block text-13 opacity-70">{opt.sub}</span>
          </button>
        )
      })}
    </div>
  )
}
