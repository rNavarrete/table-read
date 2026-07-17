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

const STATUS_LABELS: Record<FactStatusFilter, string> = {
  all: 'All',
  pending_review: 'Needs review',
  active: 'Active',
  superseded: 'Superseded',
  stale: 'Stale',
  rejected: 'Rejected',
}

const FACT_TYPE_LABELS: Record<FactTypeFilter, string> = {
  all: 'All truths',
  event: 'Events',
  state: 'States',
  knowledge: 'Knowledge',
  relationship: 'Relationships',
  world_rule: 'World rules',
}

/** One episode scene, in doc order, for the As-of selector. */
export interface AsOfSceneOption {
  id: string
  label: string
}

export interface FilterRailProps {
  project: Project
  filters: LedgerFilters
  onChange: (next: LedgerFilters) => void
  onManageCast?: () => void
  /** Episode scenes for the As-of control (T7.18). Omit/empty hides the
   * section — existing callers that don't wire time-aware filtering are
   * unaffected. */
  sceneOptions?: AsOfSceneOption[]
  /** Currently selected as-of scene, or `null` for "Latest (all)". */
  asOfScene?: string | null
  onAsOfSceneChange?: (sceneId: string | null) => void
}

/**
 * Left filter rail (UI spec §6: 198px — status, character, fact type, and
 * the T7.18 As-of scene control).
 */
export function FilterRail({
  project,
  filters,
  onChange,
  onManageCast,
  sceneOptions = [],
  asOfScene = null,
  onAsOfSceneChange,
}: FilterRailProps) {
  const optionClass = (active: boolean) =>
    'flex cursor-pointer items-center gap-2 rounded-chip px-3 py-1 text-13 transition-colors focus-within:outline focus-within:outline-selected focus-within:outline-tr-coral ' +
    (active
      ? 'bg-tr-coral-soft text-tr-accent-ink'
      : 'text-tr-text-primary hover:bg-tr-surface-clay')

  return (
    <aside
      className="w-panel-ledger-filters shrink-0 border-r border-tr-border bg-tr-surface-sunken p-4"
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
              className={optionClass(filters.status === status)}
            >
              <input
                className="sr-only"
                type="radio"
                name="ledger-status"
                checked={filters.status === status}
                onChange={() => onChange({ ...filters, status })}
              />
              {STATUS_LABELS[status]}
            </label>
          ))}
        </div>
      </fieldset>

      {sceneOptions.length > 0 && (
        <fieldset className="mb-6">
          <legend className="mb-2 text-12 uppercase tracking-wide text-tr-text-muted">
            As of
          </legend>
          <div className="flex flex-col gap-1">
            <label className={optionClass(asOfScene === null)}>
              <input
                className="sr-only"
                type="radio"
                name="ledger-as-of"
                checked={asOfScene === null}
                onChange={() => onAsOfSceneChange?.(null)}
              />
              Latest (all)
            </label>
            {sceneOptions.map((scene) => (
              <label
                key={scene.id}
                className={optionClass(asOfScene === scene.id)}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="ledger-as-of"
                  checked={asOfScene === scene.id}
                  onChange={() => onAsOfSceneChange?.(scene.id)}
                />
                {scene.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <legend className="text-12 uppercase tracking-wide text-tr-text-muted">
            People
          </legend>
          {onManageCast && (
            <button
              type="button"
              onClick={onManageCast}
              className="text-12 text-tr-sky underline-offset-2 hover:underline"
              data-testid="manage-cast-button"
            >
              Manage cast
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className={optionClass(filters.characterId === null)}>
            <input
              className="sr-only"
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
              className={optionClass(filters.characterId === c.id)}
            >
              <input
                className="sr-only"
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
          Lenses
        </legend>
        <div className="flex flex-col gap-1">
          {FACT_TYPES.map((factType) => (
            <label
              key={factType}
              className={optionClass(filters.factType === factType)}
            >
              <input
                className="sr-only"
                type="radio"
                name="ledger-fact-type"
                checked={filters.factType === factType}
                onChange={() => onChange({ ...filters, factType })}
              />
              {FACT_TYPE_LABELS[factType]}
            </label>
          ))}
        </div>
      </fieldset>
    </aside>
  )
}
