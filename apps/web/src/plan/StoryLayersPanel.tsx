import type { Episode, Project } from 'contract'
import type { PlanSelection } from './SceneCard'
import {
  actLabel,
  actNumbersForBoard,
  allScenes,
  groupScenesByAct,
} from './planTree'

function EyeGlyph({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      ) : (
        <path d="M3 3l18 18M10.6 10.6a2.5 2.5 0 0 0 3.5 3.5M6.6 6.7C4 8.4 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-1M17.6 17.4C19.9 15.8 22 12 22 12a17 17 0 0 0-3.2-4" />
      )}
    </svg>
  )
}

export interface StoryLayersPanelProps {
  project: Project
  episode: Episode
  selection: PlanSelection
  collapsedActs: Set<number>
  onSelectNothing: () => void
  onSelectScene: (sceneId: string) => void
  onToggleActCollapse: (act: number) => void
}

/**
 * Left Story Layers panel (UI spec §4): "tree — Bible (premise, characters,
 * theme) / Episode / Acts / Scenes. Selecting focuses the board; eye toggles
 * collapse acts." Bible and Episode nodes both clear the selection — this
 * task's inspector defines only one "nothing selected" view (episode
 * summary + premise, §4's own "States" list), not a separate Bible-detail
 * screen, so both tree roots resolve to it. Flagged as a simplification,
 * not a silent gap: series-bible editing has no UI task of its own yet in
 * the build plan.
 */
export function StoryLayersPanel({
  project,
  episode,
  selection,
  collapsedActs,
  onSelectNothing,
  onSelectScene,
  onToggleActCollapse,
}: StoryLayersPanelProps) {
  const scenes = allScenes(project)
  const acts = actNumbersForBoard(project.format, scenes)
  const groups = groupScenesByAct(scenes)

  return (
    <nav
      className="w-panel-story-layers shrink-0 bg-tr-surface-sunken p-4"
      aria-label="Story Layers"
      data-testid="story-layers-panel"
    >
      <ul className="flex flex-col gap-1 text-13">
        <li>
          <button
            type="button"
            onClick={onSelectNothing}
            className="w-full rounded-card px-2 py-1 text-left text-tr-text-primary hover:bg-tr-surface-clay"
          >
            Bible
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={onSelectNothing}
            className="w-full rounded-card px-2 py-1 text-left text-tr-text-primary hover:bg-tr-surface-clay"
          >
            Episode: {episode.title}
          </button>
        </li>
        <li className="mt-2 px-2 text-12 uppercase tracking-wide text-tr-text-muted">
          Acts
        </li>
        {acts.map((act) => {
          const actScenes = groups.get(act) ?? []
          const collapsed = collapsedActs.has(act)
          return (
            <li key={act}>
              <div className="flex items-center gap-1 px-2 py-1">
                <button
                  type="button"
                  aria-pressed={collapsed}
                  aria-label={
                    collapsed
                      ? `Show ${actLabel(act, project.format)}`
                      : `Hide ${actLabel(act, project.format)}`
                  }
                  onClick={() => onToggleActCollapse(act)}
                  className="shrink-0 text-tr-text-muted"
                >
                  <EyeGlyph open={!collapsed} />
                </button>
                <span className="text-tr-text-primary">
                  {actLabel(act, project.format)}
                </span>
              </div>
              {!collapsed && (
                <ul className="ml-6 flex flex-col gap-0.5">
                  {actScenes.map((scene) => (
                    <li key={scene.id}>
                      <button
                        type="button"
                        onClick={() => onSelectScene(scene.id)}
                        className={
                          'w-full truncate rounded-card px-2 py-0.5 text-left text-13 hover:bg-tr-surface-clay' +
                          (selection?.type === 'scene' &&
                          selection.sceneId === scene.id
                            ? ' bg-tr-coral-soft text-tr-text-primary'
                            : ' text-tr-text-secondary')
                        }
                      >
                        {scene.index + 1} · {scene.location}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-4 border-t border-tr-border pt-3">
        <label
          className="flex items-center gap-2 text-13 text-tr-text-muted"
          title="Setup/payoff threads — v2"
        >
          <input type="checkbox" disabled />
          Connectors
        </label>
      </div>
    </nav>
  )
}
