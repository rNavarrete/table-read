// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectImportFound, ShowFormat } from 'contract'
import { applyFound, type BoardState, emptyBoard } from '../importBoard'
import {
  advanceImportProgress,
  type ImportProgressState,
  initialImportProgressState,
} from '../importProgress'
import { type BoardPhase, ImportBoard } from './ImportBoard'

const FORMAT: ShowFormat = {
  genre: 'comedy',
  runtimeMinutes: 22,
  actCount: 2,
  coldOpen: true,
  tag: false,
  serialization: 0.5,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (Element.prototype as Partial<Element>).animate
})

function scenesFrame(count: number): ProjectImportFound {
  return {
    kind: 'scenes',
    scenes: Array.from({ length: count }, (_, index) => ({
      index,
      slugline: `INT. ROOM ${index + 1}`,
      lineCount: 4,
      intExt: 'int' as const,
    })),
  }
}

function board(...frames: ProjectImportFound[]): BoardState {
  return frames.reduce(applyFound, emptyBoard())
}

function progressAt(
  ...stages: ImportProgressState['currentStage'][]
): ImportProgressState {
  return stages.reduce(
    (state, name, k) =>
      name === null
        ? state
        : advanceImportProgress(state, { type: 'stage', name }, k * 1_000),
    initialImportProgressState,
  )
}

function renderBoard({
  state = emptyBoard(),
  progress = progressAt('parsing_scenes'),
  phase = 'streaming',
  animate = true,
  nowMs = 0,
  onOpenStory = () => {},
  onSeeInPlan = () => {},
}: {
  state?: BoardState
  progress?: ImportProgressState
  phase?: BoardPhase
  animate?: boolean
  nowMs?: number
  onOpenStory?: () => void
  onSeeInPlan?: () => void
} = {}) {
  return render(
    <ImportBoard
      title="The Long Pour"
      board={state}
      progress={progress}
      phase={phase}
      animate={animate}
      nowMs={nowMs}
      approxSceneCount={24}
      onOpenStory={onOpenStory}
      onSeeInPlan={onSeeInPlan}
    />,
  )
}

const ACTS: ProjectImportFound = {
  kind: 'acts',
  format: FORMAT,
  sceneActs: [0, 1, 1],
}

