import { useId } from 'react'
import type { Episode, Scene } from 'contract'
import { PlanField } from './PlanField'
import { draftKey } from './usePlanDrafts'

export interface DetailsSectionProps {
  scene: Scene
  /** The episode's storylines; owner decision 4 hides Storyline while empty. */
  storylines: Episode['storylines']
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
  storylines,
  locked,
  saving,
  onSaveField,
}: DetailsSectionProps) {
  const summaryId = useId()
  // Import infers storylines (T10.2); a scene in none is tagged A, which may
  // have no summary.
  const summary = storylines.find((s) => s.id === scene.storyline)?.summary
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
      {storylines.length > 0 && (
        <div>
          <p className="text-12 uppercase tracking-wide text-tr-text-secondary">
            Storyline
          </p>
          <select
            aria-label="Storyline"
            aria-describedby={summary ? summaryId : undefined}
            disabled
            title="Set by the import; editing storylines is v2"
            className="mt-1 text-13 text-tr-text-secondary"
          >
            <option>{scene.storyline}</option>
          </select>
          {summary && (
            <p id={summaryId} className="mt-1 text-13 text-tr-text-primary">
              {summary}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
