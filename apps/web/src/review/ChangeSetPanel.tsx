import { useMemo, useState } from 'react'
import type { ChangeSet, ConsistencyFlag } from 'contract'
import { Chip } from '../plan/Chip'
import { ChangeSetRow } from './ChangeSetRow'
import { selectableIds } from './selectableIds'

export interface ChangeSetPanelProps {
  changeSet: ChangeSet
  /** Ids currently checked for regenerate (locked / flag_only never included). */
  selectedIds: Set<string>
  previewing: boolean
  applying: boolean
  /** True once a successful preview has filled `after` for the selection. */
  hasPreview: boolean
  postApplyFlags?: ConsistencyFlag[]
  onToggleSelected: (objectId: string) => void
  onPreview: () => void
  onApply: () => void
  onFlagOnly: () => void
  onDiscard: () => void
  onUndoAll?: () => void
  onDismissFlag?: (flagId: string) => void
  onGoToScene?: (sceneId: string) => void
  onContinuityFlagClick?: (factId: string) => void
}

/**
 * Change Set panel (UI spec §5): header, impacted rows, sticky footer actions.
 */
export function ChangeSetPanel({
  changeSet,
  selectedIds,
  previewing,
  applying,
  hasPreview,
  postApplyFlags = [],
  onToggleSelected,
  onPreview,
  onApply,
  onFlagOnly,
  onDiscard,
  onUndoAll,
  onDismissFlag,
  onGoToScene,
  onContinuityFlagClick,
}: ChangeSetPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const selectable = useMemo(() => selectableIds(changeSet), [changeSet])
  const selectedCount = selectable.filter((id) => selectedIds.has(id)).length
  const applied = changeSet.status === 'applied'

  function toggleExpanded(objectId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(objectId)) next.delete(objectId)
      else next.add(objectId)
      return next
    })
  }

  if (applied) {
    return (
      <div data-testid="change-set-panel" className="flex flex-col gap-4 p-6">
        <header className="flex flex-col gap-2">
          <p className="font-display text-22 text-tr-text-primary">
            &ldquo;{changeSet.instruction}&rdquo;
          </p>
          <div className="flex items-center gap-2">
            <Chip hue="neutral">{changeSet.targetObjectId}</Chip>
            <Chip hue="sage">
              <span aria-hidden>✓</span>
              applied
            </Chip>
          </div>
        </header>

        <div
          role="status"
          className="rounded-card border border-tr-border bg-tr-sage-soft p-4 text-15 text-tr-text-primary"
          data-testid="applied-summary"
        >
          <p>
            Applied {selectedCount || selectable.length} change
            {(selectedCount || selectable.length) === 1 ? '' : 's'}.
          </p>
          {onUndoAll && (
            <button
              type="button"
              onClick={onUndoAll}
              className="mt-2 text-13 text-tr-text-secondary underline"
            >
              Undo all
            </button>
          )}
        </div>

        {postApplyFlags.length > 0 && (
          <section
            aria-label="Post-apply consistency"
            data-testid="post-apply-flags"
            className="flex flex-col gap-2"
          >
            <h2 className="font-display text-17 text-tr-text-primary">
              Consistency flags
            </h2>
            {postApplyFlags.map((flag) => (
              <div
                key={flag.id}
                className="flex items-center gap-3 rounded-card border border-tr-border bg-tr-amber-soft px-3 py-2"
              >
                <p className="min-w-0 flex-1 text-13 text-tr-text-primary">
                  {flag.explanation}
                </p>
                {flag.objectType === 'scene' && onGoToScene && (
                  <button
                    type="button"
                    onClick={() => onGoToScene(flag.objectId)}
                    className="text-13 text-tr-sky underline"
                  >
                    Go to scene
                  </button>
                )}
                {onDismissFlag && (
                  <button
                    type="button"
                    onClick={() => onDismissFlag(flag.id)}
                    className="text-13 text-tr-text-secondary underline"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    )
  }

  return (
    <div
      data-testid="change-set-panel"
      className="flex min-h-[calc(100vh-3.5rem)] flex-col"
    >
      <div className="flex flex-1 flex-col gap-4 p-6 pb-24">
        <header className="flex flex-col gap-2">
          <p className="font-display text-22 text-tr-text-primary">
            &ldquo;{changeSet.instruction}&rdquo;
          </p>
          <div className="flex items-center gap-2">
            <Chip hue="neutral">{changeSet.targetObjectId}</Chip>
            <Chip hue={changeSet.status === 'previewing' ? 'sky' : 'amber'}>
              {changeSet.status}
            </Chip>
          </div>
        </header>

        <div className="flex flex-col gap-2" role="list">
          {changeSet.impacted.map((row) => (
            <div key={row.objectId} role="listitem">
              <ChangeSetRow
                row={row}
                selected={selectedIds.has(row.objectId)}
                expanded={expanded.has(row.objectId)}
                previewing={previewing}
                onToggleSelected={onToggleSelected}
                onToggleExpanded={toggleExpanded}
                onContinuityFlagClick={onContinuityFlagClick}
              />
            </div>
          ))}
        </div>
      </div>

      <footer
        className="sticky bottom-0 flex items-center gap-4 border-t border-tr-border bg-tr-surface-sunken px-6 py-3"
        data-testid="change-set-footer"
      >
        <span className="text-13 text-tr-text-secondary">
          {selectedCount} of {selectable.length} selected
        </span>
        <button
          type="button"
          disabled={previewing || applying || selectedCount === 0}
          onClick={onPreview}
          className="rounded-card border border-tr-coral bg-transparent px-3 py-1 text-13 text-tr-coral disabled:opacity-50"
        >
          {previewing ? 'Previewing…' : 'Preview selected'}
        </button>
        <button
          type="button"
          disabled={
            !hasPreview || previewing || applying || selectedCount === 0
          }
          onClick={onApply}
          className="rounded-card bg-tr-coral px-3 py-1 text-13 text-tr-surface-raised disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply selected'}
        </button>
        <button
          type="button"
          disabled={previewing || applying}
          onClick={onFlagOnly}
          className="text-13 text-tr-text-secondary underline disabled:opacity-50"
        >
          Flag only
        </button>
        <button
          type="button"
          disabled={previewing || applying}
          onClick={onDiscard}
          className="text-13 text-tr-text-muted underline disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          disabled
          title="v2"
          className="ml-auto cursor-not-allowed text-13 text-tr-text-muted opacity-50"
        >
          Create branch
        </button>
      </footer>
    </div>
  )
}
