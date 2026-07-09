import type { ChangeSet } from 'contract'

/** Object ids that may be checked for preview/apply (regenerate + unlocked). */
export function selectableIds(changeSet: ChangeSet): string[] {
  return changeSet.impacted
    .filter((row) => row.applyMode === 'regenerate' && !row.locked)
    .map((row) => row.objectId)
}
