import { useMemo, useState } from 'react'
import type { LedgerFact, Project } from 'contract'
import { assignCharacterAvatars, characterAvatar } from './characterAvatar'
import type { FactStatusFilter, LedgerFilters } from './filters'

const STATUSES: FactStatusFilter[] = [
  'all',
  'pending_review',
  'active',
  'superseded',
  'stale',
  'rejected',
]

const STATUS_LABELS: Record<FactStatusFilter, string> = {
  all: 'All',
  pending_review: 'Needs review',
  active: 'Active',
  superseded: 'Superseded',
  stale: 'Stale',
  rejected: 'Rejected',
}

const COLLAPSED_PEOPLE = 10

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
  /** Facts for CAST counts. */
  facts?: LedgerFact[]
}

function countKnownBy(facts: LedgerFact[], characterId: string): number {
  return facts.filter((f) => f.knownBy.includes(characterId)).length
}

function rowClass(active: boolean): string {
  return (
    'flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors duration-standard ease-standard motion-reduce:transition-none focus-within:outline focus-within:outline-selected focus-within:outline-offset-2 focus-within:outline-tr-coral ' +
    (active
      ? 'bg-tr-ledger-selected text-tr-text-primary'
      : 'text-tr-text-primary hover:bg-tr-surface-clay')
  )
}

/**
 * CAST filter rail (UI spec §7b / Ledger redesign) — searchable people list
 * with avatars, All facts, Status + As-of disclosures. Overview / Threads /
 * Browse live in the content header (option A).
 */
