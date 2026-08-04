import type { AtlasDensity, AtlasGroupBy, AtlasSortBy } from './atlasPreference'

export interface AtlasFilterChip {
  kind: string
  label: string
  tone?: 'sky' | 'secret'
  onClear: () => void
}

export interface AtlasControlBarProps {
  query: string
  onQueryChange: (value: string) => void
  chips: AtlasFilterChip[]
  shownCount: number
  totalCount: number
  groupBy: AtlasGroupBy
  onGroupByChange: (value: AtlasGroupBy) => void
  sortBy: AtlasSortBy
  onSortByChange: (value: AtlasSortBy) => void
  density: AtlasDensity
  onDensityChange: (value: AtlasDensity) => void
}

const GROUP_OPTIONS: { value: AtlasGroupBy; label: string }[] = [
  { value: 'scene', label: 'Scene' },
  { value: 'character', label: 'Character' },
  { value: 'type', label: 'Type' },
  { value: 'thread', label: 'Thread' },
  { value: 'off', label: 'Off' },
]

const SORT_OPTIONS: { value: AtlasSortBy; label: string }[] = [
  { value: 'story_order', label: 'Story order' },
  { value: 'fewest_knowers', label: 'Fewest knowers' },
]

/** Sticky, local feedback for all Atlas filters and display controls. */
export function AtlasControlBar({
  query,
  onQueryChange,
  chips,
  shownCount,
  totalCount,
  groupBy,
  onGroupByChange,
  sortBy,
  onSortByChange,
  density,
  onDensityChange,
}: AtlasControlBarProps) {
  return (
    <div
      className="sticky top-0 z-20 -mx-5 border-y border-tr-border bg-tr-ledger-content px-5 py-2.5 lg:-mx-7 lg:px-7"
      data-testid="atlas-control-bar"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="atlas-search">
          Search facts, characters, scenes
        </label>
        <input
          id="atlas-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search facts, characters, scenes…"
          className="w-full rounded-control border border-tr-border-strong bg-tr-surface-raised px-3 py-2 text-13 text-tr-text-primary placeholder:text-tr-text-muted sm:w-[268px]"
        />
        {chips.map((chip) => (
          <button
            key={chip.kind}
            type="button"
            onClick={chip.onClear}
            className={
              'inline-flex items-center gap-1 rounded-chip border px-2.5 py-1 text-11 ' +
              (chip.tone === 'secret'
                ? 'border-tr-ledger-secret-border bg-tr-ledger-secret-surface text-tr-ledger-secret-ink'
                : 'border-tr-sky bg-tr-sky-soft text-tr-sky')
            }
            data-testid={`atlas-filter-chip-${chip.kind}`}
          >
            {chip.label}
            <span aria-hidden>×</span>
          </button>
        ))}
        <p
          className="font-script text-11 tabular-nums text-tr-text-secondary"
          data-testid="atlas-result-count"
        >
          <strong className="font-medium text-tr-text-primary">
            {shownCount}
          </strong>{' '}
          of {totalCount} facts
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="text-11 text-tr-text-muted" htmlFor="atlas-group">
            Group by
          </label>
          <select
            id="atlas-group"
            value={groupBy}
            onChange={(event) =>
              onGroupByChange(event.target.value as AtlasGroupBy)
            }
            className="rounded-control border border-tr-border bg-tr-surface-raised px-2 py-1.5 text-11 text-tr-text-primary"
            data-testid="atlas-group-select"
          >
            {GROUP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="text-11 text-tr-text-muted" htmlFor="atlas-sort">
            Sort
          </label>
          <select
            id="atlas-sort"
            value={sortBy}
            onChange={(event) =>
              onSortByChange(event.target.value as AtlasSortBy)
            }
            className="rounded-control border border-tr-border bg-tr-surface-raised px-2 py-1.5 text-11 text-tr-text-primary"
            data-testid="atlas-sort-select"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div
            className="flex rounded-control bg-tr-surface-sunken p-0.5"
            aria-label="Atlas density"
            data-testid="atlas-density-toggle"
          >
            {(['compact', 'comfortable'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={density === option}
                onClick={() => onDensityChange(option)}
                className={
                  'rounded-control px-2 py-1 text-11 capitalize ' +
                  (density === option
                    ? 'bg-tr-surface-raised text-tr-accent-ink shadow-raised'
                    : 'text-tr-text-muted')
                }
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
