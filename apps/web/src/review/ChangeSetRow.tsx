import type { ImpactedObject, SceneAddition } from 'contract'
import { Chip } from '../plan/Chip'
import {
  sceneCharacterNames,
  sceneHeading,
  scenePitch,
} from '../plan/sceneSkeletonSummary'
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
  /** Full scene proposal for `applyMode: "add"` rows (skeleton Change Sets). */
  sceneAddition?: SceneAddition | null
  /** Resolve motivation characterIds → display names. */
  characters?: ReadonlyArray<{ id: string; name: string }>
}

/**
 * One impacted-object row (UI spec §5 / §7 ChangeSetRow).
 * - regenerate + unlocked → checkbox
 * - locked → lock glyph, --tr-opacity-locked, no checkbox
 * - flag_only → sky info glyph, no checkbox
 * - add (scene skeleton) → checkbox + human scene summary, not the proposal UUID
 */
export function ChangeSetRow({
  row,
  selected,
  expanded,
  previewing,
  onToggleSelected,
  onToggleExpanded,
  onContinuityFlagClick,
  sceneAddition = null,
  characters = [],
}: ChangeSetRowProps) {
  const isLocked = row.locked
  const isFlagOnly = row.applyMode === 'flag_only'
  const isAdd = row.applyMode === 'add'
  const canSelect = !isLocked && !isFlagOnly
  const confidenceHue = row.confidence === 'high' ? 'sage' : 'amber'
  const confidenceLabel = row.confidence === 'high' ? 'direct' : 'speculative'
  const afterSummary = row.after ?? 'Preview to generate'

  const additionHeading = sceneAddition ? sceneHeading(sceneAddition) : null
  const additionPitch = sceneAddition ? scenePitch(sceneAddition) : ''
  const additionNames = sceneAddition
    ? sceneCharacterNames(sceneAddition, characters)
    : []
  const titleLabel = isAdd ? (additionHeading ?? 'New scene') : row.objectId
  const subtitle = isAdd ? additionPitch || row.reason : row.reason

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
      <div className="flex items-center gap-2 px-3 py-2 pr-4">
        {canSelect ? (
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select ${titleLabel}`}
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

        <span className="text-12 text-tr-text-secondary" aria-hidden>
          {OBJECT_GLYPH[row.objectType]}
        </span>
        <span className="font-ui text-13 font-medium text-tr-text-primary">
          {titleLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-13 text-tr-text-secondary">
          {subtitle}
        </span>

        {!expanded && !isAdd && (
          <div className="hidden min-w-0 flex-1 items-center gap-1.5 lg:flex">
            <span className="inline-flex min-w-0 items-center gap-1 rounded-chip bg-tr-surface-clay px-2 py-0.5 text-12 text-tr-text-secondary">
              <span className="uppercase tracking-wide text-tr-text-muted">
                Before
              </span>
              <span className="truncate">{row.before || '—'}</span>
            </span>
            <span className="text-12 text-tr-text-muted" aria-hidden>
              →
            </span>
            <span className="inline-flex min-w-0 items-center gap-1 rounded-chip bg-tr-coral-soft px-2 py-0.5 text-12 text-tr-accent-ink">
              <span className="uppercase tracking-wide">After</span>
              <span className="truncate">{afterSummary}</span>
            </span>
          </div>
        )}

        {!expanded && isAdd && (
          <span className="hidden rounded-chip bg-tr-coral-soft px-2 py-0.5 text-12 text-tr-accent-ink lg:inline-flex">
            New scene
          </span>
        )}

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
          className="text-13 text-tr-text-secondary hover:text-tr-text-primary"
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      {expanded && isAdd && sceneAddition && (
        <div className="border-t border-tr-border bg-tr-surface-page px-3 py-3 text-13 text-tr-text-secondary">
          <p className="font-medium text-tr-text-primary">
            {sceneHeading(sceneAddition)}
          </p>
          {additionPitch ? (
            <p className="mt-1 leading-5">{additionPitch}</p>
          ) : null}
          {sceneAddition.socialSituation.trim() ? (
            <p className="mt-2 text-12 text-tr-text-muted">
              Situation: {sceneAddition.socialSituation}
            </p>
          ) : null}
          {additionNames.length > 0 ? (
            <p className="mt-1 text-12 text-tr-text-muted">
              With {additionNames.join(', ')}
              {sceneAddition.motivations.length > 0
                ? ` — ${sceneAddition.motivations
                    .map((m) => {
                      const name =
                        characters.find((c) => c.id === m.characterId)?.name ??
                        m.characterId
                      return `${name}: ${m.objective}`
                    })
                    .join('; ')}`
                : ''}
            </p>
          ) : null}
          {(sceneAddition.audienceLearns.trim() ||
            sceneAddition.audienceFeels.trim()) && (
            <p className="mt-1 text-12 text-tr-text-muted">
              {sceneAddition.audienceLearns.trim()
                ? `Audience learns: ${sceneAddition.audienceLearns}`
                : null}
              {sceneAddition.audienceLearns.trim() &&
              sceneAddition.audienceFeels.trim()
                ? ' · '
                : null}
              {sceneAddition.audienceFeels.trim()
                ? `Feels: ${sceneAddition.audienceFeels}`
                : null}
            </p>
          )}
          {sceneAddition.beatPlanSeeds.some((b) => b.whatHappens.trim()) ? (
            <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-12">
              {sceneAddition.beatPlanSeeds
                .filter((b) => b.whatHappens.trim())
                .map((beat, index) => (
                  <li key={`${row.objectId}-beat-${index}`}>
                    {beat.whatHappens}
                  </li>
                ))}
            </ol>
          ) : null}
        </div>
      )}

      {expanded && !isAdd && (
        <div className="border-t border-tr-border bg-tr-surface-page px-3 py-3">
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
