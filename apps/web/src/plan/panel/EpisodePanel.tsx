import type { Episode, Project } from 'contract'
import { PlanField } from './PlanField'
import { draftKey } from './usePlanDrafts'

export interface EpisodePanelProps {
  project: Project
  episode: Episode
  pending: boolean
  openingReview: boolean
  onSaveEpisodePremise: (value: string) => Promise<boolean>
  onSaveSeriesPremise: (value: string) => Promise<boolean>
}

/**
 * The nothing-selected panel: today's episode and series premises, in the
 * new panel shell. T3.6's Episode view replaces it. Both premises are
 * structural; Open Review stays disabled because Change Set create can't
 * target a premise yet.
 */
export function EpisodePanel({
  project,
  episode,
  pending,
  openingReview,
  onSaveEpisodePremise,
  onSaveSeriesPremise,
}: EpisodePanelProps) {
  return (
    <aside
      data-testid="inspector"
      aria-label="Inspector"
      className="w-panel-plan shrink-0 overflow-y-auto bg-tr-surface-raised p-4"
    >
      <h2 className="font-display text-17 text-tr-text-primary">
        Episode {episode.index + 1}: {episode.title}
      </h2>
      <div className="mt-3 flex flex-col gap-4">
        <PlanField
          label="Episode premise"
          draftKey={draftKey(episode.id, 'premise')}
          sceneId={null}
          value={episode.premise}
          multiline
          structural
          locked={episode.locked}
          saving={pending}
          openingReview={openingReview}
          onSave={onSaveEpisodePremise}
        />
        <PlanField
          label="Series premise"
          draftKey={draftKey('project', 'premise')}
          sceneId={null}
          value={project.premise}
          multiline
          structural
          locked={false}
          saving={pending}
          openingReview={openingReview}
          onSave={onSaveSeriesPremise}
        />
      </div>
    </aside>
  )
}
