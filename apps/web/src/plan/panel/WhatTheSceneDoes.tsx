import type { Charge, Scene, StoryOverviewBeatItem } from 'contract'
import { PlanField } from './PlanField'
import { draftKey } from './usePlanDrafts'

export interface WhatTheSceneDoesProps {
  scene: Scene
  /** story.landmarksForScene: beat-sheet rows marked in this scene. */
  landmarks: StoryOverviewBeatItem[]
  locked: boolean
  saving: boolean
  openingReview: boolean
  onSaveField: (
    field: 'whatHappens' | 'audienceLearns' | 'audienceFeels',
    value: string,
  ) => Promise<boolean>
  onOpenReview: (instruction: string) => void
  onSuggest: () => Promise<string[]>
  onShowBeat: (beatId: string) => void
}

const CHARGE: Record<Charge, { glyph: string; word: string }> = {
  positive: { glyph: '+', word: 'positive' },
  negative: { glyph: '−', word: 'negative' },
  mixed: { glyph: '±', word: 'mixed' },
}

/**
 * The scene's charges as [shown, spoken]: "− → +" / "negative to positive",
 * "holds at −" when in and out match, one side alone as "opens" / "closes".
 * Never a grade: the row states the charges, it does not judge the turn.
 */
function describeCharges(
  chargeIn: Charge | null,
  chargeOut: Charge | null,
): [string, string] | null {
  const from = chargeIn ? CHARGE[chargeIn] : null
  const to = chargeOut ? CHARGE[chargeOut] : null
  if (from && to) {
    return chargeIn === chargeOut
      ? [`holds at ${from.glyph}`, `holds at ${from.word}`]
      : [`${from.glyph} → ${to.glyph}`, `${from.word} to ${to.word}`]
  }
  if (from) return [`opens ${from.glyph}`, `opens ${from.word}`]
  if (to) return [`closes ${to.glyph}`, `closes ${to.word}`]
  return null
}

/**
 * Panel section 1 (spec §4.6): the fields that steer Next Beat. What happens
 * leads (15px, structural, with the explicit Suggest… button), then any
 * beat-sheet landmark marked in this scene, then The audience, then the
 * import's read-only reading of the scene's turn (T10.1): The turn and Why
 * now, each only when the scene has it. The turn fields default in the
 * contract but can be missing from a raw PATCH doc, hence the falsy checks.
 */
export function WhatTheSceneDoes({
  scene,
  landmarks,
  locked,
  saving,
  openingReview,
  onSaveField,
  onOpenReview,
  onSuggest,
  onShowBeat,
}: WhatTheSceneDoesProps) {
  const stake = scene.valueAtStake
    ? scene.valueAtStake[0].toUpperCase() + scene.valueAtStake.slice(1)
    : ''
  const charges = describeCharges(scene.chargeIn, scene.chargeOut)
  return (
    <div className="flex flex-col gap-3">
      <PlanField
        label="What happens"
        draftKey={draftKey(scene.id, 'whatHappens')}
        sceneId={scene.id}
        value={scene.whatHappens}
        multiline
        lead
        structural
        locked={locked}
        saving={saving}
        openingReview={openingReview}
        onSave={(value) => onSaveField('whatHappens', value)}
        onOpenReview={onOpenReview}
        onSuggest={onSuggest}
      />
      {landmarks.map((row) => {
        const beat = scene.beats.find((b) => b.id === row.beatId)
        return (
          <p
            key={`${row.beatId}:${row.label}`}
            className="rounded-card bg-tr-sky-soft px-3 py-2 text-13 text-tr-text-primary"
          >
            <span className="text-12 font-semibold uppercase tracking-wide">
              {row.label}
            </span>
            {row.summary && <> — {row.summary}</>}
            {beat && (
              <button
                type="button"
                onClick={() => onShowBeat(beat.id)}
                className="ml-2 text-tr-sky underline focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky"
              >
                <span aria-hidden="true">→ </span>
                {`Beat ${scene.index + 1}.${beat.index + 1}`}
              </button>
            )}
          </p>
        )
      })}
      <div>
        <p className="text-12 font-semibold text-tr-text-primary">
          The audience
        </p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <PlanField
            label="Learns"
            ariaLabel="Audience learns"
            draftKey={draftKey(scene.id, 'audienceLearns')}
            sceneId={scene.id}
            value={scene.audienceLearns}
            multiline
            locked={locked}
            saving={saving}
            onSave={(value) => onSaveField('audienceLearns', value)}
          />
          <PlanField
            label="Feels"
            ariaLabel="Audience feels"
            draftKey={draftKey(scene.id, 'audienceFeels')}
            sceneId={scene.id}
            value={scene.audienceFeels}
            multiline
            locked={locked}
            saving={saving}
            onSave={(value) => onSaveField('audienceFeels', value)}
          />
        </div>
      </div>
      {(stake || charges || scene.whyNow) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-13">
          {(stake || charges) && (
            <div className="contents">
              <dt className="text-12 font-semibold text-tr-text-primary">
                The turn
              </dt>
              <dd className="text-tr-text-primary">
                {stake}
                {stake && charges && ': '}
                {charges && (
                  <>
                    <span aria-hidden="true">{charges[0]}</span>
                    <span className="sr-only">{charges[1]}</span>
                  </>
                )}
              </dd>
            </div>
          )}
          {scene.whyNow && (
            <div className="contents">
              <dt className="text-12 font-semibold text-tr-text-primary">
                Why now
              </dt>
              <dd className="text-tr-text-primary">{scene.whyNow}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
