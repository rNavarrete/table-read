import type {
  Beat,
  Character,
  Episode,
  LedgerFact,
  Project,
  Scene,
  ShowFormat,
} from 'contract'
import type { JsonPatchOp } from '../api/client'
import { allScenes, boardOrder, findScene } from '../write/projectTree'

// Re-exported so Plan-mode components have one import surface for the
// project-tree helpers (write/projectTree.ts already owns the generic
// find/flatten logic — reused rather than re-implemented, per CLAUDE.md's
// "don't refactor things that aren't broken" and the reuse/simplification
// review lens).
export { allScenes, boardOrder, findScene }

/** Where a scene lives in the doc's array nesting (data contract §1:
 * `Project.seasons[].episodes[].scenes[]`) — needed to build JSON Pointers
 * (RFC 6901), which address arrays by position, not by id. */
export interface ScenePointer {
  seasonIdx: number
  episodeIdx: number
  sceneIdx: number
}

export function findScenePointer(
  project: Project,
  sceneId: string,
): ScenePointer | null {
  for (let seasonIdx = 0; seasonIdx < project.seasons.length; seasonIdx++) {
    const season = project.seasons[seasonIdx]
    for (
      let episodeIdx = 0;
      episodeIdx < season.episodes.length;
      episodeIdx++
    ) {
      const episode = season.episodes[episodeIdx]
      const sceneIdx = episode.scenes.findIndex((s) => s.id === sceneId)
      if (sceneIdx !== -1) return { seasonIdx, episodeIdx, sceneIdx }
    }
  }
  return null
}

function scenePointerPath(pointer: ScenePointer, field: string): string {
  return `/seasons/${pointer.seasonIdx}/episodes/${pointer.episodeIdx}/scenes/${pointer.sceneIdx}/${field}`
}

function findBeatIndex(scene: Scene, beatId: string): number {
  return scene.beats.findIndex((b) => b.id === beatId)
}

export type SceneMove =
  /** A drop on a card: before it (left half) or after it (right half); the
   * scene takes the target's act. */
  | { type: 'insert'; sceneId: string; targetSceneId: string; after: boolean }
  /** The Act select or a drop on an empty act: the chosen act's nearest
   * edge — the start of a later act, the end of an earlier one. */
  | { type: 'act'; sceneId: string; act: number }
  /** ⌥← / ⌥→: one slot in board order; at an act's edge, into the
   * previous / next board act in place (empty acts too). */
  | { type: 'step'; sceneId: string; dir: 1 | -1 }

/** The locked scene that refuses a move (owner decision #2: nothing may
 * shift a locked scene). `renumber`: the move leaves it in place, but its
 * stored index is out of board order and the move would renumber it. */
export type MoveRefusal = { blockedBy: string; renumber?: true }

/** A move's one PATCH and its optimistic twin, or its refusal. */
export type AppliedMove = { ops: JsonPatchOp[]; next: Project } | MoveRefusal

/**
 * Every board move (drop, Act select, ⌥←/⌥→) as one insert into board order
 * (owner decision #2: insert where dropped). The new order is renumbered so
 * `index` = board position (0…N-1), and the result is one PATCH of `replace`
 * ops on `…/index` and `…/act` for exactly the scenes that changed — the
 * applier has no `move` op (see `JsonPatchOp`), and the scenes array order
 * never changes — plus its optimistic twin. A move that would change a locked
 * scene (or any scene in a locked episode) is refused with `{ blockedBy }`:
 * the moved scene itself, else the first locked scene the move passes, else
 * (`renumber`) the first locked scene only the renumbering would change.
 *
 * null when nothing would move (unknown scene or target, a drop beside
 * itself, the scene's own act, a step off the first / last act).
 */
