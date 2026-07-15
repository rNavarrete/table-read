import type { Beat, Project, Scene } from 'contract'

/**
 * Locates `sceneId` anywhere in the project doc (data contract §1:
 * `Project.seasons[].episodes[].scenes[]`). MVP has exactly one season and
 * one episode, but this walks the full nesting rather than assuming that so
 * it keeps working if that changes. Returns `null` if not found (the caller
 * decides how to surface a missing scene — this module has no server to ask,
 * so it never throws).
 */
export function findScene(project: Project, sceneId: string): Scene | null {
  for (const season of project.seasons) {
    for (const episode of season.episodes) {
      const scene = episode.scenes.find((s) => s.id === sceneId)
      if (scene) return scene
    }
  }
  return null
}

/** Every scene in the project, flattened, in document order. */
export function allScenes(project: Project): Scene[] {
  return project.seasons.flatMap((season) =>
    season.episodes.flatMap((episode) => episode.scenes),
  )
}

const THIN_TOKENS = new Set(['placeholder', 'n/a', 'tbd', 'todo', 'none'])

function isThinField(value: string | undefined | null): boolean {
  const text = (value ?? '').trim()
  if (!text) return true
  return THIN_TOKENS.has(text.toLowerCase())
}

/** True when a scene is empty/stub content that Write should not open on. */
export function isUnusableScene(scene: Scene): boolean {
  if (isThinField(scene.location) || isThinField(scene.whatHappens)) return true
  return false
}

/**
 * Prefer a requested/resume/`?scene=` id when it exists (deep links and Plan
 * double-click always win, even if plan fields are thin — common after
 * import). Otherwise the first scene with beats, else the first usable
 * scene, else the first scene. Automatic fallback skips placeholder stubs
 * so Next Beat isn't run on empty cast context.
 */
export function pickDefaultScene(
  project: Project,
  preferredSceneId?: string | null,
): Scene | null {
  const scenes = allScenes(project)
  if (scenes.length === 0) return null

  if (preferredSceneId) {
    const preferred = findScene(project, preferredSceneId)
    if (preferred) return preferred
  }

  const withBeats = scenes.find(
    (scene) => !isUnusableScene(scene) && scene.beats.length > 0,
  )
  if (withBeats) return withBeats

  const usable = scenes.find((scene) => !isUnusableScene(scene))
  return usable ?? scenes[0] ?? null
}

/**
 * Returns a new `Project` with `sceneId`'s beats replaced by `beats` —
 * everything else structurally shared (only the arrays along the path to the
 * target scene are copied). Used for the accept flow's optimistic
 * insert-then-reconcile (write/useAcceptBeat.ts): the local, client-only
 * beat list shown immediately, then overwritten by the server's authoritative
 * `project` on success or restored verbatim on rollback.
 */
export function withSceneBeats(
  project: Project,
  sceneId: string,
  beats: Beat[],
): Project {
  return {
    ...project,
    seasons: project.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) =>
          scene.id === sceneId ? { ...scene, beats } : scene,
        ),
      })),
    })),
  }
}

/**
 * Splices `beat` into `scene.beats` immediately after `afterBeatId` (or at
 * the top if `null`), renumbering `index` to match — the same insertion
 * semantics as `drama_manager/locks.insert_beat` server-side, reproduced
 * client-side only for the optimistic accept preview (write/useAcceptBeat.ts).
 * The server's response overwrites this the moment it arrives; this never
 * needs to be exactly right, only close enough not to visibly jump.
 */
export function spliceBeat(
  beats: Beat[],
  afterBeatId: string | null,
  beat: Beat,
): Beat[] {
  const insertAt =
    afterBeatId === null ? 0 : beats.findIndex((b) => b.id === afterBeatId) + 1
  const next = beats.slice()
  next.splice(insertAt, 0, beat)
  return next.map((b, index) => ({ ...b, index }))
}
