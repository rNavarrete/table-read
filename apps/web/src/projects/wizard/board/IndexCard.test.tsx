// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardScene } from '../importBoard'
import { IndexCard } from './IndexCard'

afterEach(cleanup)

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    index: 2,
    slugline: 'INT. BAR',
    lineCount: 9,
    intExt: 'int',
    read: 'pending',
    beatCount: 0,
    whatHappens: '',
    beats: [],
    act: null,
    castRead: false,
    factCount: null,
    secretCount: 0,
    factsFailed: false,
    pins: [],
    ...over,
  }
}

function renderCard(over: Partial<BoardScene> = {}, onRead?: () => void) {
  render(
    <ul>
      <IndexCard scene={scene(over)} onRead={onRead} />
    </ul>,
  )
  return screen.getByTestId('board-card-2')
}

const BEAT = {
  whatHappens: 'Dev finds a second ledger.',
  audienceLearns: '',
  audienceFeels: '',
}

describe('IndexCard', () => {
  it('shows a pending card as not read yet, tilted', () => {
    const card = renderCard()
    expect(screen.getByText('Not read yet')).not.toBeNull()
    expect(card.dataset.state).toBe('pending')
    expect(card.hasAttribute('data-tilt')).toBe(true)
    expect(card.getAttribute('aria-label')).toBe(
      'Scene 3, INT. BAR, not read yet',
    )
  })

  it('shows the reading with a tick per beat, squared up', () => {
    const card = renderCard({
      read: 'read',
      beatCount: 5,
      whatHappens: 'Dev finds a second ledger.',
    })
    expect(screen.getByText('~ Dev finds a second ledger.')).not.toBeNull()
    expect(card.querySelectorAll('[data-mark]')).toHaveLength(5)
    expect(card.hasAttribute('data-tilt')).toBe(false)
    expect(card.getAttribute('aria-label')).toBe(
      'Scene 3, INT. BAR, read, 5 beats',
    )
  })

  it('caps the ticks at 12', () => {
    const card = renderCard({ read: 'read', beatCount: 20, whatHappens: 'x' })
    expect(card.querySelectorAll('[data-mark]')).toHaveLength(12)
  })

  it('shows a failed scene in amber words, never an empty success', () => {
    const card = renderCard({ read: 'failed', beatCount: 1 })
    const text = screen.getByText(
      "Couldn't break into beats. Kept whole; flagged for you.",
    )
    expect(text.className).toContain('text-tr-amber')
    expect(card.dataset.state).toBe('failed')
    expect(card.getAttribute('aria-label')).toBe(
      "Scene 3, INT. BAR, couldn't be read",
    )
  })

  it('stamps the fact count, with ◆ when a fact is hidden from the audience', () => {
    const card = renderCard({
      read: 'read',
      beatCount: 2,
      whatHappens: 'x',
      factCount: 4,
      secretCount: 1,
    })
    expect(card.querySelector('[data-stamp]')?.textContent).toBe('4 facts ◆')
    expect(card.getAttribute('aria-label')).toContain(
      '4 facts, 1 hidden from the audience',
    )
    cleanup()
    const plain = renderCard({ read: 'read', factCount: 1, secretCount: 0 })
    expect(plain.querySelector('[data-stamp]')?.textContent).toBe('1 fact')
  })

  it('pins each thread number on the card', () => {
    const card = renderCard({ read: 'read', pins: [1, 3] })
    const pins = [...card.querySelectorAll('[data-pin]')]
    expect(pins.map((pin) => pin.textContent)).toEqual(['1', '3'])
    expect(card.getAttribute('aria-label')).toContain('threads 1 and 3')
  })

  it('makes a read card with beats a button that opens its reading', () => {
    const onRead = vi.fn()
    const card = renderCard(
      { read: 'read', beatCount: 1, whatHappens: 'x', beats: [BEAT] },
      onRead,
    )
    const button = screen.getByRole('button', { name: 'Read scene 3' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // The button holds the card's one tab stop.
    expect(card.tabIndex).toBe(-1)
    fireEvent.click(button)
    expect(onRead).toHaveBeenCalledWith(2)
  })

  it('keeps reading, failed and beat-less cards from being buttons', () => {
    for (const over of [
      {},
      { read: 'failed' as const, beatCount: 1 },
      { read: 'read' as const, beatCount: 0, whatHappens: 'x' },
    ]) {
      const card = renderCard(over, () => {})
      expect(screen.queryByRole('button')).toBeNull()
      expect(card.tabIndex).toBe(0)
      cleanup()
    }
  })

  it('always shows the heading and the reading, with both in full on hover', () => {
    const card = renderCard({
      read: 'read',
      beatCount: 3,
      whatHappens: 'Homer buys a snowplow with money they do not have.',
    })
    expect(screen.getByText('INT. BAR')).not.toBeNull()
    expect(
      screen.getByText('~ Homer buys a snowplow with money they do not have.'),
    ).not.toBeNull()
    expect(card.querySelectorAll('[data-mark]')).toHaveLength(3)
    expect(card.getAttribute('title')).toBe(
      '3. INT. BAR\nHomer buys a snowplow with money they do not have.',
    )
  })
})