export function applySceneMove(
  project: Project,
  move: SceneMove,
): AppliedMove | null {
  const ptr = findScenePointer(project, move.sceneId)
  if (!ptr) return null
  const episode = project.seasons[ptr.seasonIdx].episodes[ptr.episodeIdx]
  const order = boardOrder(episode.scenes)
  const at = order.findIndex((s) => s.id === move.sceneId)
  const scene = order[at]
  const rest = order.filter((s) => s !== scene)
  let act = scene.act
  let to = at // the scene's slot in `rest`
  if (move.type === 'insert') {
    const t = rest.findIndex((s) => s.id === move.targetSceneId)
    if (t < 0) return null
    act = rest[t].act
    to = t + (move.after ? 1 : 0)
  } else if (move.type === 'act') {
    if (move.act === scene.act) return null
    act = move.act
    const edge = rest.findIndex((s) =>
      act > scene.act ? s.act >= act : s.act > act,
    )
    to = edge < 0 ? rest.length : edge
  } else if (order[at + move.dir]?.act === scene.act) {
    to = at + move.dir // pass one neighbour
  } else {
    const acts = actNumbersForBoard(project.format, episode.scenes)
    const next = acts[acts.indexOf(scene.act) + move.dir]
    if (next === undefined) return null
    act = next // cross the act break in place
  }
  // Same slot, same act: nothing moves, so no renumber-only PATCH either.
  if (to === at && act === scene.act) return null

  // index = board position, so card numbers follow the board.
  const placed = [...rest.slice(0, to), scene, ...rest.slice(to)]
  const changes = new Map<string, Partial<Pick<Scene, 'index' | 'act'>>>()
  placed.forEach((s, index) => {
    const fields: Partial<Pick<Scene, 'index' | 'act'>> = {}
    if (s.index !== index) fields.index = index
    if (s === scene && act !== scene.act) fields.act = act
    if (Object.keys(fields).length > 0) changes.set(s.id, fields)
  })
  const locked = (s: Scene) => episode.locked || s.locked
  if (locked(scene)) return { blockedBy: scene.id }
  const blockers = placed.filter((s) => changes.has(s.id) && locked(s))
  const passed = blockers.find((s) => placed.indexOf(s) !== order.indexOf(s))
  if (passed) return { blockedBy: passed.id }
  if (blockers[0]) return { blockedBy: blockers[0].id, renumber: true }

  const ops: JsonPatchOp[] = episode.scenes.flatMap((s, sceneIdx) =>
    Object.entries(changes.get(s.id) ?? {}).map(([field, value]) => ({
      op: 'replace' as const,
      path: scenePointerPath({ ...ptr, sceneIdx }, field),
      value,
    })),
  )
  const next: Project = {
    ...project,
    seasons: project.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((ep) =>
        ep !== episode
          ? ep
          : {
              ...ep,
              scenes: ep.scenes.map((s) => {
                const c = changes.get(s.id)
                return c ? { ...s, ...c } : s
              }),
            },
      ),
    })),
  }
  return { ops, next }
}

/** Optimistic twin of `buildScenePatch`: sets one field on `sceneId`
 * immutably, everything else structurally shared. */
export function withSceneField<K extends keyof Scene>(
  project: Project,
  sceneId: string,
  field: K,
  value: Scene[K],
): Project {
  return {
    ...project,
    seasons: project.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) =>
          scene.id === sceneId ? { ...scene, [field]: value } : scene,
        ),
      })),
    })),
  }
}

/** Optimistic twin of `buildBeatPatch`: sets one field on `beatId` (within
 * `sceneId`) immutably, everything else structurally shared. */
export function withBeatField(
  project: Project,
  sceneId: string,
  beatId: string,
  field: keyof Beat,
  value: unknown,
): Project {
  return {
    ...project,
    seasons: project.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) =>
          scene.id !== sceneId
            ? scene
            : {
                ...scene,
                beats: scene.beats.map((beat) =>
                  beat.id === beatId ? { ...beat, [field]: value } : beat,
                ),
              },
        ),
      })),
    })),
  }
}

/** Single-field `replace` patch for a scene field (lock toggle, "Save field
 * only"). `null` if the scene isn't found. */
export function buildScenePatch<K extends keyof Scene>(
  project: Project,
  sceneId: string,
  field: K,
  value: Scene[K],
): JsonPatchOp[] | null {
  const pointer = findScenePointer(project, sceneId)
  if (!pointer) return null
  return [{ op: 'replace', path: scenePointerPath(pointer, field), value }]
}

/** Where an episode lives in the doc's array nesting — for episode-field
 * JSON Pointers (e.g. the episode `premise` edited from the inspector's
 * nothing-selected view). */
export function findEpisodePointer(
  project: Project,
  episodeId: string,
): { seasonIdx: number; episodeIdx: number } | null {
  for (let seasonIdx = 0; seasonIdx < project.seasons.length; seasonIdx++) {
    const episodeIdx = project.seasons[seasonIdx].episodes.findIndex(
      (e) => e.id === episodeId,
    )
    if (episodeIdx !== -1) return { seasonIdx, episodeIdx }
  }
  return null
}

/** Single-field `replace` patch for a top-level project field (series
 * `premise`). */
export function buildProjectFieldPatch(
  field: string,
  value: unknown,
): JsonPatchOp[] {
  return [{ op: 'replace', path: `/${field}`, value }]
}

/** Optimistic twin of `buildProjectFieldPatch`. */
export function withProjectField(
  project: Project,
  field: keyof Project,
  value: unknown,
): Project {
  return { ...project, [field]: value }
}

