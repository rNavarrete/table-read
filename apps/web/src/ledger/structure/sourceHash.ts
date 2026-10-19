import type { Scene } from 'contract'
import { boardOrder } from '../../write/projectTree'

/** Same fingerprint as structure_checks.structure_source_hash (spec: Source hash). */
export async function structureSourceHash(scenes: Scene[]): Promise<string> {
  // Scenes in story order, beats by index: Plan's drag-reorder rewrites those
  // and leaves the stored arrays alone. Matches structure_checks._ordered_scenes.
  const text = boardOrder(scenes)
    .flatMap((scene) =>
      [...(scene.beats ?? [])]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(
          (beat) => `${scene.id}\x1f${beat.id}\x1f${beat.scriptText ?? ''}\x1e`,
        ),
    )
    .join('')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
