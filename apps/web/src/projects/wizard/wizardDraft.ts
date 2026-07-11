const DRAFT_PREFIX = 'tr.wizard.v1.'

function draftKey(path: string): string {
  return `${DRAFT_PREFIX}${path}`
}

export function saveDraft(path: string, data: unknown): void {
  localStorage.setItem(draftKey(path), JSON.stringify(data))
}

export function loadDraft<T = unknown>(path: string): T | null {
  const stored = localStorage.getItem(draftKey(path))
  if (!stored) return null
  return JSON.parse(stored) as T
}

export function clearDraft(path: string): void {
  localStorage.removeItem(draftKey(path))
}
