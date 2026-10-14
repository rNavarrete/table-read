import { Chip } from './Chip'
import type { ActSummary } from './story'

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`

/** ≈ share bar with an even-share tick; "≈43%". Used by ActHeader and the Episode view. */
export function ShareBar({
  share,
  even,
  actCount,
}: {
  share: number
  even: number
  actCount: number
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-12 text-tr-text-primary tabular-nums"
      title={`An estimated share of the script text, by length. The tick marks an even split across ${actCount} acts.`}
    >
      <span
        aria-hidden="true"
        className="relative h-1.5 w-18 rounded-chip bg-tr-surface-raised inset-ring inset-ring-tr-border-strong"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-chip bg-tr-text-secondary"
          style={{ width: pct(share) }}
        />
        <span
          className="absolute -top-0.75 h-3 w-0.5 bg-tr-text-primary"
          style={{ left: pct(even) }}
        />
      </span>
      ≈{Math.round(share * 100)}%
    </span>
  )
}

export interface ActHeaderProps {
  summary: ActSummary
  /** Acts on the board, for the even-share tick (1 / actCount). */
  actCount: number
  /** model.hasThreads: no "↗0 set up · ↘0 paid off" on a project without threads. */
  showThreads: boolean
  collapsed: boolean
  onToggle: () => void
  onSelectScene: (sceneId: string) => void
}

/** An act frame's header (spec §4.3): name, scene count, ≈ share of the
 * script, set up / paid off, marked landmarks only, then act-split notes. */
export function ActHeader({
  summary,
  actCount,
  showThreads,
  collapsed,
  onToggle,
  onSelectScene,
}: ActHeaderProps) {
  const { label, scenes, share } = summary
  const hasScenes = scenes.length > 0
  return (
    <>
      <div className="flex min-h-7 flex-wrap items-center gap-3">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Show' : 'Hide'} ${label}`}
          onClick={onToggle}
          className={`-ml-1 grid size-6 place-items-center rounded-control text-tr-text-primary hover:bg-tr-surface-sunken ${FOCUS_RING}`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={`transition-transform motion-reduce:transition-none${collapsed ? ' -rotate-90' : ''}`}
          >
            <path
              d="M3 4.5l3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
          </svg>
        </button>
        <h2 className="font-display text-15 font-semibold uppercase tracking-wide text-tr-text-primary">
          {label}
        </h2>
        <span className="text-12 text-tr-text-primary tabular-nums">
          {scenes.length} scene{scenes.length === 1 ? '' : 's'}
        </span>
        {hasScenes && share !== null && (
          <ShareBar share={share} even={1 / actCount} actCount={actCount} />
        )}
        {hasScenes && showThreads && (
          <span className="text-12 text-tr-text-primary tabular-nums">
            <span className="font-semibold text-tr-sky">↗{summary.setUp}</span>{' '}
            set up ·{' '}
            <span className="font-semibold text-tr-sky">
              ↘{summary.paidOff}
            </span>{' '}
            paid off
          </span>
        )}
        {summary.landmarks.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-1.5">
            {summary.landmarks.map((m) => (
              <Chip key={m.label} hue="sage" title={m.label}>
                ✓ {m.short} · {m.number}
              </Chip>
            ))}
          </span>
        )}
      </div>
      {summary.actSplitNotes.map((note, i) => (
        <p
          key={`${note.sceneId}-${i}`}
          className="mt-2 flex items-baseline gap-2 rounded-card bg-tr-amber-soft px-2.5 py-1.5 text-12 text-tr-text-primary"
        >
          <span className="whitespace-nowrap font-semibold text-tr-amber">
            <span aria-hidden="true">⚑</span> Act split
          </span>
          <span>
            {note.text}{' '}
            <button
              type="button"
              onClick={() => onSelectScene(note.sceneId)}
              className={`text-tr-sky underline ${FOCUS_RING}`}
            >
              Open scene {note.number}
            </button>
          </span>
        </p>
      ))}
    </>
  )
}
