import { useId } from 'react'
import {
  castCounts,
  HIGHLIGHT_LABELS,
  highlightCount,
  NO_HIGHLIGHT,
  type BoardModel,
  type Highlight,
  type HighlightKind,
} from './story'

export interface HighlightBarProps {
  model: BoardModel
  highlight: Highlight
  fold: boolean
  onHighlight: (highlight: Highlight) => void
  onToggleFold: () => void
  /** N: next note (None) or next match. */
  onNext: () => void
}

const KINDS: HighlightKind[] = [
  'none',
  'threads',
  'secret',
  'continuity',
  'acts',
  'who',
]

const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'

/**
 * The board's highlight bar (spec §4.5): story questions with neutral counts
 * ("scenes that match"), Who's in it with its character select, Fold the rest
 * and Next note/match. Pure props: no storage, no requests. A highlight with
 * no matches is disabled (None never is).
 */
export function HighlightBar({
  model,
  highlight,
  fold,
  onHighlight,
  onToggleFold,
  onNext,
}: HighlightBarProps) {
  const labelId = useId()
  const cast = castCounts(model)
  // The active character, else the most-present one; null only with no cast.
  const who =
    (highlight.kind === 'who' && highlight.who) || cast[0]?.character.id || null
  const pick = (kind: HighlightKind): Highlight =>
    kind === highlight.kind || kind === 'none'
      ? NO_HIGHLIGHT
      : { kind, who: kind === 'who' ? who : null }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span id={labelId} className="text-12 text-tr-text-primary">
        Highlight
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-0.5 rounded-control bg-tr-surface-sunken p-0.5"
      >
        {KINDS.map((kind) => {
          const pressed = kind === highlight.kind
          const count =
            kind === 'none' ? null : highlightCount(model, { kind, who })
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={pressed}
              disabled={count === 0}
              onClick={() => onHighlight(pick(kind))}
              className={
                `flex items-center gap-1.5 whitespace-nowrap rounded-control px-2 py-0.5 text-13 text-tr-text-primary disabled:cursor-not-allowed disabled:text-tr-text-muted ${FOCUS}` +
                (pressed
                  ? ' bg-tr-surface-raised font-semibold shadow-raised'
                  : ' enabled:hover:bg-tr-surface-raised')
              }
            >
              {HIGHLIGHT_LABELS[kind]}
              {count !== null && (
                <>
                  {' '}
                  <span className="text-11 font-normal tabular-nums">
                    {count}
                  </span>
                </>
              )}
            </button>
          )
        })}
        {/* A placeholder unless Who's in it is on, so picking the
            character the button counts is still a change. */}
        <select
          aria-label="Character to highlight"
          title="From dialogue cues and recorded wants"
          value={highlight.kind === 'who' ? (who ?? '') : ''}
          disabled={!who}
          onChange={(event) =>
            onHighlight({ kind: 'who', who: event.target.value })
          }
          className={`max-w-28 rounded-control bg-transparent px-1 py-0.5 text-13 font-medium text-tr-text-primary disabled:cursor-not-allowed disabled:text-tr-text-muted ${FOCUS}`}
        >
          <option value="" disabled hidden>
            Character…
          </option>
          {cast.map(({ character }) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        aria-pressed={fold}
        title="Fold scenes that don't match into narrow stubs"
        onClick={onToggleFold}
        className={`ml-auto flex items-center gap-2 whitespace-nowrap rounded-control p-1 text-12 text-tr-text-primary ${FOCUS}`}
      >
        <span
          aria-hidden="true"
          className={
            'inline-flex h-4 w-7 shrink-0 items-center rounded-chip p-0.5 transition-colors motion-reduce:transition-none' +
            (fold
              ? ' justify-end bg-tr-coral'
              : ' justify-start bg-tr-border-strong')
          }
        >
          <span className="size-3 rounded-chip bg-tr-surface-raised shadow-raised" />
        </span>
        Fold the rest
      </button>
      <button
        type="button"
        aria-keyshortcuts="N"
        title="N for the next, Shift+N for the previous"
        onClick={onNext}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-control border border-tr-border-strong bg-tr-surface-raised px-2.5 py-1 text-12 font-medium text-tr-text-primary hover:bg-tr-surface-sunken ${FOCUS}`}
      >
        {highlight.kind === 'none' ? 'Next note' : 'Next match'}{' '}
        <kbd
          aria-hidden="true"
          className="rounded-card border border-b-2 border-tr-border-strong bg-tr-surface-raised px-1 font-ui text-11 text-tr-text-primary"
        >
          N
        </kbd>
      </button>
    </div>
  )
}
