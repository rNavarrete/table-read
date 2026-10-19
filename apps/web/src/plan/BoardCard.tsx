import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import { RULED } from '../projects/wizard/board/IndexCard'
import { plural } from '../projects/wizard/board/boardText'
import { sceneLocationType, sceneTypeDotClass } from '../write/sceneType'
import {
  cardTag,
  type CardTape,
  type SceneSignals,
  type TapeTone,
} from './story'

export interface BoardCardProps {
  signals: SceneSignals
  /** Effective: scene or episode lock. */
  locked: boolean
  selected: boolean
  /** Roving tab stop: Board gives exactly one card 0. */
  tabIndex: 0 | -1
  /** A write is in flight: no drag. */
  pending: boolean
  unsaved: boolean
  /** At most one tape (spec §4.2). */
  tape: CardTape | null
  /** Shares a thread or an order problem with the selected scene: a dashed
   * outline in the tape's tone (amber for "⚠ order with n", else sky). */
  related: boolean
  dragging: boolean
  dropTarget: boolean
  /** A valid insert lands on this side of the card: the coral bar. */
  insert?: 'before' | 'after' | null
  /** A highlight match: a 2px ring in the highlight's hue. */
  ring?: TapeTone | null
  /** A non-match under a highlight: flat (no ruled paper, no shadow), never
   * dimmed. */
  quiet?: boolean
  onSelect: () => void
  onOpenInWrite: () => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onFocus: () => void
  onDragStart: () => void
  onDragEnd: () => void
  /** Dragged over, with the pointer on the right half (`after`) or the left;
   * returns whether the card takes the drop (Board's call). */
  onDragOver: (after: boolean) => boolean
  onDragLeave: () => void
  onDrop: (after: boolean) => void
}

// Literal class names: Tailwind only generates whole names it can see.
const TONE_BG: Record<TapeTone, string> = {
  sky: 'bg-tr-sky',
  amber: 'bg-tr-amber',
  secret: 'bg-tr-ledger-secret-ink',
  accent: 'bg-tr-accent-ink',
}

const TONE_RING: Record<TapeTone, string> = {
  sky: 'ring-tr-sky',
  amber: 'ring-tr-amber',
  secret: 'ring-tr-ledger-secret-ink',
  accent: 'ring-tr-accent-ink',
}

const TICK: Record<SceneSignals['ticks'][number], string> = {
  story: 'h-2.5 bg-tr-amber',
  import: 'h-2.5 bg-transparent inset-ring inset-ring-tr-text-secondary',
  plain: 'h-2 bg-tr-border-strong',
}

// PanelHeader's focus ring, offset 4 so it clears the selected card's inset
// ring and the related card's dashed outline (solid even on a related card).
// Never outline-none: in Tailwind 4 it would hide outline-selected too.
const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-4 focus-visible:outline-tr-sky focus-visible:outline-solid'