export function FilterRail({
  project,
  filters,
  onChange,
  onManageCast,
  sceneOptions = [],
  asOfScene = null,
  onAsOfSceneChange,
  facts = [],
}: FilterRailProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const pendingCount = facts.filter((f) => f.status === 'pending_review').length
  const statusOpen = filters.status !== 'all'
  const statusCounts = useMemo(
    () =>
      new Map<FactStatusFilter, number>(
        STATUSES.map((status) => [
          status,
          status === 'all'
            ? facts.length
            : facts.filter((fact) => fact.status === status).length,
        ]),
      ),
    [facts],
  )

  const avatars = useMemo(
    () =>
      assignCharacterAvatars(project.seriesBible.characters.map((c) => c.name)),
    [project.seriesBible.characters],
  )

  const peopleSorted = useMemo(() => {
    return project.seriesBible.characters
      .map((character) => ({
        character,
        count: countKnownBy(facts, character.id),
      }))
      .sort(
        (a, b) =>
          b.count - a.count || a.character.name.localeCompare(b.character.name),
      )
  }, [project.seriesBible.characters, facts])

  const q = query.trim().toLowerCase()
  const matched = q
    ? peopleSorted.filter((p) => p.character.name.toLowerCase().includes(q))
    : peopleSorted

  const hasMore = !q && matched.length > COLLAPSED_PEOPLE
  const visiblePeople =
    q || expanded ? matched : matched.slice(0, COLLAPSED_PEOPLE)

  const sectionLegend =
    'font-script text-11 font-medium uppercase tracking-[0.1em] text-tr-text-muted'

  return (
    <aside
      className="flex w-panel-ledger-filters shrink-0 flex-col overflow-y-auto border-r border-tr-border bg-tr-surface-raised px-3.5 py-[18px]"
      aria-label="Ledger filters"
      data-testid="ledger-filter-rail"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2 px-1.5">
        <span className={sectionLegend}>Cast</span>
        {onManageCast && (
          <button
            type="button"
            onClick={onManageCast}
            className="rounded-control px-1 text-12 text-tr-sky underline-offset-2 transition-colors duration-standard ease-standard hover:underline focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
            data-testid="manage-cast-button"
          >
            Manage
          </button>
        )}
      </div>

      <label className="sr-only" htmlFor="ledger-cast-search">
        Search people
      </label>
      <input
        id="ledger-cast-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people…"
        className="mb-3 w-full rounded-control border border-tr-border bg-tr-surface-page px-[11px] py-2 text-13 text-tr-text-primary placeholder:text-tr-text-muted focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral"
        data-testid="cast-search"
      />

      <fieldset>
        <legend className="sr-only">People</legend>
        <label className={rowClass(filters.characterId === null)}>
          <input
            className="sr-only"
            type="radio"
            name="ledger-character"
            aria-label="All facts"
            checked={filters.characterId === null}
            onChange={() => onChange({ ...filters, characterId: null })}
          />
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-tr-border-strong text-11 text-tr-text-secondary"
            aria-hidden
          >
            ✦
          </span>
          <span className="text-13 font-medium">All facts</span>
          <span className="ml-auto font-script text-11 tabular-nums text-tr-text-muted">
            {facts.length}
          </span>
        </label>

        <div
          className="mx-1.5 my-2.5 h-px bg-tr-border"
          role="separator"
          aria-hidden
        />

        <div className="flex flex-col gap-0.5">
          {visiblePeople.map(({ character, count }) => {
            const avatar =
              avatars.get(character.name) ?? characterAvatar(character.name)
            const active = filters.characterId === character.id
            return (
              <label
                key={character.id}
                className={rowClass(active)}
                data-testid={`cast-person-${character.id}`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="ledger-character"
                  aria-label={character.name}
                  checked={active}
                  onChange={() =>
                    onChange({ ...filters, characterId: character.id })
                  }
                />
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{ background: avatar.tint, color: avatar.ink }}
                  aria-hidden
                >
                  {avatar.initials}
                </span>
                <span className="min-w-0 truncate text-13">
                  {character.name}
                </span>
                <span className="ml-auto rounded-control bg-tr-surface-clay px-1.5 py-px font-script text-11 tabular-nums text-tr-text-muted">
                  {count}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {hasMore && (
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[12.5px] text-tr-sky underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral"
            data-testid="cast-expand-toggle"
          >
            {expanded ? 'Show fewer' : `Show all ${peopleSorted.length}`}
          </button>
        </div>
      )}

      <section className="mt-6" aria-label="Visibility filters">
        <h2 className={`mb-2.5 ${sectionLegend}`}>Visibility</h2>
        <div className="flex flex-col gap-0.5">
          <label className={rowClass(filters.secretsOnly)}>
            <input
              className="sr-only"
              type="checkbox"
              checked={filters.secretsOnly}
              onChange={() =>
                onChange({ ...filters, secretsOnly: !filters.secretsOnly })
              }
              data-testid="secrets-only-toggle"
            />
            <span className="text-13">◆ Secrets only</span>
            <span className="ml-auto font-script text-11 tabular-nums text-tr-text-muted">
              {facts.filter((fact) => !fact.audienceKnows).length}
            </span>
          </label>
          <label className={rowClass(Boolean(filters.hideSuperseded))}>
            <input
              className="sr-only"
              type="checkbox"
              checked={filters.hideSuperseded}
              onChange={() =>
                onChange({
                  ...filters,
                  hideSuperseded: !filters.hideSuperseded,
                })
              }
              data-testid="hide-superseded-toggle"
            />
            <span className="text-13">Hide superseded</span>
            <span className="ml-auto font-script text-11 tabular-nums text-tr-text-muted">
              {facts.filter((fact) => fact.status === 'superseded').length}
            </span>
          </label>
          <label className={rowClass(Boolean(filters.expositionOnly))}>
            <input
              className="sr-only"
              type="checkbox"
              checked={Boolean(filters.expositionOnly)}
              onChange={() =>
                onChange({
                  ...filters,
                  expositionOnly: !filters.expositionOnly,
                })
              }
              data-testid="exposition-toggle"
            />
            <span className="text-13">Exposition</span>
            <span className="ml-auto font-script text-11 tabular-nums text-tr-text-muted">
              {facts.filter((fact) => fact.delivery).length}
            </span>
          </label>
        </div>
      </section>

      <details
        className="mt-6"
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
                className={rowClass(filters.status === status)}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="ledger-status"
                  aria-label={STATUS_LABELS[status]}
                  checked={filters.status === status}
                  onChange={() => onChange({ ...filters, status })}
                />
                <span className="text-13">{STATUS_LABELS[status]}</span>
                <span className="ml-auto font-script text-11 tabular-nums text-tr-text-muted">
                  {statusCounts.get(status) ?? 0}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </details>

      {sceneOptions.length > 0 && (
        <div className="mt-5">
          <label
            htmlFor="ledger-as-of"
            className={`mb-2.5 block ${sectionLegend}`}
          >
            As of
          </label>
          <select
            id="ledger-as-of"
            className="w-full rounded-control border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary shadow-raised transition-[box-shadow,border-color] duration-standard ease-standard focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
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
