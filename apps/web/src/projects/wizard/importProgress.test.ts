import { describe, expect, it } from 'vitest'
import type { ProjectImportStageName } from 'contract'
import {
  advanceImportProgress,
  estimateRemainingMs,
  etaRange,
  etaSeconds,
  formatElapsed,
  type ImportProgressState,
  initialImportProgressState,
  isImportProgressStale,
  isIndeterminate,
  stageStatus,
} from './importProgress'
import { usualRange } from './importTimings'

function startStages(
  names: ProjectImportStageName[],
  state: ImportProgressState = initialImportProgressState,
): ImportProgressState {
  return names.reduce(
    (current, name, k) =>
      advanceImportProgress(current, { type: 'stage', name }, k * 1_000),
    state,
  )
}

describe('import progress model', () => {
  it('keeps the latest spentUsd a progress frame carries (T11.1)', () => {
    const started = startStages(['segmenting_beats'])
    expect(started.spentUsd).toBeNull()
    const spent = advanceImportProgress(
      started,
      {
        type: 'progress',
        stage: 'segmenting_beats',
        done: 1,
        total: 3,
        spentUsd: 0.42,
      },
      2_000,
    )
    expect(spent.spentUsd).toBe(0.42)
    // A single-call step's frame counts too; one without it keeps the last.
    const acts = advanceImportProgress(
      spent,
      {
        type: 'progress',
        stage: 'inferring_acts',
        done: 1,
        total: 1,
        spentUsd: 0.6,
      },
      3_000,
    )
    expect(acts.spentUsd).toBe(0.6)
    expect(
      advanceImportProgress(
        acts,
        { type: 'progress', stage: 'extracting_facts', done: 1, total: 3 },
        4_000,
      ).spentUsd,
    ).toBe(0.6)
  })

  it('starts a stage without completing it and completes the prior stage on next start', () => {
    const segmenting = advanceImportProgress(
      initialImportProgressState,
      { type: 'stage', name: 'segmenting_beats' },
      1_000,
    )

    expect(segmenting.currentStage).toBe('segmenting_beats')
    expect(segmenting.completedStages).not.toContain('segmenting_beats')

    const extracting = advanceImportProgress(
      segmenting,
      { type: 'stage', name: 'extracting_facts' },
      2_000,
    )

    expect(extracting.currentStage).toBe('extracting_facts')
    expect(extracting.completedStages).toContain('segmenting_beats')
    expect(extracting.completedStages).not.toContain('extracting_facts')
  })

  it('does not complete a stage when its start frame is duplicated', () => {
    const started = advanceImportProgress(
      initialImportProgressState,
      { type: 'stage', name: 'segmenting_beats' },
      1_000,
    )

    const duplicate = advanceImportProgress(
      started,
      { type: 'stage', name: 'segmenting_beats' },
      2_000,
    )

    expect(duplicate.currentStage).toBe('segmenting_beats')
    expect(duplicate.completedStages).not.toContain('segmenting_beats')
  })

  it('keeps progress counters monotonic for duplicate or out-of-order frames', () => {
    const started = advanceImportProgress(
      initialImportProgressState,
      { type: 'stage', name: 'segmenting_beats' },
      0,
    )
    const current = advanceImportProgress(
      started,
      { type: 'progress', stage: 'segmenting_beats', done: 5, total: 10 },
      5_000,
    )

    const stale = advanceImportProgress(
      current,
      { type: 'progress', stage: 'segmenting_beats', done: 3, total: 8 },
      6_000,
    )
    const duplicate = advanceImportProgress(
      stale,
      { type: 'progress', stage: 'segmenting_beats', done: 5, total: 10 },
      7_000,
    )

    expect(stale.stages.segmenting_beats).toEqual({ done: 5, total: 10 })
    expect(duplicate.stages.segmenting_beats).toEqual({ done: 5, total: 10 })
    expect(duplicate.samples).toHaveLength(current.samples.length)
  })

  it('estimates remaining time from the latest 10 intervals after 5 completed scene units', () => {
    let state = advanceImportProgress(
      initialImportProgressState,
      { type: 'stage', name: 'segmenting_beats' },
      0,
    )

    state = advanceImportProgress(
      state,
      { type: 'progress', stage: 'segmenting_beats', done: 1, total: 20 },
      10_000,
    )
    for (let done = 2; done <= 12; done += 1) {
      state = advanceImportProgress(
        state,
        { type: 'progress', stage: 'segmenting_beats', done, total: 20 },
        9_000 + done * 1_000,
      )
    }

    expect(state.samples).toHaveLength(11)
    expect(estimateRemainingMs(state, 21_000)).toBe(28_000)
  })

  it('does not estimate before 5 completed units and hides stale estimates', () => {
    let state = advanceImportProgress(
      initialImportProgressState,
      { type: 'stage', name: 'segmenting_beats' },
      0,
    )
    for (let done = 1; done <= 4; done += 1) {
      state = advanceImportProgress(
        state,
        { type: 'progress', stage: 'segmenting_beats', done, total: 10 },
        done * 1_000,
      )
    }

    expect(estimateRemainingMs(state, 4_000)).toBeNull()

    state = advanceImportProgress(
      state,
      { type: 'progress', stage: 'segmenting_beats', done: 5, total: 10 },
      5_000,
    )

    expect(estimateRemainingMs(state, 20_000)).not.toBeNull()
    expect(estimateRemainingMs(state, 36_001)).toBeNull()
  })

  it('treats a started import with no progress frames as stale after 30 seconds', () => {
    const state = advanceImportProgress(
      initialImportProgressState,
      { type: 'stage', name: 'segmenting_beats' },
      1_000,
    )

    expect(isImportProgressStale(state, 31_000)).toBe(false)
    expect(isImportProgressStale(state, 31_001)).toBe(true)
  })

  it('marks current and progress-started stages done when complete arrives', () => {
    let state = advanceImportProgress(
      initialImportProgressState,
      { type: 'stage', name: 'saving' },
      1_000,
    )
    state = advanceImportProgress(
      state,
      { type: 'progress', stage: 'segmenting_beats', done: 1, total: 1 },
      1_500,
    )

    const complete = advanceImportProgress(state, { type: 'complete' }, 2_000)

    expect(complete.completedStages).toContain('saving')
    expect(complete.completedStages).toContain('segmenting_beats')
  })

  it('formats elapsed time as minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_000)).toBe('1:05')
  })

  it('keeps single-call steps indeterminate and ignores their server fractions', () => {
    let state = startStages(['inferring_promises'])
    state = advanceImportProgress(
      state,
      { type: 'progress', stage: 'inferring_promises', done: 1, total: 2 },
      1_000,
    )

    expect(isIndeterminate('inferring_promises')).toBe(true)
    expect(state.stages.inferring_promises).toBeUndefined()
    expect(stageStatus(state, 'inferring_promises')).toBe('now')

    const singletons: ProjectImportStageName[] = [
      'inferring_acts',
      'inferring_promises',
      'inferring_overview',
      'checking_consistency',
      'saving',
    ]
    for (const stage of singletons) expect(isIndeterminate(stage)).toBe(true)
    const counted: ProjectImportStageName[] = [
      'parsing_scenes',
      'segmenting_beats',
      'inferring_entities',
      'extracting_facts',
    ]
    for (const stage of counted) expect(isIndeterminate(stage)).toBe(false)
  })

  it('records when each stage started for the step clock', () => {
    let state = startStages(['parsing_scenes', 'segmenting_beats'])
    state = advanceImportProgress(
      state,
      { type: 'stage', name: 'segmenting_beats' },
      5_000,
    )

    expect(state.stageStartedAtMs).toEqual({
      parsing_scenes: 0,
      segmenting_beats: 1_000,
    })
  })

  it('stops the current stage on a failed frame', () => {
    const state = advanceImportProgress(
      startStages(['parsing_scenes', 'segmenting_beats', 'inferring_acts']),
      { type: 'failed' },
      3_000,
    )

    expect(state.stoppedStage).toBe('inferring_acts')
    expect(stageStatus(state, 'inferring_acts')).toBe('stopped')
    expect(stageStatus(state, 'segmenting_beats')).toBe('done')
    expect(stageStatus(state, 'inferring_entities')).toBe('waiting')

    const resumed = advanceImportProgress(
      state,
      { type: 'stage', name: 'inferring_entities' },
      9_000,
    )
    expect(resumed.stoppedStage).toBeNull()
    expect(resumed.completedStages).not.toContain('inferring_acts')
  })

  it('does not count a cached burst right after a stage start as speed', () => {
    let state = startStages(['segmenting_beats'])
    // A resume replays 20 saved scenes the instant the stage starts.
    state = advanceImportProgress(
      state,
      { type: 'progress', stage: 'segmenting_beats', done: 20, total: 40 },
      50,
    )
    for (let k = 1; k <= 5; k += 1) {
      state = advanceImportProgress(
        state,
        {
          type: 'progress',
          stage: 'segmenting_beats',
          done: 20 + k,
          total: 40,
        },
        50 + k * 30_000,
      )
    }

    // 5 real scenes at 30 s each; 15 segmenting + 40 facts still to go.
    expect(estimateRemainingMs(state, 150_050)).toBe(55 * 30_000)
    // Scene steps at the measured 30 s, plus every single-call step's prior:
    // 450 + acts 10 + entities 41.6, then the longest late branch, facts
    // 1200 + consistency 25.6 (threads 62, overview 35.2) = 1727.2 s, ±40%.
    expect(etaRange(state, 40)).toEqual({ lowMin: 17, highMin: 41 })
  })

  it('estimates from per-scene priors for every step before any speed is known', () => {
    // 60 scenes: segmenting 65.7 s + acts 11.4 + entities 62.4, then the
    // longest late branch, facts 65.7 + consistency 38.4 = 243.5 s, ±40%.
    expect(etaRange(initialImportProgressState, 60)).toEqual({
      lowMin: 2,
      highMin: 6,
    })

    // Threads now: the longest branch is facts 65.7 s + consistency 38.4
    // (threads 93, overview 52.8) = 104.1 s, ±40%.
    const threads = startStages([
      'parsing_scenes',
      'segmenting_beats',
      'inferring_acts',
      'inferring_entities',
      'inferring_promises',
    ])
    expect(etaRange(threads, 60)).toEqual({ lowMin: 1, highMin: 3 })
    expect(etaRange(initialImportProgressState, 0)).toBeNull()
  })

  it('counts every stage start and progress frame as news, and gives a single-call step its usual time', () => {
    // 60 scenes: threads usually take 93 s (56–130 s); started at 4 s.
    let state = startStages([
      'parsing_scenes',
      'segmenting_beats',
      'inferring_acts',
      'inferring_entities',
      'inferring_promises',
    ])
    expect(state.lastProgressAtMs).toBe(4_000)
    state = advanceImportProgress(
      state,
      { type: 'progress', stage: 'inferring_promises', done: 1, total: 2 },
      5_000,
    )
    expect(state.lastProgressAtMs).toBe(5_000)

    expect(isImportProgressStale(state, 44_000, 60)).toBe(false)
    // 40 s of every late branch already run: facts and consistency's 104.1 s
    // less 40 = 64.1 s, ±40%.
    expect(etaRange(state, 60, 44_000)).toEqual({ lowMin: 1, highMin: 2 })
    expect(isImportProgressStale(state, 135_001, 60)).toBe(true)
    // A scene step's units are due every few seconds: 30 s still means stale.
    const facts = advanceImportProgress(
      state,
      { type: 'stage', name: 'extracting_facts' },
      100_000,
    )
    expect(isImportProgressStale(facts, 130_001, 60)).toBe(true)
  })

  it('counts down only the longest late branch after the cast step', () => {
    // 60 scenes, 40 s into threads, facts done: threads 93 − 40 = 53 s
    // outlasts overview 52.8 − 40 and consistency 38.4.
    const threads = startStages([
      'parsing_scenes',
      'segmenting_beats',
      'inferring_acts',
      'inferring_entities',
      'inferring_promises',
    ])
    const factsDone: ImportProgressState = {
      ...threads,
      completedStages: [...threads.completedStages, 'extracting_facts'],
    }
    expect(etaSeconds(factsDone, 60, 44_000)).toBeCloseTo(53)
    // Facts not done: its branch has run those 40 s too.
    expect(etaSeconds(threads, 60, 44_000)).toBeCloseTo(
      (60 * 1.97) / 1.8 + 38.4 - 40,
    )
  })

  it('adds the longest late branch, not every one, before the cast step', () => {
    // 60 scenes, 5 s into acts: acts 11.4 − 5 + entities 62.4, then
    // max(threads 93, overview 52.8, facts 65.7 + consistency 38.4).
    const acts = startStages([
      'parsing_scenes',
      'segmenting_beats',
      'inferring_acts',
    ])
    expect(etaSeconds(acts, 60, 7_000)).toBeCloseTo(
      11.4 - 5 + 62.4 + (60 * 1.97) / 1.8 + 38.4,
    )
  })

  it('gives a usual range for each single-call step', () => {
    expect(usualRange('inferring_acts', 20)).toEqual({
      lowSec: 6,
      highSec: 14,
    })
    expect(usualRange('inferring_promises', 60)).toEqual({
      lowSec: 56,
      highSec: 130,
    })
    expect(usualRange('parsing_scenes', 60)).toBeNull()
  })
})
