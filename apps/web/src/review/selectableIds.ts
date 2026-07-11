import type { ChangeSet } from 'contract'

// `regenerate` — the ordinary edit flow. `add` — §9.4 initial_scene_skeleton
// scene additions (objectId is a proposalId, not a final scene id).
const SELECTABLE_APPLY_MODES = new Set(['regenerate', 'add'])

/** Object ids that may be checked for preview/apply (unlocked regenerate or
 * scene-addition rows). */
export function selectableIds(changeSet: ChangeSet): string[] {
  return changeSet.impacted
    .filter((row) => SELECTABLE_APPLY_MODES.has(row.applyMode) && !row.locked)
    .map((row) => row.objectId)
}
