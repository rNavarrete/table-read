import type { BoardScene } from '../importBoard'

// Text shared by the board's components: status is always words, never color
// alone (UI spec §2a accessibility).

export const FAILED_READING =
  "Couldn't break into beats. Kept whole; flagged for you."

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function readState(scene: BoardScene): string {
  if (scene.read === 'pending') return 'Not read yet'
  if (scene.read === 'failed') return "Couldn't be read"
  return `Read, ${plural(scene.beatCount, 'beat')}`
}
