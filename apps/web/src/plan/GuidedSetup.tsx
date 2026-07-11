import { useState } from 'react'
import type { InitialSceneSkeletonCandidate, SceneAddition } from 'contract'
import {
  createSceneSkeletonChangeSet,
  generateSceneSkeletonCandidates,
} from '../api/client'
import { navigateToReview, stashChangeSet } from '../review/changeSetSession'
import { TRUST_NOTE } from '../projects/wizard/WizardShell'
import { Chip } from './Chip'
import {
  sceneCharacterNames,
  sceneCountLabel,
  sceneHeading,
  scenePitch,
} from './sceneSkeletonSummary'

export interface GuidedSetupProps {
  projectId: string
  premise?: string
  theme?: string
  characters?: ReadonlyArray<{ id: string; name: string }>
  /** Dismiss guided setup and build the plan by hand (local; no server write). */
  onSkip?: () => void
}

/**
 * Guided Plan setup (design spec §6/§9.4): shown on Plan while the project
 * has no usable scene skeleton. "Generate scene skeleton" is a separate,
 * explicit gesture (CLAUDE.md rule 8) — the product-wide convergent loop
 * generates exactly three diverse candidates for side-by-side comparison.
 * Choosing one creates an `initial_scene_skeleton` Change Set and sends the
 * writer to Review; the AI proposal never writes directly (rule 3).
 */
