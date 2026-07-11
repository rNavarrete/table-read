import type { SceneAddition } from 'contract'

/** Location line for a proposed scene; falls back when the model left fields thin. */
export function sceneHeading(
  scene: Pick<SceneAddition, 'location' | 'time'>,
): string {
  const location = scene.location.trim()
  const time = scene.time.trim()
  if (
    location &&
    time &&
    !location.toUpperCase().includes(time.toUpperCase())
  ) {
    return `${location} — ${time}`
  }
  if (location) return location
  if (time) return time
  return 'Untitled scene'
}

/** One-line pitch used in cards and Review rows. */
export function scenePitch(scene: SceneAddition): string {
  const what = scene.whatHappens.trim()
  if (what && !/^placeholder$/i.test(what)) return what
  const social = scene.socialSituation.trim()
  if (social) return social
  const learns = scene.audienceLearns.trim()
  if (learns) return learns
  return ''
}

export function sceneCharacterNames(
  scene: SceneAddition,
  characters: ReadonlyArray<{ id: string; name: string }>,
): string[] {
  const byId = new Map(characters.map((c) => [c.id, c.name]))
  const names: string[] = []
  const seen = new Set<string>()
  for (const motivation of scene.motivations) {
    const name = byId.get(motivation.characterId) ?? motivation.characterId
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

export function sceneCountLabel(count: number): string {
  return count === 1 ? '1 scene' : `${count} scenes`
}
