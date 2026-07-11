import type { ProjectSummary } from 'contract'

export function rowStatus(s: ProjectSummary): 'facts' | 'setup' | 'ready' {
  if (s.pendingReviewCount > 0) return 'facts'
  if (s.setupState === 'incomplete') return 'setup'
  return 'ready'
}
