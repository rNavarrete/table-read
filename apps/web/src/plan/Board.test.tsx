// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'
import type {
  Character,
  ConsistencyFlag,
  Episode,
  Motivation,
  Project,
  Scene,
  StoryThread,
} from 'contract'
import { Board, gridNeighbor } from './Board'
import {
  boardModel,
  NO_HIGHLIGHT,
  predictionTape,
  type Highlight,
  type OrderIssue,
} from './story'

afterEach(cleanup)

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: '',
    whatHappens:
      'Marta walks back into the bar for the first time in eight years.',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...overrides,
  }
}

function episode(scenes: Scene[], overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: '',
    seasonFunction: '',
    storylines: [],
    scenes,
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads: [],
    secrets: [],
    storyOverview: null,
    narrativeMap: null,
    structureChecks: [],
    ...overrides,
  }
}

function project(ep: Episode, characters: Character[] = []): Project {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: false,
      serialization: 0.8,
    },
    enabledComponents: [],
    premise: '',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters,
      relationships: [],
      audienceGoals: [],
      narratorGoals: [],
      worldQA: [],
    },
    seasons: [
      {
        id: 'season-1',
        index: 0,
        locked: false,
        seasonArc: '',
        characterArcs: [],
        episodes: [ep],
      },
    ],
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
  }
}

function thread(
  id: string,
  setupSceneId: string,
  payoffSceneId: string | null,
): StoryThread {
  return {
    id,
    label: id,
    summary: '',
    status: payoffSceneId ? 'paid_off' : 'open',
    ownerCharacterIds: [],
    setupSceneId,
    payoffSceneId,
    setupQuote: '',
    payoffQuote: '',
    setupBeatId: null,
    payoffBeatId: null,
    locked: false,
  }
}

function storyFlag(objectId: string): ConsistencyFlag {
  return {
    id: `flag-${objectId}`,
    objectType: 'scene',
    objectId,
    factId: null,
    explanation: 'Scene 2 still has the money in the bar.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-root',
  }
}

/** The fixture's shape with act 4 empty: cold open scene-1; act 1 scene-2,
 * scene-3; act 2 scene-4; act 3 scene-5. */
function fixtureEpisode(overrides: Partial<Episode> = {}): Episode {
  return episode(
    [
      scene({ id: 'scene-1', index: 0, act: 0 }),
      scene({ id: 'scene-3', index: 2, act: 1, location: 'INT. BACK ROOM' }),
      scene({ id: 'scene-2', index: 1, act: 1, location: 'INT. BAR' }),
      scene({ id: 'scene-4', index: 3, act: 2, location: 'EXT. MARINA' }),
      scene({ id: 'scene-5', index: 4, act: 3, location: 'INT. OFFICE' }),
    ],
    overrides,
  )
}

function model(
  ep: Episode = fixtureEpisode(),
  flags: ConsistencyFlag[] = [],
  characters: Character[] = [],
) {
  return boardModel(project(ep, characters), ep, flags)
}

const MARTA: Character = {
  id: 'char-marta',
  name: 'Marta Vega',
  locked: false,
  aliases: [],
  embodiment: '',
  presentation: '',
  hiding: '',
  traits: '',
  seriesArc: '',
  summary: '',
  bio: '',
}

function want(characterId: string): Motivation {
  return {
    characterId,
    objective: 'Keep the bar open',
    stakes: '',
    obstacle: '',
    statedObjective: '',
    concealed: false,
  }
}

const WHO_MARTA: Highlight = { kind: 'who', who: 'char-marta' }

/** fixtureEpisode with Marta wanting something in scenes 2 and 4. */
function martaModel(overrides: Partial<Episode> = {}) {
  const ep = fixtureEpisode(overrides)
  for (const s of ep.scenes)
    if (s.id === 'scene-2' || s.id === 'scene-4')
      s.motivations = [want('char-marta')]
  return model(ep, [], [MARTA])
}

/** Act 1: scene-1 … scene-5; act 2: scene-6. Story notes on 1 and 5. */
function foldModel() {
  const ep = episode([
    ...[1, 2, 3, 4, 5].map((n) =>
      scene({ id: `scene-${n}`, index: n - 1, act: 1 }),
    ),
    scene({ id: 'scene-6', index: 5, act: 2 }),
  ])
  return model(ep, [storyFlag('scene-1'), storyFlag('scene-5')])
}

