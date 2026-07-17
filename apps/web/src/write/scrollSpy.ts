/**
 * Pick the topmost intersecting scene section from a map of the latest
 * IntersectionObserver entry per target. IO callbacks only include *changed*
 * entries — callers must accumulate into `byTarget` across callbacks.
 */
export function pickTopIntersectingSceneId(
  byTarget: Iterable<IntersectionObserverEntry>,
): string | null {
  const visible = [...byTarget]
    .filter((entry) => entry.isIntersecting)
    .sort(
      (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
    )
  const top = visible[0]?.target
  if (!(top instanceof HTMLElement)) return null
  return top.dataset.sceneId ?? null
}

/** True when the writer is editing inside the script scrollport (caret wins). */
export function isEditingInScrollport(root: ParentNode | null): boolean {
  if (!root || typeof document === 'undefined') return false
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  if (!root.contains(el)) return false
  const tag = el.tagName
  return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable
}
