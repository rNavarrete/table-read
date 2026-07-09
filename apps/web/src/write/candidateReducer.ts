import type { BeatCandidate } from 'contract'
import type { RawSseEvent } from '../api/sse'

export interface StreamError {
  code: string
  message: string
}

// One card slot's lifecycle. `streaming` carries only a provisional
// scriptText buffer — no label/beatPlan exists yet, because the server's
// `delta` events surface *only* incremental scriptText (drama_manager/
// candidates.py `extract_script_text_prefix`); the rest of the card is
// unknown until `candidate_done`. A card is actionable (Accept/Tune/Skip)
// only in the `done` state — obligation 3.
export type CandidateSlot =
  | { status: 'streaming'; provisionalScriptText: string }
  | { status: 'done'; candidate: BeatCandidate }
  | { status: 'failed'; error: StreamError }

// One decoded SSE frame (data contract §4), plus `connection_error`: a
// client-synthesized pseudo-event for transport failures the server never
// gets to report (dropped connection, non-2xx before the stream opens).
// Feeding it through the same reducer as every server event means every
// failure mode — reported or not — resolves through one code path.
export type CandidateStreamEvent =
  | { type: 'candidate_start'; index: number }
  | { type: 'delta'; text: string }
  | { type: 'candidate_done'; candidate: BeatCandidate }
  | { type: 'candidate_failed'; error: StreamError }
  | { type: 'done' }
  | { type: 'connection_error'; message: string }

export function toStreamEvent(raw: RawSseEvent): CandidateStreamEvent | null {
  switch (raw.event) {
    case 'candidate_start':
      return {
        type: 'candidate_start',
        index: (raw.data as { index: number }).index,
      }
    case 'delta':
      return { type: 'delta', text: (raw.data as { text: string }).text }
    case 'candidate_done':
      return { type: 'candidate_done', candidate: raw.data as BeatCandidate }
    case 'candidate_failed':
      return {
        type: 'candidate_failed',
        error: (raw.data as { error: StreamError }).error,
      }
    case 'done':
      return { type: 'done' }
    default:
      return null
  }
}

/**
 * The single-slot state machine, shared by the 3-card generation session
 * below and write/useTuneSession.ts's 1-card session — the "reusable by
 * tune" module the SSE client obligation calls for.
 *
 * §8a provisional-buffer-replace semantics: `delta` naively *appends* to the
 * streaming buffer, and `candidate_done` *replaces* the slot wholesale with
 * the authoritative payload. This is deliberately not smarter than that: if
 * the server retries a candidate mid-stream (rule 9), the retry's deltas
 * restart their own scriptText prefix from empty (candidates.py `_stream_one`
 * docstring) without a new `candidate_start` to mark the seam, so a naive
 * append can transiently show a garbled concatenation of the abandoned
 * attempt's partial text and the retry's restart. That's fine — deltas are
 * "provisional display only" (data contract §4) — because `candidate_done`
 * discards the provisional buffer entirely rather than trying to reconcile
 * it, so the glitch is never visible in the resolved card.
 */
export function applyEventToSlot(
  slot: CandidateSlot | undefined,
  event: CandidateStreamEvent,
): CandidateSlot | undefined {
  switch (event.type) {
    case 'candidate_start':
      return { status: 'streaming', provisionalScriptText: '' }
    case 'delta':
      if (!slot || slot.status !== 'streaming') return slot
      return {
        status: 'streaming',
        provisionalScriptText: slot.provisionalScriptText + event.text,
      }
    case 'candidate_done':
      return { status: 'done', candidate: event.candidate }
    case 'candidate_failed':
      return { status: 'failed', error: event.error }
    case 'connection_error':
      if (slot && slot.status !== 'streaming') return slot // already resolved — leave it
      return {
        status: 'failed',
        error: { code: 'CONNECTION_ERROR', message: event.message },
      }
    case 'done':
      return slot
  }
}

// ── the 3-card generation session (POST .../candidates) ────────────────────

export type SessionAction =
  | CandidateStreamEvent
  | { type: 'start' }
  | { type: 'skip'; index: number }
  | { type: 'reset' }
  | { type: 'replaceSlot'; index: number; slot: CandidateSlot }

export interface CandidateSession {
  phase: 'idle' | 'streaming' | 'settled'
  slots: CandidateSlot[]
  currentIndex: number | null
  connectionError: string | null
}

export const INITIAL_SESSION: CandidateSession = {
  phase: 'idle',
  slots: [],
  currentIndex: null,
  connectionError: null,
}

export function sessionReducer(
  state: CandidateSession,
  action: SessionAction,
): CandidateSession {
  switch (action.type) {
    case 'start':
      return { ...INITIAL_SESSION, phase: 'streaming' }
    case 'reset':
      return INITIAL_SESSION
    case 'skip': {
      const slots = state.slots.slice()
      slots.splice(action.index, 1)
      return { ...state, slots }
    }
    case 'replaceSlot': {
      // Tune (per-card) resolves outside this stream, via its own session
      // (useTuneSession) — the card pushes its result back in through here.
      const slots = state.slots.slice()
      slots[action.index] = action.slot
      return { ...state, slots }
    }
    case 'candidate_start': {
      const slots = state.slots.slice()
      slots[action.index] = applyEventToSlot(undefined, action)!
      return { ...state, phase: 'streaming', slots, currentIndex: action.index }
    }
    case 'done':
      return { ...state, phase: 'settled', currentIndex: null }
    case 'connection_error': {
      if (state.currentIndex === null) {
        return { ...state, phase: 'settled', connectionError: action.message }
      }
      const slots = state.slots.slice()
      slots[state.currentIndex] = applyEventToSlot(
        slots[state.currentIndex],
        action,
      )!
      return { ...state, phase: 'settled', slots, currentIndex: null }
    }
    case 'delta':
    case 'candidate_done':
    case 'candidate_failed': {
      if (state.currentIndex === null) return state
      const slots = state.slots.slice()
      slots[state.currentIndex] = applyEventToSlot(
        slots[state.currentIndex],
        action,
      )!
      return { ...state, slots }
    }
  }
}

// ── the 1-card tune session (POST .../candidates/tune) ─────────────────────

export type TuneAction =
  CandidateStreamEvent | { type: 'start' } | { type: 'reset' }

export interface TuneSession {
  phase: 'idle' | 'streaming' | 'settled'
  slot: CandidateSlot | null
  connectionError: string | null
}

export const INITIAL_TUNE_SESSION: TuneSession = {
  phase: 'idle',
  slot: null,
  connectionError: null,
}

export function tuneReducer(
  state: TuneSession,
  action: TuneAction,
): TuneSession {
  switch (action.type) {
    case 'start':
      return { ...INITIAL_TUNE_SESSION, phase: 'streaming' }
    case 'reset':
      return INITIAL_TUNE_SESSION
    case 'done':
      return { ...state, phase: 'settled' }
    case 'connection_error':
      if (state.slot && state.slot.status === 'streaming') {
        return {
          ...state,
          phase: 'settled',
          slot: applyEventToSlot(state.slot, action) ?? null,
        }
      }
      return { ...state, phase: 'settled', connectionError: action.message }
    case 'candidate_start':
    case 'delta':
    case 'candidate_done':
    case 'candidate_failed':
      return {
        ...state,
        phase: 'streaming',
        slot: applyEventToSlot(state.slot ?? undefined, action) ?? null,
      }
  }
}
