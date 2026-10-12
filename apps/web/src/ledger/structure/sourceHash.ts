import type { Scene } from 'contract'

/** Same fingerprint as structure_checks.structure_source_hash (spec: Source hash). */
export async function structureSourceHash(scenes: Scene[]): Promise<string> {
  // Scenes by (act, index), beats by index: Plan's drag-reorder rewrites those
  // and leaves the stored arrays alone. Matches structure_checks._ordered_scenes.
  const text = [...scenes]
    .sort(
      (a, b) => (a.act ?? 0) - (b.act ?? 0) || (a.index ?? 0) - (b.index ?? 0),
    )
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
