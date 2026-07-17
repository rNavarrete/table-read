/**
 * Soft personality layer for Write mode. Tokens only — no new colors.
 *
 * Rollback options (pick one):
 * 1. Set `WRITE_WHIMSY` to `false` and reload.
 * 2. `git revert` the commit that introduced this file / wiring.
 */
export const WRITE_WHIMSY = true

/** Append whimsy classes when the flag is on; otherwise return `base` only. */
export function whimsy(base: string, extra: string): string {
  if (!WRITE_WHIMSY) return base
  return extra ? `${base} ${extra}` : base
}

/** Pick plain vs whimsical value (copy, fully replaced class strings, etc.). */
export function whimsyPick<T>(plain: T, whimsical: T): T {
  return WRITE_WHIMSY ? whimsical : plain
}
