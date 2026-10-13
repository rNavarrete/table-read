import type { ReactNode } from 'react'
import { PlanDraftsContext, usePlanDraftStore } from './usePlanDrafts'

/** Test-only: a real draft store, provided the way PlanScreen provides it.
 * Use as `render(ui, { wrapper: WithDrafts })`. */
export function WithDrafts({ children }: { children: ReactNode }) {
  const drafts = usePlanDraftStore()
  return (
    <PlanDraftsContext.Provider value={drafts}>
      {children}
    </PlanDraftsContext.Provider>
  )
}
