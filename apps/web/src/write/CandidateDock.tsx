import type { BeatCandidate } from 'contract'
import type { CandidateSession } from './candidateReducer'
import { CandidateCard } from './CandidateCard'
import type { AcceptErrorState } from './useAcceptBeat'
import { useFrozenWhen } from './useFrozenWhen'

export interface CandidateDockProps {
  session: CandidateSession
  /** Quiet-AI (UI spec §3 / CLAUDE.md rule 8): true while the script canvas
   * is focused. Dims the whole dock to 40% and freezes its content (never
   * updates), and additionally hides every actionable control inside it. */
  quiet: boolean
  onNextBeat: () => void
  onSkip: (index: number) => void
  onReplace: (index: number, candidate: BeatCandidate) => void
  onAccept: (index: number, candidate: BeatCandidate) => void
  onRetry: () => void
  acceptingIndex: number | null
  errorByIndex: Record<number, AcceptErrorState>
  projectId: string
  sceneId: string
}

function NextBeatButton({
  onClick,
  disabled,
  hidden,
  centered,
}: {
  onClick: () => void
  disabled: boolean
  hidden: boolean
  centered: boolean
}) {
  return (
    <div
      className={centered ? 'flex flex-1 items-center justify-center' : 'mb-4'}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={
          'rounded-card bg-tr-coral px-4 py-2 text-15 text-tr-surface-raised transition-colors hover:bg-tr-coral-hover disabled:opacity-50 motion-reduce:transition-none' +
          (hidden ? ' invisible' : '')
        }
      >
        Next Beat
      </button>
    </div>
  )
}

/**
 * The right dock (UI spec §3): candidate cards, the Next Beat trigger, and
 * the dock-level states (empty, streaming shimmer, connection error).
 * Per-card states (streaming/done/failed) are CandidateCard's job; this
 * component owns only what spans the whole dock.
 *
 * Quiet-AI freeze (obligation 5): `useFrozenWhen` snapshots `session`
 * structurally the instant the canvas gains focus, so React's own render
 * tree stops changing underneath the dimmed dock — CSS opacity alone would
 * still let streaming text repaint invisibly-but-inspectably underneath,
 * which the rule forbids ("never updates").
 */
export function CandidateDock({
  session: liveSession,
  quiet,
  onNextBeat,
  onSkip,
  onReplace,
  onAccept,
  onRetry,
  acceptingIndex,
  errorByIndex,
  projectId,
  sceneId,
}: CandidateDockProps) {
  const session = useFrozenWhen(liveSession, quiet)
  const streaming = session.phase === 'streaming'
  const empty = session.slots.length === 0

  return (
    <aside
      className={
        'flex w-panel-candidate-dock shrink-0 flex-col rounded-card border border-tr-border bg-tr-surface-sunken p-4' +
        (quiet ? ' opacity-40' : '') +
        (streaming
          ? ' ring-2 ring-tr-coral-soft motion-safe:animate-pulse'
          : '')
      }
      aria-label="Candidate dock"
      data-testid="candidate-dock"
    >
      {session.connectionError ? (
        <div className="rounded-card border border-tr-border border-l-4 border-l-tr-danger bg-tr-surface-raised p-4">
          <p className="text-13 text-tr-text-primary">
            Connection lost: {session.connectionError}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-card bg-tr-coral px-3 py-1.5 text-13 text-tr-surface-raised hover:bg-tr-coral-hover"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {empty ? (
            <>
              <NextBeatButton
                onClick={onNextBeat}
                disabled={streaming}
                hidden={quiet}
                centered
              />
            </>
          ) : (
            <>
              <NextBeatButton
                onClick={onNextBeat}
                disabled={streaming}
                hidden={quiet}
                centered={false}
              />
              <div className="flex flex-col gap-4">
                {session.slots.map((slot, index) => (
                  <CandidateCard
                    key={index}
                    index={index}
                    slot={slot}
                    projectId={projectId}
                    sceneId={sceneId}
                    controlsHidden={quiet}
                    accepting={acceptingIndex === index}
                    acceptError={errorByIndex[index] ?? null}
                    onAccept={(candidate) => onAccept(index, candidate)}
                    onSkip={() => onSkip(index)}
                    onReplace={(candidate) => onReplace(index, candidate)}
                    onRetryGeneration={onRetry}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </aside>
  )
}
