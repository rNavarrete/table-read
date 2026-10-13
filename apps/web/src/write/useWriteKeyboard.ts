import { useEffect } from 'react'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

export interface WriteKeyboardHandlers {
  /** True while script canvas has focus — AI shortcuts must not fire. */
  quiet: boolean
  /** True while a candidate stream is in flight. */
  streaming: boolean
  onGenerate: () => void
  onFocusCommandBar: () => void
  onCycleFocus: (delta: 1 | -1) => void
  onAcceptFocused: () => void
  onDismissDock: () => void
  onSelectCard: (index: number) => void
  /** Whether the dock currently has any candidate cards. */
  hasCards: boolean
  /** Previous/next scene in the episode outline (T2.4). */
  onPrevScene?: () => void
  onNextScene?: () => void
}

/**
 * Write-mode keyboard path (adoption A8 / UI spec §3+§8).
 *
 * Shortcuts are disabled while the script canvas is focused (`quiet`) or
 * while the writer is typing in any text field — AI-quiet: typing never
 * triggers generation.
 */
export function useWriteKeyboard({
  quiet,
  streaming,
  onGenerate,
  onFocusCommandBar,
  onCycleFocus,
  onAcceptFocused,
  onDismissDock,
  onSelectCard,
  hasCards,
  onPrevScene,
  onNextScene,
}: WriteKeyboardHandlers): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (quiet) return
      if (isTypingTarget(event.target)) {
        // W and / still shouldn't steal from fields; Escape is handled by
        // the command bar itself. Allow nothing else while typing.
        return
      }

      const key = event.key
      if (key === 'q' || key === 'Q') {
        if (streaming) return
        event.preventDefault()
        onGenerate()
        return
      }
      if (key === 'w' || key === 'W') {
        event.preventDefault()
        onFocusCommandBar()
        return
      }
      if (key === '[') {
        if (!onPrevScene) return
        event.preventDefault()
        onPrevScene()
        return
      }
      if (key === ']') {
        if (!onNextScene) return
        event.preventDefault()
        onNextScene()
        return
      }
      if (key === 'Escape') {
        if (!hasCards) return
        event.preventDefault()
        onDismissDock()
        return
      }
      if (key === 'Tab' && hasCards) {
        event.preventDefault()
        onCycleFocus(event.shiftKey ? -1 : 1)
        return
      }
      if (key === 'Enter' && hasCards) {
        event.preventDefault()
        if (event.repeat) return // a held Enter is one accept, not several
        onAcceptFocused()
        return
      }
      if (key === '1' || key === '2' || key === '3') {
        if (!hasCards) return
        event.preventDefault()
        onSelectCard(Number(key) - 1)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    quiet,
    streaming,
    onGenerate,
    onFocusCommandBar,
    onCycleFocus,
    onAcceptFocused,
    onDismissDock,
    onSelectCard,
    hasCards,
    onPrevScene,
    onNextScene,
  ])
}
