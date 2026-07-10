import { useState } from 'react'
import type { InitialSceneSkeletonCandidate } from 'contract'
import {
  createSceneSkeletonChangeSet,
  generateSceneSkeletonCandidates,
} from '../api/client'
import { navigateToReview, stashChangeSet } from '../review/changeSetSession'
import { TRUST_NOTE } from '../projects/wizard/WizardShell'
import { Chip } from './Chip'

export interface GuidedSetupProps {
  projectId: string
}

/**
 * Guided Plan setup (design spec §6/§9.4): shown on Plan while the project
 * has no usable scene skeleton. "Generate scene skeleton" is a separate,
 * explicit gesture (CLAUDE.md rule 8) — the product-wide convergent loop
 * generates exactly three diverse candidates for side-by-side comparison.
 * Choosing one creates an `initial_scene_skeleton` Change Set and sends the
 * writer to Review; the AI proposal never writes directly (rule 3).
 */
export function GuidedSetup({ projectId }: GuidedSetupProps) {
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

  return (
    <div
      data-testid="guided-setup"
      className="mx-auto flex max-w-3xl flex-col gap-6 p-8"
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

      {!candidates && (
        <div className="flex flex-col gap-3 rounded-card border border-tr-border bg-tr-surface-raised p-5 shadow-raised">
          <p className="text-13 leading-6 text-tr-text-secondary">
            Sends your premise, format, story foundation, and characters to the
            model. It proposes three diverse sets of opening scenes — nothing is
            written to your plan until you choose one.
          </p>
          <button
            type="button"
            disabled={generating}
            onClick={() => void handleGenerate()}
            className="self-start rounded-card bg-tr-coral px-4 py-2 text-13 font-medium text-tr-surface-raised transition hover:bg-tr-coral-hover disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Generate scene skeleton'}
          </button>
        </div>
      )}

      {candidates && (
        <div
          className="grid gap-4 sm:grid-cols-3"
          data-testid="skeleton-candidates"
        >
          {candidates.map((candidate) => (
            <div
              key={candidate.candidateId}
              data-testid={`skeleton-candidate-${candidate.candidateId}`}
              className="flex flex-col gap-3 rounded-card border border-tr-border bg-tr-surface-raised p-4 shadow-raised"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-15 font-semibold text-tr-text-primary">
                  {candidate.label}
                </p>
                <Chip hue="neutral">{candidate.scenes.length} scenes</Chip>
              </div>
              <ul className="flex flex-col gap-2">
                {candidate.scenes.map((scene) => (
                  <li
                    key={scene.proposalId}
                    className="rounded-chip bg-tr-surface-clay px-3 py-2 text-13 text-tr-text-secondary"
                  >
                    <p className="font-medium text-tr-text-primary">
                      {scene.location || 'Untitled scene'}
                    </p>
                    <p>{scene.whatHappens}</p>
                  </li>
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
