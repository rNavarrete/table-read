import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { Beat, Scene } from 'contract'
import { isBeatEffectivelyLocked } from '../plan/planTree'
import { FormattedScript } from './FormattedScript'
import { parseFountainLines } from './fountainFormat'
import { OPTIMISTIC_BEAT_ID } from './projectTree'
import { formatSceneSlug } from './SceneOutline'
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

const HIGHLIGHT_CLASSES = [
  'rounded-card',
  'bg-tr-amber-soft',
  'outline',
  'outline-selected',
  'outline-tr-coral',
] as const

/**
 * One beat row: gutter label (hover-visible) + the beat's script text.
 * Unlocked beats are a live `<textarea>` (rule: "Direct typing is allowed
 * only in unlocked ranges" — UI spec §3); effectively locked beats (the beat's
 * own `locked`/`scriptLocked`, or a locked scene or episode — Plan's
 * `isBeatEffectivelyLocked`) render the same script text read-only, with a
 * lock glyph in the gutter and a hint on focus ("caret placement inside
 * shows a brief hint"). The optimistic Accept placeholder is read-only too:
 * it is re-keyed to the server's id the moment the accept lands.
 *
 * Planned-but-unwritten beats (empty `scriptText`, non-empty `whatHappens`)
 * show the plan pitch as solid primary copy — not muted ghost text — so the
 * page never looks blank after a scene-skeleton apply.
 *
 * The typed text stays in this row's state (the editor never loses it, even
 * if a save fails); `onEdit` reports each change and `onEditBlur` asks for an
 * immediate save — WriteScreen's queue autosaves it (write/useWriteQueue.ts).
 * When the server's text changes (a refetch) and the row is neither being
 * edited nor holding text of its own, the row picks the new text up, so a
 * stale row can't overwrite a newer version with one keystroke.
 */
