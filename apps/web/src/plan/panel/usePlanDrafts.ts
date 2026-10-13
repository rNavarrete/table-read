import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
} from 'react'

/** Unsaved Plan edits, in memory only (redesign spec §4.9 "while browsing"):
 * a draft survives scene switches, a failed save and a server value changing
 * underneath it. Leaving Plan with drafts asks first (useLeaveGuard). */
export interface PlanDrafts {
  get(key: string): string | undefined
  /** sceneId null = not a scene field (premises): counts for leaving, no card dot */
  set(key: string, sceneId: string | null, text: string): void
  clear(key: string): void
  clearAll(): void
  /** Live: current even before React re-renders (beforeunload, leave guard). */
  readonly size: number
  readonly dirtySceneIds: ReadonlySet<string>
}

/** `${objectId}:${field}`; objectId is a scene, beat or episode id, or 'project'. */
export function draftKey(objectId: string, field: string): string {
  return `${objectId}:${field}`
}

interface Entry {
  sceneId: string | null
  text: string
}

// A tiny external store. Every change replaces the map and publishes a new
// PlanDrafts value, so consumers re-render; `get` and `size` read the live
// map, so code that runs before that re-render (an unload, a guard) still
// sees the latest drafts. Not a ref: eslint-plugin-react-hooks 7 forbids
// reading ref.current during render.
function createDraftStore() {
  let entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()

  function commit(next: Map<string, Entry>) {
    entries = next
    snapshot = build()
    for (const listener of listeners) listener()
  }

  function build(): PlanDrafts {
    const dirtySceneIds = new Set<string>()
    for (const entry of entries.values()) {
      if (entry.sceneId) dirtySceneIds.add(entry.sceneId)
    }
    return {
      get: (key) => entries.get(key)?.text,
      set: (key, sceneId, text) =>
        commit(new Map(entries).set(key, { sceneId, text })),
      clear: (key) => {
        if (!entries.has(key)) return
        const next = new Map(entries)
        next.delete(key)
        commit(next)
      },
      clearAll: () => {
        if (entries.size > 0) commit(new Map())
      },
      get size() {
        return entries.size
      },
      dirtySceneIds,
    }
  }

  let snapshot = build()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
  }
}

/** PlanScreen owns one store and provides it through PlanDraftsContext.
 * ponytail: every keystroke re-renders PlanScreen (board + panel); memo Board
 * if typing lags at 70 scenes. */
export function usePlanDraftStore(): PlanDrafts {
  const [store] = useState(createDraftStore)
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

export const PlanDraftsContext = createContext<PlanDrafts | null>(null)

export function usePlanDrafts(): PlanDrafts {
  const drafts = useContext(PlanDraftsContext)
  if (!drafts) throw new Error('PlanDraftsContext missing')
  return drafts
}

export interface FieldDraft {
  /** the draft, else the server value */
  text: string
  /** a draft exists and differs from the server value */
  dirty: boolean
  /** typing back to the server value clears the draft */
  set(next: string): void
  discard(): void
}

/** One field's view of the store. A field calls `discard()` only after its
 * save resolves true: on a failed save the optimistic value equals the draft,
 * the rollback makes it dirty again, and the typed text stays. */
export function useFieldDraft(
  key: string,
  sceneId: string | null,
  value: string,
): FieldDraft {
  const drafts = usePlanDrafts()
  const stored = drafts.get(key)
  return {
    text: stored ?? value,
    dirty: stored !== undefined && stored !== value,
    set: (next) =>
      next === value ? drafts.clear(key) : drafts.set(key, sceneId, next),
    discard: () => drafts.clear(key),
  }
}
