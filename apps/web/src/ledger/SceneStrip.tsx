import type { LedgerFact, Project } from 'contract'
import { actLabel } from '../plan/planTree'

export interface SceneStripProps {
  project: Project
  facts: LedgerFact[]
  selectedSceneId: string | null
  onSelectScene: (sceneId: string) => void
}

interface StripScene {
  id: string
  index: number
  act: number
}

function allScenes(project: Project): StripScene[] {
  return project.seasons.flatMap((season) =>
    season.episodes.flatMap((episode) =>
      episode.scenes.map((scene) => ({
        id: scene.id,
        index: scene.index,
        act: typeof scene.act === 'number' ? scene.act : 1,
      })),
    ),
  )
}

/** A compact shared scene spine for finding fact-dense stretches of story. */
export function SceneStrip({
  project,
  facts,
  selectedSceneId,
  onSelectScene,
}: SceneStripProps) {
  const scenes = allScenes(project)
  const counts = new Map<string, number>()
  for (const fact of facts) {
    const sceneId = fact.sourceSpan.sceneId
    counts.set(sceneId, (counts.get(sceneId) ?? 0) + 1)
  }
  const acts = Array.from(new Set(scenes.map((scene) => scene.act))).sort(
    (left, right) => left - right,
  )

  return (
    <section
      className="border-b border-tr-border bg-tr-ledger-content px-1 py-3"
      aria-label="Scene density"
      data-testid="atlas-scene-strip"
    >
      <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
        {acts.map((act) => {
          const actScenes = scenes.filter((scene) => scene.act === act)
          return (
            <div key={act} className="min-w-[116px] flex-1">
              <div className="flex h-10 items-end gap-px rounded-control bg-tr-surface-sunken px-1.5 pb-1">
                {actScenes.map((scene) => {
                  const count = counts.get(scene.id) ?? 0
                  const selected = scene.id === selectedSceneId
                  const height = 5 + Math.min(count, 6) * 3.2
                  const color = selected
                    ? 'bg-tr-amber'
                    : count >= 4
                      ? 'bg-tr-sky'
                      : count > 0
                        ? 'bg-[#c9c9c0]'
                        : 'bg-tr-border-strong'
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      title={`scene ${scene.index + 1} · ${count} facts`}
                      onClick={() => onSelectScene(scene.id)}
                      className={`min-w-1 flex-1 rounded-t-sm ${color} focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral`}
                      style={{ height }}
                      data-testid={`atlas-scene-tick-${scene.index + 1}`}
                    />
                  )
                })}
              </div>
              <p className="mt-1 font-script text-10 uppercase tracking-[0.06em] text-tr-text-muted">
                {project.format ? actLabel(act, project.format) : `ACT ${act}`}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
