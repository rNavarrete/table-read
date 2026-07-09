import type { ConsistencyFlag, Project } from 'contract'
import { allScenes } from '../write/projectTree'

/**
 * Scene ids that should show the Plan-mode amber consistency badge (UI
 * spec §5): any open flag whose `objectId` is the scene itself, or a beat
 * belonging to that scene. Beat-level flags badge the parent scene card —
 * Plan has no per-beat amber affordance yet.
 */
export function sceneIdsWithOpenFlags(
  flags: ConsistencyFlag[],
  project: Project,
): Set<string> {
  const beatToScene = new Map<string, string>()
  for (const scene of allScenes(project)) {
    for (const beat of scene.beats) {
      beatToScene.set(beat.id, scene.id)
    }
  }

  const out = new Set<string>()
  for (const flag of flags) {
    if (flag.status !== 'open') continue
    if (flag.objectType === 'scene') {
      out.add(flag.objectId)
      continue
    }
    const sceneId = beatToScene.get(flag.objectId)
    if (sceneId) out.add(sceneId)
  }
  return out
}
