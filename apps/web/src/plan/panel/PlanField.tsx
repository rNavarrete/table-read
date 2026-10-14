import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SuggestionChips } from '../../write/SuggestionChips'
import { useFieldDraft } from './usePlanDrafts'

export type SceneTextField =
  | 'whatHappens'
  | 'audienceLearns'
  | 'audienceFeels'
  | 'location'
  | 'time'
  | 'socialSituation'
export type BeatTextField =
  'whatHappens' | 'audienceLearns' | 'audienceFeels' | 'scriptText'

export interface PlanFieldProps {
  label: string
  /** Accessible name; defaults to `label`. Scene fields keep "Location",
   * "What happens", "Audience learns"… (e2e selectors). */
  ariaLabel?: string
  draftKey: string
  /** Scene the draft belongs to (card dot, header chip); null = premises. */
  sceneId: string | null
  /** The server value. */
  value: string
  /** Textarea that grows with its content. */
  multiline?: boolean
  /** 15px text (What happens). */
  lead?: boolean
  /** Dirty → "Structural change — review impact?" footer instead of Save. */
  structural?: boolean
  locked: boolean
  saving: boolean
  openingReview?: boolean
  /** Resolves true when the server took the value; only then is the draft dropped. */
  onSave: (value: string) => Promise<boolean>
  /** Omitted → Open Review stays disabled (premises: create can't target them). */
  onOpenReview?: (instruction: string) => void
  /** Set → an explicit "Suggest…" button on an empty, unlocked field. */
  onSuggest?: () => Promise<string[]>
}

const CONTROL =
  'mt-1 w-full rounded-card border border-tr-border bg-tr-surface-raised p-2 text-tr-text-primary outline-none focus:border-tr-sky disabled:opacity-50'

function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  // A closed <details> lays nothing out (scrollHeight 0): keep the rows
  // height until it opens; the toggle listener below measures again then.
  if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`
}

/**
 * One editable Plan field (UI spec §5 panel). The text lives in the Plan
 * draft store, not in local state, so it survives a scene switch, a failed
 * save (the optimistic value and its rollback never touch the draft) and a
 * server value changing underneath it. A locked field shows the server value
 * read-only and keeps any draft for when it is unlocked.
 *
 * AI stays behind a verb (CLAUDE.md rule 8, spec decision 5): `onSuggest` runs
 * only from the Suggest… click — never on mount, focus, typing or select.
 */
export function PlanField({
  label,
  ariaLabel,
  draftKey,
  sceneId,
  value,
  multiline = false,
  lead = false,
  structural = false,
  locked,
  saving,
  openingReview = false,
  onSave,
  onOpenReview,
  onSuggest,
}: PlanFieldProps) {
  const draft = useFieldDraft(draftKey, sceneId, value)
  const text = locked ? value : draft.text
  const dirty = !locked && draft.dirty
  const busy = saving || openingReview
  const areaRef = useRef<HTMLTextAreaElement>(null)
  // One reply per draftKey: the panel isn't remounted per scene, so a late
  // reply for one scene must neither show on nor replace another's.
  const [suggestions, setSuggestions] = useState<
    Record<string, { items: string[]; failed: boolean }>
  >({})
  const [suggestingKey, setSuggestingKey] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (areaRef.current) grow(areaRef.current)
  }, [text])

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const regrow = () => grow(el)
    // `toggle` doesn't bubble; a capturing listener still sees every <details>.
    document.addEventListener('toggle', regrow, true)
    return () => document.removeEventListener('toggle', regrow, true)
  }, [])

  async function save() {
    if (await onSave(draft.text)) draft.discard()
  }

  async function suggest() {
    if (!onSuggest) return
    const key = draftKey
    setSuggestingKey(key)
    try {
      const items = await onSuggest()
      setSuggestions((s) => ({ ...s, [key]: { items, failed: false } }))
    } catch {
      setSuggestions((s) => ({ ...s, [key]: { items: [], failed: true } }))
    } finally {
      setSuggestingKey((current) => (current === key ? null : current))
    }
  }

  const shown = suggestions[draftKey]
  const canSuggest = !!onSuggest && !locked && text.trim() === ''
  const suggesting = suggestingKey === draftKey
  const controlClass = `${CONTROL} ${lead ? 'text-15' : 'text-13'}`

  // Labels, prompts and button text are identifying text: AA (spec §4.10).
  // --tr-text-secondary (3.7:1) and --tr-text-muted (2.8:1) fall short.
  return (
    <div>
      <p className="text-12 uppercase tracking-wide text-tr-text-primary">
        {label}
        {structural && (
          <span className="ml-2 normal-case tracking-normal">· structural</span>
        )}
      </p>
      {multiline ? (
        <textarea
          ref={areaRef}
          aria-label={ariaLabel ?? label}
          value={text}
          readOnly={locked}
          disabled={busy}
          rows={2}
          onChange={(e) => draft.set(e.target.value)}
          className={`${controlClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          aria-label={ariaLabel ?? label}
          value={text}
          readOnly={locked}
          disabled={busy}
          onChange={(e) => draft.set(e.target.value)}
          className={controlClass}
        />
      )}
      {canSuggest && (
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            disabled={suggesting || busy}
            onClick={() => void suggest()}
            className="text-12 text-tr-sky underline disabled:opacity-50"
          >
            {suggesting ? 'Suggesting…' : 'Suggest…'}
          </button>
          {shown?.failed && (
            <span className="text-12 text-tr-text-primary">
              Couldn&apos;t load suggestions.
            </span>
          )}
        </div>
      )}
      {canSuggest && shown && (
        <SuggestionChips
          suggestions={shown.items}
          disabled={busy}
          onPick={(picked) => {
            draft.set(picked)
            setSuggestions((s) => {
              const rest = { ...s }
              delete rest[draftKey]
              return rest
            })
          }}
        />
      )}
      {dirty && structural && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-card border border-tr-border bg-tr-surface-sunken p-2">
          <p className="text-13 text-tr-text-primary">
            Structural change — review impact?
          </p>
          <button
            type="button"
            disabled={!onOpenReview || busy}
            title={
              onOpenReview
                ? undefined
                : 'Open Review needs a scene or beat target'
            }
            onClick={() => onOpenReview?.(draft.text)}
            className="ml-auto rounded-card bg-tr-coral px-3 py-1 text-13 text-tr-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            {openingReview ? 'Opening…' : 'Open Review'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="text-13 text-tr-text-primary underline disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save field only'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={draft.discard}
            className="text-13 text-tr-text-primary underline disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      )}
      {dirty && !structural && (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-card bg-tr-coral px-3 py-1 text-13 text-tr-surface-raised disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={draft.discard}
            className="text-13 text-tr-text-primary underline disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}