function BeatRow({
  beat,
  index,
  locked,
  highlighted,
  onFocusScene,
  onEdit,
  onEditBlur,
}: {
  beat: Beat
  index: number
  /** Effectively locked (beat, scene or episode lock). */
  locked: boolean
  highlighted: boolean
  onFocusScene?: () => void
  onEdit?: (text: string) => void
  onEditBlur?: () => void
}) {
  const readOnly = locked || beat.id === OPTIMISTIC_BEAT_ID
  const [text, setText] = useState(beat.scriptText)
  const [seen, setSeen] = useState(beat.scriptText)
  const [editing, setEditing] = useState(false)
  // Adjusting state during render (React's documented pattern for "derive
  // from a changed prop"), as CandidateCard does.
  if (!editing && beat.scriptText !== seen) {
    setSeen(beat.scriptText)
    if (text === seen) setText(beat.scriptText)
  }
  const rowRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const planPitch = beat.whatHappens.trim()
  const showPlan = text.trim().length === 0 && planPitch.length > 0
  const showFormatted = text.trim().length > 0 && (readOnly || !editing)

  // Ledger source-span jump (UI spec §6): highlight 2s via DOM classes —
  // avoids setState-in-effect (react-hooks lint) while still timing out.
  useEffect(() => {
    const el = rowRef.current
    if (!highlighted || !el) return
    el.classList.add(...HIGHLIGHT_CLASSES)
    el.dataset.highlighted = 'true'
    const t = window.setTimeout(() => {
      el.classList.remove(...HIGHLIGHT_CLASSES)
      delete el.dataset.highlighted
    }, 2000)
    return () => {
      window.clearTimeout(t)
      el.classList.remove(...HIGHLIGHT_CLASSES)
      delete el.dataset.highlighted
    }
  }, [highlighted])

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    autosize(el)
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [editing])

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value)
    autosize(event.target)
    onEdit?.(event.target.value)
  }

  function startEditing() {
    if (readOnly) return
    onFocusScene?.()
    setEditing(true)
  }

  return (
    <div
      ref={rowRef}
      className="group relative flex gap-4 py-5"
      data-testid={`beat-row-${beat.id}`}
    >
      <div
        className="w-6 shrink-0 pt-1 text-right text-12 text-tr-text-muted opacity-60 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      >
        {locked ? (
          <LockGlyph />
        ) : (
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-tr-surface-clay font-script text-11 text-tr-text-secondary">
            {index + 1}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showPlan ? (
          <div data-testid={`beat-plan-${beat.id}`} className="mb-3">
            <p className="font-script text-11 font-medium uppercase tracking-[0.1em] text-tr-text-muted">
              What happens here
            </p>
            <p className="mt-1 text-15 leading-6 text-tr-text-primary">
              {planPitch}
            </p>
            {(beat.audienceLearns.trim() || beat.audienceFeels.trim()) && (
              <p className="mt-2 text-13 leading-5 text-tr-text-secondary">
                {beat.audienceLearns.trim()
                  ? `Audience learns: ${beat.audienceLearns}`
                  : null}
                {beat.audienceLearns.trim() && beat.audienceFeels.trim()
                  ? ' · '
                  : null}
                {beat.audienceFeels.trim()
                  ? `Feels: ${beat.audienceFeels}`
                  : null}
              </p>
            )}
          </div>
        ) : null}
        {showFormatted ? (
          <FormattedScript
            text={text}
            aria-label={
              locked
                ? `Beat ${index + 1} (locked)`
                : `Beat ${index + 1} — click to edit`
            }
            onActivate={readOnly ? undefined : startEditing}
          />
        ) : (
          <textarea
            className={
              'peer w-full resize-none overflow-hidden whitespace-pre-wrap border-0 bg-transparent font-script text-12 leading-relaxed text-tr-text-primary outline-none' +
              (readOnly ? ' cursor-default text-tr-text-secondary' : '') +
              (showPlan
                ? ' min-h-[3rem] rounded-card border border-tr-border bg-tr-surface-clay px-3 py-2'
                : '')
            }
            value={text}
            readOnly={readOnly}
            aria-readonly={readOnly}
            aria-label={
              showPlan ? `Script for beat ${index + 1}` : `Beat ${index + 1}`
            }
            data-testid={`beat-${beat.id}`}
            ref={(el) => {
              textareaRef.current = el
              if (el) autosize(el)
            }}
            onChange={onChange}
            onFocus={() => {
              onFocusScene?.()
              // An empty planned beat shows this textarea without a click:
              // mark it as editing so its first keystroke doesn't swap in
              // the formatted view, and so a refetch won't replace its text.
              if (!readOnly) setEditing(true)
            }}
            onBlur={() => {
              setEditing(false)
              onEditBlur?.()
            }}
            rows={showPlan ? 3 : 1}
          />
        )}
        {showPlan && !readOnly ? (
          <p className="mt-1 text-12 text-tr-text-secondary">
            Type script here, or use Next Beat to draft dialogue for this scene.
          </p>
        ) : null}
        {locked && (
          <p className="mt-1 text-12 text-tr-text-muted">
            Locked — unlock to edit
          </p>
        )}
      </div>
    </div>
  )
}

function sceneScriptOpensWithHeading(scene: Scene): boolean {
  const first = scene.beats[0]?.scriptText?.trim() ?? ''
  if (!first) return false
  return parseFountainLines(first).some((line) => line.type === 'scene_heading')
}

