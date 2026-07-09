import type { Project } from 'contract'
import type { FactStatusFilter, FactTypeFilter, LedgerFilters } from './filters'

const STATUSES: FactStatusFilter[] = [
  'all',
  'pending_review',
  'active',
  'superseded',
  'stale',
  'rejected',
]

const FACT_TYPES: FactTypeFilter[] = [
  'all',
  'event',
  'state',
  'knowledge',
  'relationship',
  'world_rule',
]

export interface FilterRailProps {
  project: Project
  filters: LedgerFilters
  onChange: (next: LedgerFilters) => void
}

/**
 * Left filter rail (UI spec §6: 200px — status, character, fact type).
 */
export function FilterRail({ project, filters, onChange }: FilterRailProps) {
  return (
    <aside
      className="w-panel-ledger-filters shrink-0 bg-tr-surface-sunken p-4"
      aria-label="Ledger filters"
      data-testid="ledger-filter-rail"
    >
      <fieldset className="mb-6">
        <legend className="mb-2 text-12 uppercase tracking-wide text-tr-text-muted">
          Status
        </legend>
        <div className="flex flex-col gap-1">
          {STATUSES.map((status) => (
            <label
              key={status}
              className="flex cursor-pointer items-center gap-2 text-13 text-tr-text-primary"
            >
              <input
                type="radio"
                name="ledger-status"
                checked={filters.status === status}
                onChange={() => onChange({ ...filters, status })}
              />
              {status === 'all' ? 'All' : status}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mb-6">
        <legend className="mb-2 text-12 uppercase tracking-wide text-tr-text-muted">
          Character
        </legend>
        <div className="flex flex-col gap-1">
          <label className="flex cursor-pointer items-center gap-2 text-13 text-tr-text-primary">
            <input
              type="radio"
              name="ledger-character"
              checked={filters.characterId === null}
              onChange={() => onChange({ ...filters, characterId: null })}
            />
            All
          </label>
          {project.seriesBible.characters.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 text-13 text-tr-text-primary"
            >
              <input
                type="radio"
                name="ledger-character"
                checked={filters.characterId === c.id}
                onChange={() => onChange({ ...filters, characterId: c.id })}
              />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-12 uppercase tracking-wide text-tr-text-muted">
          Fact type
        </legend>
        <div className="flex flex-col gap-1">
          {FACT_TYPES.map((factType) => (
            <label
              key={factType}
              className="flex cursor-pointer items-center gap-2 text-13 text-tr-text-primary"
            >
              <input
                type="radio"
                name="ledger-fact-type"
                checked={filters.factType === factType}
                onChange={() => onChange({ ...filters, factType })}
              />
              {factType === 'all' ? 'All' : factType}
            </label>
          ))}
        </div>
      </fieldset>
    </aside>
  )
}
