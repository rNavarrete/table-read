import type { Project } from 'contract'

/**
 * Mirrors the server's `setupState` derivation (data contract §9.1): a
 * project is "ready" iff it has at least one scene containing at least one
 * beat; otherwise Plan shows Guided setup (design spec §6) instead of the
 * (empty) board.
 */
export function needsGuidedSetup(project: Project): boolean {
  const scenes = project.seasons.flatMap((season) =>
    season.episodes.flatMap((episode) => episode.scenes),
  )
  return !scenes.some((scene) => scene.beats.length > 0)
}
