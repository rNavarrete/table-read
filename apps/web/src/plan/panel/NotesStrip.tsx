import { useRef, useState } from 'react'
import type { LedgerFact, Scene } from 'contract'
import { plural } from '../../projects/wizard/board/boardText'
import {
  fixInstruction,
  importNoteText,
  linkifyNote,
  type OrderNote,
  type PlanNote,
} from '../story'

export interface NotesStripProps {
  scene: Scene
  /** notesForScene(openFlags, scene); the strip renders nothing when empty */
  notes: PlanNote[]
  /** for linkified "Scene n" references */
  scenes: Scene[]
  /** for linkified fact ids and the quoted fact */
  ledger: LedgerFact[]
  /** a write is in flight: Dismiss is disabled */
  busy: boolean
  /** the Act select is disabled, so "Change the act" is too */
  actLocked: boolean
  /** The scene or its episode is locked: no "Draft a fix in Review…" and no
   * open fix editor (rule 2; owner decision 3). Notes and Dismiss still work. */
  locked: boolean
  /** Draft a fix in Review… → Open Review: PlanScreen creates the Change Set
   * and goes to Review. Resolves once on the way, or when the writer stays in
   * Plan; rejects with the error the editor shows. Absent → no verb. */
  onDraftFix?: (instruction: string) => Promise<void>
  onSelectScene: (sceneId: string) => void
  onShowBeat: (beatId: string) => void
  /** null = the scene */
  onOpenInWrite: (beatId: string | null) => void
  onOpenFact: (factId: string) => void
  onDismiss: (flagId: string) => void
  onChangeAct: () => void
  /** This scene's computed Order notes (spec §4.8): shown first, never dismissable. */
  orderNotes?: OrderNote[]
  /** Issue ids whose note offers Undo the move. */
  undoableIssueIds?: ReadonlySet<string>
  onUndoMove?: () => void
  /** Start open: a new order problem just landed on this scene (PlanScreen re-keys the strip). */
  defaultExpanded?: boolean
}

const NO_IDS: ReadonlySet<string> = new Set()

const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'
const LINK = `text-tr-sky underline ${FOCUS}`
const VERB = `rounded-card px-2 py-1 text-13 text-tr-text-primary hover:bg-tr-surface-clay disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
// PlanField's CONTROL textarea and its footer's coral Open Review.
const CONTROL =
  'mt-1 w-full rounded-card border border-tr-border bg-tr-surface-raised p-2 text-tr-text-primary outline-none focus:border-tr-sky disabled:opacity-50'
const PRIMARY = `rounded-card bg-tr-coral px-3 py-1 text-13 text-tr-surface-raised disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

function beatLabel(scene: Scene, note: PlanNote): string | null {
  return note.beat ? `${scene.index + 1}.${note.beat.index + 1}` : null
}

/** The scene's notes (redesign spec §4.6): collapsed to a count and a peek
 * at the first story note; expanded to the computed Order notes (§4.8, no
 * Dismiss: they clear when the order is fixed), one card per story note with
 * its verbs, then the import notes in a closed "From the import" group.
 * Order notes count as story notes. Severity is not shown: all live flags are
 * 'tension'. PlanScreen keys the strip by scene id, so it starts collapsed on
 * every scene unless `defaultExpanded`. */
