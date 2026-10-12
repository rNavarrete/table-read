export type LedgerViewId = 'story' | 'atlas' | 'web' | 'threads' | 'structure'

const VIEWS: readonly LedgerViewId[] = [
  'story',
  'atlas',
  'web',
  'threads',
  'structure',
]
const sessionViews = new Map<string, LedgerViewId>()

function storageKey(projectId: string): string {
  return `tr.ledger.view.${projectId}`
}

function isLedgerViewId(value: unknown): value is LedgerViewId {
  return typeof value === 'string' && VIEWS.includes(value as LedgerViewId)
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null)
  } catch {
    return null
  }
}

export function loadLedgerView(projectId: string): LedgerViewId {
  const key = storageKey(projectId)
  const storage = browserStorage()
  const raw = storage ? storage.getItem(key) : (sessionViews.get(key) ?? null)
  return isLedgerViewId(raw) ? raw : 'atlas'
}

export function saveLedgerView(projectId: string, view: LedgerViewId): void {
  const key = storageKey(projectId)
  sessionViews.set(key, view)
  try {
    browserStorage()?.setItem(key, view)
  } catch {
    // Session memory above still keeps controls usable in private/blocked storage.
  }
}
