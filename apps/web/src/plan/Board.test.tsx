// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Episode, Project, Scene } from 'contract'
import { Board } from './Board'

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

function beat1_1() {
  return {
    id: 'beat-1-1',
    index: 0,
    locked: false,
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    scriptText: "DAN\nWe're closed.",
    scriptLocked: false,
  }
}

function beat1_2Locked() {
  return {
    id: 'beat-1-2',
    index: 1,
    locked: true,
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    scriptText: 'ON SCREEN: OUTGOING TRANSFER',
    scriptLocked: true,
  }
}

function episode(scenes: Scene[]): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: '',
    seasonFunction: '',
    storylines: [],
    scenes,
  }
}

function project(ep: Episode): Project {
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
      characters: [],
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
  }
}

const noop = () => {}

describe('Board / SceneCard / BeatCard', () => {
  it('renders act frames, and the scene card shows a beat-count chip and the 2-line whatHappens clamp', () => {
    const ep = episode([scene({ beats: [beat1_1(), beat1_2Locked()] })])
    render(
      <Board
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectScene={noop}
        onSelectBeat={noop}
        onReorder={noop}
      />,
    )
    expect(screen.getByTestId('act-frame-0')).not.toBeNull() // cold open
    expect(screen.getByText('COLD OPEN')).not.toBeNull()
    expect(screen.getByTestId('scene-card-scene-1')).not.toBeNull()
    expect(screen.getByText('2 beats')).not.toBeNull()
  })

  it('clicking a scene card selects it', async () => {
    const user = userEvent.setup()
    const ep = episode([scene()])
    const onSelectScene = vi.fn()
    render(
      <Board
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectScene={onSelectScene}
        onSelectBeat={noop}
        onReorder={noop}
      />,
    )
    await user.click(screen.getByTestId('scene-card-scene-1'))
    expect(onSelectScene).toHaveBeenCalledWith('scene-1')
  })

  it('a selected scene card carries the selected data attribute driving the coral outline', () => {
    const ep = episode([scene()])
    render(
      <Board
        project={project(ep)}
        episode={ep}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        collapsedActs={new Set()}
        onSelectScene={noop}
        onSelectBeat={noop}
        onReorder={noop}
      />,
    )
    const card = screen.getByTestId('scene-card-scene-1')
    expect(card.className).toContain('outline-selected')
    expect(card.className).toContain('outline-tr-coral')
  })

  it('the chevron expands the card to reveal nested beat cards; the locked beat shows a lock chip', async () => {
    const user = userEvent.setup()
    const ep = episode([scene({ beats: [beat1_1(), beat1_2Locked()] })])
    render(
      <Board
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectScene={noop}
        onSelectBeat={noop}
        onReorder={noop}
      />,
    )
    expect(screen.queryByTestId('beat-card-beat-1-2')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Expand beats' }))
    expect(screen.getByTestId('beat-card-beat-1-1')).not.toBeNull()
    const lockedBeatCard = screen.getByTestId('beat-card-beat-1-2')
    expect(lockedBeatCard.textContent).toContain('Locked')
  })

  it('clicking a nested beat card selects the beat, not the parent scene', async () => {
    const user = userEvent.setup()
    const ep = episode([scene({ beats: [beat1_1()] })])
    const onSelectScene = vi.fn()
    const onSelectBeat = vi.fn()
    render(
      <Board
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectScene={onSelectScene}
        onSelectBeat={onSelectBeat}
        onReorder={noop}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Expand beats' }))
    await user.click(screen.getByTestId('beat-card-beat-1-1'))
    expect(onSelectBeat).toHaveBeenCalledWith('scene-1', 'beat-1-1')
    expect(onSelectScene).not.toHaveBeenCalled()
  })

  it('a locked scene card is not draggable', () => {
    const ep = episode([scene({ locked: true })])
    render(
      <Board
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectScene={noop}
        onSelectBeat={noop}
        onReorder={noop}
      />,
    )
    const card = screen.getByTestId('scene-card-scene-1')
    expect(card.getAttribute('draggable')).toBe('false')
    expect(card.getAttribute('data-locked')).toBe('true')
  })

  it('an unlocked scene card is draggable', () => {
    const ep = episode([scene()])
    render(
      <Board
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectScene={noop}
        onSelectBeat={noop}
        onReorder={noop}
      />,
    )
    expect(
      screen.getByTestId('scene-card-scene-1').getAttribute('draggable'),
    ).toBe('true')
  })

  it('a collapsed act hides its scene cards but keeps the frame and label', () => {
    const ep = episode([scene()])
    render(
      <Board
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set([0])}
        onSelectScene={noop}
        onSelectBeat={noop}
        onReorder={noop}
      />,
    )
    expect(screen.getByText('COLD OPEN')).not.toBeNull()
    expect(screen.queryByTestId('scene-card-scene-1')).toBeNull()
    expect(screen.getByText('1 scene hidden')).not.toBeNull()
  })

  it('dragging one unlocked scene card onto another calls onReorder with (dragged, target)', () => {
    const ep = episode([
      scene({ id: 'scene-1', index: 0, act: 1 }),
      scene({ id: 'scene-2', index: 1, act: 1, location: 'INT. OTHER' }),
    ])
    const onReorder = vi.fn()
    render(
      <Board
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectScene={noop}
        onSelectBeat={noop}
        onReorder={onReorder}
      />,
    )
    const source = screen.getByTestId('scene-card-scene-1')
    const target = screen.getByTestId('scene-card-scene-2')

    fireEvent.dragStart(source, { dataTransfer: makeDataTransfer() })
    fireEvent.dragOver(target, { dataTransfer: makeDataTransfer() })
    fireEvent.drop(target, { dataTransfer: makeDataTransfer() })

    expect(onReorder).toHaveBeenCalledWith('scene-1', 'scene-2')
  })
})

// jsdom doesn't implement DataTransfer fully; a minimal stand-in is enough
// since SceneCard only calls setData/reads effectAllowed, never getData in
// these handlers (onReorder is driven by Board's own drag-source state, per
// the comment in Board.tsx).
function makeDataTransfer() {
  return {
    setData: () => {},
    getData: () => '',
    effectAllowed: 'move',
  } as unknown as DataTransfer
}
