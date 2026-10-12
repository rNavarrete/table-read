import type { Scene } from 'contract'

/** Same fingerprint as structure_checks.structure_source_hash (spec: Source hash). */
export async function structureSourceHash(scenes: Scene[]): Promise<string> {
  const text = scenes
    .flatMap((scene) =>
      (scene.beats ?? []).map(
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
