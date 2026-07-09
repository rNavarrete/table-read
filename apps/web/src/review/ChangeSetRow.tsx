import type { ImpactedObject } from 'contract'
import { Chip } from '../plan/Chip'
import { DiffPane } from './DiffPane'

const OBJECT_GLYPH: Record<ImpactedObject['objectType'], string> = {
  scene: '▣',
  beat: '▸',
  character: '◎',
  ledgerFact: '◇',
}

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function InfoGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 text-tr-sky"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6M12 7h.01" />
    </svg>
  )
}

export interface ChangeSetRowProps {
  row: ImpactedObject
  selected: boolean
  expanded: boolean
  previewing: boolean
  onToggleSelected: (objectId: string) => void
  onToggleExpanded: (objectId: string) => void
  /** Continuity-flag chip → Ledger with focusFactId (UI spec §5). */
  onContinuityFlagClick?: (factId: string) => void
}

/**
 * One impacted-object row (UI spec §5 / §7 ChangeSetRow).
 * - regenerate + unlocked → checkbox
 * - locked → lock glyph, --tr-opacity-locked, no checkbox
 * - flag_only → sky info glyph, no checkbox
 */
export function ChangeSetRow({
  row,
  selected,
  expanded,
  previewing,
  onToggleSelected,
  onToggleExpanded,
  onContinuityFlagClick,
}: ChangeSetRowProps) {
  const isLocked = row.locked
  const isFlagOnly = row.applyMode === 'flag_only'
  const canSelect = !isLocked && !isFlagOnly
  const confidenceHue = row.confidence === 'high' ? 'sage' : 'amber'
  const confidenceLabel = row.confidence === 'high' ? 'direct' : 'speculative'

  return (
    <div
      data-testid={`change-set-row-${row.objectId}`}
      className={
        'rounded-card border border-tr-border bg-tr-surface-raised' +
        (isLocked ? ' opacity-locked' : '')
      }
      title={
        isLocked
          ? 'Locked — the AI could not touch this'
          : isFlagOnly
            ? 'Affected, but not changed by this apply — review it yourself'
            : undefined
      }
    >
      <div className="flex items-center gap-3 px-3 py-2 pr-6">
        {canSelect ? (
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select ${row.objectId}`}
            onChange={() => onToggleSelected(row.objectId)}
            className="size-4 accent-tr-coral"
          />
        ) : isLocked ? (
          <span
            aria-label="Locked"
            className="inline-flex w-4 justify-center text-tr-text-muted"
          >
            <LockGlyph />
          </span>
        ) : (
          <span
            aria-label="Flag only"
            title="Affected, but not changed by this apply — review it yourself"
            className="inline-flex w-4 justify-center"
          >
            <InfoGlyph />
          </span>
        )}

        <span className="text-13 text-tr-text-secondary" aria-hidden>
          {OBJECT_GLYPH[row.objectType]}
        </span>
        <span className="font-ui text-13 text-tr-text-primary">
          {row.objectId}
        </span>
        <span className="min-w-0 flex-1 truncate text-13 text-tr-text-secondary">
          {row.reason}
        </span>

        <Chip hue={confidenceHue}>
          <span aria-hidden>{row.confidence === 'high' ? '●' : '◐'}</span>
          {confidenceLabel}
        </Chip>

        {row.continuityFlags.map((flag) =>
          onContinuityFlagClick ? (
            <button
              key={flag.factId}
              type="button"
              onClick={() => onContinuityFlagClick(flag.factId)}
              className="inline-flex items-center gap-1 rounded-chip bg-tr-amber-soft px-2 py-0.5 text-12 text-tr-text-primary"
              data-testid={`continuity-flag-${flag.factId}`}
            >
              <span aria-hidden>⚠</span>
              {flag.factId}
            </button>
          ) : (
            <Chip key={flag.factId} hue="amber">
              <span aria-hidden>⚠</span>
              {flag.factId}
            </Chip>
          ),
        )}

        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse row' : 'Expand row'}
          onClick={() => onToggleExpanded(row.objectId)}
          className="text-13 text-tr-text-secondary"
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-tr-border px-3 py-3">
          <DiffPane
            before={row.before}
            after={row.after}
            variant={row.objectType === 'beat' ? 'script' : 'plan'}
            previewing={previewing && selected && canSelect}
          />
        </div>
      )}
    </div>
  )
}
