import { useEffect } from 'react'

export interface PlanKeyHandlers {
  /** j / k */
  onStep: (dir: 1 | -1) => void
  /** n / N (Shift+n) */
  onNext: (dir: 1 | -1) => void
  /** Escape outside the inspector */
  onEpisodeView: () => void
  /** ⌘↵ / Ctrl+↵ */
  onOpenInWrite: () => void
}

/** Plan's document shortcuts (spec §4.10). Ignores text fields, selects,
 * contentEditable, anything inside a <dialog>, already-handled events and
 * other modifier chords. Esc inside the inspector is the panel's. */
export function usePlanKeys(handlers: PlanKeyHandlers): void {
  // A fresh handlers object each render re-subscribes: cheap, and the
  // listener always sees current state with no refs.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null
      if (
        event.defaultPrevented ||
        target?.closest(
          'input, textarea, select, [contenteditable="true"], dialog',
        )
      )
        return
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        handlers.onOpenInWrite()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const run = (fn: () => void) => {
        event.preventDefault()
        fn()
      }
      if (event.key === 'j') run(() => handlers.onStep(1))
      else if (event.key === 'k') run(() => handlers.onStep(-1))
      else if (event.key === 'n') run(() => handlers.onNext(1))
      else if (event.key === 'N') run(() => handlers.onNext(-1))
      else if (
        event.key === 'Escape' &&
        !target?.closest('[data-testid="inspector"]')
      )
        run(handlers.onEpisodeView)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [handlers])
}
