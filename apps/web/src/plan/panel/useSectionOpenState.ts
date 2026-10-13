import { useCallback, useState } from 'react'

export type PlanSectionId = 'scene' | 'wants' | 'touches' | 'beats' | 'details'

const STORAGE_KEY = 'tr.plan.sections.v1'

const DEFAULT_OPEN: Record<PlanSectionId, boolean> = {
  scene: true,
  wants: true,
  touches: true,
  beats: true,
  details: false,
}

function loadOpen(): Record<PlanSectionId, boolean> {
  const open = { ...DEFAULT_OPEN }
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '{}',
    )
    if (stored && typeof stored === 'object') {
      for (const id of Object.keys(open) as PlanSectionId[]) {
        const value = (stored as Record<string, unknown>)[id]
        if (typeof value === 'boolean') open[id] = value
      }
    }
  } catch {
    // Blocked storage or a corrupt value: the defaults still work.
  }
  return open
}

/**
 * Which scene-panel sections are open (spec §4.6: native `<details>`, open or
 * closed remembered per viewer). One setting per browser, not per project.
 * Every storage access is guarded, so the in-memory state keeps working in a
 * private window or with site data blocked (pattern: ledger/viewPreference.ts).
 */
export function useSectionOpenState(): {
  open: Record<PlanSectionId, boolean>
  setOpen: (id: PlanSectionId, open: boolean) => void
} {
  const [open, setOpenState] = useState(loadOpen)

  const setOpen = useCallback((id: PlanSectionId, next: boolean) => {
    setOpenState((prev) => {
      if (prev[id] === next) return prev
      const updated = { ...prev, [id]: next }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      } catch {
        // The in-memory state above still toggles.
      }
      return updated
    })
  }, [])

  return { open, setOpen }
}
