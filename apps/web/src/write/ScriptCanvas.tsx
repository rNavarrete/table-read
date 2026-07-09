import { useState, type ChangeEvent } from 'react'
import type { Beat, Scene } from 'contract'
import type { QuietAiCanvasHandlers } from './useQuietAi'

function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3 text-tr-text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

/**
 * One beat row: gutter label (hover-visible) + the beat's script text.
 * Unlocked beats are a live `<textarea>` (rule: "Direct typing is allowed
 * only in unlocked ranges" — UI spec §3); locked beats (`locked` or
 * `scriptLocked`, either one) render the same script text read-only, with a
 * lock glyph in the gutter and a hint on focus ("caret placement inside
 * shows a brief hint").
 *
 * Persistence scope note (T2.3): typing here updates only this component's
 * local state, driving the quiet-AI focus rule and the read-only/locked
 * rendering this task owns. Writing edits back to the server via `PATCH
 * /projects/{pid}` — including the locked-range 409 guard — is T3.2 (build
 * plan); wiring it here would duplicate that task's lock-guard tests ahead
 * of the endpoint actually enforcing them.
 */
function BeatRow({ beat, index }: { beat: Beat; index: number }) {
  const locked = beat.locked || beat.scriptLocked
  const [text, setText] = useState(beat.scriptText)

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value)
    autosize(event.target)
  }

  return (
    <div className="group relative flex gap-4 border-t border-tr-border py-6 first:border-t-0">
      <div
        className="w-6 shrink-0 pt-1 text-right text-12 text-tr-text-muted opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      >
        {locked ? <LockGlyph /> : index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <textarea
          className={
            'peer w-full resize-none overflow-hidden whitespace-pre-wrap border-0 bg-transparent font-script text-12 leading-relaxed text-tr-text-primary outline-none' +
            (locked ? ' cursor-default text-tr-text-secondary' : '')
          }
          value={text}
          readOnly={locked}
          aria-readonly={locked}
          data-testid={`beat-${beat.id}`}
          ref={(el) => el && autosize(el)}
          onChange={onChange}
          rows={1}
        />
        {locked && (
          <p className="pointer-events-none max-h-0 overflow-hidden text-13 text-tr-text-muted opacity-0 transition-all peer-focus:max-h-6 peer-focus:opacity-100 motion-reduce:transition-none">
            Locked — click the lock to edit
          </p>
        )}
      </div>
    </div>
  )
}

export interface ScriptCanvasProps {
  scene: Scene
  canvasHandlers: QuietAiCanvasHandlers
}

/**
 * The script canvas: the "hero" surface (design doc §4.3) — a formatted
 * teleplay page, current scene's beats separated by faint rules, gutter
 * labels visible on hover. `canvasHandlers` (write/useQuietAi.ts) is spread
 * on this root container so focus anywhere inside — any beat's textarea —
 * drives the quiet-AI rule.
 */
export function ScriptCanvas({ scene, canvasHandlers }: ScriptCanvasProps) {
  return (
    <section
      // NOTE (flagged, not a token): UI spec §3 pins the script column to a
      // literal 720px max-width. §1's token list has no "layout width" scale
      // (only color/spacing/radius/shadow/motion are tokenized) — this is a
      // structural page-layout constant, not a design token subject to rule
      // 6, so it's expressed as a Tailwind arbitrary value rather than
      // invented as a new --tr-* variable (tokens.test.ts's "no invented
      // tokens" guard treats tokens.css as closed to the §1 list). Flagged in
      // the task report per the self-review instruction to surface any value
      // with no corresponding token.
      className="max-w-[720px] flex-1 rounded-card bg-tr-surface-raised px-8 py-6 shadow-raised"
      aria-label={`Script — ${scene.location}`}
      {...canvasHandlers}
    >
      {scene.beats.length === 0 ? (
        <p className="py-16 text-center font-script text-12 text-tr-text-muted">
          Write, or press Next Beat
        </p>
      ) : (
        scene.beats.map((beat, index) => (
          <BeatRow key={beat.id} beat={beat} index={index} />
        ))
      )}
    </section>
  )
}
