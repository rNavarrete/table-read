import { useState } from 'react'
import type { Episode, LedgerFact, Project, Scene } from 'contract'
import { suggestInstructions } from '../api/client'
import { SuggestionChips } from '../write/SuggestionChips'
import { Chip } from './Chip'
import { LockToggle } from './LockToggle'
import type { PlanSelection } from './SceneCard'
import {
  affectedFacts,
  actLabel,
  actNumbersForFormat,
  characterName,
  findScene,
  isBeatEffectivelyLocked,
} from './planTree'

function LockBanner() {
  return (
    <p
      role="status"
      className="rounded-card border border-tr-border bg-tr-amber-soft px-3 py-2 text-13 text-tr-text-primary"
    >
      Locked — unlock to edit
    </p>
  )
}

/**
 * The structural-edit footer bar (UI spec §4): shown when a **structural plan
 * field** (scene `whatHappens`, `premise`, storyline summaries — data contract
 * §4) is dirty. *Open Review* creates a Change Set from the dirty draft and
 * navigates to Review (T4.3). *Save field only* writes the field as a direct
 * PATCH with no regeneration — but the server still runs the post-save
 * consistency scan (the flagging promise holds even when the writer skips
 * Review).
 *
 * `onOpenReview` is omitted for targets the create API can't accept yet
 * (episode/series premise — create only validates scene/beat/character/
 * ledgerFact). Those rows keep Save field only.
 */
function StructuralFooter({
  saving,
  openingReview,
  onSave,
  onOpenReview,
}: {
  saving: boolean
  openingReview?: boolean
  onSave: () => void
  onOpenReview?: () => void
}) {
  const reviewDisabled = !onOpenReview || saving || !!openingReview
  return (
    <div className="mt-2 flex items-center gap-3 rounded-card border border-tr-border bg-tr-surface-sunken p-2">
      <p className="text-13 text-tr-text-secondary">
        Structural change — review impact?
      </p>
      <button
        type="button"
        disabled={reviewDisabled}
        title={
          onOpenReview ? undefined : 'Open Review needs a scene or beat target'
        }
        onClick={onOpenReview}
        className={
          'ml-auto rounded-card bg-tr-coral px-3 py-1 text-13 text-tr-surface-raised' +
          (reviewDisabled ? ' cursor-not-allowed opacity-50' : '')
        }
      >
        {openingReview ? 'Opening…' : 'Open Review'}
      </button>
      <button
        type="button"
        disabled={saving || !!openingReview}
        onClick={onSave}
        className="text-13 text-tr-text-secondary underline disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save field only'}
      </button>
    </div>
  )
}

/**
 * One inspector field the writer can edit (UI spec §4 `InspectorField`:
 * read-only-when-locked built in). A dirty edit surfaces a save affordance:
 *   - `structural` fields (scene `whatHappens`, `premise`, storyline summaries)
 *     show the {@link StructuralFooter} "review impact?" bar (the edit will
 *     trigger `scan_consistency` server-side, §4);
 *   - every other field shows a plain *Save* button — a silent direct PATCH.
 * Read-only (no save affordance) while `locked`. Keyed by the caller on the
 * field's server value so a selection change *or* a successful save resets the
 * draft to the new baseline without an effect.
 */