function SceneBlock({
  scene,
  sceneNumber,
  active,
  episodeLocked,
  highlightBeatId,
  onSceneFocus,
  onBeatEdit,
  onBeatBlur,
}: {
  scene: Scene
  /** 1-based index matching the ON THE PAGE outline (document order). */
  sceneNumber: number
  /** True when this scene is the Write active scene. */
  active: boolean
  /** The scene's episode is locked (every beat inside is read-only). */
  episodeLocked: boolean
  highlightBeatId: string | null
  onSceneFocus?: (sceneId: string) => void
  onBeatEdit?: ScriptCanvasProps['onBeatEdit']
  onBeatBlur?: () => void
}) {
  const slug = formatSceneSlug(scene)
  const scenePitch = scene.whatHappens.trim()
  const focus = () => onSceneFocus?.(scene.id)
  // Avoid INT. … twice: once in chrome, once in Fountain body (imports).
  const showSlug =
    !sceneScriptOpensWithHeading(scene) && slug !== 'Untitled scene'
  const showHeader = true

  return (
    <section
      data-testid={`write-scene-${scene.id}`}
      data-scene-id={scene.id}
      aria-label={`Script — scene ${sceneNumber}, ${scene.location || slug}`}
      className="relative border-b-0 py-10 last:pb-4"
      onFocusCapture={focus}
    >
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center text-12 tracking-[0.5em] text-tr-text-muted"
        aria-hidden
      >
        · · ·
      </div>
      {showHeader ? (
        <header
          className={
            'relative flex items-start gap-3 ' +
            (scenePitch || scene.beats.length === 0 || showSlug
              ? 'mb-5'
              : 'mb-2')
          }
        >
          <span
            data-testid={`script-scene-number-${scene.id}`}
            className={
              'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-script text-11 tabular-nums ' +
              (active
                ? 'bg-tr-coral-soft text-tr-coral'
                : 'bg-tr-surface-clay text-tr-text-muted')
            }
            aria-hidden
          >
            {sceneNumber}
          </span>
          <div className="min-w-0 flex-1">
            {showSlug ? (
              <p
                data-testid={`script-scene-slug-${scene.id}`}
                className="font-script text-15 font-bold uppercase tracking-[0.02em] leading-[1.65] text-tr-text-primary"
              >
                {slug}
              </p>
            ) : null}
            {scenePitch ? (
              <p
                data-testid={`script-scene-pitch-${scene.id}`}
                className={
                  'text-15 leading-6 text-tr-text-secondary' +
                  (showSlug ? ' mt-2' : '')
                }
              >
                {scenePitch}
              </p>
            ) : null}
          </div>
        </header>
      ) : null}

      {scene.beats.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-15 text-tr-text-primary">
            No beats in this scene yet.
          </p>
          <p className="mt-2 text-13 text-tr-text-secondary">
            Press Next Beat to draft the first one, or type once a beat exists.
          </p>
        </div>
      ) : (
        scene.beats.map((beat, index) => (
          <BeatRow
            key={beat.id}
            beat={beat}
            index={index}
            locked={isBeatEffectivelyLocked(episodeLocked, scene, beat)}
            highlighted={highlightBeatId === beat.id}
            onFocusScene={focus}
            onEdit={(text) => onBeatEdit?.(scene.id, beat.id, text)}
            onEditBlur={onBeatBlur}
          />
        ))
      )}
    </section>
  )
}

export interface ScriptCanvasProps {
  /** Episode scenes in story order (projectTree.allScenes; T2.4). */
  scenes: Scene[]
  canvasHandlers: QuietAiCanvasHandlers
  /** When set (Ledger source-span jump), highlight that beat for 2s. */
  highlightBeatId?: string | null
  /** Focus/caret inside a scene sets the Write active scene. */
  onSceneFocus?: (sceneId: string) => void
  /** Active scene id — drives scene-number badge accent (matches outline). */
  activeSceneId?: string | null
  /** Scenes whose episode is locked — their beats render read-only. */
  lockedEpisodeSceneIds?: ReadonlySet<string>
  /** Each change to an unlocked beat's text (autosave, debounced upstream). */
  onBeatEdit?: (sceneId: string, beatId: string, text: string) => void
  /** A beat editor blurred — save now. */
  onBeatBlur?: () => void
}

/**
 * The script canvas: the "hero" surface (design doc §4.3 / T2.4) — a
 * formatted teleplay page with the episode's scenes stacked for continuous
 * scroll. Beats stay delimited with gutter labels. `canvasHandlers`
 * (write/useQuietAi.ts) is spread on the root so focus anywhere inside
 * drives the quiet-AI rule.
 */
export function ScriptCanvas({
  scenes,
  canvasHandlers,
  highlightBeatId = null,
  onSceneFocus,
  activeSceneId = null,
  lockedEpisodeSceneIds,
  onBeatEdit,
  onBeatBlur,
}: ScriptCanvasProps) {
  return (
    <div
      className="mx-auto mt-[34px] mb-40 w-full max-w-script-page rounded-[6px] border border-tr-border bg-tr-surface-raised px-[76px] py-16 shadow-write-page"
      aria-label="Episode script"
      data-testid="script-canvas"
      {...canvasHandlers}
    >
      {scenes.map((scene, index) => (
        <SceneBlock
          key={scene.id}
          scene={scene}
          sceneNumber={index + 1}
          active={scene.id === activeSceneId}
          episodeLocked={lockedEpisodeSceneIds?.has(scene.id) ?? false}
          highlightBeatId={highlightBeatId}
          onSceneFocus={onSceneFocus}
          onBeatEdit={onBeatEdit}
          onBeatBlur={onBeatBlur}
        />
      ))}
    </div>
  )
}
