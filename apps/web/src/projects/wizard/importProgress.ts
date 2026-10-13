import type { ProjectImportStageName } from 'contract'
import {
  STEP_SECONDS_PER_SCENE,
  USUAL_BAND,
  usualRange,
  usualSeconds,
} from './importTimings'

export interface StageProgress {
  done: number
  total: number
}

export interface ProgressSample {
  atMs: number
  completedUnits: number
}

export interface ImportProgressState {
  currentStage: ProjectImportStageName | null
  completedStages: ProjectImportStageName[]
  stages: Partial<Record<ProjectImportStageName, StageProgress>>
  startedAtMs: number | null
  lastProgressAtMs: number | null
  samples: ProgressSample[]
  stoppedStage: ProjectImportStageName | null
  stageStartedAtMs: Partial<Record<ProjectImportStageName, number>>
}

export type StageStatus = 'done' | 'now' | 'waiting' | 'stopped'

type ImportProgressEvent =
  | { type: 'stage'; name: ProjectImportStageName }
  | {
      type: 'progress'
      stage: ProjectImportStageName
      done: number
      total: number
    }
  | { type: 'complete' }
  | { type: 'failed' }

const SCENE_UNIT_STAGES: ProjectImportStageName[] = [
  'segmenting_beats',
  'extracting_facts',
]

// Single model calls: their server-sent fractions (threads' "1 of 2") say
// nothing about time left, so the client shows them as indeterminate.
const INDETERMINATE_STAGES: ProjectImportStageName[] = [
  'inferring_acts',
  'inferring_promises',
  'inferring_overview',
  'checking_consistency',
  'saving',
]

// The import runs one step at a time up to the cast, then threads, overview
// and facts→continuity side by side. (TABLEREAD_IMPORT_OVERLAP=0 on the
// server runs them in turn, and the ETA then reads short.)
const SERIAL_STAGES: ProjectImportStageName[] = [
  'segmenting_beats',
  'inferring_acts',
  'inferring_entities',
]
const LATE_BRANCHES: ProjectImportStageName[][] = [
  ['inferring_promises'],
  ['inferring_overview'],
  ['extracting_facts', 'checking_consistency'],
]

const MAX_SAMPLES = 11
// A resume replays saved units the instant a stage starts; that burst is not
// the model's speed.
const BURST_WINDOW_MS = 200
const BURST_UNITS = 3
const MIN_COMPLETED_UNITS_FOR_ETA = 5
const STALE_PROGRESS_MS = 30_000

export const initialImportProgressState: ImportProgressState = {
  currentStage: null,
  completedStages: [],
  stages: {},
  startedAtMs: null,
  lastProgressAtMs: null,
  samples: [],
  stoppedStage: null,
  stageStartedAtMs: {},
}

