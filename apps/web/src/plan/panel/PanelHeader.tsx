import type { Scene } from 'contract'
import { placeTitle } from '../story'
import type { PlanSectionId } from './useSectionOpenState'

export type JumpTarget = 'notes' | PlanSectionId

export interface JumpCounts {
  notes: number
  wants: number
  touches: number
  beats: number
}

export interface PanelHeaderProps {
  scene: Scene
  /** 1-based position in board order (story.boardOrder), the order ‹ › step. */
  position: number
  /** Scenes in the episode. */
  total: number
  /** Neighbours in board order (story.boardOrder). */
  prevSceneId: string | null
  nextSceneId: string | null
  /** Effective: scene or episode lock. */
  locked: boolean
  /** This scene has at least one draft. */
  unsaved: boolean
  counts: JumpCounts
  active: JumpTarget
  onBack: () => void
  onSelectScene: (sceneId: string) => void
  onJump: (target: JumpTarget) => void
}

const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'
const STEP = `rounded-card px-2 text-15 text-tr-text-primary hover:bg-tr-surface-clay disabled:opacity-50 ${FOCUS}`

/**
 * The panel's sticky header (spec §4.6): back to the episode, "Scene n of N"
 * with ‹ ›, the scene title with its lock glyph and unsaved chip, and the
 * jump bar. ScenePanel owns the sticky wrapper and the scroll-spy. All of it
 * is identifying text: --tr-text-primary (AA, spec §4.10); the active jump
 * reads by its coral underline and weight, not by colour alone.
 */
export function PanelHeader({
  scene,
  position,
  total,
  prevSceneId,
  nextSceneId,
  locked,
  unsaved,
  counts,
  active,
  onBack,
  onSelectScene,
  onJump,
}: PanelHeaderProps) {
  const jumps: { target: JumpTarget; label: string }[] = [
    ...(counts.notes > 0
      ? [{ target: 'notes' as const, label: `Notes ${counts.notes}` }]
      : []),
    { target: 'scene', label: 'Scene' },
    { target: 'wants', label: `Wants ${counts.wants}` },
    { target: 'touches', label: `Touches ${counts.touches}` },
    { target: 'beats', label: `Beats ${counts.beats}` },
    { target: 'details', label: 'Details' },
  ]

  return (
    <div className="flex flex-col gap-2 border-b border-tr-border px-4 pb-2 pt-3">
      <div className="flex items-center gap-2 text-13 text-tr-text-primary">
        <button
          type="button"
          onClick={onBack}
          className={`rounded-card px-1 hover:bg-tr-surface-clay ${FOCUS}`}
        >
          ← Episode
        </button>
        <span className="ml-auto">
          Scene {position} of {total}
        </span>
        <button
          type="button"
          aria-label="Previous scene"
          disabled={!prevSceneId}
          onClick={() => prevSceneId && onSelectScene(prevSceneId)}
          className={STEP}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next scene"
          disabled={!nextSceneId}
          onClick={() => nextSceneId && onSelectScene(nextSceneId)}
          className={STEP}
        >
          ›
        </button>
      </div>
      {/* Enter on the selected card lands here (redesign spec §4.10). */}
      <h2
        tabIndex={-1}
        className={`flex items-center gap-2 font-display text-17 text-tr-text-primary ${FOCUS}`}
      >
        <span className="min-w-0 truncate">
          {scene.index + 1} · {placeTitle(scene)}
        </span>
        {locked && (
          <svg
            role="img"
            aria-label="Locked"
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 shrink-0 text-tr-text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
        {unsaved && (
          <span
            data-testid="unsaved-chip"
            className="shrink-0 rounded-chip bg-tr-coral-soft px-2 py-0.5 text-12 text-tr-accent-ink"
          >
            unsaved
          </span>
        )}
      </h2>
      <nav
        aria-label="Panel sections"
        data-testid="jump-bar"
        className="flex flex-wrap gap-3 text-12"
      >
        {jumps.map(({ target, label }) => (
          <button
            key={target}
            type="button"
            aria-current={target === active ? 'true' : undefined}
            onClick={() => onJump(target)}
            className={
              `border-b-2 pb-0.5 text-tr-text-primary ${FOCUS}` +
              (target === active
                ? ' border-tr-coral font-semibold'
                : ' border-transparent hover:border-tr-border')
            }
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