function LockGlyph() {
  return (
    <svg
      data-lock-glyph
      viewBox="0 0 24 24"
      className="h-3 w-3 shrink-0 text-tr-amber"
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

/** "3 beats", "1 with a story note", "1 with an import note": what the ticks
 * say, for their tooltip and the card's accessible name. None with no beats. */
function beatParts(s: SceneSignals): string[] {
  if (!s.scene.beats.length) return []
  const story = s.ticks.filter((t) => t === 'story').length
  const imported = s.ticks.filter((t) => t === 'import').length
  return [
    plural(s.scene.beats.length, 'beat'),
    story > 0 ? `${story} with a story note` : '',
    imported > 0 ? `${imported} with an import note` : '',
  ].filter(Boolean)
}

/** Story notes and Order notes: the amber ⚑ count. */
function storyCount(s: SceneSignals): number {
  return s.storyNotes.length + s.orderNotes.length
}

function cardLabel(
  s: SceneSignals,
  locked: boolean,
  unsaved: boolean,
  tape: CardTape | null,
): string {
  const notes = storyCount(s) + s.importNotes.length
  const tag = cardTag(s)
  return [
    `Scene ${s.number}`,
    s.place,
    locked && 'locked',
    notes > 0 && plural(notes, 'note'),
    s.importNotes.length > 0 && `${s.importNotes.length} from the import`,
    ...beatParts(s),
    s.setsUp.length > 0 && `sets up ${s.setsUp.length}`,
    s.paysOff.length > 0 && `pays off ${s.paysOff.length}`,
    s.secret && `secret ${s.secret}`,
    tag && (tag === 'TURN' ? s.landmark : 'act out'),
    unsaved && 'unsaved draft',
    tape?.text,
  ]
    .filter(Boolean)
    .join(', ')
}

/** The right half of the card inserts after it. */
function pointerAfter(event: DragEvent<HTMLElement>): boolean {
  const r = event.currentTarget.getBoundingClientRect()
  return event.clientX > r.left + r.width / 2
}

/**
 * A scene on the Plan board as the import board's ruled index card (redesign
 * spec §4.2). Draggable unless locked (scene or episode) or a write is in
 * flight. Every card, locked or not, reports a dragover with the pointer's
 * half and takes the drop only when Board says so (a locked card takes one
 * that leaves it in place); the coral bar marks the insert's side. Board owns
 * the roving tab stop and the keys; double-click opens Write on this scene.
 */
export function BoardCard({
  signals,
  locked,
  selected,
  tabIndex,
  pending,
  unsaved,
  tape,
  related,
  dragging,
  dropTarget,
  insert = null,
  ring = null,
  quiet = false,
  onSelect,
  onOpenInWrite,
  onKeyDown,
  onFocus,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: BoardCardProps) {
  const { scene, number, place } = signals
  const draggable = !locked && !pending
  const tag = cardTag(signals)
  // Under Act shape an act-out card's tape would repeat its own ACT OUT tag:
  // the ring marks the match, so no tape (a landmark or ACT SPLIT? tape stays).
  const shownTape = tape && tape.text !== tag ? tape : null
  const beats = beatParts(signals).join(' · ')
  const stories = storyCount(signals)
  const amber = tape?.tone === 'amber'

  function handleDoubleClick(event: MouseEvent) {
    event.preventDefault()
    onOpenInWrite()
  }

  function handleDragStart(event: DragEvent) {
    if (!draggable) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData('text/plain', scene.id)
    event.dataTransfer.effectAllowed = 'move'
    onDragStart()
  }

  // Prevented only when Board takes the drop; otherwise the browser shows
  // "not allowed" and never drops.
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (onDragOver(pointerAfter(event))) event.preventDefault()
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    onDrop(pointerAfter(event))
  }

  const fill = selected
    ? 'bg-tr-coral-soft inset-ring-2 inset-ring-tr-coral shadow-card-lift'
    : quiet
      ? 'bg-tr-surface-sunken shadow-none'
      : 'bg-tr-board-paper shadow-card-board hover:shadow-card-lift'

  return (
    <div
      role="button"
      aria-pressed={selected}
      aria-label={cardLabel(signals, locked, unsaved, shownTape)}
      // ⌥←/⌥→ move it (Board's keys): the only keyboard reorder in an act.
      aria-keyshortcuts={draggable ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
      title={`${number}. ${scene.location}\n${scene.whatHappens}`}
      data-scene-card
      data-scene-id={scene.id}
      data-testid={`scene-card-${scene.id}`}
      data-locked={locked}
      data-match={ring ? true : undefined}
      tabIndex={tabIndex}
      draggable={draggable}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
      style={quiet && !selected ? undefined : RULED}
      className={
        `relative flex h-card-board-h w-card-board-w shrink-0 cursor-pointer select-none flex-col rounded-[4px] px-2 pb-1 pt-[7px] text-tr-text-primary transition-[box-shadow,translate] ease-standard hover:-translate-y-px motion-reduce:transition-none ${fill} ${FOCUS}` +
        (related
          ? ` outline-[1.5px] outline-offset-3 outline-dashed ${amber ? 'outline-tr-amber' : 'outline-tr-sky'}`
          : '') +
        (dragging ? ' opacity-50' : '') +
        // Both are box-shadow rings and compose with the selected inset ring;
        // a drop target's ring (amber for a problem or a lock, else sky) wins
        // over a highlight ring.
        (dropTarget
          ? ` ring-2 ${amber ? 'ring-tr-amber' : 'ring-tr-sky'}`
          : ring
            ? ` ring-2 ${TONE_RING[ring]}`
            : '')
      }
    >
      {shownTape && (
        <span
          aria-hidden="true"
          data-tape
          // Only the drop tape wraps (its reason must read whole); a second
          // line on any other tape would cover the number and place row.
          className={`absolute -top-2.5 left-2 z-[2] ${dropTarget ? 'line-clamp-2' : 'truncate'} max-w-[134px] rounded-[3px] px-1.5 text-11 font-semibold leading-4 text-tr-surface-raised shadow-raised ${TONE_BG[shownTape.tone]}`}
        >
          {shownTape.text}
        </span>
      )}
      {insert && (
        // Centred in the board's 12px gap-x-3.
        <span
          aria-hidden="true"
          data-insert-bar
          data-side={insert}
          className={`absolute inset-y-0 w-[3px] rounded-full bg-tr-coral ${insert === 'before' ? '-left-[7.5px]' : '-right-[7.5px]'}`}
        />
      )}
      <div
        aria-hidden="true"
        className="flex h-3.5 min-w-0 items-center gap-[5px] whitespace-nowrap text-12 leading-[14px]"
      >
        <span className="shrink-0 font-semibold tabular-nums">{number}</span>
        <span
          className={`size-1.5 shrink-0 rounded-full ${sceneTypeDotClass(sceneLocationType(scene))}`}
        />
        <span className="min-w-0 flex-1 truncate font-semibold">{place}</span>
        {stories > 0 ? (
          <span
            data-testid="consistency-flag-badge"
            data-kind="story"
            className="shrink-0 rounded-chip bg-tr-amber-soft px-[5px] text-11 font-semibold text-tr-amber"
          >
            ⚑{stories}
          </span>
        ) : (
          signals.importNotes.length > 0 && (
            <span
              data-testid="consistency-flag-badge"
              data-kind="import"
              className="shrink-0 rounded-chip bg-tr-surface-sunken px-[5px] text-11 font-medium inset-ring inset-ring-tr-border-strong"
            >
              ⚑{signals.importNotes.length}
            </span>
          )
        )}
        {locked && <LockGlyph />}
        {unsaved && (
          <span
            data-testid="unsaved-dot"
            role="img"
            aria-label="Unsaved edits"
            title="Unsaved edits"
            className="size-2 shrink-0 rounded-full bg-tr-coral"
          />
        )}
      </div>
      <p className="mt-[7px] line-clamp-4 flex-1 overflow-hidden font-ledger-display text-13 leading-[15px] text-tr-text-primary">
        {scene.whatHappens}
      </p>
      <div
        aria-hidden="true"
        className="flex h-3.5 items-center gap-1.5 text-11 leading-[14px] tabular-nums"
      >
        <span
          data-ticks
          title={beats || undefined}
          className="flex shrink-0 items-end gap-0.5"
        >
          {signals.ticks.map((tick, i) => (
            <i
              key={i}
              data-tick={tick}
              className={`w-0.75 rounded-[1px] ${TICK[tick]}`}
            />
          ))}
        </span>
        {signals.setsUp.length > 0 && (
          <span
            className={`font-semibold ${signals.neverPaidOff ? 'text-tr-amber' : 'text-tr-sky'}`}
          >
            ↗{signals.setsUp.length}
          </span>
        )}
        {signals.paysOff.length > 0 && (
          <span className="font-semibold text-tr-sky">
            ↘{signals.paysOff.length}
          </span>
        )}
        {signals.secret && (
          <span className="font-semibold text-tr-ledger-secret-ink">
            {signals.secret === 'out' ? '◇' : '◆'}
          </span>
        )}
        {tag && (
          <span className="ml-auto font-semibold tracking-[.05em] text-tr-accent-ink">
            {tag}
          </span>
        )}
      </div>
    </div>
  )
}