describe('ImportBoard', () => {
  it('starts with the client count, labelled approximate', () => {
    renderBoard({ progress: initialImportProgressState })
    expect(screen.getByTestId('board-headline').textContent).toBe(
      'About 24 scenes found in your pages',
    )
    expect(screen.getByTestId('board-caption').textContent).toMatch(
      /^Usually \d+–\d+ minutes for a script this size\. Keep this tab open\.$/,
    )
  })

  it('lays the cards in script order until the acts land', () => {
    renderBoard({ state: board(scenesFrame(3)) })
    expect(screen.getByTestId('board-headline').textContent).toBe(
      '3 scenes found in your pages',
    )
    const order = screen.getByRole('list', { name: 'In script order' })
    expect(within(order).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByTestId('board-act-0')).toBeNull()
  })

  it('puts the cards in act frames with tape labels once the acts land', () => {
    renderBoard({
      state: board(scenesFrame(3), ACTS),
      progress: progressAt(
        'parsing_scenes',
        'segmenting_beats',
        'inferring_acts',
      ),
    })
    expect(screen.queryByRole('list', { name: 'In script order' })).toBeNull()
    const cards = screen.getByRole('list', { name: 'Scenes by act' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByTestId('board-act-0').textContent).toContain('COLD OPEN')
    expect(screen.getByTestId('board-act-1').textContent).toBe(
      'ACT ONE2 scenes · 0 beats',
    )
    expect(screen.getByTestId('board-headline').textContent).toBe(
      'The breaks go up',
    )
    expect(screen.getByTestId('board-caption').textContent).toBe(
      'Cold Open: 1 scene · Act One: 2 scenes',
    )
    expect(screen.getByRole('status').textContent).toBe(
      'Cold Open: 1 scene · Act One: 2 scenes',
    )
  })

  it('keeps every card readable on a big script', () => {
    // A 54-scene import once switched to a card that dropped the reading.
    renderBoard({
      state: board(scenesFrame(54), {
        kind: 'scene',
        index: 40,
        beatCount: 4,
        whatHappens: 'Barney buys a bigger plow.',
        failed: false,
      }),
    })
    const card = screen.getByTestId('board-card-40')
    expect(card.textContent).toContain('~ Barney buys a bigger plow.')
    expect(card.querySelector('[data-body]')).not.toBeNull()
  })

  it('lists the threads with their status and strings the first one', () => {
    renderBoard({
      state: board(scenesFrame(3), ACTS, {
        kind: 'threads',
        threads: [
          {
            label: 'The second ledger',
            status: 'paid_off',
            setupSceneIndex: 0,
            payoffSceneIndex: 2,
          },
          {
            label: 'Back pay',
            status: 'open',
            setupSceneIndex: 1,
            payoffSceneIndex: null,
          },
        ],
      }),
      progress: progressAt('inferring_promises'),
    })
    const threads = screen.getByTestId('board-threads')
    expect(threads.textContent).toContain('~ The second ledger')
    expect(threads.textContent).toContain('Paid off')
    expect(threads.textContent).toContain('~ Back pay')
    expect(threads.textContent).toContain('Open')
    const string = screen.getByTestId('board-string-1')
    expect(string.tagName).toBe('path')
    expect(string.dataset).toMatchObject({ from: '0', to: '2' })
    // Only setup: a pin, no string.
    expect(screen.queryByTestId('board-string-2')).toBeNull()
    expect(screen.getByTestId('board-card-1').textContent).toContain('2')
    expect(screen.getByTestId('board-caption').textContent).toBe(
      '2 threads traced',
    )
  })

  it('runs a step clock with a sweep for a single-call step', () => {
    renderBoard({
      state: board(scenesFrame(20)),
      progress: progressAt(
        'parsing_scenes',
        'segmenting_beats',
        'inferring_acts',
      ),
      nowMs: 2_000 + 8_000,
    })
    expect(screen.getByTestId('board-caption').textContent).toBe(
      'One read of the whole episode · 0:08 on this step · usually 6–14 s',
    )
    expect(screen.getByTestId('inferring_acts-indeterminate')).not.toBeNull()
    expect(
      screen.getByText('While you wait, every card is open to read.'),
    ).not.toBeNull()
  })

  it('keeps the ETA 40 s into a single-call step', () => {
    renderBoard({
      state: board(scenesFrame(60)),
      progress: progressAt(
        'parsing_scenes',
        'segmenting_beats',
        'inferring_acts',
        'inferring_entities',
        'inferring_promises',
      ),
      nowMs: 4_000 + 40_000,
    })
    expect(screen.getByText(/min left$/).textContent).toBe(
      'typically about 1–2 min left',
    )
  })

  it('freezes a stopped step: Stopped in words, no sweep', () => {
    const progress = advanceImportProgress(
      progressAt('parsing_scenes', 'segmenting_beats', 'inferring_acts'),
      { type: 'failed' },
      5_000,
    )
    renderBoard({ state: board(scenesFrame(20)), progress, phase: 'failed' })
    const step = screen.getByTestId('board-step-inferring_acts')
    expect(step.dataset.status).toBe('stopped')
    expect(step.textContent).toContain('Stopped')
    expect(
      screen.getByTestId('board-step-segmenting_beats').dataset.status,
    ).toBe('done')
    expect(screen.queryByTestId('inferring_acts-indeterminate')).toBeNull()
    expect(screen.getByTestId('board-caption').textContent).toMatch(/Stopped$/)
  })

  it('says each step status in words', () => {
    renderBoard({ progress: progressAt('parsing_scenes', 'segmenting_beats') })
    expect(screen.getByTestId('board-step-parsing_scenes').textContent).toBe(
      'Readingdone',
    )
    const now = screen.getByTestId('board-step-segmenting_beats')
    expect(now.dataset.status).toBe('now')
    expect(now.textContent).toBe('Beatsin progress')
    expect(now.getAttribute('aria-current')).toBe('step')
    expect(screen.getByTestId('board-step-saving').textContent).toBe(
      'Savingwaiting',
    )
  })

  it('shows a focused card in Notes', () => {
    renderBoard({
      state: board(scenesFrame(2), {
        kind: 'scene',
        index: 1,
        beatCount: 3,
        whatHappens: 'Ruth smokes in the alley.',
        failed: false,
      }),
      progress: progressAt('parsing_scenes', 'segmenting_beats'),
    })
    fireEvent.focus(screen.getByTestId('board-card-0'))
    expect(screen.getByText('Sc. 1 · INT. ROOM 1')).not.toBeNull()
    fireEvent.blur(screen.getByTestId('board-card-0'))
    // Unfocused, Notes go back to the latest find.
    expect(
      screen.getByText('3 beats · ~ Ruth smokes in the alley.'),
    ).not.toBeNull()
  })

  it('keeps a focused card focused through the act break; Notes follow focus', () => {
    const props = {
      title: 'x',
      progress: progressAt('parsing_scenes', 'segmenting_beats'),
      phase: 'streaming' as const,
      animate: true,
      nowMs: 0,
      approxSceneCount: 3,
      onOpenStory: () => {},
      onSeeInPlan: () => {},
    }
    const { rerender } = render(
      <ImportBoard {...props} board={board(scenesFrame(3))} />,
    )
    const card = screen.getByTestId('board-card-1')
    act(() => card.focus())
    expect(screen.getByText('Sc. 2 · INT. ROOM 2')).not.toBeNull()

    rerender(
      <ImportBoard
        {...props}
        board={board(scenesFrame(3), ACTS, {
          kind: 'threads',
          threads: [
            {
              label: 'Back pay',
              status: 'open',
              setupSceneIndex: 1,
              payoffSceneIndex: null,
            },
          ],
        })}
      />,
    )
    // The same node, still focused: the act break never remounts a card.
    expect(screen.getByTestId('board-card-1')).toBe(card)
    expect(document.activeElement).toBe(card)
    expect(screen.getByText('Sc. 2 · INT. ROOM 2')).not.toBeNull()

    act(() => card.blur())
    expect(screen.getByTestId('board-threads').textContent).toContain(
      '~ Back pay',
    )
  })

  it('counts read scenes and announces only every 10th', () => {
    const reads = Array.from(
      { length: 11 },
      (_, index): ProjectImportFound => ({
        kind: 'scene',
        index,
        beatCount: 1,
        whatHappens: 'x',
        failed: false,
      }),
    )
    const progress = progressAt('parsing_scenes', 'segmenting_beats')
    renderBoard({
      state: board(scenesFrame(24), ...reads.slice(0, 9)),
      progress,
    })
    expect(screen.getByTestId('board-caption').textContent).toBe(
      'Breaking scenes into beats · 9 of 24',
    )
    expect(screen.getByRole('status').textContent).toBe('Reading your script')
    cleanup()
    renderBoard({ state: board(scenesFrame(24), ...reads), progress })
    expect(screen.getByRole('status').textContent).toBe('10 of 24 scenes read')
  })

  it('holds on the finale with Open your story focused', () => {
    const onOpenStory = vi.fn()
    const onSeeInPlan = vi.fn()
    renderBoard({
      state: board(scenesFrame(3), ACTS),
      progress: advanceImportProgress(
        progressAt('saving'),
        { type: 'complete' },
        1,
      ),
      phase: 'done',
      onOpenStory,
      onSeeInPlan,
    })
    expect(screen.getByTestId('board-headline').textContent).toBe(
      'The board is up.',
    )
    const open = screen.getByTestId('open-your-story')
    expect(document.activeElement).toBe(open)
    expect(screen.getByTestId('board-finale').textContent).toContain(
      '3 scenes · 0 beats · 2 acts · 0 facts',
    )
    fireEvent.click(screen.getByTestId('see-it-in-plan'))
    fireEvent.click(open)
    expect(onSeeInPlan).toHaveBeenCalledTimes(1)
    expect(onOpenStory).toHaveBeenCalledTimes(1)
    for (const step of screen.getAllByTestId(/^board-step-/))
      expect(step.dataset.status).toBe('done')
  })

  it('deals the cards when animated, and not for a burst', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const animate = vi.fn()
    Element.prototype.animate = animate as unknown as Element['animate']
    const { rerender } = renderBoard()
    const props = {
      title: 'x',
      progress: progressAt('parsing_scenes'),
      phase: 'streaming' as const,
      nowMs: 0,
      approxSceneCount: 3,
      onOpenStory: () => {},
      onSeeInPlan: () => {},
    }
    rerender(<ImportBoard {...props} board={board(scenesFrame(3))} animate />)
    expect(animate).toHaveBeenCalledTimes(3)

    cleanup()
    animate.mockClear()
    const burst = render(
      <ImportBoard {...props} board={emptyBoard()} animate={false} />,
    )
    burst.rerender(
      <ImportBoard
        {...props}
        board={board(scenesFrame(3), ACTS)}
        animate={false}
      />,
    )
    expect(animate).not.toHaveBeenCalled()
    expect(
      screen.getByTestId('import-board').querySelector('[data-motion]'),
    ).toHaveProperty('dataset.motion', 'off')
  })

  it('reduced motion: nothing flies', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const animate = vi.fn()
    Element.prototype.animate = animate as unknown as Element['animate']
    const { rerender } = renderBoard()
    rerender(
      <ImportBoard
        title="x"
        board={board(scenesFrame(3))}
        progress={progressAt('parsing_scenes')}
        phase="streaming"
        animate
        nowMs={0}
        approxSceneCount={3}
        onOpenStory={() => {}}
        onSeeInPlan={() => {}}
      />,
    )
    expect(animate).not.toHaveBeenCalled()
  })
})
