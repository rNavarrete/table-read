// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  actBreakFlip,
  countUp,
  deal,
  drawString,
  prefersReducedMotion,
  staggerMs,
} from './boardMotion'

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduce }) as MediaQueryList),
  )
}

function stubAnimate() {
  const animate = vi.fn()
  Element.prototype.animate = animate as unknown as Element['animate']
  return animate
}

function desk(cards: number) {
  const root = document.createElement('div')
  const deck = document.createElement('div')
  root.append(deck)
  for (let i = 0; i < cards; i += 1) {
    const card = document.createElement('div')
    card.dataset.card = ''
    card.dataset.index = String(i)
    root.append(card)
  }
  return {
    root,
    deck,
    cards: [...root.querySelectorAll<HTMLElement>('[data-card]')],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  // jsdom has no Web Animations; leave it that way for other suites.
  delete (Element.prototype as Partial<Element>).animate
})

describe('board motion', () => {
  it('staggers by min(28 ms, 600 ms / N)', () => {
    expect(staggerMs(10)).toBe(28)
    expect(staggerMs(60)).toBe(10)
    expect(staggerMs(120)).toBe(5)
    expect(staggerMs(0)).toBe(0)
  })

  it('deals every card from the deck, one after another', () => {
    stubReducedMotion(false)
    const animate = stubAnimate()
    const { root, deck, cards } = desk(3)
    deal(cards, deck, root)
    expect(animate).toHaveBeenCalledTimes(3)
    expect(animate.mock.calls.map(([, options]) => options.delay)).toEqual([
      0, 28, 56,
    ])
  })

  it('draws a string with its delay', () => {
    stubReducedMotion(false)
    const animate = stubAnimate()
    drawString(
      document.createElementNS('http://www.w3.org/2000/svg', 'path'),
      120,
    )
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0][1].delay).toBe(120)
  })

  it('flies only the cards it saw before the act break', () => {
    stubReducedMotion(false)
    const animate = stubAnimate()
    const { root } = desk(2)
    actBreakFlip(root, new Map([[0, new DOMRect(10, 10, 118, 88)]]))
    // The desk's pull-back, then card 0's flight.
    expect(animate).toHaveBeenCalledTimes(2)
  })

  it('flies the act break on transform and opacity only', () => {
    stubReducedMotion(false)
    const animate = stubAnimate()
    const { root, cards } = desk(1)
    const lift = document.createElement('span')
    lift.dataset.lift = ''
    cards[0].append(lift)
    actBreakFlip(root, new Map([[0, new DOMRect(10, 10, 118, 88)]]))
    // The desk's pull-back, card 0's flight, and its lift layer fading.
    expect(animate.mock.instances).toEqual([root, cards[0], lift])
    const animated = animate.mock.calls.flatMap(([frames]) =>
      (frames as Keyframe[]).flatMap((frame) => Object.keys(frame)),
    )
    expect(new Set(animated)).toEqual(
      new Set(['transform', 'opacity', 'offset']),
    )
  })

  it('does nothing under reduced motion', () => {
    stubReducedMotion(true)
    const animate = stubAnimate()
    const { root, deck, cards } = desk(3)
    expect(prefersReducedMotion()).toBe(true)
    deal(cards, deck, root)
    actBreakFlip(root, new Map([[0, new DOMRect()]]))
    drawString(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
    expect(animate).not.toHaveBeenCalled()
  })

  it('sets the count at once under reduced motion', () => {
    stubReducedMotion(true)
    const el = document.createElement('span')
    el.textContent = '3'
    countUp(el, 42)
    expect(el.textContent).toBe('42')
  })

  it('counts up to the total', async () => {
    stubReducedMotion(false)
    vi.useFakeTimers()
    const el = document.createElement('span')
    el.textContent = '0'
    countUp(el, 40)
    await vi.advanceTimersByTimeAsync(600)
    expect(el.textContent).toBe('40')
    vi.useRealTimers()
  })
})
