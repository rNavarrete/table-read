import type { ProjectImportStageName } from 'contract'

// Typical seconds per scene for each import step, measured on real runs
// (import board spec, "ETA"). Parsing and saving are near-instant and have
// no entry. These are what usually happens, never a promise.
export const STEP_SECONDS_PER_SCENE: Partial<
  Record<ProjectImportStageName, number>
> = {
  segmenting_beats: 1.97,
  inferring_acts: 0.19,
  inferring_entities: 1.04,
  inferring_promises: 1.55,
  inferring_overview: 0.88,
  extracting_facts: 1.97,
  checking_consistency: 0.64,
}

const FLOOR_SECONDS: Partial<Record<ProjectImportStageName, number>> = {
  inferring_acts: 10,
}

/** The ± share around a typical duration that we call "usual". */
export const USUAL_BAND = 0.4

export function usualSeconds(
  stage: ProjectImportStageName,
  sceneCount: number,
): number {
  return Math.max(
    FLOOR_SECONDS[stage] ?? 0,
    (STEP_SECONDS_PER_SCENE[stage] ?? 0) * sceneCount,
  )
}

/** "usually 10–20 s" for a step's clock; null for steps with no prior. */
export function usualRange(
  stage: ProjectImportStageName,
  sceneCount: number,
): { lowSec: number; highSec: number } | null {
  if (STEP_SECONDS_PER_SCENE[stage] === undefined) return null
  const seconds = usualSeconds(stage, sceneCount)
  return {
    lowSec: Math.round(seconds * (1 - USUAL_BAND)),
    highSec: Math.round(seconds * (1 + USUAL_BAND)),
  }
}
