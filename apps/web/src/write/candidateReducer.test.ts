import { describe, expect, it } from 'vitest'
import type { BeatCandidate } from 'contract'
import {
  INITIAL_SESSION,
  INITIAL_TUNE_SESSION,
  sessionReducer,
  toStreamEvent,
  tuneReducer,
  type CandidateSession,
  type TuneSession,
} from './candidateReducer'

function candidate(label: string): BeatCandidate {
  return {
    label,
    beatPlan: { whatHappens: 'w', audienceLearns: 'l', audienceFeels: 'f' },
    scriptText: `${label} script`,
    continuityConflicts: [],
  }
}

describe('toStreamEvent', () => {
  it('decodes every server event name', () => {
    expect(
      toStreamEvent({ event: 'candidate_start', data: { index: 1 } }),
    ).toEqual({
      type: 'candidate_start',
      index: 1,
    })
    expect(toStreamEvent({ event: 'delta', data: { text: 'hi' } })).toEqual({
      type: 'delta',
      text: 'hi',
    })
    const cand = candidate('Quiet reveal')
    expect(toStreamEvent({ event: 'candidate_done', data: cand })).toEqual({
      type: 'candidate_done',
      candidate: cand,
    })
    expect(
      toStreamEvent({
        event: 'candidate_failed',
        data: { error: { code: 'SCHEMA_INVALID_LLM', message: 'bad' } },
      }),
    ).toEqual({
      type: 'candidate_failed',
      error: { code: 'SCHEMA_INVALID_LLM', message: 'bad' },
    })
    expect(toStreamEvent({ event: 'done', data: {} })).toEqual({ type: 'done' })
  })

  it('returns null for an unrecognized event name', () => {
    expect(toStreamEvent({ event: 'ping', data: {} })).toBeNull()
  })
})