export function advanceImportProgress(
  state: ImportProgressState,
  event: ImportProgressEvent,
  nowMs: number,
): ImportProgressState {
  const startedAtMs = state.startedAtMs ?? nowMs
  const withStart =
    state.startedAtMs === null
      ? {
          ...state,
          startedAtMs,
          samples: [
            { atMs: nowMs, completedUnits: completedSceneUnits(state) },
          ],
        }
      : state

  if (event.type === 'stage') {
    const isNewStage = withStart.currentStage !== event.name
    // A stopped stage never reads done just because another stage started.
    const previousStage =
      isNewStage && withStart.stoppedStage === null
        ? withStart.currentStage
        : null
    return {
      ...withStart,
      currentStage: event.name,
      lastProgressAtMs: nowMs,
      stoppedStage: null,
      completedStages: addCompletedStage(
        withStart.completedStages,
        previousStage,
      ),
      stageStartedAtMs:
        isNewStage || withStart.stoppedStage !== null
          ? { ...withStart.stageStartedAtMs, [event.name]: nowMs }
          : withStart.stageStartedAtMs,
    }
  }

  if (event.type === 'failed') {
    return { ...withStart, stoppedStage: withStart.currentStage }
  }

  if (event.type === 'complete') {
    const startedStages = Object.keys(
      withStart.stages,
    ) as ProjectImportStageName[]
    const completedStages = [withStart.currentStage, ...startedStages].reduce(
      addCompletedStage,
      withStart.completedStages,
    )

    return {
      ...withStart,
      completedStages,
    }
  }

  // Every progress frame is news, even one whose fraction the client ignores.
  if (isIndeterminate(event.stage))
    return { ...withStart, lastProgressAtMs: nowMs }

  const previousStage = withStart.stages[event.stage] ?? { done: 0, total: 0 }
  const nextStage = {
    done: Math.max(previousStage.done, event.done),
    total: Math.max(previousStage.total, event.total, event.done),
  }
  const stages = { ...withStart.stages, [event.stage]: nextStage }
  const completedUnits = completedSceneUnits({ ...withStart, stages })
  const previousUnits = completedSceneUnits(withStart)
  const advanced = completedUnits > previousUnits
  const stageStartedAtMs = withStart.stageStartedAtMs[event.stage]
  const isBurst =
    stageStartedAtMs !== undefined &&
    nowMs - stageStartedAtMs <= BURST_WINDOW_MS &&
    nextStage.done > BURST_UNITS
  const sample = { atMs: nowMs, completedUnits }

  return {
    ...withStart,
    stages,
    lastProgressAtMs: nowMs,
    samples: !advanced
      ? withStart.samples
      : isBurst
        ? [sample]
        : [...withStart.samples, sample].slice(-MAX_SAMPLES),
  }
}

export function isIndeterminate(stage: ProjectImportStageName): boolean {
  return INDETERMINATE_STAGES.includes(stage)
}

export function stageStatus(
  state: ImportProgressState,
  stage: ProjectImportStageName,
): StageStatus {
  if (state.stoppedStage === stage) return 'stopped'
  if (state.completedStages.includes(stage)) return 'done'
  if (state.currentStage === stage) return 'now'
  return 'waiting'
}

/** "about N–M min left" from `etaSeconds`, ±40%. Null when nothing is left. */
export function etaRange(
  state: ImportProgressState,
  sceneCount: number,
  nowMs?: number,
): { lowMin: number; highMin: number } | null {
  const seconds = etaSeconds(state, sceneCount, nowMs)
  if (seconds <= 0) return null
  const lowMin = Math.max(1, Math.floor((seconds * (1 - USUAL_BAND)) / 60))
  return {
    lowMin,
    highMin: Math.max(lowMin, Math.ceil((seconds * (1 + USUAL_BAND)) / 60)),
  }
}

/** Typical seconds left: scene steps at the measured pace once there is one,
 * every other unfinished step at its prior less the time it has already run
 * (given `nowMs`). The steps up to the cast add up; after them only the
 * longest late branch counts. */
