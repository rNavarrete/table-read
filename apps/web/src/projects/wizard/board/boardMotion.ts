import { useState } from 'react'

// The import board's motion (UI spec §2a), all Web Animations so the stream
// loop never waits on one. Durations and easings are read from the tokens.
// Every helper is a no-op under prefers-reduced-motion, and where the DOM
// can't animate (jsdom).

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function canAnimate(el: Element | null | undefined): el is Element {
  return !!el && typeof el.animate === 'function' && !prefersReducedMotion()
}

function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
}

function tokenMs(name: string): number {
  return parseFloat(token(name)) || 0
}

/** Spec: stagger is min(28 ms, 600 ms / N), so a big deal still ends fast. */
export function staggerMs(count: number): number {
  return count > 0 ? Math.min(28, 600 / count) : 0
}

/** Whether a mounting element plays its entrance. Fixed at mount, so a later
 * animated batch never replays it on cards a cached burst already placed. */
export function useEntrance(animate: boolean): boolean {
  const [enter] = useState(animate)
  return enter
}

/** Position of `el` inside `ancestor`'s padding box, ignoring transforms. */
export function offsetIn(
  el: HTMLElement,
  ancestor: HTMLElement,
): { x: number; y: number } {
  let x = 0
  let y = 0
  let node: HTMLElement | null = el
  while (node && node !== ancestor) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return { x, y }
}

/** Cards fly out of the deck onto the board, one after another. */
export function deal(
  cards: HTMLElement[],
  deck: HTMLElement,
  desk: HTMLElement,
) {
  if (!canAnimate(deck)) return
  const step = staggerMs(cards.length)
  const from = offsetIn(deck, desk)
  const options = {
    duration: tokenMs('--tr-motion-deal'),
    easing: token('--tr-motion-spring') || 'ease-out',
    fill: 'backwards' as const,
  }
  cards.forEach((card, i) => {
    const to = offsetIn(card, desk)
    card.animate(
      [
        {
          transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) rotate(${(i % 5) - 2}deg)`,
          opacity: 0.9,
        },
        { transform: 'none', opacity: 1 },
      ],
      { ...options, delay: i * step },
    )
  })
}

/** The act break: the board pulls back, every card lifts and flies (FLIP)
 * from where it was into its act frame, then the tape labels drop on. */
export function actBreakFlip(desk: HTMLElement, first: Map<number, DOMRect>) {
  if (!canAnimate(desk)) return
  const duration = tokenMs('--tr-motion-flight')
  const settle = token('--tr-motion-settle') || 'ease-out'
  const lift = token('--tr-shadow-card-lift')
  const rest = token('--tr-shadow-card-board')
  const cards = [...desk.querySelectorAll<HTMLElement>('[data-card]')]
  const step = staggerMs(cards.length) / 2
  desk.animate(
    [
      { transform: 'none' },
      { transform: 'scale(0.975)', offset: 0.3 },
      { transform: 'none' },
    ],
    { duration: duration + 400, easing: settle },
  )
  cards.forEach((card, i) => {
    const was = first.get(Number(card.dataset.index))
    if (!was) return
    const now = card.getBoundingClientRect()
    card.animate(
      [
        {
          transform: `translate(${was.left - now.left}px, ${was.top - now.top}px)`,
          boxShadow: lift,
        },
        {
          transform: `translate(0, -6px) rotate(${(i % 3) - 1}deg)`,
          boxShadow: lift,
          offset: 0.78,
        },
        { transform: 'none', boxShadow: rest },
      ],
      { duration, delay: i * step, easing: settle, fill: 'backwards' },
    )
  })
  desk.querySelectorAll('[data-tape]').forEach((tape, k) =>
    tape.animate(
      [
        {
          opacity: 0,
          transform: 'translateY(-10px) rotate(-8deg) scale(1.1)',
        },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: 420,
        delay: duration * 0.9 + k * 120,
        easing: token('--tr-motion-spring') || 'ease-out',
        fill: 'backwards',
      },
    ),
  )
}

/** A string draws itself from setup to payoff. Paths carry pathLength=1. */
export function drawString(path: SVGPathElement, delay = 0) {
  if (!canAnimate(path)) return
  path.animate(
    [
      { strokeDasharray: '1', strokeDashoffset: '1' },
      { strokeDasharray: '1', strokeDashoffset: '0' },
    ],
    {
      duration: tokenMs('--tr-motion-string'),
      delay,
      easing: token('--tr-motion-settle') || 'ease-out',
      fill: 'backwards',
    },
  )
}

/** Counts `el` up to `to` over 500 ms; returns a cancel. */
export function countUp(el: HTMLElement, to: number): () => void {
  const from = Number(el.textContent) || 0
  if (
    from === to ||
    prefersReducedMotion() ||
    typeof requestAnimationFrame !== 'function'
  ) {
    el.textContent = String(to)
    return () => {}
  }
  const start = performance.now()
  let id = 0
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / 500)
    el.textContent = String(Math.round(from + (to - from) * (1 - (1 - p) ** 3)))
    if (p < 1) id = requestAnimationFrame(tick)
  }
  id = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(id)
}
