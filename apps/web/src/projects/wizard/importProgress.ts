import type { ProjectImportStageName } from 'contract'
import {
  STEP_SECONDS_PER_SCENE,
  USUAL_BAND,
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

  if (isIndeterminate(event.stage)) return withStart

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
    lastProgressAtMs: advanced ? nowMs : withStart.lastProgressAtMs,
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

/** "about N–M min left": scene steps at the measured pace once there is one,
 * every other unfinished step at its prior, ±40%. Null when nothing is left. */
export function etaRange(
  state: ImportProgressState,
  sceneCount: number,
): { lowMin: number; highMin: number } | null {
  if (sceneCount <= 0) return null
  const measuredMs = msPerSceneUnit(state)
  let seconds = 0
  for (const [stage, perScene] of Object.entries(STEP_SECONDS_PER_SCENE) as [
    ProjectImportStageName,
    number,
  ][]) {
    if (state.completedStages.includes(stage)) continue
    if (!SCENE_UNIT_STAGES.includes(stage)) {
      seconds += usualSeconds(stage, sceneCount)
      continue
    }
    const progress = state.stages[stage]
    const left = Math.max(
      0,
      (progress?.total || sceneCount) - (progress?.done ?? 0),
    )
    seconds += left * (measuredMs === null ? perScene : measuredMs / 1_000)
  }
  if (seconds <= 0) return null
  const lowMin = Math.max(1, Math.floor((seconds * (1 - USUAL_BAND)) / 60))
  return {
    lowMin,
    highMin: Math.max(lowMin, Math.ceil((seconds * (1 + USUAL_BAND)) / 60)),
  }
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

export function isImportProgressStale(
  state: ImportProgressState,
  nowMs: number,
): boolean {
  const lastActivityMs = state.lastProgressAtMs ?? state.startedAtMs
  return lastActivityMs !== null && nowMs - lastActivityMs > STALE_PROGRESS_MS
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
