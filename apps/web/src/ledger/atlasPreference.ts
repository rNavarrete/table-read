export type AtlasGroupBy = 'scene' | 'character' | 'type' | 'thread' | 'off'
export type AtlasSortBy = 'story_order' | 'fewest_knowers'
export type AtlasDensity = 'compact' | 'comfortable'

export interface AtlasPreferences {
  groupBy: AtlasGroupBy
  sortBy: AtlasSortBy
  density: AtlasDensity
}

export const DEFAULT_ATLAS_PREFERENCES: AtlasPreferences = {
  groupBy: 'scene',
  sortBy: 'story_order',
  density: 'compact',
}

const sessionPreferences = new Map<string, AtlasPreferences>()

function storageKey(projectId: string): string {
  return `tr.ledger.atlas.${projectId}`
}

function isGroupBy(value: unknown): value is AtlasGroupBy {
  return (
    typeof value === 'string' &&
    ['scene', 'character', 'type', 'thread', 'off'].includes(value)
  )
}

function isSortBy(value: unknown): value is AtlasSortBy {
  return (
    typeof value === 'string' &&
    ['story_order', 'fewest_knowers'].includes(value)
  )
}

function isDensity(value: unknown): value is AtlasDensity {
  return value === 'compact' || value === 'comfortable'
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null)
  } catch {
    return null
  }
}

/** Per-project Atlas controls; malformed or older values fall back safely. */
export function loadAtlasPreferences(projectId: string): AtlasPreferences {
  try {
    const key = storageKey(projectId)
    const storage = browserStorage()
    const raw = storage ? storage.getItem(key) : null
    const value: unknown = raw
      ? JSON.parse(raw)
      : storage
        ? DEFAULT_ATLAS_PREFERENCES
        : (sessionPreferences.get(key) ?? DEFAULT_ATLAS_PREFERENCES)
    if (typeof value !== 'object' || value === null)
      return DEFAULT_ATLAS_PREFERENCES
    const candidate = value as Partial<AtlasPreferences>
    return {
      groupBy: isGroupBy(candidate.groupBy)
        ? candidate.groupBy
        : DEFAULT_ATLAS_PREFERENCES.groupBy,
      sortBy: isSortBy(candidate.sortBy)
        ? candidate.sortBy
        : DEFAULT_ATLAS_PREFERENCES.sortBy,
      density: isDensity(candidate.density)
        ? candidate.density
        : DEFAULT_ATLAS_PREFERENCES.density,
    }
  } catch {
    return DEFAULT_ATLAS_PREFERENCES
  }
}

export function saveAtlasPreferences(
  projectId: string,
  preferences: AtlasPreferences,
): void {
  const key = storageKey(projectId)
  sessionPreferences.set(key, preferences)
  try {
    browserStorage()?.setItem(key, JSON.stringify(preferences))
  } catch {
    // Session memory above still keeps controls usable in private/blocked storage.
  }
}
