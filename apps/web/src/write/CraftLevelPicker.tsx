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
 * Adoption A3 — craft tier picker (Write dock). Segmented control matching
 * the Write redesign handoff.
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
      className="flex rounded-control bg-tr-surface-clay p-0.5"
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
              'flex-1 rounded-[7px] px-2.5 py-1.5 text-[12.5px] transition-colors duration-standard ease-standard disabled:opacity-50 motion-reduce:transition-none ' +
              (active
                ? 'bg-tr-surface-raised font-medium text-tr-text-primary shadow-raised'
                : 'text-tr-text-secondary hover:text-tr-text-primary')
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
