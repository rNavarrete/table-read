import type { Character } from 'contract'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { characterName } from './planTree'
import { nameList, type SceneSignals } from './story'

/** Rest on a card this long before its peek opens; leave it this long
 * before it closes (time to move onto the peek, WCAG 1.4.13 "hoverable"). */
export const PEEK_SHOW_MS = 400
export const PEEK_HIDE_MS = 120
const GAP = 8
const MARGIN = 8

export interface CardPeekState {
  open: boolean
  anchor: DOMRect | null
  close: () => void
  /** Spread on the card. */
  cardHandlers: {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => void
    onPointerLeave: () => void
    onPointerDown: () => void
    onFocus: (event: FocusEvent<HTMLElement>) => void
    onBlur: () => void
  }
  /** Spread on the peek, so the pointer can move onto it. */
  peekHandlers: { onPointerEnter: () => void; onPointerLeave: () => void }
  /** Esc closes an open peek and is consumed; returns whether it was. */
  onEscape: (event: KeyboardEvent<HTMLElement>) => boolean
}

/**
 * The card peek's open state (Plan card peek): opens after resting the
 * pointer on a card for PEEK_SHOW_MS, or at once when the card takes focus
 * from the keyboard (not from a click, which selects); closes on leaving the
 * card and the peek, blur, Esc, a scroll, or `disabled` (a drag). Esc is
 * consumed only for a hover peek (dismiss without moving, WCAG 1.4.13); a
 * focus peek closes and lets Esc go on to Plan (back to the Episode view), so
 * keyboard users never need a second press. Nothing here calls a model.
 */
export function useCardPeek(disabled = false): CardPeekState {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [byPointer, setByPointer] = useState(false)
  const timer = useRef<number | null>(null)
  const pointerFocus = useRef(false)

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const close = useCallback(() => {
    clear()
    setAnchor(null)
  }, [])
  const later = (ms: number, fn: () => void) => {
    clear()
    timer.current = window.setTimeout(fn, ms)
  }

  useEffect(() => clear, [])
  // A fixed peek would float off its card once the board scrolls.
  useEffect(() => {
    if (!anchor) return
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [anchor, close])

  // `disabled` (a drag) hides it outright; the drag start also closes it.
  const shown = disabled ? null : anchor
  return {
    open: shown !== null,
    anchor: shown,
    close,
    cardHandlers: {
      onPointerEnter: (event) => {
        if (disabled) return
        const card = event.currentTarget
        later(PEEK_SHOW_MS, () => {
          setByPointer(true)
          setAnchor(card.getBoundingClientRect())
        })
      },
      onPointerLeave: () => later(PEEK_HIDE_MS, () => setAnchor(null)),
      onPointerDown: () => {
        pointerFocus.current = true
      },
      onFocus: (event) => {
        const fromPointer = pointerFocus.current
        pointerFocus.current = false
        if (disabled || fromPointer) return
        clear()
        setByPointer(false)
        setAnchor(event.currentTarget.getBoundingClientRect())
      },
      onBlur: close,
    },
    peekHandlers: {
      onPointerEnter: clear,
      onPointerLeave: () => later(PEEK_HIDE_MS, () => setAnchor(null)),
    },
    onEscape: (event) => {
      if (event.key !== 'Escape' || shown === null) return false
      close()
      if (!byPointer) return false
      event.preventDefault()
      event.stopPropagation()
      return true
    },
  }
}

/** The peek's at-a-glance lines (T10.12 readings), each only when read. */
export function peekLines(
  signals: SceneSignals,
  characters: Character[],
): { term: string; text: string }[] {
  const name = (id: string) => characterName(characters, id)
  const lines: { term: string; text: string }[] = []
  const { turn, clashes, knowledge } = signals
  if (turn?.charges)
    lines.push({
      term: 'Turns',
      text: [turn.stake, turn.charges[0]].filter(Boolean).join(' '),
    })
  if (clashes.length)
    lines.push({
      term: 'Clash',
      text: clashes
        .map((c) => `${name(c.a.characterId)} vs ${name(c.b.characterId)}`)
        .join('; '),
    })
  if (knowledge?.irony.length)
    lines.push({
      term: 'Who knows',
      text: `Dramatic irony: ${nameList(knowledge.irony.map(name))} in the dark`,
    })
  else if (knowledge?.mystery.length)
    lines.push({
      term: 'Who knows',
      text: 'Mystery: the audience is in the dark',
    })
  return lines
}

export interface CardPeekProps {
  signals: SceneSignals
  characters: Character[]
  anchor: DOMRect
  onPointerEnter: () => void
  onPointerLeave: () => void
}

/**
 * A scene's card read in full (Plan card peek): number and place, the whole
 * slugline and What happens, and the turn, clash and who-knows readings.
 * Beside the card (right, or left where the window ends), in a portal so the
 * board's scroll box can't clip it. Visual only: the card's own label already
 * names the scene for screen readers, so the peek is aria-hidden.
 */
export function CardPeek({
  signals,
  characters,
  anchor,
  onPointerEnter,
  onPointerLeave,
}: CardPeekProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const right = anchor.right + GAP
    const left =
      right + width <= window.innerWidth - MARGIN
        ? right
        : Math.max(MARGIN, anchor.left - GAP - width)
    const top = Math.max(
      MARGIN,
      Math.min(anchor.top, window.innerHeight - MARGIN - height),
    )
    setPos({ left, top })
  }, [anchor])

  const { scene, number, place } = signals
  return createPortal(
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="card-peek"
      data-scene-id={scene.id}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        position: 'fixed',
        left: pos?.left ?? anchor.right + GAP,
        top: pos?.top ?? anchor.top,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="z-30 flex w-80 flex-col gap-2 rounded-[4px] border border-tr-border bg-tr-board-paper p-3 text-tr-text-primary shadow-card-lift"
    >
      <p className="text-13 font-semibold">
        {number} · {place}
      </p>
      <p className="font-script text-12 text-tr-text-secondary">
        {scene.location}
      </p>
      {scene.whatHappens && (
        <p className="font-ledger-display text-13 leading-[17px]">
          {scene.whatHappens}
        </p>
      )}
      {peekLines(signals, characters).map((line) => (
        <p key={line.term} className="text-12">
          <span className="font-semibold">{line.term}</span>{' '}
          <span className="text-tr-text-secondary">{line.text}</span>
        </p>
      ))}
    </div>,
    document.body,
  )
}
