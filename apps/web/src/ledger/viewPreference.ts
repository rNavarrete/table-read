export type LedgerViewId = 'atlas' | 'web'

const VIEWS: readonly LedgerViewId[] = ['atlas', 'web']

function storageKey(projectId: string): string {
  return `tr.ledger.view.${projectId}`
}

function isLedgerViewId(value: unknown): value is LedgerViewId {
  return typeof value === 'string' && VIEWS.includes(value as LedgerViewId)
}

export function loadLedgerView(projectId: string): LedgerViewId {
  const raw = localStorage.getItem(storageKey(projectId))
  return isLedgerViewId(raw) ? raw : 'atlas'
}

export function saveLedgerView(projectId: string, view: LedgerViewId): void {
  localStorage.setItem(storageKey(projectId), view)
}
