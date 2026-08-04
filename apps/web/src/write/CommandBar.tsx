import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { suggestInstructions } from '../api/client'
import { SuggestionChips } from './SuggestionChips'

export interface CommandBarProps {
  onSubmit: (instruction: string) => void
  /** Streaming in progress — the command bar disables while a round is in flight. */
  disabled: boolean
  /** Quiet-AI (UI spec §4): true while the script canvas is focused. The
   * command bar is itself an AI-generation trigger, so it goes fully
   * invisible (not just dimmed) alongside every other AI control. */
  hidden: boolean
  projectId?: string
  sceneId?: string
  /** Optional unsaved script from the canvas (A4). */
  draftScript?: string
}

export interface CommandBarHandle {
  focus: () => void
}

/**
 * Floating command bar (UI spec §4 / Write redesign): anchored over the
 * editor column, not the viewport. Chips insert text only — never
 * auto-generate (A4).
 */
export const CommandBar = forwardRef<CommandBarHandle, CommandBarProps>(
  function CommandBar(
    { onSubmit, disabled, hidden, projectId, sceneId, draftScript },
    ref,
  ) {
    const [instruction, setInstruction] = useState('')
    const [suggestions, setSuggestions] = useState<string[]>([])
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }))

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

    async function loadSuggestions() {
      if (!projectId || !sceneId || instruction.trim() || disabled) return
      try {
        const result = await suggestInstructions(projectId, {
          context: 'scene',
          targetId: sceneId,
          surface: 'command_bar',
          draftScript: draftScript ?? null,
        })
        setSuggestions(result.suggestions)
      } catch {
        setSuggestions([])
      }
    }

    function handleSubmit(event: FormEvent) {
      event.preventDefault()
      if (!instruction.trim() || disabled) return
      onSubmit(instruction.trim())
      setInstruction('')
      setSuggestions([])
    }

    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'Escape') inputRef.current?.blur()
    }

    return (
      <div
        className={
          'pointer-events-none absolute inset-x-0 bottom-[26px] z-10 mx-auto w-full max-w-command-bar px-4' +
          (hidden ? ' invisible' : '')
        }
      >
        <form
          onSubmit={handleSubmit}
          className="pointer-events-auto flex w-full items-center gap-2.5 rounded-2xl border border-tr-border bg-tr-surface-raised py-2 pl-[18px] pr-2 shadow-write-bar"
          data-testid="command-bar"
        >
          <input
            ref={inputRef}
            value={instruction}
            onChange={(event) => {
              setInstruction(event.target.value)
              if (event.target.value.trim()) setSuggestions([])
            }}
            onFocus={() => void loadSuggestions()}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Whisper the next move…"
            aria-label="Whisper the next move"
            className="min-w-0 flex-1 bg-transparent text-15 text-tr-text-primary outline-none placeholder:text-tr-text-muted disabled:opacity-50"
          />
          <span
            aria-hidden
            className="rounded-[5px] border border-tr-border-strong bg-tr-surface-clay px-1.5 py-px font-script text-[10.5px] text-tr-text-secondary"
          >
            /
          </span>
          <span
            aria-hidden
            className="rounded-[5px] border border-tr-border-strong bg-tr-surface-clay px-1.5 py-px font-script text-[10.5px] text-tr-text-secondary"
          >
            W
          </span>
          <button
            type="submit"
            disabled={disabled || !instruction.trim()}
            className="rounded-[11px] bg-tr-coral px-[18px] py-2 text-13 font-medium text-tr-surface-raised transition-colors hover:bg-tr-coral-hover disabled:opacity-50 motion-reduce:transition-none"
          >
            Write it
          </button>
        </form>
        {!instruction.trim() && (
          <div className="pointer-events-auto">
            <SuggestionChips
              suggestions={suggestions}
              disabled={disabled}
              onPick={(text) => {
                setInstruction(text)
                setSuggestions([])
                inputRef.current?.focus()
              }}
            />
          </div>
        )}
      </div>
    )
  },
)
