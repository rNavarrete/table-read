import type { ChangeSet } from 'contract'

// DESIGN-GAP(T4.3): data contract §4 has no GET /change-sets/{cid} or list
// drafts endpoint. Review mode keeps the active draft in sessionStorage for
// the "one Change Set at a time" UI (spec §5) until a read API lands (Wave 3
// or a follow-on task). ModeSwitcher amber-dot and /review?changeSet= both
// read this stash.

const KEY_PREFIX = 'tr:changeSet:'
const DRAFT_PROJECT_KEY = 'tr:draftChangeSetProject'

function storageKey(changeSetId: string): string {
  return `${KEY_PREFIX}${changeSetId}`
}

export function stashChangeSet(changeSet: ChangeSet): void {
  sessionStorage.setItem(storageKey(changeSet.id), JSON.stringify(changeSet))
  if (changeSet.status === 'draft' || changeSet.status === 'previewing') {
    sessionStorage.setItem(DRAFT_PROJECT_KEY, changeSet.projectId)
  } else {
    clearDraftMarker(changeSet.projectId)
  }
}

export function loadStashedChangeSet(changeSetId: string): ChangeSet | null {
  const raw = sessionStorage.getItem(storageKey(changeSetId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as ChangeSet
  } catch {
    return null
  }
}

export function hasDraftChangeSet(projectId: string): boolean {
  return sessionStorage.getItem(DRAFT_PROJECT_KEY) === projectId
}

function clearDraftMarker(projectId: string): void {
  if (sessionStorage.getItem(DRAFT_PROJECT_KEY) === projectId) {
    sessionStorage.removeItem(DRAFT_PROJECT_KEY)
  }
}

export function clearStashedChangeSet(changeSet: ChangeSet): void {
  sessionStorage.removeItem(storageKey(changeSet.id))
  clearDraftMarker(changeSet.projectId)
}

/** Navigate to Review with the given Change Set, preserving other query params. */
export function navigateToReview(projectId: string, changeSetId: string): void {
  const url = new URL(window.location.href)
  url.pathname = '/review'
  url.searchParams.set('project', projectId)
  url.searchParams.set('changeSet', changeSetId)
  window.location.assign(url.toString())
}
