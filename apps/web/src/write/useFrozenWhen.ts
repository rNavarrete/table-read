import { useState } from 'react'

/**
 * Returns `value`, except while `freeze` is true — then it keeps returning
 * whatever `value` was the instant freezing began, ignoring further changes
 * until `freeze` goes false again.
 *
 * Backs the quiet-AI rule's "never updates" clause (UI spec §3 / CLAUDE.md
 * rule 8): CSS opacity alone would dim the dock but still visibly redraw
 * streaming text underneath it, which is exactly what the rule forbids. This
 * makes the freeze structural — the dock's own render tree stops changing,
 * not just its appearance — so the underlying session can keep streaming
 * into state (no data loss) while nothing paints until the writer un-quiets.
 *
 * Implementation note: this adjusts state *during render* (the pattern React
 * itself documents for "storing information from previous renders" —
 * https://react.dev/reference/react/useState#storing-information-from-previous-renders)
 * rather than in a `useEffect`. An effect would only capture the snapshot one
 * render *after* `freeze` flips true (effects run post-commit), reintroducing
 * exactly the one-render lag this hook exists to avoid; a ref write during
 * render would avoid the lag but reads/writes of `ref.current` outside an
 * effect or handler are flagged by this repo's stricter `react-hooks/refs`
 * lint rule. Comparing `freeze` to its previous value and calling `setState`
 * conditionally, right here in the render body, is the one construct that is
 * both same-render-accurate and lint-clean.
 */
export function useFrozenWhen<T>(value: T, freeze: boolean): T {
  const [frozen, setFrozen] = useState(value)
  const [wasFrozen, setWasFrozen] = useState(freeze)

  if (freeze !== wasFrozen) {
    setWasFrozen(freeze)
    if (freeze) setFrozen(value)
  }

  return freeze ? frozen : value
}