export function NotesStrip({
  scene,
  notes,
  scenes,
  ledger,
  busy,
  actLocked,
  locked,
  onDraftFix,
  onSelectScene,
  onShowBeat,
  onOpenInWrite,
  onOpenFact,
  onDismiss,
  onChangeAct,
  orderNotes = [],
  undoableIssueIds = NO_IDS,
  onUndoMove,
  defaultExpanded = false,
}: NotesStripProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  // The one open fix editor (T3.9): its note and the writer's text. Lives
  // while this scene stays selected (PlanScreen keys the strip by scene).
  const [fix, setFix] = useState<{ flagId: string; text: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [fixError, setFixError] = useState<string | null>(null)
  const fixVerbRef = useRef<HTMLButtonElement>(null)
  const fixAreaRef = useRef<HTMLTextAreaElement>(null)

  function toggleFix(note: PlanNote) {
    setFixError(null)
    setFix(
      fix?.flagId === note.flag.id
        ? null
        : {
            flagId: note.flag.id,
            text: fixInstruction(note, scene, scenes, ledger),
          },
    )
  }
  function sendFix() {
    if (!fix || !onDraftFix) return
    setSending(true)
    setFixError(null)
    onDraftFix(fix.text.trim()).then(
      () => setSending(false), // on the way to Review, or Stay in Plan
      (err: unknown) => {
        setSending(false)
        setFixError(
          err instanceof Error ? err.message : "Couldn't open Review.",
        )
        fixAreaRef.current?.focus() // the text is kept; let the writer edit it
      },
    )
  }
  // Cancel: focus the verb first (it exists before and after the close).
  function cancelFix() {
    fixVerbRef.current?.focus()
    setFix(null)
    setFixError(null)
  }

  if (notes.length === 0 && orderNotes.length === 0) return null

  const story = notes.filter((note) => note.kind !== 'import')
  const imported = notes.filter((note) => note.kind === 'import')
  const storyCount = story.length + orderNotes.length
  const summary =
    storyCount > 0
      ? `⚑ ${plural(storyCount, 'note')}${imported.length > 0 ? ` · ${imported.length} from the import` : ''}`
      : `${plural(imported.length, 'note')} from the import`
  const linkify = (text: string) => linkifyNote(text, scenes, ledger)
  const dismissButton = (note: PlanNote, label: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onDismiss(note.flag.id)}
      className={VERB}
    >
      {label}
    </button>
  )

  return (
    <section
      id="plan-section-notes"
      data-plan-section="notes"
      data-testid="notes-strip"
      aria-label="Notes"
      className="border-b border-tr-border bg-tr-amber-soft px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <p className="text-13 font-medium text-tr-text-primary">{summary}</p>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className={`ml-auto text-13 ${LINK}`}
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>

      {!expanded && storyCount > 0 && (
        <p
          data-testid="notes-peek"
          className="mt-1 line-clamp-2 text-13 text-tr-text-primary"
        >
          {orderNotes[0]?.text ??
            linkify(story[0].flag.explanation)
              .map((segment) => segment.text)
              .join('')}
        </p>
      )}

      {expanded && (
        <div className="mt-3 flex flex-col gap-2">
          {orderNotes.map((note) => (
            <article
              key={note.issue.id}
              data-testid={`order-note-${note.issue.id}`}
              className="rounded-card border border-tr-amber bg-tr-surface-raised p-3 text-13 text-tr-text-primary"
            >
              <p className="mb-1 flex items-center gap-2 text-12">
                <span className="rounded-chip bg-tr-amber-soft px-2 font-semibold text-tr-amber">
                  Order
                </span>
                from the board order · clears when fixed
              </p>
              <p>{note.text}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => onSelectScene(note.otherSceneId)}
                  className={VERB}
                >
                  Go to scene {note.otherNumber}
                </button>
                {undoableIssueIds.has(note.issue.id) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onUndoMove}
                    className={VERB}
                  >
                    Undo the move
                  </button>
                )}
              </div>
            </article>
          ))}

          {story.map((note) => {
            const label = beatLabel(scene, note)
            const beatId = note.beat?.id ?? null
            const fact = note.flag.factId
              ? ledger.find((f) => f.id === note.flag.factId)
              : undefined
            const canFix = !!onDraftFix && !locked
            const fixing = fix?.flagId === note.flag.id
            return (
              <article
                key={note.flag.id}
                data-testid={`note-${note.flag.id}`}
                className="rounded-card border border-tr-border bg-tr-surface-raised p-3 text-13 text-tr-text-primary"
              >
                {label && (
                  <p className="mb-1 text-12 font-medium">Beat {label}</p>
                )}
                <p>
                  {linkify(note.flag.explanation).map((segment, i) =>
                    segment.type === 'scene' ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onSelectScene(segment.sceneId)}
                        className={LINK}
                      >
                        {segment.text}
                      </button>
                    ) : segment.type === 'fact' ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onOpenFact(segment.factId)}
                        className={LINK}
                      >
                        {segment.text}
                      </button>
                    ) : (
                      <span key={i}>{segment.text}</span>
                    ),
                  )}
                </p>
                {fact && (
                  <blockquote className="mt-2 border-l-2 border-tr-border-strong pl-3">
                    <p>{fact.fact}</p>
                    <button
                      type="button"
                      onClick={() => onOpenFact(fact.id)}
                      className={`mt-1 text-12 ${LINK}`}
                    >
                      Open in Ledger →
                    </button>
                  </blockquote>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {note.kind === 'act_split' ? (
                    <>
                      <button
                        type="button"
                        disabled={actLocked}
                        onClick={onChangeAct}
                        className={VERB}
                      >
                        Change the act
                      </button>
                      {dismissButton(note, 'Looks right — dismiss')}
                    </>
                  ) : (
                    <>
                      {beatId && (
                        <button
                          type="button"
                          onClick={() => onShowBeat(beatId)}
                          className={VERB}
                        >
                          Show beat
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenInWrite(beatId)}
                        className={VERB}
                      >
                        Open in Write
                      </button>
                      {canFix && (
                        <button
                          ref={fixing ? fixVerbRef : undefined}
                          type="button"
                          aria-expanded={fixing}
                          disabled={busy}
                          onClick={() => toggleFix(note)}
                          className={VERB}
                        >
                          Draft a fix in Review…
                        </button>
                      )}
                      {dismissButton(note, 'Dismiss')}
                    </>
                  )}
                </div>
                {canFix && fixing && (
                  <div
                    data-testid="fix-editor"
                    className="mt-2 flex flex-col gap-2"
                  >
                    <textarea
                      ref={fixAreaRef}
                      aria-label="Fix instruction"
                      aria-describedby="plan-fix-explainer"
                      rows={4}
                      autoFocus
                      readOnly={sending}
                      value={fix.text}
                      onChange={(e) =>
                        setFix({ flagId: note.flag.id, text: e.target.value })
                      }
                      className={`${CONTROL} resize-y text-13`}
                    />
                    <p
                      id="plan-fix-explainer"
                      className="text-12 text-tr-text-primary"
                    >
                      Nothing changes until you apply it in Review. Locked
                      scenes are never changed.
                    </p>
                    {fixError && (
                      <p role="alert" className="text-13 text-tr-danger">
                        {fixError}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        disabled={busy || sending || !fix.text.trim()}
                        onClick={sendFix}
                        className={PRIMARY}
                      >
                        {sending ? 'Opening…' : 'Open Review'}
                      </button>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={cancelFix}
                        className={VERB}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}

          {imported.length > 0 && (
            <details
              data-testid="notes-import-group"
              className="rounded-card border border-tr-border bg-tr-surface-raised p-3"
            >
              <summary
                className={`cursor-pointer text-13 font-medium text-tr-text-primary ${FOCUS}`}
              >
                From the import · {imported.length}
              </summary>
              <ul className="mt-2 flex flex-col gap-3">
                {imported.map((note) => {
                  const beatId = note.beat?.id ?? null
                  return (
                    <li
                      key={note.flag.id}
                      data-testid={`note-${note.flag.id}`}
                      className="text-13 text-tr-text-primary"
                    >
                      <p>{importNoteText(note.flag, beatLabel(scene, note))}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => onOpenInWrite(beatId)}
                          className={VERB}
                        >
                          {beatId ? 'Open beat in Write' : 'Open in Write'}
                        </button>
                        {dismissButton(note, 'Looks right — dismiss')}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