function EditableField({
  label,
  value,
  structural = false,
  multiline = false,
  locked,
  saving,
  openingReview,
  onSave,
  onOpenReview,
  suggestSceneId,
  projectId,
}: {
  label: string
  value: string
  structural?: boolean
  multiline?: boolean
  locked: boolean
  saving: boolean
  openingReview?: boolean
  onSave: (value: string) => void
  /** When set, Open Review is enabled for this structural field. */
  onOpenReview?: (instruction: string) => void
  /** When set and draft is empty, load A4 suggestion chips for scene premise. */
  suggestSceneId?: string
  projectId?: string
}) {
  const [draft, setDraft] = useState(value)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const dirty = draft !== value
  const controlClass =
    'mt-1 w-full rounded-card border border-tr-border bg-tr-surface-raised p-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky disabled:opacity-50'

  async function loadSuggestions() {
    if (!suggestSceneId || !projectId || draft.trim() || locked) return
    try {
      const result = await suggestInstructions(projectId, {
        context: 'scene',
        targetId: suggestSceneId,
        surface: 'scene_premise',
        draftScript: null,
      })
      setSuggestions(result.suggestions)
    } catch {
      setSuggestions([])
    }
  }

  return (
    <div>
      <p className="text-12 uppercase tracking-wide text-tr-text-muted">
        {label}
      </p>
      {multiline ? (
        <textarea
          aria-label={label}
          value={draft}
          readOnly={locked}
          disabled={saving || !!openingReview}
          onChange={(e) => {
            setDraft(e.target.value)
            if (e.target.value.trim()) setSuggestions([])
          }}
          onFocus={() => void loadSuggestions()}
          rows={4}
          className={`${controlClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          aria-label={label}
          value={draft}
          readOnly={locked}
          disabled={saving || !!openingReview}
          onChange={(e) => {
            setDraft(e.target.value)
            if (e.target.value.trim()) setSuggestions([])
          }}
          onFocus={() => void loadSuggestions()}
          className={controlClass}
        />
      )}
      {!draft.trim() && !locked && (
        <SuggestionChips
          suggestions={suggestions}
          disabled={saving || !!openingReview}
          onPick={(text) => {
            setDraft(text)
            setSuggestions([])
          }}
        />
      )}
      {dirty && !locked && structural && (
        <StructuralFooter
          saving={saving}
          openingReview={openingReview}
          onSave={() => onSave(draft)}
          onOpenReview={onOpenReview ? () => onOpenReview(draft) : undefined}
        />
      )}
      {dirty && !locked && !structural && (
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(draft)}
          className="mt-2 rounded-card bg-tr-coral px-3 py-1 text-13 text-tr-surface-raised disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  )
}

function MotivationsTable({
  scene,
  project,
}: {
  scene: Scene
  project: Project
}) {
  if (scene.motivations.length === 0) return null
  return (
    <div>
      <p className="text-12 uppercase tracking-wide text-tr-text-muted">
        Motivations
      </p>
      <table className="mt-1 w-full text-13">
        <thead>
          <tr className="text-left text-12 text-tr-text-muted">
            <th className="pr-2 font-normal">Character</th>
            <th className="pr-2 font-normal">Objective</th>
            <th className="pr-2 font-normal">Stakes</th>
            <th className="font-normal">Obstacle</th>
          </tr>
        </thead>
        <tbody>
          {scene.motivations.map((m) => (
            <tr key={m.characterId} className="align-top">
              <td className="pr-2 py-1 text-tr-text-primary">
                {characterName(project.seriesBible.characters, m.characterId)}
              </td>
              <td className="pr-2 py-1 text-tr-text-secondary">
                {m.objective}
              </td>
              <td className="pr-2 py-1 text-tr-text-secondary">{m.stakes}</td>
              <td className="py-1 text-tr-text-secondary">{m.obstacle}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Affected-facts list (UI spec §4: "ledger facts whose sourceSpan is this
 * scene — click → Ledger mode"). Navigates to `/ledger?fact=` so Ledger can
 * scroll/highlight the card (T5.1).
 */
function AffectedFacts({ facts }: { facts: LedgerFact[] }) {
  return (
    <div>
      <p className="text-12 uppercase tracking-wide text-tr-text-muted">
        Affected facts
      </p>
      {facts.length === 0 ? (
        <p className="mt-1 text-13 text-tr-text-muted">None yet.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1.5">
          {facts.map((fact) => (
            <li key={fact.id}>
              <button
                type="button"
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.pathname = '/ledger'
                  url.searchParams.set('fact', fact.id)
                  window.location.assign(url.toString())
                }}
                className="flex w-full items-start gap-2 rounded-card border border-tr-border bg-tr-surface-raised p-2 text-left hover:bg-tr-surface-clay"
              >
                <span className="text-13 text-tr-text-primary">
                  {fact.fact}
                </span>
                <Chip hue="sky">{fact.factType}</Chip>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export interface InspectorProps {
  project: Project
  episode: Episode
  ledger: LedgerFact[]
  selection: PlanSelection
  pending: boolean
  onToggleSceneLock: (sceneId: string, locked: boolean) => void
  onToggleBeatScriptLock: (
    sceneId: string,
    beatId: string,
    scriptLocked: boolean,
  ) => void
  onSaveSceneField: <K extends keyof Scene>(
    sceneId: string,
    field: K,
    value: Scene[K],
  ) => void
  onSaveBeatField: (
    sceneId: string,
    beatId: string,
    field: string,
    value: string,
  ) => void
  onSaveProjectField: (field: string, value: string) => void
  onSaveEpisodeField: (episodeId: string, field: string, value: string) => void
  /** Create a Change Set from a structural draft and open Review (T4.3). */
  onOpenReview?: (targetObjectId: string, instruction: string) => void
  openingReview?: boolean
}

/**
 * The right inspector (UI spec §4). Three shapes, driven by `selection`:
 * nothing selected (episode + series premise), a selected scene (fields,
 * motivations, affected facts, lock toggle), a selected beat (beat fields +
 * `scriptLocked` toggle). All value fields are editable via a per-field Save
 * (structural fields — `whatHappens`, `premise` — through the "review impact?"
 * footer). `isBeatEffectivelyLocked`/`scene.locked` decide the "Locked
 * selection" read-only + banner state (§4).
 */
export function Inspector({
  project,
  episode,
  ledger,
  selection,
  pending,
  openingReview = false,
  onToggleSceneLock,
  onToggleBeatScriptLock,
  onSaveSceneField,
  onSaveBeatField,
  onSaveProjectField,
  onSaveEpisodeField,
  onOpenReview,
}: InspectorProps) {
  if (selection === null) {
    return (
      <aside
        className="w-panel-inspector shrink-0 overflow-y-auto rounded-card bg-tr-surface-raised p-4"
        aria-label="Inspector"
        data-testid="inspector"
      >
        <p className="font-display text-15 text-tr-text-primary">
          Episode {episode.index + 1}: {episode.title}
        </p>
        <div className="mt-2 flex flex-col gap-3">
          <EditableField
            key={`${episode.id}:premise:${episode.premise}`}
            label="Episode premise"
            value={episode.premise}
            structural
            multiline
            locked={episode.locked}
            saving={pending}
            openingReview={openingReview}
            onSave={(value) => onSaveEpisodeField(episode.id, 'premise', value)}
          />
          <EditableField
            key={`premise:${project.premise}`}
            label="Series premise"
            value={project.premise}
            structural
            multiline
            locked={false}
            saving={pending}
            openingReview={openingReview}
            onSave={(value) => onSaveProjectField('premise', value)}
          />
        </div>
      </aside>
    )
  }

  if (selection.type === 'scene') {
    const scene = findScene(project, selection.sceneId)
    if (!scene) return null
    const locked = scene.locked || episode.locked

    return (
      <aside
        className="w-panel-inspector shrink-0 overflow-y-auto rounded-card bg-tr-surface-raised p-4"
        aria-label="Inspector"
        data-testid="inspector"
      >
        <div className="flex flex-col gap-3">
          <LockToggle
            locked={scene.locked}
            label="Scene"
            disabled={pending}
            onChange={(next) => onToggleSceneLock(scene.id, next)}
          />
          {locked && <LockBanner />}
          <EditableField
            key={`${scene.id}:location:${scene.location}`}
            label="Location"
            value={scene.location}
            locked={locked}
            saving={pending}
            onSave={(value) => onSaveSceneField(scene.id, 'location', value)}
          />
          <EditableField
            key={`${scene.id}:time:${scene.time}`}
            label="Time"
            value={scene.time}
            locked={locked}
            saving={pending}
            onSave={(value) => onSaveSceneField(scene.id, 'time', value)}
          />
          <EditableField
            key={`${scene.id}:socialSituation:${scene.socialSituation}`}
            label="Social situation"
            value={scene.socialSituation}
            locked={locked}
            saving={pending}
            onSave={(value) =>
              onSaveSceneField(scene.id, 'socialSituation', value)
            }
          />
          <label className="text-12 uppercase tracking-wide text-tr-text-muted">
            Act
            <select
              aria-label="Act"
              value={scene.act}
              disabled={locked || pending}
              onChange={(event) =>
                onSaveSceneField(scene.id, 'act', Number(event.target.value))
              }
              className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-2 py-1 text-13 text-tr-text-primary disabled:opacity-50"
            >
              {actNumbersForFormat(project.format).map((act) => (
                <option key={act} value={act}>
                  {actLabel(act, project.format)}
                </option>
              ))}
            </select>
          </label>
          <div>
            <p className="text-12 uppercase tracking-wide text-tr-text-muted">
              Storyline
            </p>
            <select
              disabled
              title="Storyline tagging is v2"
              className="mt-1 text-13 text-tr-text-muted"
            >
              <option>{scene.storyline}</option>
            </select>
          </div>
          <EditableField
            key={`${scene.id}:whatHappens:${scene.whatHappens}`}
            label="What happens"
            value={scene.whatHappens}
            structural
            multiline
            locked={locked}
            saving={pending}
            openingReview={openingReview}
            projectId={project.id}
            suggestSceneId={scene.id}
            onSave={(value) => onSaveSceneField(scene.id, 'whatHappens', value)}
            onOpenReview={
              onOpenReview
                ? (instruction) => onOpenReview(scene.id, instruction)
                : undefined
            }
          />
          <EditableField
            key={`${scene.id}:audienceLearns:${scene.audienceLearns}`}
            label="Audience learns"
            value={scene.audienceLearns}
            multiline
            locked={locked}
            saving={pending}
            onSave={(value) =>
              onSaveSceneField(scene.id, 'audienceLearns', value)
            }
          />
          <EditableField
            key={`${scene.id}:audienceFeels:${scene.audienceFeels}`}
            label="Audience feels"
            value={scene.audienceFeels}
            multiline
            locked={locked}
            saving={pending}
            onSave={(value) =>
              onSaveSceneField(scene.id, 'audienceFeels', value)
            }
          />
          <MotivationsTable scene={scene} project={project} />
          <AffectedFacts facts={affectedFacts(ledger, scene.id)} />
        </div>
      </aside>
    )
  }

  const scene = findScene(project, selection.sceneId)
  const beat = scene?.beats.find((b) => b.id === selection.beatId)
  if (!scene || !beat) return null
  const locked = isBeatEffectivelyLocked(episode.locked, scene, beat)

  return (
    <aside
      className="w-panel-inspector shrink-0 overflow-y-auto rounded-card bg-tr-surface-raised p-4"
      aria-label="Inspector"
      data-testid="inspector"
    >
      <div className="flex flex-col gap-3">
        <LockToggle
          locked={beat.scriptLocked}
          label="Script"
          disabled={pending}
          onChange={(next) => onToggleBeatScriptLock(scene.id, beat.id, next)}
        />
        {locked && <LockBanner />}
        <EditableField
          key={`${beat.id}:whatHappens:${beat.whatHappens}`}
          label="What happens"
          value={beat.whatHappens}
          multiline
          locked={locked}
          saving={pending}
          onSave={(value) =>
            onSaveBeatField(scene.id, beat.id, 'whatHappens', value)
          }
        />
        <EditableField
          key={`${beat.id}:audienceLearns:${beat.audienceLearns}`}
          label="Audience learns"
          value={beat.audienceLearns}
          multiline
          locked={locked}
          saving={pending}
          onSave={(value) =>
            onSaveBeatField(scene.id, beat.id, 'audienceLearns', value)
          }
        />
        <EditableField
          key={`${beat.id}:audienceFeels:${beat.audienceFeels}`}
          label="Audience feels"
          value={beat.audienceFeels}
          multiline
          locked={locked}
          saving={pending}
          onSave={(value) =>
            onSaveBeatField(scene.id, beat.id, 'audienceFeels', value)
          }
        />
        <EditableField
          key={`${beat.id}:scriptText:${beat.scriptText}`}
          label="Script"
          value={beat.scriptText}
          multiline
          locked={locked}
          saving={pending}
          onSave={(value) =>
            onSaveBeatField(scene.id, beat.id, 'scriptText', value)
          }
        />
      </div>
    </aside>
  )
}