export function etaSeconds(
  state: ImportProgressState,
  sceneCount: number,
  nowMs?: number,
): number {
  if (sceneCount <= 0) return 0
  const measuredMs = msPerSceneUnit(state)
  const done = (stage: ProjectImportStageName) =>
    state.completedStages.includes(stage)
  const secondsSince = (startMs: number | undefined) =>
    nowMs === undefined || startMs === undefined
      ? 0
      : Math.max(0, (nowMs - startMs) / 1_000)
  const prior = (stage: ProjectImportStageName): number => {
    if (done(stage)) return 0
    if (!SCENE_UNIT_STAGES.includes(stage))
      return usualSeconds(stage, sceneCount)
    const progress = state.stages[stage]
    const left = Math.max(
      0,
      (progress?.total || sceneCount) - (progress?.done ?? 0),
    )
    const perScene = STEP_SECONDS_PER_SCENE[stage] ?? 0
    return left * (measuredMs === null ? perScene : measuredMs / 1_000)
  }
  // A scene step's counted units already show its progress; a running
  // single-call step has used up part of its prior.
  const ranFor = (stage: ProjectImportStageName) =>
    stage === state.currentStage && !SCENE_UNIT_STAGES.includes(stage)
      ? secondsSince(state.stageStartedAtMs[stage])
      : 0

  const serial = SERIAL_STAGES.reduce(
    (sum, stage) => sum + Math.max(0, prior(stage) - ranFor(stage)),
    0,
  )
  // Every late branch starts when threads does, even though the server
  // reports overview and facts only after threads ends.
  const lateRunning =
    state.currentStage !== null &&
    LATE_BRANCHES.flat().includes(state.currentStage)
  const lateSpent = lateRunning
    ? secondsSince(state.stageStartedAtMs.inferring_promises)
    : 0
  const branches = LATE_BRANCHES.map((branch) => {
    const head = branch.find((stage) => !done(stage))
    if (head === undefined) return 0
    const seen =
      SCENE_UNIT_STAGES.includes(head) &&
      (head === state.currentStage || state.stages[head] !== undefined)
    const spent = seen ? 0 : head === branch[0] ? lateSpent : ranFor(head)
    const left = branch.reduce((sum, stage) => sum + prior(stage), 0)
    return Math.max(0, left - spent)
  })
  return serial + Math.max(...branches)
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function estimateRemainingMs(
  state: ImportProgressState,
  nowMs: number,
): number | null {
  if (
    state.lastProgressAtMs !== null &&
    nowMs - state.lastProgressAtMs > STALE_PROGRESS_MS
  ) {
    return null
  }

  const msPerUnit = msPerSceneUnit(state)
  if (msPerUnit === null) return null

  const remaining = remainingSceneUnits(state)
  if (remaining <= 0) return 0

  return Math.round(msPerUnit * remaining)
}

function msPerSceneUnit(state: ImportProgressState): number | null {
  const first = state.samples[0]
  const latest = state.samples.at(-1)
  if (first === undefined || latest === undefined) return null
  const completedDelta = latest.completedUnits - first.completedUnits
  const elapsedDelta = latest.atMs - first.atMs
  if (completedDelta < MIN_COMPLETED_UNITS_FOR_ETA || elapsedDelta <= 0) {
    return null
  }
  return elapsedDelta / completedDelta
}

/** No news for 30 s, or, in a step that sends nothing until it ends (acts,
 * cast, threads, logline, continuity), for longer than it usually takes. */
export function isImportProgressStale(
  state: ImportProgressState,
  nowMs: number,
  sceneCount = 0,
): boolean {
  const lastActivityMs = state.lastProgressAtMs ?? state.startedAtMs
  if (lastActivityMs === null) return false
  const stage = state.currentStage
  const usual =
    stage === null || SCENE_UNIT_STAGES.includes(stage)
      ? null
      : usualRange(stage, sceneCount)
  const quietMs = Math.max(STALE_PROGRESS_MS, (usual?.highSec ?? 0) * 1_000)
  return nowMs - lastActivityMs > quietMs
}

function addCompletedStage(
  completedStages: ProjectImportStageName[],
  stage: ProjectImportStageName | null,
): ProjectImportStageName[] {
  if (stage === null || completedStages.includes(stage)) return completedStages
  return [...completedStages, stage]
}

function completedSceneUnits(state: ImportProgressState): number {
  return SCENE_UNIT_STAGES.reduce(
    (sum, stage) => sum + (state.stages[stage]?.done ?? 0),
    0,
  )
}

function remainingSceneUnits(state: ImportProgressState): number {
  const segmenting = state.stages.segmenting_beats
  const extracting = state.stages.extracting_facts
  const extractingTotal = extracting?.total ?? segmenting?.total ?? 0

  return (
    remainingFor(segmenting) +
    Math.max(0, extractingTotal - (extracting?.done ?? 0))
  )
}

function remainingFor(progress: StageProgress | undefined): number {
  if (progress === undefined) return 0
  return Math.max(0, progress.total - progress.done)
}
