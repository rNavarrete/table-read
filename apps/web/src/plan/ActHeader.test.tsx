// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Scene } from 'contract'
import { ActHeader } from './ActHeader'
import type { ActSummary } from './story'

afterEach(cleanup)

function scene(id: string, act = 1): Scene {
  return {
    id,
    index: 0,
    act,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: '',
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
  }
}

function summary(overrides: Partial<ActSummary> = {}): ActSummary {
  return {
    act: 1,
    label: 'ACT ONE',
    short: '1',
    scenes: [scene('scene-2'), scene('scene-3')],
    share: 0.43,
    setUp: 0,
    paidOff: 0,
    landmarks: [],
    actOutSceneId: 'scene-3',
    actSplitNotes: [],
    ...overrides,
  }
}

function renderHeader(props: Partial<ComponentProps<typeof ActHeader>> = {}) {
  const onToggle = vi.fn()
  const onSelectScene = vi.fn()
  render(
    <ActHeader
      summary={summary()}
      actCount={4}
      showThreads
      collapsed={false}
      onToggle={onToggle}
      onSelectScene={onSelectScene}
      {...props}
    />,
  )
  return { onToggle, onSelectScene }
}

describe('ActHeader', () => {
  it('names the act and counts its scenes, with the share bar, its even-share tick and ≈ percent', () => {
    renderHeader()
    expect(
      screen.getByRole('heading', { level: 2, name: 'ACT ONE' }),
    ).toBeTruthy()
    expect(screen.getByText('2 scenes')).toBeTruthy()

    const share = screen.getByText('≈43%')
    expect(share.title).toMatch(/share of the script text/)
    expect(share.title).toMatch(/an even split across 4 acts/)
    const fill = share.querySelector<HTMLElement>('[style*="width"]')
    const tick = share.querySelector<HTMLElement>('[style*="left"]')
    expect(fill?.style.width).toBe('43%')
    expect(tick?.style.left).toBe('25%')
  })

  it('no share bar without script text and no thread counts without threads', () => {
    renderHeader({ summary: summary({ share: null }), showThreads: false })
    expect(screen.queryByText(/≈/)).toBeNull()
    expect(screen.queryByTitle(/share of the script text/)).toBeNull()
    expect(screen.queryByText(/set up/)).toBeNull()
  })

  it('shows ↗ set up and ↘ paid off counts', () => {
    renderHeader({ summary: summary({ setUp: 3, paidOff: 1 }) })
    const counts = screen.getByText(/set up/)
    expect(counts.textContent).toBe('↗3 set up · ↘1 paid off')
  })

  it("chips only for marked landmarks: '✓ Turn · 3'", () => {
    renderHeader({
      summary: summary({
        landmarks: [
          {
            label: 'Act One Turn',
            short: 'Turn',
            sceneId: 'scene-3',
            number: 3,
          },
          { label: 'Act One Out', short: 'Out', sceneId: 'scene-3', number: 3 },
        ],
      }),
    })
    const turn = screen.getByText('✓ Turn · 3')
    expect(turn.title).toBe('Act One Turn')
    expect(screen.getByText('✓ Out · 3').title).toBe('Act One Out')
    expect(screen.getAllByText(/^✓/)).toHaveLength(2)
  })

  it('no landmark chip and no "not marked" nag when none are marked', () => {
    renderHeader()
    expect(screen.queryByText(/✓/)).toBeNull()
    expect(screen.queryByText(/not marked/i)).toBeNull()
  })

  it('an act-split note reads its sentence and Open scene n selects that scene', async () => {
    const { onSelectScene } = renderHeader({
      summary: summary({
        actSplitNotes: [
          {
            sceneId: 'scene-3',
            number: 3,
            text: 'Scene 3 reads like the start of the next act.',
          },
        ],
      }),
    })
    expect(screen.getByText('Act split')).toBeTruthy()
    expect(
      screen.getByText('Scene 3 reads like the start of the next act.'),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open scene 3' }))
    expect(onSelectScene).toHaveBeenCalledWith('scene-3')
  })

  it('the chevron says Hide/Show ACT ONE, carries aria-expanded and calls onToggle', async () => {
    const { onToggle } = renderHeader()
    const hide = screen.getByRole('button', { name: 'Hide ACT ONE' })
    expect(hide.getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(hide)
    expect(onToggle).toHaveBeenCalledOnce()

    cleanup()
    renderHeader({ collapsed: true })
    expect(
      screen
        .getByRole('button', { name: 'Show ACT ONE' })
        .getAttribute('aria-expanded'),
    ).toBe('false')
  })

  it('an empty act shows no share bar or counts', () => {
    renderHeader({
      summary: summary({ scenes: [], share: 0, actOutSceneId: null }),
    })
    expect(screen.getByText('0 scenes')).toBeTruthy()
    expect(screen.queryByText(/≈/)).toBeNull()
    expect(screen.queryByText(/set up/)).toBeNull()
  })

  it('says 1 scene for a single-scene act', () => {
    renderHeader({ summary: summary({ scenes: [scene('scene-4', 2)] }) })
    expect(screen.getByText('1 scene')).toBeTruthy()
  })
})