/** What predict returns for a move that would make scene 5 pay off the cash
 * before scene 2 sets it up. */
const PAYS_OFF_FIRST: OrderIssue = {
  id: 'payoff_first:thread-cash:scene-5',
  kind: 'payoff_first',
  sourceId: 'thread-cash',
  label: 'The moved cash',
  sceneId: 'scene-5',
  otherSceneId: 'scene-2',
}

const sel = (sceneId: string) => ({ type: 'scene' as const, sceneId })
const noop = () => {}

function renderBoard(overrides: Partial<ComponentProps<typeof Board>> = {}) {
  return render(
    <Board
      model={model()}
      episodeLocked={false}
      selection={null}
      collapsedActs={new Set()}
      pending={false}
      onSelectScene={noop}
      onOpenInWrite={noop}
      onReorder={noop}
      onMoveToAct={noop}
      onToggleAct={noop}
      onEnterPanel={noop}
      {...overrides}
    />,
  )
}

const card = (id: string) => screen.getByTestId(`scene-card-${id}`)
const cardIds = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[data-scene-card]')].map(
    (el) => el.dataset.sceneId,
  )

// jsdom doesn't implement DataTransfer; the cards only call setData.
function dt() {
  return {
    setData: () => {},
    getData: () => '',
    effectAllowed: 'move',
  } as unknown as DataTransfer
}

