import type { ChangeSet } from 'contract'

// Warm cache only (user ruling 3): GET /change-sets/{cid} is the source of
// truth. Review prefers GET on load and falls back to this stash when GET is
// unavailable (e.g. API branch not merged yet) or while create→navigate races.
// ModeSwitcher amber-dot and post-create handoff still write here.

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
