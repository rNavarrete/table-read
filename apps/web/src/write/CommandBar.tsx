import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

export interface CommandBarProps {
  onSubmit: (instruction: string) => void
  /** Streaming in progress — the command bar disables while a round is in flight. */
  disabled: boolean
  /** Quiet-AI (UI spec §3): true while the script canvas is focused. The
   * command bar is itself an AI-generation trigger, so it goes fully
   * invisible (not just dimmed) alongside every other AI control. */
  hidden: boolean
}

/**
 * The bottom command bar (UI spec §3): natural-language instructions,
 * command-palette feel, not a chat — no history thread, no assistant
 * bubbles, one instruction per submission. `/` focuses it from anywhere
 * except another text input (so it doesn't hijack typing inside the script
 * canvas or this bar's own field).
 */
export function CommandBar({ onSubmit, disabled, hidden }: CommandBarProps) {
  const [instruction, setInstruction] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== '/') return
      const target = event.target as HTMLElement | null
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (isTyping) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!instruction.trim() || disabled) return
    onSubmit(instruction.trim())
    setInstruction('')
  }

  // Belt-and-suspenders: Escape while focused defocuses back to the canvas,
  // never submits a stray blank instruction.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') inputRef.current?.blur()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={
        'fixed inset-x-0 bottom-6 mx-auto flex h-14 w-full max-w-script-col items-center gap-3 rounded-card border border-tr-border bg-tr-surface-sunken px-4 shadow-raised' +
        (hidden ? ' invisible' : '')
      }
      data-testid="command-bar"
    >
      <input
        ref={inputRef}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Tell the scene where to go…"
        aria-label="Tell the scene where to go"
        className="min-w-0 flex-1 bg-transparent text-15 text-tr-text-primary outline-none placeholder:text-tr-text-muted disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !instruction.trim()}
        className="rounded-card bg-tr-coral px-4 py-1.5 text-13 text-tr-surface-raised transition-colors hover:bg-tr-coral-hover disabled:opacity-50 motion-reduce:transition-none"
      >
        Generate
      </button>
    </form>
  )
}
