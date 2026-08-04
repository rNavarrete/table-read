import type { Scene } from 'contract'

export type SceneLocationType = 'int' | 'ext' | 'other'

/** INT / EXT / other from location/time for outline type dots. */
export function sceneLocationType(scene: Scene): SceneLocationType {
  const slug = `${scene.location} ${scene.time}`.toUpperCase()
  if (
    /\bEXT\b/.test(slug) ||
    slug.startsWith('EXT.') ||
    slug.startsWith('EXT ')
  ) {
    return 'ext'
  }
  if (
    /\bINT\b/.test(slug) ||
    slug.startsWith('INT.') ||
    slug.startsWith('INT ') ||
    slug.includes('I/E') ||
    slug.includes('INT/EXT')
  ) {
    return 'int'
  }
  return 'other'
}

export function sceneTypeDotClass(type: SceneLocationType): string {
  if (type === 'ext') return 'bg-tr-write-dot-ext'
  if (type === 'int') return 'bg-tr-write-dot-int'
  return 'bg-tr-write-dot-other'
}
