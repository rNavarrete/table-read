import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BeatCandidate } from 'contract'
import { suggestInstructions } from '../api/client'
import type { CandidateSlot } from './candidateReducer'
import { formatConflictExplanation } from './formatConflictExplanation'
import {
  normalizeScriptText,
  withNormalizedScriptText,
} from './normalizeScriptText'
import { SuggestionChips } from './SuggestionChips'
import { useTuneSession } from './useTuneSession'
import type { AcceptErrorState } from './useAcceptBeat'

export interface CandidateCardProps {
  index: number
  slot: CandidateSlot
  projectId: string
  sceneId: string
  /** Quiet-AI: true while the canvas is focused — buttons hide (obligation 5). */
  controlsHidden: boolean
  /** Keyboard focus ring (adoption A8). */
  focused?: boolean
  accepting: boolean
  acceptError: AcceptErrorState | null
  onAccept: (candidate: BeatCandidate) => void
  onSkip: () => void
  onReplace: (candidate: BeatCandidate) => void
  /** Session-level retry (regenerates the full 3-card round) — the only
   * retry granularity the generation endpoint offers a failed slot. */
  onRetryGeneration: () => void
}

const cardShell =
  'rounded-card border border-tr-border bg-tr-surface-raised p-4 shadow-raised transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-lift motion-reduce:transform-none motion-reduce:transition-none'
const dangerShell =
  'rounded-card border border-tr-border border-l-4 border-l-tr-danger bg-tr-surface-raised p-4 shadow-raised transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-lift motion-reduce:transform-none motion-reduce:transition-none'

function ScriptPreview({ text }: { text: string }) {
  // UI spec §3: ~8-line script preview. Scrollable so longer beats stay
  // readable; fade removed so the scrollbar isn't fighting a mask.
  return (
    <div
      className="mt-2 max-h-[9.5rem] overflow-y-auto rounded-card bg-tr-surface-clay px-2.5 py-2"
      data-testid="candidate-script-preview"
    >
      <pre className="m-0 whitespace-pre-wrap font-script text-12 leading-relaxed text-tr-text-secondary">
        {normalizeScriptText(text)}
      </pre>
    </div>
  )
}

/**
 * Continuity warning (UI spec §3): Accept stays disabled until the writer
 * acknowledges. Copy is cleaned of ledger internals; the CTA is the action.
 */
function ContinuityWarning({
  conflicts,
  confirmed,
  onConfirm,
}: {
  conflicts: BeatCandidate['continuityConflicts']
  confirmed: boolean
  onConfirm: () => void
}) {
  if (conflicts.length === 0) return null

  const n = conflicts.length
  const heading = confirmed
    ? n === 1
      ? 'Continuity noted'
      : 'Continuity notes acknowledged'
    : n === 1
      ? 'May conflict with the Ledger'
      : `May conflict with ${n} Ledger facts`

  return (
    <div
      className="mt-2 rounded-card border border-tr-border bg-tr-amber-soft px-3 py-2.5"
      data-testid="continuity-conflict"
      role="status"
    >
      <p className="text-13 font-medium text-tr-text-primary">{heading}</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-13 leading-snug text-tr-text-secondary">
        {conflicts.map((conflict) => (
          <li key={conflict.factId}>
            {formatConflictExplanation(conflict.explanation)}
          </li>
        ))}
      </ul>
      {confirmed ? (
        <p className="mt-2 text-12 text-tr-text-secondary">
          Accept is unlocked. Tune if you want to resolve it first.
        </p>
      ) : (
        <button
          type="button"
          onClick={onConfirm}
          data-testid="continuity-conflict-confirm"
          className="mt-2 rounded-chip border border-tr-border bg-tr-surface-raised px-3 py-1 text-13 text-tr-text-primary transition-colors hover:border-tr-coral motion-reduce:transition-none"
        >
          I understand — unlock Accept
        </button>
      )}
    </div>
  )
}

/**
 * One card slot in the right dock. Renders one of three shapes depending on
 * `slot.status` (write/candidateReducer.ts):
 *
 * - `streaming` — provisional scriptText only, growing token-by-token, no
 *   label/plan yet (the server doesn't send those until `candidate_done`) and
 *   no action buttons — never actionable mid-stream (obligation 3).
 * - `done` — the actionable shape: label, beat-plan summary, script preview,
 *   continuity-conflict chips (confirm-to-accept per UI spec §3), Accept /
 *   Tune / Skip.
 * - `failed` — the UI spec §3 Error-state treatment (danger left border,
 *   message, Retry) scoped to this one card, not the whole dock, so a
 *   3-candidate round with one failure leaves the other two actionable.
 *
 * Tune (obligation 4) is a per-card inline session (write/useTuneSession.ts —
 * the SSE machinery reused, scoped to one card). On the tuned candidate's
 * `candidate_done`, it hands the result back to the parent session via
 * `onReplace` (sessionReducer's `replaceSlot`) rather than holding its own
 * "tuned" display state.
 */
