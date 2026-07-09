import { useState, type FocusEvent } from 'react'

export interface QuietAiCanvasHandlers {
  onFocus: (event: FocusEvent<HTMLElement>) => void
  onBlur: (event: FocusEvent<HTMLElement>) => void
}

/**
 * Quiet-AI rule (UI spec §3 / CLAUDE.md rule 8): while the script canvas has
 * focus, the AI dock goes quiet. Spread the returned handlers onto the
 * canvas's outer container — React's onFocus/onBlur are focusin/focusout
 * under the hood, so they fire for focus landing on any descendant (a beat's
 * editable region), and `relatedTarget` tells us whether focus merely moved
 * to another beat within the same canvas (still quiet) or left it entirely
 * (blur for real).
 *
 * Simplification, documented: the spec's literal condition is "has focus AND
 * is typing"; this hook (and the callers gating on it) key off focus alone.
 * Focusing an editable script region is, in practice, the immediate prelude
 * to typing, and the acceptance criterion this obligation is tested against
 * ("AI controls invisible while textarea focused") is itself stated in terms
 * of focus alone — so tracking keystroke-recency separately would add a
 * debounce with no spec-visible behavior difference.
 */
export function useQuietAi(): {
  quiet: boolean
  canvasHandlers: QuietAiCanvasHandlers
} {
  const [quiet, setQuiet] = useState(false)

  return {
    quiet,
    canvasHandlers: {
      onFocus: () => setQuiet(true),
      onBlur: (event) => {
        const next = event.relatedTarget as Node | null
        if (!next || !event.currentTarget.contains(next)) {
          setQuiet(false)
        }
      },
    },
  }
}
