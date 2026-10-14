import { useCallback, useState } from 'react'

const keyFor = (projectId: string) => `tr.plan.collapsedActs.v1.${projectId}`

function load(projectId: string): Set<number> {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(keyFor(projectId)) ?? '[]',
    )
    if (Array.isArray(stored)) {
      return new Set(stored.filter((n): n is number => Number.isInteger(n)))
    }
  } catch {
    // Blocked storage or a corrupt value: every act starts open.
  }
  return new Set()
}

/**
 * Which act frames are collapsed (spec §4.3: the chevron is persisted), saved
 * per project in this browser. Storage is guarded like useSectionOpenState, so
 * the in-memory state keeps working when site data is blocked.
 */
export function useCollapsedActs(projectId: string): {
  collapsed: Set<number>
  toggle: (act: number) => void
  /** Opens a collapsed act (selecting a scene inside it); no-op when open. */
  expand: (act: number) => void
} {
  // ponytail: loads once per mount; ?project= only changes with a full page
  // load today. Re-load on a projectId change if client-side routing arrives.
  const [collapsed, setCollapsed] = useState(() => load(projectId))

  const update = useCallback(
    (act: number, close: (isClosed: boolean) => boolean) => {
      setCollapsed((prev) => {
        const next = close(prev.has(act))
        if (next === prev.has(act)) return prev
        const updated = new Set(prev)
        if (next) updated.add(act)
        else updated.delete(act)
        try {
          window.localStorage.setItem(
            keyFor(projectId),
            JSON.stringify([...updated]),
          )
        } catch {
          // The in-memory state above still toggles.
        }
        return updated
      })
    },
    [projectId],
  )

  const toggle = useCallback(
    (act: number) => update(act, (isClosed) => !isClosed),
    [update],
  )
  const expand = useCallback(
    (act: number) => update(act, () => false),
    [update],
  )

  return { collapsed, toggle, expand }
}
