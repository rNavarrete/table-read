// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type {
  Beat,
  ConsistencyFlag,
  Episode,
  Project,
  Scene,
  StoryThread,
} from 'contract'
import { RULED } from '../projects/wizard/board/IndexCard'
import { BoardCard } from './BoardCard'
import { boardModel } from './story'

afterEach(cleanup)

const READING =
  'Marta probes the state of the business over coffee, giving Dan every chance to mention the transfer.'

function beat(id: string, index: number): Beat {
  return {
    id,
    index,
    locked: false,
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    scriptText: '',
    scriptLocked: false,
  }
}

function scene(
  id: string,
  index: number,
  act: number,
  location: string,
  beats: Beat[],
): Scene {
  return {
    id,
    index,
    act,
    storyline: 'A',
    locked: false,
    location,
    time: '',
    socialSituation: '',
    whatHappens: id === 'scene-3' ? READING : '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats,
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

// Act 1: scenes 2 and 3 (3 is the act's last card); act 2: scene 4.
// Scene 3 pays off the cash (set up in 2), sets up the foreclosure (paid off
// in 4) and keeps the transfer secret.
function episode(threads: StoryThread[]): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: '',
    seasonFunction: '',
    storylines: [],
    scenes: [
      scene('scene-2', 1, 1, 'INT. THE LONG POUR - BASEMENT - NIGHT', [
        beat('beat-2-1', 0),
      ]),
      scene('scene-3', 2, 1, 'INT. THE LONG POUR - BAR - DAY', [
        beat('beat-3-1', 0),
        beat('beat-3-2', 1),
        beat('beat-3-3', 2),
      ]),
      scene('scene-4', 3, 2, 'INT. THE LONG POUR - VARIOUS - NIGHT', [
        beat('beat-4-1', 0),
      ]),
    ],
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads,
    secrets: [
      {
        id: 'secret-transfer',
        summary: 'Marta saw the transfer.',
        factId: null,
        holderCharacterIds: [],
        concealedFromCharacterIds: [],
        audienceKnows: true,
        establishedSceneId: 'scene-2',
        revealedSceneId: 'scene-4',
        concealmentSceneIds: ['scene-3'],
        establishedQuote: '',
        revealedQuote: '',
        establishedBeatId: null,
        revealedBeatId: null,
        provenance: 'inferred',
        locked: false,
      },
    ],
    storyOverview: null,
    narrativeMap: null,
    structureChecks: [],
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
    defaultCraftLevel: 'standard',
  }
}

function flag(
  id: string,
  objectType: 'scene' | 'beat',
  objectId: string,
  importNote = false,
): ConsistencyFlag {
  return {
    id,
    objectType,
    objectId,
    factId: null,
    explanation: importNote
      ? '[empty_beat_fields] The beat came back empty.'
      : 'The stakes here no longer match the ledger.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-1',
  }
}

const STORY_THREADS = [
  thread('thread-cash', 'scene-2', 'scene-3'),
  thread('thread-foreclosure', 'scene-3', 'scene-4'),
]

function signalsFor(
  sceneId: string,
  flags: ConsistencyFlag[] = [],
  threads: StoryThread[] = STORY_THREADS,
) {
  const ep = episode(threads)
  const s = boardModel(project(ep), ep, flags).signals.get(sceneId)
  if (!s) throw new Error(`no signals for ${sceneId}`)
  return s
}

function renderCard(props: Partial<ComponentProps<typeof BoardCard>> = {}) {
  const noop = () => {}
  render(
    <BoardCard
      signals={signalsFor('scene-3')}
      locked={false}
      selected={false}
      tabIndex={-1}
      pending={false}
      unsaved={false}
      tape={null}
      related={false}
      dragging={false}
      dropTarget={false}
      onSelect={noop}
      onOpenInWrite={noop}
      onKeyDown={noop}
      onFocus={noop}
      onDragStart={noop}
      onDragEnd={noop}
      onDragOver={noop}
      onDragLeave={noop}
      onDrop={noop}
      {...props}
    />,
  )
  return screen.getByTestId(
    `scene-card-${(props.signals ?? signalsFor('scene-3')).scene.id}`,
  )
}