describe('sessionReducer (3-card generation session, POST .../candidates)', () => {
  it('starts a card streaming and tracks it as current', () => {
    const state = sessionReducer(INITIAL_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    expect(state.phase).toBe('streaming')
    expect(state.currentIndex).toBe(0)
    expect(state.slots[0]).toEqual({
      status: 'streaming',
      provisionalScriptText: '',
    })
  })

  it('appends deltas to only the current card, leaving other slots untouched', () => {
    let state = sessionReducer(INITIAL_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    state = sessionReducer(state, { type: 'delta', text: 'Marta slides' })
    state = sessionReducer(state, { type: 'delta', text: ' a note.' })
    expect(state.slots[0]).toEqual({
      status: 'streaming',
      provisionalScriptText: 'Marta slides a note.',
    })
  })

  it('candidate_done REPLACES the provisional buffer wholesale, making the card actionable', () => {
    let state = sessionReducer(INITIAL_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    state = sessionReducer(state, { type: 'delta', text: 'draft text' })
    const done = candidate('Quiet reveal')
    state = sessionReducer(state, { type: 'candidate_done', candidate: done })
    expect(state.slots[0]).toEqual({ status: 'done', candidate: done })
  })

  it('handles the retry-restart delta case: mid-stream deltas may garble transiently, but candidate_done discards them entirely', () => {
    let state = sessionReducer(INITIAL_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    state = sessionReducer(state, {
      type: 'delta',
      text: 'first attempt opening',
    })
    // Server-side retry (rule 9) restarts its own scriptText prefix with no
    // new candidate_start to mark the seam — the client just keeps
    // appending, per the reducer's documented "provisional display only"
    // contract.
    state = sessionReducer(state, { type: 'delta', text: 'retried opening' })
    expect(state.slots[0]).toEqual({
      status: 'streaming',
      provisionalScriptText: 'first attempt openingretried opening',
    })
    const done = candidate('Deflected ambush')
    state = sessionReducer(state, { type: 'candidate_done', candidate: done })
    // The garbled provisional text never survives past candidate_done.
    expect(state.slots[0]).toEqual({ status: 'done', candidate: done })
  })

  it('candidate_failed marks the card failed, never a partial actionable card', () => {
    let state = sessionReducer(INITIAL_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    state = sessionReducer(state, { type: 'delta', text: 'partial' })
    state = sessionReducer(state, {
      type: 'candidate_failed',
      error: {
        code: 'LLM_UNAVAILABLE',
        message: 'the language model is unavailable',
      },
    })
    expect(state.slots[0]).toEqual({
      status: 'failed',
      error: {
        code: 'LLM_UNAVAILABLE',
        message: 'the language model is unavailable',
      },
    })
  })

  it('runs a full 3-candidate round with a mix of outcomes, then settles on done', () => {
    let state: CandidateSession = INITIAL_SESSION
    state = sessionReducer(state, { type: 'start' })
    state = sessionReducer(state, { type: 'candidate_start', index: 0 })
    state = sessionReducer(state, {
      type: 'candidate_done',
      candidate: candidate('A'),
    })
    state = sessionReducer(state, { type: 'candidate_start', index: 1 })
    state = sessionReducer(state, {
      type: 'candidate_failed',
      error: { code: 'SCHEMA_INVALID_LLM', message: 'bad output' },
    })
    state = sessionReducer(state, { type: 'candidate_start', index: 2 })
    state = sessionReducer(state, {
      type: 'candidate_done',
      candidate: candidate('C'),
    })
    state = sessionReducer(state, { type: 'done' })

    expect(state.phase).toBe('settled')
    expect(state.currentIndex).toBeNull()
    expect(state.slots).toHaveLength(3)
    expect(state.slots[0].status).toBe('done')
    expect(state.slots[1].status).toBe('failed')
    expect(state.slots[2].status).toBe('done')
  })

  it('a connection_error before any candidate_start becomes a session-level error', () => {
    const state = sessionReducer(INITIAL_SESSION, {
      type: 'connection_error',
      message: 'network down',
    })
    expect(state.phase).toBe('settled')
    expect(state.connectionError).toBe('network down')
    expect(state.slots).toHaveLength(0)
  })

  it('a connection_error mid-stream resolves only the in-flight card as failed', () => {
    let state = sessionReducer(INITIAL_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    state = sessionReducer(state, {
      type: 'candidate_done',
      candidate: candidate('A'),
    })
    state = sessionReducer(state, { type: 'candidate_start', index: 1 })
    state = sessionReducer(state, {
      type: 'connection_error',
      message: 'dropped',
    })

    expect(state.phase).toBe('settled')
    expect(state.currentIndex).toBeNull()
    expect(state.slots[0]).toEqual({
      status: 'done',
      candidate: candidate('A'),
    })
    expect(state.slots[1]).toEqual({
      status: 'failed',
      error: { code: 'CONNECTION_ERROR', message: 'dropped' },
    })
  })

  it('ignores stray delta/candidate_done/candidate_failed with no current index (defensive)', () => {
    const state = sessionReducer(INITIAL_SESSION, {
      type: 'delta',
      text: 'orphan',
    })
    expect(state).toEqual(INITIAL_SESSION)
  })

  it('skip removes a card client-side only (no event payload needed)', () => {
    let state = sessionReducer(INITIAL_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    state = sessionReducer(state, {
      type: 'candidate_done',
      candidate: candidate('A'),
    })
    state = sessionReducer(state, { type: 'skip', index: 0 })
    expect(state.slots).toHaveLength(0)
  })

  it('replaceSlot lets a per-card tune result overwrite one slot without touching others', () => {
    let state = sessionReducer(INITIAL_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    state = sessionReducer(state, {
      type: 'candidate_done',
      candidate: candidate('A'),
    })
    state = sessionReducer(state, { type: 'candidate_start', index: 1 })
    state = sessionReducer(state, {
      type: 'candidate_done',
      candidate: candidate('B'),
    })

    const tuned = candidate('Tuned A')
    state = sessionReducer(state, {
      type: 'replaceSlot',
      index: 0,
      slot: { status: 'done', candidate: tuned },
    })

    expect(state.slots[0]).toEqual({ status: 'done', candidate: tuned })
    expect(state.slots[1]).toEqual({
      status: 'done',
      candidate: candidate('B'),
    })
  })

  it('reset returns to the initial idle session', () => {
    let state = sessionReducer(INITIAL_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    state = sessionReducer(state, { type: 'reset' })
    expect(state).toEqual(INITIAL_SESSION)
  })
})

describe('tuneReducer (1-card session, POST .../candidates/tune — reuses the same slot machine)', () => {
  it('streams and resolves exactly like one slot of the generation session', () => {
    let state: TuneSession = INITIAL_TUNE_SESSION
    state = tuneReducer(state, { type: 'start' })
    state = tuneReducer(state, { type: 'candidate_start', index: 0 })
    state = tuneReducer(state, { type: 'delta', text: 'revised opening' })
    expect(state.slot).toEqual({
      status: 'streaming',
      provisionalScriptText: 'revised opening',
    })

    const done = candidate('Deflected ambush')
    state = tuneReducer(state, { type: 'candidate_done', candidate: done })
    state = tuneReducer(state, { type: 'done' })

    expect(state.phase).toBe('settled')
    expect(state.slot).toEqual({ status: 'done', candidate: done })
  })

  it('candidate_failed never leaves a partial actionable slot', () => {
    let state: TuneSession = INITIAL_TUNE_SESSION
    state = tuneReducer(state, { type: 'candidate_start', index: 0 })
    state = tuneReducer(state, {
      type: 'candidate_failed',
      error: { code: 'SCHEMA_INVALID_LLM', message: 'bad' },
    })
    expect(state.slot).toEqual({
      status: 'failed',
      error: { code: 'SCHEMA_INVALID_LLM', message: 'bad' },
    })
  })

  it('a connection_error before any frame becomes a session-level error', () => {
    const state = tuneReducer(INITIAL_TUNE_SESSION, {
      type: 'connection_error',
      message: 'network down',
    })
    expect(state.phase).toBe('settled')
    expect(state.connectionError).toBe('network down')
    expect(state.slot).toBeNull()
  })

  it('reset returns to idle', () => {
    let state = tuneReducer(INITIAL_TUNE_SESSION, {
      type: 'candidate_start',
      index: 0,
    })
    state = tuneReducer(state, { type: 'reset' })
    expect(state).toEqual(INITIAL_TUNE_SESSION)
  })
})
