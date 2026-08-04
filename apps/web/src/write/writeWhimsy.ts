/**
 * Soft personality layer for Write mode — superseded by the Write redesign
 * handoff (defaults now match the former whimsy copy/chrome). Kept so older
 * call sites can import without breaking; prefer updating callers to drop it.
 *
 * Rollback: `git revert` the redesign commit rather than flipping this flag.
 */
export const WRITE_WHIMSY = false

/** Append whimsy classes when the flag is on; otherwise return `base` only. */
export function whimsy(base: string, extra: string): string {
  if (!WRITE_WHIMSY) return base
  return extra ? `${base} ${extra}` : base
}

/** Pick plain vs whimsical value (copy, fully replaced class strings, etc.). */
export function whimsyPick<T>(plain: T, whimsical: T): T {
  return WRITE_WHIMSY ? whimsical : plain
}
