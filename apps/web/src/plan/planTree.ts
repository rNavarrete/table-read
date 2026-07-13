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
import { allScenes, findScene } from '../write/projectTree'

// Re-exported so Plan-mode components have one import surface for the
// project-tree helpers (write/projectTree.ts already owns the generic
// find/flatten logic — reused rather than re-implemented, per CLAUDE.md's
// "don't refactor things that aren't broken" and the reuse/simplification
// review lens).
export { allScenes, findScene }

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

/**
 * Builds the two-or-three-op JSON Patch for dragging `draggedId`'s scene
 * card onto `targetId`'s (UI spec §4 "drag to reorder... within/between
 * acts"; brief obligation 3: "index swap semantics").
 *
 * **Ambiguity resolved (documented per the "report NEEDS_CONTEXT if
 * ambiguous" instruction, but resolved rather than blocked — a coherent
 * reading exists): §4 doesn't spell out act-reassignment semantics for a
 * cross-act drag, and the brief's own "PATCH index swap" phrasing rules out
 * a full list-shift insert (the applier has no `move` op — see
 * `JsonPatchOp`'s doc comment — so any reorder must be expressed as
 * `replace`s on existing fields, never an array splice).**
 *
 * The rule this function implements: the **dragged** scene adopts the
 * **target**'s `act` (if different) and the two scenes swap `index` values.
 * The target's `act` never changes. Worked example (fixture): dragging
 * scene-4 (act 2, index 3) onto scene-3 (act 1, index 2) yields scene-4 →
 * {act 1, index 2}, scene-3 → {act 1, index 3} — scene-4 now renders inside
 * Act One's frame, immediately before scene-3 (Act One's other member,
 * scene-2, is index 1) — exactly the visually-observable "reorder scene-4
 * before scene-3" the acceptance criterion describes. This is symmetric
 * (dragging A onto B or B onto A both produce a valid swap) and always a
 * valid permutation of the project's index set (exchanging two of N unique
 * values never creates a duplicate or a gap), so it needs no renumbering of
 * any other scene.
 *
 * Returns `null` if either scene is missing, or dragging onto itself.
 */
export function buildSceneSwapPatch(
  project: Project,
  draggedId: string,
  targetId: string,
): JsonPatchOp[] | null {
  if (draggedId === targetId) return null
  const dragged = findScene(project, draggedId)
  const target = findScene(project, targetId)
  const draggedPtr = findScenePointer(project, draggedId)
  const targetPtr = findScenePointer(project, targetId)
  if (!dragged || !target || !draggedPtr || !targetPtr) return null

  const ops: JsonPatchOp[] = [
    {
      op: 'replace',
      path: scenePointerPath(draggedPtr, 'index'),
      value: target.index,
    },
    {
      op: 'replace',
      path: scenePointerPath(targetPtr, 'index'),
      value: dragged.index,
    },
  ]
  if (dragged.act !== target.act) {
    ops.push({
      op: 'replace',
      path: scenePointerPath(draggedPtr, 'act'),
      value: target.act,
    })
  }
  return ops
}

/**
 * The optimistic, client-side twin of `buildSceneSwapPatch`: applies the
 * exact same transform to `project` in memory, immediately, before the PATCH
 * round-trips. Kept as a separate pure function (not derived from the ops
 * list) so the optimistic UI update never depends on interpreting JSON
 * Pointers — it's the same rule, expressed structurally.
 */
export function swapScenesLocally(
  project: Project,
  draggedId: string,
  targetId: string,
): Project {
  const dragged = findScene(project, draggedId)
  const target = findScene(project, targetId)
  if (!dragged || !target || draggedId === targetId) return project

  const draggedIndex = dragged.index
  const targetIndex = target.index
  const targetAct = target.act

  return {
    ...project,
    seasons: project.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) => {
          if (scene.id === draggedId) {
            return { ...scene, index: targetIndex, act: targetAct }
          }
          if (scene.id === targetId) {
            return { ...scene, index: draggedIndex }
          }
          return scene
        }),
      })),
    })),
  }
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
