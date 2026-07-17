import type { LedgerFact, Project } from 'contract'
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
  /** Opens the Threads panel (T7.21 narrative promises). Omit to hide the
   * entry point — existing callers that haven't wired threads yet are
   * unaffected. */
  onViewThreads?: () => void
  /** Thread count shown next to the entry point; 0/undefined hides it. */
  threadCount?: number
  /** Episode scenes for the As-of control (T7.18). Omit/empty hides the
   * section — existing callers that don't wire time-aware filtering are
   * unaffected. */
  sceneOptions?: AsOfSceneOption[]
  /** Currently selected as-of scene, or `null` for "Latest (all)". */
  asOfScene?: string | null
  onAsOfSceneChange?: (sceneId: string | null) => void
  /** Facts for People / Browse counts (browse-clarity rail). */
  facts?: LedgerFact[]
}

function countKnownBy(facts: LedgerFact[], characterId: string): number {
  return facts.filter((f) => f.knownBy.includes(characterId)).length
}

function countFactType(facts: LedgerFact[], factType: FactTypeFilter): number {
  if (factType === 'all') return facts.length
  return facts.filter((f) => f.factType === factType).length
}

/**
 * Left filter rail (UI spec §7b) — browse-first: People · Browse · Threads ·
 * Status (collapsed) · compact As-of.
 */
export function FilterRail({
  project,
  filters,
  onChange,
  onManageCast,
  onViewThreads,
  threadCount = 0,
  sceneOptions = [],
  asOfScene = null,
  onAsOfSceneChange,
  facts = [],
}: FilterRailProps) {
  const optionClass = (active: boolean) =>
    'flex cursor-pointer items-center gap-2 rounded-chip px-3 py-1 text-13 transition-colors focus-within:outline focus-within:outline-selected focus-within:outline-tr-coral ' +
    (active
      ? 'bg-tr-coral-soft text-tr-accent-ink'
      : 'text-tr-text-primary hover:bg-tr-surface-clay')

  const pendingCount = facts.filter((f) => f.status === 'pending_review').length
  const statusOpen = filters.status !== 'all'

  return (
    <aside
      className="w-panel-ledger-filters shrink-0 border-r border-tr-border bg-tr-surface-sunken p-4"
      aria-label="Ledger filters"
      data-testid="ledger-filter-rail"
    >
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
          {project.seriesBible.characters.map((c) => {
            const count = countKnownBy(facts, c.id)
            return (
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
                <span>
                  {c.name}
                  {facts.length > 0 && (
                    <span className="ml-1 text-tr-text-muted">({count})</span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="mb-6">
        <legend className="mb-2 text-12 uppercase tracking-wide text-tr-text-muted">
          Browse
        </legend>
        <div className="flex flex-col gap-1">
          {FACT_TYPES.map((factType) => {
            const count = countFactType(facts, factType)
            return (
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
                <span>
                  {FACT_TYPE_LABELS[factType]}
                  {facts.length > 0 && factType !== 'all' && (
                    <span className="ml-1 text-tr-text-muted">({count})</span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {onViewThreads && (
        <fieldset className="mb-6">
          <legend className="mb-2 text-12 uppercase tracking-wide text-tr-text-muted">
            Threads
          </legend>
          <button
            type="button"
            onClick={onViewThreads}
            className="w-full rounded-chip px-3 py-1 text-left text-13 text-tr-text-primary hover:bg-tr-surface-clay"
            data-testid="view-threads-button"
          >
            Setups &amp; payoffs
            {threadCount > 0 && (
              <span className="ml-2 text-tr-text-muted">({threadCount})</span>
            )}
          </button>
        </fieldset>
      )}

      <details
        className="mb-6"
        data-testid="filter-rail-status"
        open={statusOpen || undefined}
      >
        <summary className="mb-2 cursor-pointer text-12 uppercase tracking-wide text-tr-text-muted">
          Status
          {pendingCount > 0 && (
            <span className="ml-2 normal-case tracking-normal text-tr-text-secondary">
              {pendingCount} to review
            </span>
          )}
        </summary>
        <fieldset>
          <legend className="sr-only">Status</legend>
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
      </details>

      {sceneOptions.length > 0 && (
        <div className="mb-2">
          <label
            htmlFor="ledger-as-of"
            className="mb-2 block text-12 uppercase tracking-wide text-tr-text-muted"
          >
            As of
          </label>
          <select
            id="ledger-as-of"
            className="w-full rounded-chip border border-tr-border bg-tr-surface-raised px-3 py-1.5 text-13 text-tr-text-primary"
            value={asOfScene ?? ''}
            onChange={(e) =>
              onAsOfSceneChange?.(e.target.value === '' ? null : e.target.value)
            }
            data-testid="ledger-as-of-select"
          >
            <option value="">Latest (all)</option>
            {sceneOptions.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </aside>
  )
}
