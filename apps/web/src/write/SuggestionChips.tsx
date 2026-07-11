import type { SuggestRequest } from 'contract'

export interface SuggestionChipsProps {
  suggestions: string[]
  onPick: (text: string) => void
  /** While true, chips stay visible but non-interactive. */
  disabled?: boolean
}

/**
 * Muted AI-origin chips (adoption A4 / UI spec): click inserts into the
 * focused input — never auto-executes generation.
 */
export function SuggestionChips({
  suggestions,
  onPick,
  disabled = false,
}: SuggestionChipsProps) {
  if (suggestions.length === 0) return null
  return (
    <div
      className="mt-2 flex flex-wrap gap-2"
      data-testid="suggestion-chips"
      role="list"
    >
      {suggestions.map((text) => (
        <button
          key={text}
          type="button"
          role="listitem"
          disabled={disabled}
          title={text}
          onClick={() => onPick(text)}
          className="max-w-full truncate rounded-chip border border-tr-border bg-tr-surface-clay px-3 py-1 text-left text-13 text-tr-text-secondary hover:border-tr-border-strong hover:text-tr-text-primary disabled:opacity-50"
        >
          <span className="mr-1 text-tr-text-muted" aria-hidden="true">
            ~
          </span>
          {text}
        </button>
      ))}
    </div>
  )
}

export type { SuggestRequest }