export function CandidateCard({
  index,
  slot,
  projectId,
  sceneId,
  controlsHidden,
  focused = false,
  accepting,
  acceptError,
  onAccept,
  onSkip,
  onReplace,
  onRetryGeneration,
}: CandidateCardProps) {
  const tuneSession = useTuneSession(projectId, sceneId)
  const [tuneOpen, setTuneOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [conflictsConfirmed, setConflictsConfirmed] = useState(false)
  const [tuneSuggestions, setTuneSuggestions] = useState<string[]>([])

  const tuning = tuneSession.session.phase !== 'idle'
  const tuneResult = tuneSession.session.slot
  const tuneDone = tuneResult?.status === 'done' ? tuneResult : null

  // This card's own transient UI (the open tune form) resets the instant a
  // tuned candidate resolves — done during render, not in an effect (React's
  // documented "adjust state during render" pattern; see
  // write/useFrozenWhen.ts for the fuller rationale on why an effect would
  // lag a render behind). `handledLocal` tracks which settled result this
  // block has already reacted to, so it fires exactly once per settle.
  const [handledLocal, setHandledLocal] = useState(tuneDone)
  if (tuneDone && tuneDone !== handledLocal) {
    setHandledLocal(tuneDone)
    setTuneOpen(false)
    setInstruction('')
    setConflictsConfirmed(false)
  }

  // Handing the tuned candidate to the *parent's* session, and resetting
  // this card's own tune session, are updates that reach outside this
  // component/render — real side effects, which belong in an effect (unlike
  // the local reset above). Guarded by a ref rather than the render-phase
  // `handledLocal` state above: a ref is only touched here, inside the
  // effect, never during render, so re-renders triggered by `onReplace`'s
  // (unstable, inline-function) identity changing can't double-fire it.
  const notifiedRef = useRef(tuneDone)
  useEffect(() => {
    if (tuneDone && tuneDone !== notifiedRef.current) {
      notifiedRef.current = tuneDone
      onReplace(withNormalizedScriptText(tuneDone.candidate))
      tuneSession.reset()
    }
    // tuneSession is a stable object identity per render, not a dependency
    // (including it would re-run this on every settle-then-reset cycle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tuneDone, onReplace])

  function submitTune(event: FormEvent) {
    event.preventDefault()
    if (slot.status !== 'done' || !instruction.trim()) return
    tuneSession.tune(slot.candidate, instruction.trim())
  }

  async function loadTuneSuggestions() {
    if (instruction.trim()) return
    try {
      const result = await suggestInstructions(projectId, {
        context: 'scene',
        targetId: sceneId,
        surface: 'tune',
        draftScript: null,
      })
      setTuneSuggestions(result.suggestions)
    } catch {
      setTuneSuggestions([])
    }
  }

  if (slot.status === 'streaming') {
    return (
      <div
        className={cardShell}
        aria-live="polite"
        data-testid={`candidate-card-${index}`}
      >
        <p className="text-13 text-tr-text-muted">Drafting…</p>
        <p className="mt-2 max-h-[9.5rem] overflow-y-auto whitespace-pre-wrap font-script text-12 text-tr-text-secondary">
          {normalizeScriptText(slot.provisionalScriptText)}
        </p>
      </div>
    )
  }

  if (slot.status === 'failed') {
    return (
      <div className={dangerShell} data-testid={`candidate-card-${index}`}>
        <p className="text-13 text-tr-text-primary">
          This candidate failed: {slot.error.message}
        </p>
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={onRetryGeneration}
            className="rounded-card bg-tr-coral px-3 py-1.5 text-13 text-tr-surface-raised transition-colors hover:bg-tr-coral-hover motion-reduce:transition-none"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="text-13 text-tr-text-secondary"
          >
            Skip
          </button>
        </div>
      </div>
    )
  }

  const candidate = withNormalizedScriptText(slot.candidate)
  const hasConflicts = candidate.continuityConflicts.length > 0
  const acceptDisabled = accepting || (hasConflicts && !conflictsConfirmed)
  const focusRing = focused ? ' ring-2 ring-tr-sky' : ''

  return (
    <div
      className={(acceptError ? dangerShell : cardShell) + focusRing}
      data-testid={`candidate-card-${index}`}
      data-focused={focused ? 'true' : undefined}
      aria-selected={focused}
    >
      <p className="font-display text-15 text-tr-text-primary">
        <span className="mr-2 text-13 text-tr-text-muted">[{index + 1}]</span>
        {candidate.label}
      </p>
      <p className="mt-1 text-13 text-tr-text-secondary">
        {candidate.beatPlan.whatHappens}
      </p>
      <ScriptPreview text={candidate.scriptText} />
      <ContinuityWarning
        conflicts={candidate.continuityConflicts}
        confirmed={conflictsConfirmed}
        onConfirm={() => setConflictsConfirmed(true)}
      />

      {acceptError && (
        <p className="mt-2 text-13 text-tr-danger">
          Accept failed: {acceptError.message}
        </p>
      )}

      {tuneOpen ? (
        <div className="mt-3">
          {tuning ? (
            <div>
              {tuneResult?.status === 'streaming' && (
                <>
                  <p className="text-13 text-tr-text-muted">Tuning…</p>
                  <p className="mt-1 max-h-[9.5rem] overflow-y-auto whitespace-pre-wrap font-script text-12 text-tr-text-secondary">
                    {normalizeScriptText(tuneResult.provisionalScriptText)}
                  </p>
                </>
              )}
              {(tuneResult?.status === 'failed' ||
                tuneSession.session.connectionError) && (
                <div>
                  <p className="text-13 text-tr-danger">
                    Tune failed:{' '}
                    {tuneResult?.status === 'failed'
                      ? tuneResult.error.message
                      : tuneSession.session.connectionError}
                  </p>
                  <p className="mt-1 text-12 text-tr-text-secondary">
                    The model’s revised beat didn’t match the required shape
                    after one automatic retry. Try Retry, or Tune again with a
                    shorter instruction.
                  </p>
                  <button
                    type="button"
                    onClick={() => tuneSession.retry()}
                    className="mt-2 rounded-card bg-tr-coral px-3 py-1.5 text-13 text-tr-surface-raised transition-colors hover:bg-tr-coral-hover motion-reduce:transition-none"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={submitTune} className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={instruction}
                  onChange={(event) => {
                    setInstruction(event.target.value)
                    if (event.target.value.trim()) setTuneSuggestions([])
                  }}
                  onFocus={() => void loadTuneSuggestions()}
                  placeholder="Adjust this beat…"
                  className="min-w-0 flex-1 rounded-card border border-tr-border bg-tr-surface-page px-3 py-1.5 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                />
                <button
                  type="submit"
                  disabled={!instruction.trim()}
                  className="rounded-card border border-tr-border px-3 py-1.5 text-13 text-tr-text-primary disabled:opacity-50"
                >
                  Go
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTuneOpen(false)
                    setTuneSuggestions([])
                  }}
                  className="text-13 text-tr-text-secondary"
                >
                  Cancel
                </button>
              </div>
              {!instruction.trim() && (
                <SuggestionChips
                  suggestions={tuneSuggestions}
                  onPick={(text) => {
                    setInstruction(text)
                    setTuneSuggestions([])
                  }}
                />
              )}
            </form>
          )}
        </div>
      ) : (
        !controlsHidden && (
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={acceptDisabled}
              title={
                hasConflicts && !conflictsConfirmed
                  ? 'Acknowledge the continuity warning first'
                  : undefined
              }
              onClick={() => onAccept(candidate)}
              className="rounded-card bg-tr-coral px-3 py-1.5 text-13 text-tr-surface-raised transition-colors hover:bg-tr-coral-hover disabled:opacity-50 motion-reduce:transition-none"
            >
              {accepting ? (
                'Accepting…'
              ) : acceptError ? (
                'Retry'
              ) : (
                <>
                  Accept <span aria-hidden="true">[↵]</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={accepting}
              onClick={() => setTuneOpen(true)}
              className="rounded-card border border-tr-coral px-3 py-1.5 text-13 text-tr-coral disabled:opacity-50"
            >
              Tune
            </button>
            <button
              type="button"
              disabled={accepting}
              onClick={onSkip}
              className="text-13 text-tr-text-secondary opacity-60 disabled:opacity-50"
            >
              Skip
            </button>
          </div>
        )
      )}
    </div>
  )
}