/** Order-free: each class in `names` is on the element. */
function expectClasses(el: Element, names: string) {
  expect([...el.classList]).toEqual(expect.arrayContaining(names.split(' ')))
}

function dataTransfer() {
  return { setData: vi.fn(), getData: vi.fn(), effectAllowed: 'all' }
}

describe('BoardCard', () => {
  it('shows the index card face: number, INT/EXT dot, cleaned place title, a 4-line reading, the full slug in the tooltip', () => {
    const card = renderCard()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('Bar')).toBeTruthy()
    expect(card.querySelector('.bg-tr-write-dot-int')).not.toBeNull()
    expect(card.title).toContain('INT. THE LONG POUR - BAR - DAY')
    expect(card.title).toContain(READING)
    expect(screen.getByText(READING).className).toContain('line-clamp-4')
    expectClasses(card, 'w-card-board-w h-card-board-h')
    expect(card.style.backgroundImage).toBe(RULED.backgroundImage)
    expect(card.hasAttribute('data-scene-card')).toBe(true)
  })

  it('story notes show an amber ⚑n chip; import-only notes a quiet chip; both are consistency-flag-badge', () => {
    renderCard({
      signals: signalsFor('scene-3', [
        flag('story-scene', 'scene', 'scene-3'),
        flag('story-beat', 'beat', 'beat-3-1'),
        flag('import-beat', 'beat', 'beat-3-2', true),
      ]),
    })
    const story = screen.getByTestId('consistency-flag-badge')
    expect(story.dataset.kind).toBe('story')
    expect(story.textContent).toBe('⚑2')
    expect(story.className).toContain('bg-tr-amber-soft')
    cleanup()

    renderCard({
      signals: signalsFor('scene-3', [
        flag('import-beat', 'beat', 'beat-3-2', true),
      ]),
    })
    const imported = screen.getByTestId('consistency-flag-badge')
    expect(imported.dataset.kind).toBe('import')
    expect(imported.textContent).toBe('⚑1')
    expect(imported.className).toContain('bg-tr-surface-sunken')
    cleanup()

    renderCard()
    expect(screen.queryByTestId('consistency-flag-badge')).toBeNull()
  })

  it('beat ticks mark story and import notes', () => {
    const card = renderCard({
      signals: signalsFor('scene-3', [
        flag('story-beat', 'beat', 'beat-3-1'),
        flag('import-beat', 'beat', 'beat-3-2', true),
      ]),
    })
    expect(card.querySelectorAll('[data-tick="story"]')).toHaveLength(1)
    expect(card.querySelectorAll('[data-tick="import"]')).toHaveLength(1)
    expect(card.querySelectorAll('[data-tick="plain"]')).toHaveLength(1)
    // A native tooltip says what the ticks mean.
    expect(card.querySelector<HTMLElement>('[data-ticks]')?.title).toBe(
      '3 beats · 1 with a story note · 1 with an import note',
    )
    cleanup()

    const bare = renderCard({ signals: signalsFor('scene-3', [], []) })
    expect(bare.querySelector<HTMLElement>('[data-ticks]')?.title).toBe(
      '3 beats',
    )
  })

  it('shows ↗/↘ counts, ◆ or ◇ for the secret and the TURN / ACT OUT tag', () => {
    renderCard()
    expect(screen.getByText('↗1').className).toContain('text-tr-sky')
    expect(screen.getByText('↘1')).toBeTruthy()
    expect(screen.getByText('◆')).toBeTruthy()
    expect(screen.getByText('ACT OUT')).toBeTruthy()
    cleanup()

    // A setup never paid off reads amber; a revealed secret is hollow.
    renderCard({
      signals: signalsFor(
        'scene-4',
        [],
        [thread('thread-open', 'scene-4', null)],
      ),
    })
    expect(screen.getByText('↗1').className).toContain('text-tr-amber')
    expect(screen.queryByText(/↘/)).toBeNull()
    expect(screen.getByText('◇')).toBeTruthy()
    cleanup()

    const turn = {
      ...signalsFor('scene-2'),
      landmark: 'Act One Turn',
    }
    renderCard({ signals: turn })
    expect(screen.getByText('TURN')).toBeTruthy()
    expect(screen.queryByText('ACT OUT')).toBeNull()
  })

  it('a locked card shows the lock glyph, says data-locked=true and does not drag; a pending card does not drag', () => {
    const onDragStart = vi.fn()
    const card = renderCard({ locked: true, onDragStart })
    expect(card.dataset.locked).toBe('true')
    expect(card.querySelector('[data-lock-glyph]')).not.toBeNull()
    expect(card.getAttribute('draggable')).toBe('false')
    expect(fireEvent.dragStart(card, { dataTransfer: dataTransfer() })).toBe(
      false,
    )
    expect(onDragStart).not.toHaveBeenCalled()
    cleanup()

    const pending = renderCard({ pending: true, onDragStart })
    expect(pending.getAttribute('draggable')).toBe('false')
    expect(fireEvent.dragStart(pending, { dataTransfer: dataTransfer() })).toBe(
      false,
    )
    expect(onDragStart).not.toHaveBeenCalled()
    cleanup()

    const free = renderCard({ onDragStart })
    expect(free.dataset.locked).toBe('false')
    expect(free.querySelector('[data-lock-glyph]')).toBeNull()
    expect(free.getAttribute('draggable')).toBe('true')
    fireEvent.dragStart(free, { dataTransfer: dataTransfer() })
    expect(onDragStart).toHaveBeenCalledTimes(1)
  })

  it('the coral unsaved dot only when unsaved', () => {
    renderCard()
    expect(screen.queryByTestId('unsaved-dot')).toBeNull()
    cleanup()
    renderCard({ unsaved: true })
    expect(screen.getByTestId('unsaved-dot').className).toContain('bg-tr-coral')
  })

  it('at most one tape, hidden from assistive tech, its text in the accessible name', () => {
    const card = renderCard({ tape: { text: '↘ pays off 2', tone: 'sky' } })
    const tapes = card.querySelectorAll('[data-tape]')
    expect(tapes).toHaveLength(1)
    expect(tapes[0].getAttribute('aria-hidden')).toBe('true')
    expect(tapes[0].textContent).toBe('↘ pays off 2')
    expect(tapes[0].className).toContain('bg-tr-sky')
    expect(card.getAttribute('aria-label')).toMatch(/, ↘ pays off 2$/)
    cleanup()

    const bare = renderCard()
    expect(bare.querySelector('[data-tape]')).toBeNull()
  })

  it("no tape when it would repeat the card's own tag; the ring still marks the match", () => {
    // Scene 3 is its act's last card: its tag already reads ACT OUT.
    const out = renderCard({
      tape: { text: 'ACT OUT', tone: 'accent' },
      ring: 'accent',
    })
    expect(out.querySelector('[data-tape]')).toBeNull()
    expect(out.dataset.match).toBe('true')
    expect(screen.getAllByText('ACT OUT')).toHaveLength(1)
    expect(out.getAttribute('aria-label')).toMatch(/, act out$/)
    cleanup()

    // A tape that says something else stays.
    for (const text of ['ACT ONE TURN', 'ACT SPLIT?']) {
      const card = renderCard({ tape: { text, tone: 'accent' } })
      expect(card.querySelector('[data-tape]')?.textContent).toBe(text)
      cleanup()
    }
  })

  it('selected: aria-pressed, coral-soft fill and an inset coral ring; related: a dashed sky outline; the focus ring is a separate 2px sky outline offset 4px', () => {
    const selected = renderCard({ selected: true })
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(selected.className).toContain('bg-tr-coral-soft')
    expectClasses(selected, 'inset-ring-2 inset-ring-tr-coral')
    expect(selected.className).not.toContain('outline-dashed')
    expectClasses(
      selected,
      'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-4 focus-visible:outline-tr-sky',
    )
    expect(selected.className).not.toMatch(/(^|\s)outline-none/)
    cleanup()

    const related = renderCard({ related: true })
    expect(related.getAttribute('aria-pressed')).toBe('false')
    expect(related.className).not.toContain('bg-tr-coral-soft')
    expectClasses(
      related,
      'outline-dashed outline-tr-sky focus-visible:outline-tr-sky',
    )
  })

  it('a match wears a 2px ring in its hue and says data-match', () => {
    const match = renderCard({ ring: 'secret' })
    expectClasses(match, 'ring-2 ring-tr-ledger-secret-ink')
    expect(match.dataset.match).toBe('true')
    // The ruled paper stays: a match is not quiet.
    expect(match.style.backgroundImage).toBe(RULED.backgroundImage)
    cleanup()

    // Selected and matching: the inset coral ring and the hue ring compose.
    const both = renderCard({ ring: 'sky', selected: true })
    expectClasses(both, 'inset-ring-2 inset-ring-tr-coral ring-2 ring-tr-sky')
    cleanup()

    const plain = renderCard()
    expect(plain.hasAttribute('data-match')).toBe(false)
    expect(plain.className).not.toMatch(/(^|\s)ring-/)
  })

  it('a quiet card is flat but keeps full opacity and primary text', () => {
    const card = renderCard({ quiet: true })
    expect(card.style.backgroundImage).toBe('')
    expectClasses(card, 'bg-tr-surface-sunken shadow-none')
    expect(card.className).not.toContain('shadow-card-board')
    expect(card.className).not.toContain('bg-tr-board-paper')
    expect(card.className).not.toMatch(/opacity-/)
    expect(card.hasAttribute('data-match')).toBe(false)
    expect(screen.getByText(READING).className).toContain(
      'text-tr-text-primary',
    )
    expect(card.className).toContain('text-tr-text-primary')
  })

  it('its accessible name reads number, place, lock, notes, beats, threads, secret, tag, draft and tape', () => {
    const card = renderCard({
      signals: signalsFor('scene-3', [
        flag('story-beat', 'beat', 'beat-3-1'),
        flag('import-beat', 'beat', 'beat-3-2', true),
      ]),
      locked: true,
      unsaved: true,
    })
    expect(card.getAttribute('aria-label')).toBe(
      'Scene 3, Bar, locked, 2 notes, 1 from the import, 3 beats, 1 with a story note, 1 with an import note, sets up 1, pays off 1, secret kept, act out, unsaved draft',
    )
    cleanup()

    const plain = renderCard({ signals: signalsFor('scene-3', [], []) })
    expect(plain.getAttribute('aria-label')).toBe(
      'Scene 3, Bar, 3 beats, secret kept, act out',
    )
  })

  it('click selects, double-click opens Write; a locked card refuses a drop (no preventDefault on dragover)', () => {
    const onSelect = vi.fn()
    const onOpenInWrite = vi.fn()
    const onDragOver = vi.fn()
    const onDrop = vi.fn()
    const card = renderCard({ onSelect, onOpenInWrite, onDragOver, onDrop })
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledTimes(1)
    fireEvent.doubleClick(card)
    expect(onOpenInWrite).toHaveBeenCalledTimes(1)
    expect(fireEvent.dragOver(card, { dataTransfer: dataTransfer() })).toBe(
      false,
    )
    expect(onDragOver).toHaveBeenCalledTimes(1)
    fireEvent.drop(card, { dataTransfer: dataTransfer() })
    expect(onDrop).toHaveBeenCalledTimes(1)
    cleanup()

    const locked = renderCard({ locked: true, onDragOver, onDrop })
    expect(fireEvent.dragOver(locked, { dataTransfer: dataTransfer() })).toBe(
      true,
    )
    fireEvent.drop(locked, { dataTransfer: dataTransfer() })
    expect(onDragOver).toHaveBeenCalledTimes(1)
    expect(onDrop).toHaveBeenCalledTimes(1)
  })
})
