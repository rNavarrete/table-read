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
import { whimsyPick } from './writeWhimsy'

export interface CommandBarProps {
  onSubmit: (instruction: string) => void
  /** Streaming in progress — the command bar disables while a round is in flight. */
  disabled: boolean
  /** Quiet-AI (UI spec §3): true while the script canvas is focused. The
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
 * The bottom command bar (UI spec §3): natural-language instructions,
 * command-palette feel, not a chat — no history thread, no assistant
 * bubbles, one instruction per submission. `/` and `W` focus it from
 * anywhere except another text input (adoption A8). Empty-state chips
 * from `POST /suggest` insert text only — never auto-generate (A4).
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
          'fixed inset-x-0 bottom-6 mx-auto w-full max-w-script-col' +
          (hidden ? ' invisible' : '')
        }
      >
        <form
          onSubmit={handleSubmit}
          className={whimsyPick(
            'flex h-14 w-full max-w-script-col items-center gap-3 rounded-chip border border-tr-border bg-tr-surface-raised px-4 shadow-raised',
            'flex h-14 w-full max-w-script-col items-center gap-3 rounded-chip border border-tr-coral-soft bg-tr-surface-raised px-4 shadow-lift',
          )}
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
            placeholder={whimsyPick(
              'Tell the scene where to go…  [/] or [W]',
              'Whisper the next move…  [/] or [W]',
            )}
            aria-label="Tell the scene where to go"
            className="min-w-0 flex-1 bg-transparent text-15 text-tr-text-primary outline-none placeholder:text-tr-text-muted disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={disabled || !instruction.trim()}
            className="rounded-chip bg-tr-coral px-4 py-1.5 text-13 text-tr-surface-raised transition-colors hover:bg-tr-coral-hover disabled:opacity-50 motion-reduce:transition-none"
          >
            {whimsyPick('Generate', 'Write it')}
          </button>
        </form>
        {!instruction.trim() && (
          <SuggestionChips
            suggestions={suggestions}
            disabled={disabled}
            onPick={(text) => {
              setInstruction(text)
              setSuggestions([])
              inputRef.current?.focus()
            }}
          />
        )}
      </div>
    )
  },
)
