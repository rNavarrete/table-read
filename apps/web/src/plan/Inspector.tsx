import { useState } from 'react'
import type { Episode, LedgerFact, Project, Scene } from 'contract'
import { Chip } from './Chip'
import { LockToggle } from './LockToggle'
import type { PlanSelection } from './SceneCard'
import {
  affectedFacts,
  characterName,
  findScene,
  isBeatEffectivelyLocked,
} from './planTree'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-12 uppercase tracking-wide text-tr-text-muted">
        {label}
      </p>
      <p className="text-13 text-tr-text-primary">{value || '—'}</p>
    </div>
  )
}

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
 * The `whatHappens` field: the one scene field this task wires for real
 * editing (data contract §4 names it a "structural plan field" — the only
 * scene field that triggers the "Structural change — review impact?" footer
 * bar). Keyed by the caller on `${scene.id}:${scene.whatHappens}` so a
 * scene switch *or* a successful save both reset the local draft to the new
 * baseline, without an effect.
 */
function WhatHappensEditor({
  scene,
  locked,
  saving,
  onSave,
}: {
  scene: Scene
  locked: boolean
  saving: boolean
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(scene.whatHappens)
  const dirty = draft !== scene.whatHappens

  return (
    <div>
      <p className="text-12 uppercase tracking-wide text-tr-text-muted">
        What happens
      </p>
      <textarea
        value={draft}
        readOnly={locked}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        className="mt-1 w-full resize-none rounded-card border border-tr-border bg-tr-surface-raised p-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky disabled:opacity-50"
      />
      {dirty && !locked && (
        <div className="mt-2 flex items-center gap-3 rounded-card border border-tr-border bg-tr-surface-sunken p-2">
          <p className="text-13 text-tr-text-secondary">
            Structural change — review impact?
          </p>
          <button
            type="button"
            disabled
            title="Review mode is T4.3"
            className="ml-auto cursor-not-allowed rounded-card bg-tr-coral px-3 py-1 text-13 text-tr-surface-raised opacity-50"
          >
            Open Review
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(draft)}
            className="text-13 text-tr-text-secondary underline disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save field only'}
          </button>
        </div>
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
 * scene — click → Ledger mode"). Ledger mode is T5.1 (build plan) — not
 * built yet, so navigation is a **disabled state** rather than a dead link
 * (brief obligation 7: "leave a disabled state or navigate to a
 * placeholder; flag your choice" — flagged here and in the task report).
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
                disabled
                title="Ledger mode isn't built yet (T5.1)"
                className="flex w-full cursor-not-allowed items-start gap-2 rounded-card border border-tr-border bg-tr-surface-raised p-2 text-left opacity-70"
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
  onSaveWhatHappens: (sceneId: string, value: string) => void
}

/**
 * The right inspector (UI spec §4). Three shapes, driven by `selection`:
 * nothing selected (episode summary + premise), a selected scene (fields,
 * motivations, affected facts, lock toggle), a selected beat (beat fields +
 * `scriptLocked` toggle). `isBeatEffectivelyLocked`/`scene.locked` decide the
 * "Locked selection" read-only + banner state (obligation 3/§4).
 */
export function Inspector({
  project,
  episode,
  ledger,
  selection,
  pending,
  onToggleSceneLock,
  onToggleBeatScriptLock,
  onSaveWhatHappens,
}: InspectorProps) {
  if (selection === null) {
    return (
      <aside
        className="w-panel-inspector shrink-0 rounded-card bg-tr-surface-raised p-4"
        aria-label="Inspector"
        data-testid="inspector"
      >
        <p className="font-display text-15 text-tr-text-primary">
          Episode {episode.index + 1}: {episode.title}
        </p>
        <p className="mt-2 text-13 text-tr-text-secondary">{episode.premise}</p>
        <p className="mt-4 text-12 uppercase tracking-wide text-tr-text-muted">
          Series premise
        </p>
        <p className="mt-1 text-13 text-tr-text-secondary">{project.premise}</p>
      </aside>
    )
  }

  if (selection.type === 'scene') {
    const scene = findScene(project, selection.sceneId)
    if (!scene) return null
    const locked = scene.locked || episode.locked

    return (
      <aside
        className="w-panel-inspector shrink-0 rounded-card bg-tr-surface-raised p-4"
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
          <Field label="Location" value={scene.location} />
          <Field label="Time" value={scene.time} />
          <Field label="Social situation" value={scene.socialSituation} />
          <Field label="Act" value={String(scene.act)} />
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
          <WhatHappensEditor
            key={`${scene.id}:${scene.whatHappens}`}
            scene={scene}
            locked={locked}
            saving={pending}
            onSave={(value) => onSaveWhatHappens(scene.id, value)}
          />
          <Field label="Audience learns" value={scene.audienceLearns} />
          <Field label="Audience feels" value={scene.audienceFeels} />
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
      className="w-panel-inspector shrink-0 rounded-card bg-tr-surface-raised p-4"
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
        <Field label="What happens" value={beat.whatHappens} />
        <Field label="Audience learns" value={beat.audienceLearns} />
        <Field label="Audience feels" value={beat.audienceFeels} />
        <div>
          <p className="text-12 uppercase tracking-wide text-tr-text-muted">
            Script
          </p>
          <p className="mt-1 whitespace-pre-wrap font-script text-12 text-tr-text-primary">
            {beat.scriptText || '—'}
          </p>
        </div>
      </div>
    </aside>
  )
}
