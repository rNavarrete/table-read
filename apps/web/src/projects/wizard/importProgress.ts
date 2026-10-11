import type { ProjectImportStageName } from 'contract'

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
}

type ImportProgressEvent =
  | { type: 'stage'; name: ProjectImportStageName }
  | {
      type: 'progress'
      stage: ProjectImportStageName
      done: number
      total: number
    }
  | { type: 'complete' }

const SCENE_UNIT_STAGES: ProjectImportStageName[] = [
  'segmenting_beats',
  'extracting_facts',
]

const MAX_SAMPLES = 11
const MIN_COMPLETED_UNITS_FOR_ETA = 5
const STALE_PROGRESS_MS = 30_000

export const initialImportProgressState: ImportProgressState = {
  currentStage: null,
  completedStages: [],
  stages: {},
  startedAtMs: null,
  lastProgressAtMs: null,
  samples: [],
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
    const previousStage =
      withStart.currentStage === event.name ? null : withStart.currentStage
    return {
      ...withStart,
      currentStage: event.name,
      completedStages: addCompletedStage(
        withStart.completedStages,
        previousStage,
      ),
    }
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

  const previousStage = withStart.stages[event.stage] ?? { done: 0, total: 0 }
  const nextStage = {
    done: Math.max(previousStage.done, event.done),
    total: Math.max(previousStage.total, event.total, event.done),
  }
  const stages = { ...withStart.stages, [event.stage]: nextStage }
  const completedUnits = completedSceneUnits({ ...withStart, stages })
  const previousUnits = completedSceneUnits(withStart)
  const advanced = completedUnits > previousUnits

  return {
    ...withStart,
    stages,
    lastProgressAtMs: advanced ? nowMs : withStart.lastProgressAtMs,
    samples: advanced
      ? [...withStart.samples, { atMs: nowMs, completedUnits }].slice(
          -MAX_SAMPLES,
        )
      : withStart.samples,
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

  const latest = state.samples.at(-1)
  if (
    latest === undefined ||
    latest.completedUnits < MIN_COMPLETED_UNITS_FOR_ETA ||
    state.samples.length < 2
  ) {
    return null
  }

  const first = state.samples[0]
  const completedDelta = latest.completedUnits - first.completedUnits
  const elapsedDelta = latest.atMs - first.atMs
  if (completedDelta <= 0 || elapsedDelta <= 0) return null

  const remaining = remainingSceneUnits(state)
  if (remaining <= 0) return 0

  return Math.round((elapsedDelta / completedDelta) * remaining)
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