describe('Board', () => {
  it('renders a frame per board act with its header, and its cards in board order', () => {
    renderBoard()
    for (const n of [0, 1, 2, 3, 4]) {
      expect(screen.getByTestId(`act-frame-${n}`)).not.toBeNull()
    }
    const actOne = screen.getByTestId('act-frame-1')
    expect(
      within(actOne).getByRole('heading', { name: 'ACT ONE' }),
    ).not.toBeNull()
    expect(cardIds(actOne)).toEqual(['scene-2', 'scene-3'])
    expect(
      within(screen.getByTestId('act-frame-0')).getByText('COLD OPEN'),
    ).not.toBeNull()
  })

  it('a collapsed act keeps its header and says how many scenes are hidden, and how many have notes', async () => {
    const user = userEvent.setup()
    const onToggleAct = vi.fn()
    renderBoard({
      model: model(fixtureEpisode(), [storyFlag('scene-3')]),
      collapsedActs: new Set([1]),
      onToggleAct,
    })
    const actOne = screen.getByTestId('act-frame-1')
    expect(within(actOne).getByText('ACT ONE')).not.toBeNull()
    expect(
      within(actOne).getByText('2 scenes hidden · 1 with notes'),
    ).not.toBeNull()
    expect(cardIds(actOne)).toEqual([])

    await user.click(
      within(actOne).getByRole('button', { name: 'Show ACT ONE' }),
    )
    expect(onToggleAct).toHaveBeenCalledWith(1)
  })

  it('an empty act says so and takes a drop as one act change', () => {
    const onMoveToAct = vi.fn()
    const onReorder = vi.fn()
    renderBoard({ onMoveToAct, onReorder })
    const frame = screen.getByTestId('act-frame-4')
    const empty = within(frame).getByText(
      'No scenes yet. Drag a card here, or use the Act control.',
    )

    fireEvent.dragStart(card('scene-1'), { dataTransfer: dt() })
    const notPrevented = fireEvent.dragOver(empty, { dataTransfer: dt() })
    expect(notPrevented).toBe(false)
    expect(frame.className).toContain('inset-ring-tr-sky')
    fireEvent.drop(empty, { dataTransfer: dt() })

    expect(onMoveToAct).toHaveBeenCalledTimes(1)
    expect(onMoveToAct).toHaveBeenCalledWith('scene-1', 4)
    expect(onReorder).not.toHaveBeenCalled()
    expect(frame.className).not.toContain('inset-ring-tr-sky')
  })

  it('an empty act ignores a drag that never started (a locked card)', () => {
    const onMoveToAct = vi.fn()
    const ep = fixtureEpisode()
    ep.scenes[0].locked = true
    renderBoard({ model: model(ep), onMoveToAct })
    const empty = within(screen.getByTestId('act-frame-4')).getByText(
      /^No scenes yet/,
    )

    fireEvent.dragStart(card('scene-1'), { dataTransfer: dt() })
    expect(fireEvent.dragOver(empty, { dataTransfer: dt() })).toBe(true)
    fireEvent.drop(empty, { dataTransfer: dt() })
    expect(onMoveToAct).not.toHaveBeenCalled()
  })

  it('a locked card neither drags nor takes a drop; dragging one card onto another swaps', () => {
    const onReorder = vi.fn()
    const ep = fixtureEpisode()
    ep.scenes[1].locked = true // scene-3
    const { rerender } = renderBoard({ model: model(ep), onReorder })

    expect(card('scene-3').getAttribute('draggable')).toBe('false')
    expect(card('scene-3').getAttribute('data-locked')).toBe('true')
    expect(card('scene-2').getAttribute('draggable')).toBe('true')

    // A locked target: dragOver is not prevented (the browser never drops)
    // and a drop that fires anyway does nothing.
    fireEvent.dragStart(card('scene-2'), { dataTransfer: dt() })
    expect(fireEvent.dragOver(card('scene-3'), { dataTransfer: dt() })).toBe(
      true,
    )
    fireEvent.drop(card('scene-3'), { dataTransfer: dt() })
    expect(onReorder).not.toHaveBeenCalled()
    fireEvent.dragEnd(card('scene-2'), { dataTransfer: dt() })

    // A locked source never starts a drag.
    fireEvent.dragStart(card('scene-3'), { dataTransfer: dt() })
    fireEvent.dragOver(card('scene-2'), { dataTransfer: dt() })
    fireEvent.drop(card('scene-2'), { dataTransfer: dt() })
    expect(onReorder).not.toHaveBeenCalled()

    // Unlocked onto unlocked swaps.
    fireEvent.dragStart(card('scene-2'), { dataTransfer: dt() })
    fireEvent.dragOver(card('scene-4'), { dataTransfer: dt() })
    fireEvent.drop(card('scene-4'), { dataTransfer: dt() })
    expect(onReorder).toHaveBeenCalledTimes(1)
    expect(onReorder).toHaveBeenCalledWith('scene-2', 'scene-4')

    // An episode lock locks every card.
    rerender(
      <Board
        model={model(ep)}
        episodeLocked
        selection={null}
        collapsedActs={new Set()}
        pending={false}
        onSelectScene={noop}
        onReorder={onReorder}
        onMoveToAct={noop}
        onToggleAct={noop}
        onEnterPanel={noop}
      />,
    )
    expect(card('scene-2').getAttribute('draggable')).toBe('false')
    expect(card('scene-2').getAttribute('data-locked')).toBe('true')
  })

  it('nothing drags while a write is in flight', () => {
    const onReorder = vi.fn()
    const onMoveToAct = vi.fn()
    renderBoard({ pending: true, onReorder, onMoveToAct })
    expect(card('scene-2').getAttribute('draggable')).toBe('false')

    // Even a synthetic dragStart (bypassing the attribute) starts nothing.
    fireEvent.dragStart(card('scene-2'), { dataTransfer: dt() })
    fireEvent.dragOver(card('scene-4'), { dataTransfer: dt() })
    fireEvent.drop(card('scene-4'), { dataTransfer: dt() })
    const empty = within(screen.getByTestId('act-frame-4')).getByText(
      /^No scenes yet/,
    )
    fireEvent.dragOver(empty, { dataTransfer: dt() })
    fireEvent.drop(empty, { dataTransfer: dt() })
    expect(onReorder).not.toHaveBeenCalled()
    expect(onMoveToAct).not.toHaveBeenCalled()
  })

  it('exactly one card is a tab stop: the selected one, else the first', () => {
    const stops = (root: HTMLElement) =>
      [
        ...root.querySelectorAll<HTMLElement>(
          '[data-scene-card][tabindex="0"]',
        ),
      ].map((el) => el.dataset.sceneId)

    const { container, rerender } = renderBoard({ selection: sel('scene-3') })
    expect(stops(container)).toEqual(['scene-3'])

    const props = {
      model: model(),
      episodeLocked: false,
      pending: false,
      onSelectScene: noop,
      onReorder: noop,
      onMoveToAct: noop,
      onToggleAct: noop,
      onEnterPanel: noop,
    }
    rerender(<Board {...props} selection={null} collapsedActs={new Set()} />)
    expect(stops(container)).toEqual(['scene-1'])

    // The selected scene's act is collapsed: the first rendered card.
    rerender(
      <Board
        {...props}
        selection={sel('scene-3')}
        collapsedActs={new Set([0, 1])}
      />,
    )
    expect(stops(container)).toEqual(['scene-4'])

    // Without a selection, the last focused card keeps the stop.
    rerender(<Board {...props} selection={null} collapsedActs={new Set()} />)
    act(() => card('scene-5').focus())
    expect(stops(container)).toEqual(['scene-5'])
  })

  it('→ ← Home End select and focus the neighbour in board order, across acts', async () => {
    const user = userEvent.setup()
    const onSelectScene = vi.fn()
    renderBoard({ selection: sel('scene-1'), onSelectScene })

    act(() => card('scene-1').focus())
    await user.keyboard('{ArrowRight}')
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-2')
    expect(document.activeElement).toBe(card('scene-2'))

    await user.keyboard('{ArrowLeft}')
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-1')
    expect(document.activeElement).toBe(card('scene-1'))

    await user.keyboard('{End}')
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-5')
    expect(document.activeElement).toBe(card('scene-5'))

    await user.keyboard('{Home}')
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-1')
    expect(document.activeElement).toBe(card('scene-1'))

    // At the edge, and with a modifier (⌥← is Phase 4's insert move): nothing.
    onSelectScene.mockClear()
    await user.keyboard('{ArrowLeft}{Alt>}{ArrowRight}{/Alt}')
    expect(onSelectScene).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(card('scene-1'))
  })

  it('↓ ↑ move to the nearest card in the next or previous row', async () => {
    const user = userEvent.setup()
    const onSelectScene = vi.fn()
    // Four act-1 cards; jsdom has no layout, so give each a box: two rows of two.
    const ep = episode([
      scene({ id: 'scene-1', index: 0, act: 1 }),
      scene({ id: 'scene-2', index: 1, act: 1 }),
      scene({ id: 'scene-3', index: 2, act: 1 }),
      scene({ id: 'scene-4', index: 3, act: 1 }),
    ])
    renderBoard({ model: model(ep), selection: sel('scene-1'), onSelectScene })
    const boxes: Record<string, [number, number]> = {
      'scene-1': [0, 0],
      'scene-2': [0, 162],
      'scene-3': [124, 0],
      'scene-4': [124, 162],
    }
    for (const [id, [top, left]] of Object.entries(boxes)) {
      card(id).getBoundingClientRect = () =>
        ({ top, bottom: top + 106, left, width: 150 }) as DOMRect
    }
    act(() => card('scene-2').focus())
    await user.keyboard('{ArrowDown}')
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-4')
    expect(document.activeElement).toBe(card('scene-4'))
    await user.keyboard('{ArrowUp}')
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-2')
  })

  it('Enter on the selected card asks for the panel; Enter or Space on another card selects it', () => {
    const onSelectScene = vi.fn()
    const onEnterPanel = vi.fn()
    renderBoard({ selection: sel('scene-2'), onSelectScene, onEnterPanel })

    fireEvent.keyDown(card('scene-2'), { key: 'Enter' })
    expect(onEnterPanel).toHaveBeenCalledTimes(1)
    expect(onSelectScene).not.toHaveBeenCalled()

    expect(fireEvent.keyDown(card('scene-3'), { key: 'Enter' })).toBe(false)
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-3')
    expect(fireEvent.keyDown(card('scene-4'), { key: ' ' })).toBe(false)
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-4')
    expect(onEnterPanel).toHaveBeenCalledTimes(1)
  })

  it('a collapsed act counts scenes with Order notes as with notes', () => {
    // Scene 3 (act 1) pays off before scene 4 (act 2) sets up: an Order note
    // on each, and no story note anywhere.
    const ep = fixtureEpisode({
      threads: [thread('thread-cash', 'scene-4', 'scene-3')],
    })
    renderBoard({ model: model(ep), collapsedActs: new Set([1]) })
    expect(
      within(screen.getByTestId('act-frame-1')).getByText(
        '2 scenes hidden · 1 with notes',
      ),
    ).not.toBeNull()
  })

  it('dragging over a card predicts the swap on it', () => {
    const m = model()
    const predict = vi.fn(() => [PAYS_OFF_FIRST])
    const { unmount } = renderBoard({ model: m, predict })
    fireEvent.dragStart(card('scene-5'), { dataTransfer: dt() })
    expect(predict).not.toHaveBeenCalled()
    fireEvent.dragOver(card('scene-1'), { dataTransfer: dt() })

    expect(predict).toHaveBeenCalledWith({
      type: 'insert',
      sceneId: 'scene-5',
      targetSceneId: 'scene-1',
      after: false,
    })
    const tape = card('scene-1').querySelector('[data-tape]')
    expect(tape?.textContent).toBe(predictionTape(m, [PAYS_OFF_FIRST])?.text)
    expect(tape?.textContent).toBe('⚠ 5 would pay off before 2')
    expect(tape?.className).toContain('bg-tr-amber')
    expect(card('scene-1').className).toContain('ring-tr-amber')
    // The dragged card itself is never a target.
    expect(card('scene-5').querySelector('[data-tape]')).toBeNull()
    unmount()

    renderBoard({ predict: () => [] })
    fireEvent.dragStart(card('scene-5'), { dataTransfer: dt() })
    fireEvent.dragOver(card('scene-1'), { dataTransfer: dt() })
    const swap = card('scene-1').querySelector('[data-tape]')
    expect(swap?.textContent).toBe('Swap with 5')
    expect(swap?.className).toContain('bg-tr-sky')
    expect(card('scene-1').className).toContain('ring-tr-sky')
    expect(card('scene-1').getAttribute('aria-label')).toContain('Swap with 5')

    // Leaving the card or ending the drag takes the tape off.
    fireEvent.dragLeave(card('scene-1'), { dataTransfer: dt() })
    expect(card('scene-1').querySelector('[data-tape]')).toBeNull()
    fireEvent.dragOver(card('scene-1'), { dataTransfer: dt() })
    fireEvent.dragEnd(card('scene-5'), { dataTransfer: dt() })
    expect(card('scene-1').querySelector('[data-tape]')).toBeNull()
    expect(card('scene-1').className).not.toMatch(/(^|\s)ring-2/)
  })

  it("a locked card says Locked — can't swap and refuses the drop", () => {
    const onReorder = vi.fn()
    const predict = vi.fn(() => [PAYS_OFF_FIRST])
    const ep = fixtureEpisode()
    ep.scenes[1].locked = true // scene-3
    renderBoard({ model: model(ep), predict, onReorder })

    fireEvent.dragStart(card('scene-2'), { dataTransfer: dt() })
    fireEvent.dragOver(card('scene-3'), { dataTransfer: dt() })
    const tape = card('scene-3').querySelector('[data-tape]')
    expect(tape?.textContent).toBe("Locked — can't swap")
    expect(tape?.className).toContain('bg-tr-amber')
    expect(card('scene-3').className).toContain('ring-tr-amber')
    expect(predict).not.toHaveBeenCalled()

    fireEvent.drop(card('scene-3'), { dataTransfer: dt() })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it("an empty act shows the act change's prediction while a card is over it", () => {
    const predict = vi.fn(() => [PAYS_OFF_FIRST])
    const { unmount } = renderBoard({ predict })
    let frame = screen.getByTestId('act-frame-4')
    let empty = within(frame).getByText(/^No scenes yet/)
    fireEvent.dragStart(card('scene-5'), { dataTransfer: dt() })
    fireEvent.dragOver(empty, { dataTransfer: dt() })

    expect(predict).toHaveBeenCalledWith({
      type: 'act',
      sceneId: 'scene-5',
      act: 4,
    })
    expect(empty.textContent).toBe('⚠ 5 would pay off before 2')
    expect(empty.className).toContain('text-tr-amber')
    expect(frame.className).toContain('inset-ring-tr-amber')
    expect(frame.className).not.toContain('inset-ring-tr-sky')
    fireEvent.dragLeave(empty, { dataTransfer: dt() })
    expect(empty.textContent).toMatch(/^No scenes yet/)
    expect(frame.className).not.toContain('inset-ring-tr-amber')
    unmount()

    renderBoard({ predict: () => [] })
    frame = screen.getByTestId('act-frame-4')
    empty = within(frame).getByText(/^No scenes yet/)
    fireEvent.dragStart(card('scene-5'), { dataTransfer: dt() })
    fireEvent.dragOver(empty, { dataTransfer: dt() })
    expect(empty.textContent).toBe('Move scene 5 here')
    expect(empty.className).not.toContain('text-tr-amber')
    expect(frame.className).toContain('inset-ring-tr-sky')
  })

  it('a dragover without a drag from this board changes nothing', () => {
    const predict = vi.fn(() => [PAYS_OFF_FIRST])
    const { container } = renderBoard({ predict })
    fireEvent.dragOver(card('scene-1'), { dataTransfer: dt() })
    expect(container.querySelector('[data-tape]')).toBeNull()
    expect(card('scene-1').className).not.toMatch(/(^|\s)ring-2/)
    expect(predict).not.toHaveBeenCalled()
  })

  it('the drop tape replaces the relation and highlight tapes; a card never wears two', () => {
    // scene-4 relates to the selected scene-2 and matches Marta.
    const { container } = renderBoard({
      model: martaModel({
        threads: [thread('thread-cash', 'scene-2', 'scene-4')],
      }),
      selection: sel('scene-2'),
      highlight: WHO_MARTA,
    })
    expect(card('scene-4').querySelector('[data-tape]')?.textContent).toBe(
      '↘ pays off 2',
    )
    fireEvent.dragStart(card('scene-5'), { dataTransfer: dt() })
    fireEvent.dragOver(card('scene-4'), { dataTransfer: dt() })

    const tapes = card('scene-4').querySelectorAll('[data-tape]')
    expect(tapes).toHaveLength(1)
    expect(tapes[0].textContent).toBe('Swap with 5')
    expect(card('scene-4').className).not.toContain('outline-dashed')
    for (const el of container.querySelectorAll('[data-scene-card]'))
      expect(el.querySelectorAll('[data-tape]').length).toBeLessThanOrEqual(1)
  })

  it('a card that shares a thread with the selection wears the relation tape and the dashed outline', () => {
    const ep = fixtureEpisode({
      threads: [thread('thread-cash', 'scene-2', 'scene-4')],
    })
    renderBoard({ model: model(ep), selection: sel('scene-2') })

    const payoff = card('scene-4')
    expect(payoff.querySelector('[data-tape]')?.textContent).toBe(
      '↘ pays off 2',
    )
    expect(payoff.className).toContain('outline-dashed')
    expect(card('scene-5').querySelector('[data-tape]')).toBeNull()
    expect(card('scene-5').className).not.toContain('outline-dashed')
  })

  it('click selects, double-click opens Write, the unsaved dot follows draftSceneIds', async () => {
    const user = userEvent.setup()
    const onSelectScene = vi.fn()
    const onOpenInWrite = vi.fn()
    renderBoard({
      selection: sel('scene-1'),
      draftSceneIds: new Set(['scene-2']),
      onSelectScene,
      onOpenInWrite,
    })

    await user.click(card('scene-3'))
    expect(onSelectScene).toHaveBeenCalledWith('scene-3')
    await user.dblClick(card('scene-4'))
    expect(onOpenInWrite).toHaveBeenCalledWith('scene-4')

    expect(
      card('scene-2').querySelector('[data-testid="unsaved-dot"]'),
    ).not.toBeNull()
    expect(
      card('scene-1').querySelector('[data-testid="unsaved-dot"]'),
    ).toBeNull()
    expect(card('scene-1').getAttribute('aria-pressed')).toBe('true')
    expect(card('scene-3').getAttribute('aria-pressed')).toBe('false')
  })

  it('under a highlight, matches wear its ring and tape and the rest go quiet', () => {
    renderBoard({ model: martaModel(), highlight: WHO_MARTA })
    for (const id of ['scene-2', 'scene-4']) {
      expect(card(id).dataset.match).toBe('true')
      expect(card(id).querySelector('[data-tape]')?.textContent).toBe(
        'MARTA VEGA · wants',
      )
      expect(card(id).className).toContain('ring-tr-sky')
      expect(card(id).className).not.toContain('bg-tr-surface-sunken')
    }
    for (const id of ['scene-1', 'scene-3', 'scene-5']) {
      expect(card(id).hasAttribute('data-match')).toBe(false)
      expect(card(id).querySelector('[data-tape]')).toBeNull()
      expect(card(id).className).toContain('bg-tr-surface-sunken')
      expect(card(id).className).not.toMatch(/opacity-/)
    }
  })

  it('the relation tape wins over the highlight tape; there is only ever one tape', () => {
    const { container } = renderBoard({
      model: martaModel({
        threads: [thread('thread-cash', 'scene-2', 'scene-4')],
      }),
      selection: sel('scene-2'),
      highlight: WHO_MARTA,
    })
    for (const el of container.querySelectorAll('[data-scene-card]'))
      expect(el.querySelectorAll('[data-tape]').length).toBeLessThanOrEqual(1)
    // scene-4 matches Marta but relates to the selection: relation tape,
    // still the highlight's ring.
    expect(card('scene-4').querySelector('[data-tape]')?.textContent).toBe(
      '↘ pays off 2',
    )
    expect(card('scene-4').dataset.match).toBe('true')
    expect(card('scene-4').className).toContain('outline-dashed')
    // The selected match keeps its highlight tape.
    expect(card('scene-2').querySelector('[data-tape]')?.textContent).toBe(
      'MARTA VEGA · wants',
    )
  })

  it('the selected card never goes quiet', () => {
    renderBoard({
      model: martaModel(),
      selection: sel('scene-3'),
      highlight: WHO_MARTA,
    })
    expect(card('scene-3').className).not.toContain('bg-tr-surface-sunken')
    expect(card('scene-3').className).toContain('bg-tr-coral-soft')
    expect(card('scene-3').hasAttribute('data-match')).toBe(false)
    expect(card('scene-1').className).toContain('bg-tr-surface-sunken')
  })

  it('None shows no ring, tape-from-highlight or quiet card', () => {
    const { container } = renderBoard({
      model: model(fixtureEpisode(), [storyFlag('scene-3')], [MARTA]),
      highlight: NO_HIGHLIGHT,
    })
    expect(container.querySelector('[data-match]')).toBeNull()
    expect(container.querySelector('[data-tape]')).toBeNull()
    for (const el of container.querySelectorAll('[data-scene-card]')) {
      expect(el.className).not.toContain('bg-tr-surface-sunken')
      expect(el.className).not.toMatch(/(^|\s)ring-2/)
    }
  })

  it('Fold the rest turns each run of non-matches into one stub; a stub opens its run; the selected scene never folds', async () => {
    const user = userEvent.setup()
    const onUnfold = vi.fn()
    const { container, rerender } = renderBoard({
      model: foldModel(),
      selection: sel('scene-2'),
      fold: true,
      onUnfold,
    })
    // None + fold keeps scenes with a story note (1, 5) and the selection (2).
    expect(cardIds(container)).toEqual(['scene-1', 'scene-2', 'scene-5'])
    const stub = screen.getByRole('button', {
      name: 'Show 2 folded scenes, 3 to 4',
    })
    expect(stub.textContent).toBe('3–4')
    // Runs stop at the act's edge.
    expect(
      within(screen.getByTestId('act-frame-2')).getByRole('button', {
        name: 'Show 1 folded scene, 6',
      }).textContent,
    ).toBe('6')

    await user.click(stub)
    expect(onUnfold).toHaveBeenCalledWith(['scene-3', 'scene-4'])

    rerender(
      <Board
        model={foldModel()}
        episodeLocked={false}
        selection={sel('scene-2')}
        collapsedActs={new Set()}
        pending={false}
        fold
        unfolded={new Set(['scene-3', 'scene-4'])}
        onSelectScene={noop}
        onReorder={noop}
        onMoveToAct={noop}
        onToggleAct={noop}
        onEnterPanel={noop}
      />,
    )
    expect(cardIds(container)).toEqual([
      'scene-1',
      'scene-2',
      'scene-3',
      'scene-4',
      'scene-5',
    ])
    expect(screen.queryByRole('button', { name: /^Show 2 folded/ })).toBeNull()
  })

  /** Board wired like PlanScreen: selection and opened scenes in state. */
  function FoldHarness() {
    const [selected, setSelected] = useState('scene-2')
    const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
    return (
      <Board
        model={foldModel()}
        episodeLocked={false}
        selection={sel(selected)}
        collapsedActs={new Set()}
        pending={false}
        fold
        unfolded={unfolded}
        onUnfold={(ids) => setUnfolded((prev) => new Set([...prev, ...ids]))}
        onSelectScene={setSelected}
        onReorder={noop}
        onMoveToAct={noop}
        onToggleAct={noop}
        onEnterPanel={noop}
      />
    )
  }

  it('an opened stub stays open when the writer selects one of its cards', async () => {
    const user = userEvent.setup()
    const { container } = render(<FoldHarness />)
    await user.click(
      screen.getByRole('button', { name: 'Show 2 folded scenes, 3 to 4' }),
    )
    await waitFor(() => expect(document.activeElement).toBe(card('scene-3')))
    await user.click(card('scene-3'))
    // scene-2 was kept only as the selection; the opened run stays.
    expect(cardIds(container)).toEqual([
      'scene-1',
      'scene-3',
      'scene-4',
      'scene-5',
    ])
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(card('scene-4'))
  })

  it('opening a stub puts focus on its first card, not <body>', async () => {
    const user = userEvent.setup()
    render(<FoldHarness />)
    act(() =>
      screen
        .getByRole('button', { name: 'Show 2 folded scenes, 3 to 4' })
        .focus(),
    )
    await user.keyboard('{Enter}')
    await waitFor(() => expect(document.activeElement).toBe(card('scene-3')))
  })

  it('roving order skips folded scenes', async () => {
    const user = userEvent.setup()
    const onSelectScene = vi.fn()
    renderBoard({
      model: foldModel(),
      selection: sel('scene-2'),
      fold: true,
      onSelectScene,
    })
    act(() => card('scene-2').focus())
    await user.keyboard('{ArrowRight}')
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-5')
    expect(document.activeElement).toBe(card('scene-5'))
    await user.keyboard('{End}')
    expect(onSelectScene).toHaveBeenLastCalledWith('scene-5')
  })

  it('the header slot renders inside the scroll area, before the acts', () => {
    renderBoard({ header: <div data-testid="highlight-slot">bar</div> })
    const slot = screen.getByTestId('highlight-slot')
    const board = screen.getByLabelText('Plan board')
    expect(board.contains(slot)).toBe(true)
    expect(board.className).toContain('overflow-y-auto')
    expect(slot.parentElement?.className).toContain('sticky')
    expect(
      slot.compareDocumentPosition(screen.getByTestId('act-frame-0')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("the scroll padding follows the sticky header's height", () => {
    const observed: Element[] = []
    let resized = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe(el: Element) {
          observed.push(el)
        }
        disconnect() {}
      },
    )
    try {
      renderBoard({ header: <div data-testid="highlight-slot">bar</div> })
      const sticky = screen.getByTestId('highlight-slot').parentElement!
      const board = screen.getByLabelText('Plan board')
      expect(observed).toEqual([sticky])
      // Focus and scrolls land a card below the header (and its tape).
      expect(board.className).toContain(
        'scroll-pt-[calc(var(--board-header-h,0px)+--spacing(4))]',
      )
      let height = 140
      sticky.getBoundingClientRect = () => ({ height }) as DOMRect
      act(() => resized())
      expect(board.style.getPropertyValue('--board-header-h')).toBe('140px')
      height = 212 // the bar wrapped
      act(() => resized())
      expect(board.style.getPropertyValue('--board-header-h')).toBe('212px')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('gridNeighbor', () => {
  const box = (top: number, left: number) => ({
    top,
    bottom: top + 106,
    left,
    width: 150,
  })
  // Row 0: three cards (centres 75, 237, 399); row 1: two (175, 375).
  const boxes = [
    box(0, 0),
    box(0, 162),
    box(0, 324),
    box(120, 100),
    box(120, 300),
  ]

  it('returns the box in the next or previous row nearest by centre', () => {
    expect(gridNeighbor(boxes, 1, 1)).toBe(3)
    expect(gridNeighbor(boxes, 2, 1)).toBe(4)
    expect(gridNeighbor(boxes, 4, -1)).toBe(2)
  })

  it('is null past the first or last row', () => {
    expect(gridNeighbor(boxes, 3, 1)).toBeNull()
    expect(gridNeighbor(boxes, 0, -1)).toBeNull()
    expect(gridNeighbor([], 0, 1)).toBeNull()
  })
})
