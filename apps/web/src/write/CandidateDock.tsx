import type { BeatCandidate, CraftLevel } from 'contract'
import type { CandidateSession } from './candidateReducer'
import { CandidateCard } from './CandidateCard'
import { CraftLevelPicker } from './CraftLevelPicker'
import type { AcceptErrorState } from './useAcceptBeat'
import { useFrozenWhen } from './useFrozenWhen'

export interface CandidateDockProps {
  session: CandidateSession
  /** Quiet-AI (UI spec §4 / CLAUDE.md rule 8): true while the script canvas
   * is focused. Dims the whole dock to 40% and freezes its content (never
   * updates), and additionally hides every actionable control inside it. */
  quiet: boolean
  /** Keyboard focus among candidate cards (adoption A8). */
  focusedIndex: number | null
  craftLevel: CraftLevel
  onCraftLevelChange: (level: CraftLevel) => void
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
}: {
  onClick: () => void
  disabled: boolean
  hidden: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="next-beat"
      className={
        'flex w-full items-center justify-between rounded-xl bg-tr-coral px-4 py-3 text-15 font-medium text-tr-surface-raised shadow-write-cta transition-colors duration-standard ease-standard hover:bg-tr-coral-hover disabled:opacity-50 motion-reduce:transition-none' +
        (hidden ? ' invisible' : '')
      }
    >
      <span>Suggest next beat</span>
      <span
        aria-hidden="true"
        className="rounded-[5px] border border-tr-coral-hover bg-tr-coral-hover/80 px-1.5 py-px font-script text-[10.5px] text-tr-surface-raised"
      >
        Q
      </span>
    </button>
  )
}

/**
 * CO-WRITER dock (UI spec §4 / Write redesign): craft picker, Suggest next
 * beat, candidate cards. Quiet-AI freeze via `useFrozenWhen`.
 */
export function CandidateDock({
  session: liveSession,
  quiet,
  focusedIndex,
  craftLevel,
  onCraftLevelChange,
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
        'flex h-full min-h-0 w-panel-candidate-dock shrink-0 flex-col overflow-y-auto bg-tr-write-panel px-[22px] pb-10 pt-[22px]' +
        (quiet ? ' opacity-40' : '') +
        (streaming
          ? ' ring-2 ring-inset ring-tr-coral-soft motion-safe:animate-pulse'
          : '')
      }
      aria-label="Co-writer"
      data-testid="candidate-dock"
    >
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <p className="font-script text-11 font-medium uppercase tracking-[0.1em] text-tr-text-muted">
          Co-writer
        </p>
        {!quiet && (
          <CraftLevelPicker
            value={craftLevel}
            onChange={onCraftLevelChange}
            disabled={streaming}
          />
        )}
      </div>

      {session.connectionError ? (
        <div className="rounded-ledger-card border border-tr-border border-l-4 border-l-tr-danger bg-tr-surface-raised p-4 shadow-write-card">
          <p className="text-13 text-tr-text-primary">
            Connection lost: {session.connectionError}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-xl bg-tr-coral px-3 py-1.5 text-13 text-tr-surface-raised hover:bg-tr-coral-hover"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 shrink-0">
            <NextBeatButton
              onClick={onNextBeat}
              disabled={streaming}
              hidden={quiet}
            />
          </div>
          {!empty && (
            <div
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
              data-testid="candidate-dock-scroll"
            >
              {session.slots.map((slot, index) => (
                <CandidateCard
                  key={index}
                  index={index}
                  slot={slot}
                  projectId={projectId}
                  sceneId={sceneId}
                  craftLevel={craftLevel}
                  controlsHidden={quiet}
                  focused={focusedIndex === index}
                  accepting={acceptingIndex === index}
                  acceptError={errorByIndex[index] ?? null}
                  onAccept={(candidate) => onAccept(index, candidate)}
                  onSkip={() => onSkip(index)}
                  onReplace={(candidate) => onReplace(index, candidate)}
                  onRetryGeneration={onRetry}
                />
              ))}
            </div>
          )}
          {empty && !quiet && (
            <p className="mt-auto text-center text-[11.5px] text-tr-text-muted">
              Tune to nudge tone, length, or direction before accepting.
            </p>
          )}
        </>
      )}
    </aside>
  )
}
