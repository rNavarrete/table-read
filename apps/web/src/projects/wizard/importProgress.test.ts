import { describe, expect, it } from 'vitest'
import {
  advanceImportProgress,
  estimateRemainingMs,
  formatElapsed,
  initialImportProgressState,
  isImportProgressStale,
} from './importProgress'

describe('import progress model', () => {
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
})