export function GuidedSetup({
  projectId,
  premise = '',
  theme = '',
  characters = [],
  onSkip,
}: GuidedSetupProps) {
  const [candidates, setCandidates] = useState<
    InitialSceneSkeletonCandidate[] | null
  >(null)
  const [generating, setGenerating] = useState(false)
  const [choosingId, setChoosingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const result = await generateSceneSkeletonCandidates(projectId)
      setCandidates(result)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate a skeleton',
      )
    } finally {
      setGenerating(false)
    }
  }

  async function handleChoose(candidate: InitialSceneSkeletonCandidate) {
    setChoosingId(candidate.candidateId)
    setError(null)
    try {
      const changeSet = await createSceneSkeletonChangeSet(projectId, candidate)
      stashChangeSet(changeSet)
      navigateToReview(projectId, changeSet.id)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to select this option',
      )
      setChoosingId(null)
    }
  }

  const foundationBits = [
    premise.trim() ? { label: 'Premise', value: premise.trim() } : null,
    characters.length > 0
      ? {
          label: 'Characters',
          value: characters.map((c) => c.name).join(', '),
        }
      : null,
    theme.trim() ? { label: 'Theme', value: theme.trim() } : null,
  ].filter((bit): bit is { label: string; value: string } => bit !== null)

  return (
    <div
      data-testid="guided-setup"
      className="mx-auto flex max-w-5xl flex-col gap-6 p-8"
    >
      <div>
        <p className="text-12 uppercase tracking-wide text-tr-text-muted">
          Guided Plan setup
        </p>
        <h2 className="mt-2 font-display text-22 font-semibold text-tr-text-primary">
          Let&apos;s open your first episode.
        </h2>
        <p className="mt-2 text-15 text-tr-text-secondary">
          Generate a scene skeleton from your premise, characters, and theme —
          or skip this and build the plan by hand.
        </p>
      </div>

      {foundationBits.length > 0 && (
        <dl
          data-testid="guided-setup-foundation"
          className="grid gap-3 rounded-card border border-tr-border bg-tr-surface-sunken px-4 py-3 sm:grid-cols-3"
        >
          {foundationBits.map((bit) => (
            <div key={bit.label} className="min-w-0">
              <dt className="text-12 uppercase tracking-wide text-tr-text-muted">
                {bit.label}
              </dt>
              <dd className="mt-1 line-clamp-3 text-13 text-tr-text-primary">
                {bit.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!candidates && (
        <div className="flex flex-col gap-3 rounded-card border border-tr-border bg-tr-surface-raised p-5 shadow-raised">
          <p className="text-13 leading-6 text-tr-text-secondary">
            Sends your premise, format, story foundation, and characters to the
            model. It proposes three diverse sets of opening scenes — nothing is
            written to your plan until you choose one and confirm in Review.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={generating}
              onClick={() => void handleGenerate()}
              className="self-start rounded-card bg-tr-coral px-4 py-2 text-13 font-medium text-tr-surface-raised transition hover:bg-tr-coral-hover disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate scene skeleton'}
            </button>
            {onSkip && (
              <button
                type="button"
                disabled={generating}
                onClick={onSkip}
                className="text-13 text-tr-text-secondary underline disabled:opacity-50"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      )}

      {candidates && (
        <>
          <p className="text-13 text-tr-text-secondary">
            Compare three options. Choosing one opens Review — nothing is
            written until you apply there.
          </p>
          <div
            className="grid gap-4 lg:grid-cols-3"
            data-testid="skeleton-candidates"
          >
            {candidates.map((candidate) => (
              <div
                key={candidate.candidateId}
                data-testid={`skeleton-candidate-${candidate.candidateId}`}
                className="flex flex-col gap-3 rounded-card border border-tr-border bg-tr-surface-raised p-4 shadow-raised"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-15 font-semibold text-tr-text-primary">
                    {candidate.label}
                  </p>
                  <Chip hue="neutral">
                    {sceneCountLabel(candidate.scenes.length)}
                  </Chip>
                </div>
                <ul className="flex flex-col gap-2">
                  {candidate.scenes.map((scene) => (
                    <SceneProposalCard
                      key={scene.proposalId}
                      scene={scene}
                      characters={characters}
                    />
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={choosingId !== null}
                  onClick={() => void handleChoose(candidate)}
                  className="mt-auto rounded-card border border-tr-coral bg-transparent px-3 py-1.5 text-13 font-medium text-tr-coral transition hover:bg-tr-coral-soft disabled:opacity-50"
                >
                  {choosingId === candidate.candidateId
                    ? 'Choosing…'
                    : 'Choose this'}
                </button>
              </div>
            ))}
          </div>
          {onSkip && (
            <button
              type="button"
              disabled={choosingId !== null}
              onClick={onSkip}
              className="self-start text-13 text-tr-text-secondary underline disabled:opacity-50"
            >
              Skip for now — build by hand
            </button>
          )}
        </>
      )}

      {error && (
        <p className="text-13 text-tr-danger" role="alert">
          {error}
        </p>
      )}

      <p className="rounded-card border border-tr-border bg-tr-surface-sunken px-4 py-3 text-13 leading-6 text-tr-text-secondary">
        {TRUST_NOTE}
      </p>
    </div>
  )
}

function SceneProposalCard({
  scene,
  characters,
}: {
  scene: SceneAddition
  characters: ReadonlyArray<{ id: string; name: string }>
}) {
  const heading = sceneHeading(scene)
  const pitch = scenePitch(scene)
  const names = sceneCharacterNames(scene, characters)
  const learns = scene.audienceLearns.trim()
  const feels = scene.audienceFeels.trim()
  const beats = scene.beatPlanSeeds.filter((b) => b.whatHappens.trim())

  return (
    <li className="rounded-chip bg-tr-surface-clay px-3 py-2 text-13 text-tr-text-secondary">
      <p className="font-medium text-tr-text-primary">{heading}</p>
      {pitch ? <p className="mt-1 leading-5">{pitch}</p> : null}
      {names.length > 0 ? (
        <p className="mt-1 text-12 text-tr-text-muted">
          With {names.join(', ')}
        </p>
      ) : null}
      {(learns || feels) && (
        <p className="mt-1 text-12 text-tr-text-muted">
          {learns ? `Audience learns: ${learns}` : null}
          {learns && feels ? ' · ' : null}
          {feels ? `Feels: ${feels}` : null}
        </p>
      )}
      {beats.length > 0 ? (
        <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-12 text-tr-text-muted">
          {beats.map((beat, index) => (
            <li key={`${scene.proposalId}-beat-${index}`}>
              {beat.whatHappens}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  )
}
