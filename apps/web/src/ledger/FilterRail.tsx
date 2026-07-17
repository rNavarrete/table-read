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
  /** Opens the Overview panel (T7.29 story overview). Omit to hide. */
  onViewOverview?: () => void
  /** When true, show a present cue next to the Overview entry. */
  overviewPresent?: boolean
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
 * Overview · Status (collapsed) · compact As-of.
 */
export function FilterRail({
  project,
  filters,
  onChange,
  onManageCast,
  onViewThreads,
  threadCount = 0,
  onViewOverview,
  overviewPresent = false,
  sceneOptions = [],
  asOfScene = null,
  onAsOfSceneChange,
  facts = [],
}: FilterRailProps) {
  const optionClass = (active: boolean) =>
    'flex cursor-pointer items-center gap-2 rounded-chip px-3 py-1.5 text-13 transition-colors duration-standard ease-standard motion-reduce:transition-none focus-within:outline focus-within:outline-selected focus-within:outline-offset-2 focus-within:outline-tr-coral ' +
    (active
      ? 'bg-tr-coral-soft text-tr-accent-ink'
      : 'text-tr-text-primary hover:bg-tr-surface-clay')

  const sectionLegend =
    'text-11 font-medium uppercase tracking-wide text-tr-text-muted'

  const pendingCount = facts.filter((f) => f.status === 'pending_review').length
  const statusOpen = filters.status !== 'all'

  const charactersWithCounts = project.seriesBible.characters.map((c) => ({
    character: c,
    count: countKnownBy(facts, c.id),
  }))
  const peopleWithFacts = charactersWithCounts.filter((c) => c.count > 0)
  const peopleWithoutFacts = charactersWithCounts.filter((c) => c.count === 0)
  const zeroCountSelected = peopleWithoutFacts.some(
    (c) => c.character.id === filters.characterId,
  )

  const renderPersonOption = (
    character: { id: string; name: string },
    count: number,
  ) => (
    <label
      key={character.id}
      className={optionClass(filters.characterId === character.id)}
    >
      <input
        className="sr-only"
        type="radio"
        name="ledger-character"
        checked={filters.characterId === character.id}
        onChange={() => onChange({ ...filters, characterId: character.id })}
      />
      <span>
        {character.name}
        {facts.length > 0 && (
          <span className="ml-1 text-tr-text-muted">({count})</span>
        )}
      </span>
    </label>
  )

  return (
    <aside
      className="w-panel-ledger-filters shrink-0 border-r border-tr-border bg-tr-surface-sunken px-3 py-5"
      aria-label="Ledger filters"
      data-testid="ledger-filter-rail"
    >
      <fieldset className="mb-7">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <legend className={sectionLegend}>People</legend>
          {onManageCast && (
            <button
              type="button"
              onClick={onManageCast}
              className="rounded-chip px-1 text-12 text-tr-sky underline-offset-2 transition-colors duration-standard ease-standard hover:underline focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
              data-testid="manage-cast-button"
            >
              Manage cast
            </button>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
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
          {peopleWithFacts.map(({ character, count }) =>
            renderPersonOption(character, count),
          )}
          {peopleWithoutFacts.length > 0 && (
            <details
              className="mt-1"
              data-testid="filter-rail-people-zero"
              open={zeroCountSelected || undefined}
            >
              <summary className="cursor-pointer rounded-chip px-3 py-1.5 text-12 text-tr-text-muted transition-colors duration-standard ease-standard hover:bg-tr-surface-clay hover:text-tr-text-secondary motion-reduce:transition-none">
                No linked facts ({peopleWithoutFacts.length})
              </summary>
              <div className="mt-1 flex flex-col gap-0.5">
                {peopleWithoutFacts.map(({ character, count }) =>
                  renderPersonOption(character, count),
                )}
              </div>
            </details>
          )}
        </div>
      </fieldset>

      <fieldset className="mb-7">
        <legend className={`mb-2.5 ${sectionLegend}`}>Browse</legend>
        <div className="flex flex-col gap-0.5">
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
        <fieldset className="mb-7">
          <legend className={`mb-2.5 ${sectionLegend}`}>Threads</legend>
          <button
            type="button"
            onClick={onViewThreads}
            className="w-full rounded-chip px-3 py-1.5 text-left text-13 text-tr-text-primary transition-colors duration-standard ease-standard hover:bg-tr-surface-clay focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
            data-testid="view-threads-button"
          >
            Setups &amp; payoffs
            {threadCount > 0 && (
              <span className="ml-2 text-tr-text-muted">({threadCount})</span>
            )}
          </button>
        </fieldset>
      )}

      {onViewOverview && (
        <fieldset className="mb-7">
          <legend className={`mb-2.5 ${sectionLegend}`}>Overview</legend>
          <button
            type="button"
            onClick={onViewOverview}
            className="w-full rounded-chip px-3 py-1.5 text-left text-13 text-tr-text-primary transition-colors duration-standard ease-standard hover:bg-tr-surface-clay focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
            data-testid="view-overview-button"
          >
            Story overview
            {overviewPresent && (
              <span className="ml-2 text-tr-text-muted">(ready)</span>
            )}
          </button>
        </fieldset>
      )}

      <details
        className="mb-7"
        data-testid="filter-rail-status"
        open={statusOpen || undefined}
      >
        <summary
          className={`mb-2.5 cursor-pointer ${sectionLegend} transition-colors duration-standard ease-standard hover:text-tr-text-secondary motion-reduce:transition-none`}
        >
          Status
          {pendingCount > 0 && (
            <span className="ml-2 normal-case tracking-normal text-tr-amber">
              {pendingCount} to review
            </span>
          )}
        </summary>
        <fieldset>
          <legend className="sr-only">Status</legend>
          <div className="flex flex-col gap-0.5">
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
          <label htmlFor="ledger-as-of" className={`mb-2.5 block ${sectionLegend}`}>
            As of
          </label>
          <select
            id="ledger-as-of"
            className="w-full rounded-card border border-tr-border bg-tr-surface-raised px-3 py-2 text-13 text-tr-text-primary shadow-raised transition-[box-shadow,border-color] duration-standard ease-standard focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
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
