import type { Scene } from 'contract'
import { PlanField } from './PlanField'
import { draftKey } from './usePlanDrafts'

export interface DetailsSectionProps {
  scene: Scene
  /** `episode.storylines.length > 0`: owner decision 4 hides Storyline otherwise. */
  showStoryline: boolean
  locked: boolean
  saving: boolean
  onSaveField: (
    field: 'location' | 'time' | 'socialSituation',
    value: string,
  ) => Promise<boolean>
}

const FIELDS = [
  { field: 'location', label: 'Location', multiline: false },
  { field: 'time', label: 'Time', multiline: false },
  { field: 'socialSituation', label: 'Social situation', multiline: true },
] as const

/** Section 5 (closed by default): the scene's plain metadata (spec §4.6, §4.12). */
export function DetailsSection({
  scene,
  showStoryline,
  locked,
  saving,
  onSaveField,
}: DetailsSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      {FIELDS.map(({ field, label, multiline }) => (
        <PlanField
          key={field}
          label={label}
          draftKey={draftKey(scene.id, field)}
          sceneId={scene.id}
          value={scene[field]}
          multiline={multiline}
          locked={locked}
          saving={saving}
          onSave={(value) => onSaveField(field, value)}
        />
      ))}
      {showStoryline && (
        <div>
          <p className="text-12 uppercase tracking-wide text-tr-text-secondary">
            Storyline
          </p>
          <select
            aria-label="Storyline"
            disabled
            title="Storyline tagging is v2"
            className="mt-1 text-13 text-tr-text-secondary"
          >
            <option>{scene.storyline}</option>
          </select>
        </div>
      )}
    </div>
  )
}