/** Single-field `replace` patch for an episode field (episode `premise`).
 * `null` if the episode isn't found. */
export function buildEpisodePatch(
  project: Project,
  episodeId: string,
  field: string,
  value: unknown,
): JsonPatchOp[] | null {
  const pointer = findEpisodePointer(project, episodeId)
  if (!pointer) return null
  return [
    {
      op: 'replace',
      path: `/seasons/${pointer.seasonIdx}/episodes/${pointer.episodeIdx}/${field}`,
      value,
    },
  ]
}

/** Optimistic twin of `buildEpisodePatch`: sets one field on `episodeId`
 * immutably. */
export function withEpisodeField(
  project: Project,
  episodeId: string,
  field: keyof Episode,
  value: unknown,
): Project {
  return {
    ...project,
    seasons: project.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) =>
        episode.id === episodeId ? { ...episode, [field]: value } : episode,
      ),
    })),
  }
}

/** Single-field `replace` patch for a beat field (the `scriptLocked`
 * toggle, and the inspector's editable beat fields). `null` if the scene or
 * beat isn't found. */
export function buildBeatPatch(
  project: Project,
  sceneId: string,
  beatId: string,
  field: string,
  value: unknown,
): JsonPatchOp[] | null {
  const scenePointer = findScenePointer(project, sceneId)
  if (!scenePointer) return null
  const scene = findScene(project, sceneId)
  if (!scene) return null
  const beatIdx = findBeatIndex(scene, beatId)
  if (beatIdx === -1) return null
  return [
    {
      op: 'replace',
      path: `${scenePointerPath(scenePointer, 'beats')}/${beatIdx}/${field}`,
      value,
    },
  ]
}

/** Every act number the board should render a frame for — the format's own
 * range (cold open + `actCount` acts) unioned with any act value actually
 * present on a scene (defensive: a frame is never silently dropped just
 * because a drag emptied it, and no scene is ever orphaned by a format that
 * disagrees with the data), sorted ascending. */
export function actNumbersForFormat(format: ShowFormat): number[] {
  const count = format.coldOpen ? format.actCount + 1 : format.actCount
  return Array.from({ length: count }, (_, index) => index)
}

export function actNumbersForBoard(
  format: ShowFormat,
  scenes: Scene[],
): number[] {
  const present = scenes.map((s) => s.act)
  return Array.from(new Set([...actNumbersForFormat(format), ...present])).sort(
    (a, b) => a - b,
  )
}

/** Display label for an act frame (UI spec §4: "COLD OPEN", "ACT ONE"…). */
export function actLabel(act: number, format: ShowFormat): string {
  if (format.coldOpen && act === 0) return 'COLD OPEN'
  const ordinal = format.coldOpen ? act : act + 1
  const names = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT']
  return `ACT ${names[ordinal - 1] ?? ordinal}`
}

/** Scenes grouped by `act`, each group sorted by `index` ascending — the
 * board's rendering order (UI spec §4: "Acts as frames... Scene cards"). */
export function groupScenesByAct(scenes: Scene[]): Map<number, Scene[]> {
  const groups = new Map<number, Scene[]>()
  for (const scene of scenes) {
    const group = groups.get(scene.act)
    if (group) group.push(scene)
    else groups.set(scene.act, [scene])
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.index - b.index)
  }
  return groups
}

/** Ledger facts whose `sourceSpan.sceneId` is this scene (UI spec §4
 * "Affected facts" — "ledger facts whose sourceSpan is this scene"). */
export function affectedFacts(
  ledger: LedgerFact[],
  sceneId: string,
): LedgerFact[] {
  return ledger.filter((fact) => fact.sourceSpan.sceneId === sceneId)
}

/** `characterId` → display name, for the motivations table (UI spec §4). */
export function characterName(
  characters: Character[],
  characterId: string,
): string {
  return characters.find((c) => c.id === characterId)?.name ?? characterId
}

/**
 * Whether `beat` is locked once the episode→scene→beat lock cascade is
 * applied for display purposes (mirrors `drama_manager/locks.py`'s
 * `_beat_is_locked` read-side rule exactly: episode.locked OR scene.locked OR
 * beat.locked OR beat.scriptLocked). The backend enforces this cascade on
 * every write path that regenerates content (CLAUDE.md rule 2); the UI needs
 * the same rule purely to *render* the correct locked state — e.g. a beat
 * inside a scene the writer just locked via the inspector is "locked" for
 * display even though its own `beat.locked` flag never changed.
 */
export function isBeatEffectivelyLocked(
  episodeLocked: boolean,
  scene: Scene,
  beat: Beat,
): boolean {
  return Boolean(
    episodeLocked || scene.locked || beat.locked || beat.scriptLocked,
  )
}
