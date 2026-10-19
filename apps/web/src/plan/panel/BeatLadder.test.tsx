// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Beat, ConsistencyFlag, Scene } from 'contract'
import type { PlanNote } from '../story'
import { BeatLadder, type BeatLadderProps } from './BeatLadder'
import { WithDrafts } from './testDrafts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function beat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: 'beat-1-1',
    index: 0,
    locked: false,
    whatHappens: 'Marta walks in mid-closing.',
    audienceLearns: 'She has been gone eight years.',
    audienceFeels: 'Unease.',
    scriptText: "INT. THE LONG POUR - NIGHT\n\nDAN\nWe're closed.",
    scriptLocked: false,
    ...overrides,
  }
}

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
    whatHappens: 'Marta walks back in.',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [
      beat(),
      beat({
        id: 'beat-1-2',
        index: 1,
        locked: true,
        scriptLocked: true,
        whatHappens: 'Marta finds the transfer in the books.',
      }),
      beat({ id: 'beat-1-3', index: 2, whatHappens: '' }),
    ],
    ...overrides,
  }
}

function flag(overrides: Partial<ConsistencyFlag> = {}): ConsistencyFlag {
  return {
    id: 'flag-1',
    objectType: 'beat',
    objectId: 'beat-1-1',
    factId: null,
    explanation: 'Dan says the bar is closed, but Scene 3 has it open.',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-1',
    ...overrides,
  }
}

function renderLadder(overrides: Partial<BeatLadderProps> = {}) {
  const props: BeatLadderProps = {
    scene: scene(),
    episodeLocked: false,
    selectedBeatId: null,
    notes: [],
    landmarks: [],
    timeJump: null,
    pending: false,
    onSelectBeat: vi.fn(),
    onToggleBeatLock: vi.fn(),
    onToggleBeatScriptLock: vi.fn(),
    onSaveBeatField: vi.fn().mockResolvedValue(true),
    onOpenBeatInWrite: vi.fn(),
    ...overrides,
  }
  const view = render(<BeatLadder {...props} />, { wrapper: WithDrafts })
  return { props, ...view }
}

describe('BeatLadder', () => {
  it("rows show each beat's number and plan, never its first script line", () => {
    renderLadder()
    const row = screen.getByTestId('beat-card-beat-1-1')
    expect(row.textContent).toContain('1.1')
    expect(row.textContent).toContain('Marta walks in mid-closing.')
    expect(row.textContent).not.toContain('INT. THE LONG POUR')
    expect(screen.getByTestId('beat-card-beat-1-3').textContent).toContain(
      '(no plan yet)',
    )
  })

  it('an effectively locked beat reads Locked, cascading from the episode and the scene', () => {
    const { props, rerender } = renderLadder()
    expect(screen.getByTestId('beat-card-beat-1-2').textContent).toContain(
      'Locked',
    )
    expect(screen.getByTestId('beat-card-beat-1-1').textContent).not.toContain(
      'Locked',
    )

    rerender(<BeatLadder {...props} episodeLocked />)
    expect(screen.getByTestId('beat-card-beat-1-1').textContent).toContain(
      'Locked',
    )

    rerender(<BeatLadder {...props} scene={scene({ locked: true })} />)
    expect(screen.getByTestId('beat-card-beat-1-3').textContent).toContain(
      'Locked',
    )
  })

  it('marks a beat with a story note and a beat with only an import note differently', () => {
    const s = scene()
    const notes: PlanNote[] = [
      { flag: flag(), kind: 'continuity', beat: s.beats[0] },
      {
        flag: flag({
          id: 'flag-2',
          objectId: 'beat-1-2',
          explanation: '[model_unassigned] source lines 10-12 were kept here',
        }),
        kind: 'import',
        beat: s.beats[1],
      },
    ]
    renderLadder({ scene: s, notes })
    expect(
      within(screen.getByTestId('beat-card-beat-1-1')).getByText('Story note'),
    ).not.toBeNull()
    expect(
      within(screen.getByTestId('beat-card-beat-1-2')).getByText('Import note'),
    ).not.toBeNull()
    expect(
      within(screen.getByTestId('beat-card-beat-1-3')).queryByText(/note/),
    ).toBeNull()
  })

  it('tags the landmark beat, says the last beat lands, and ends with the time jump', () => {
    renderLadder({
      landmarks: [
        {
          beatId: 'beat-1-2',
          label: 'ACT ONE TURN',
          summary: 'Marta finds the transfer.',
          sceneId: 'scene-1',
          act: 1,
        },
      ],
      timeJump: {
        afterSceneId: 'scene-1',
        label: 'The next morning',
        kind: 'relative',
        quote: '',
      },
    })
    expect(screen.getByTestId('beat-card-beat-1-2').textContent).toContain(
      'ACT ONE TURN',
    )
    expect(screen.getByTestId('beat-card-beat-1-3').textContent).toContain(
      'lands',
    )
    expect(screen.getByTestId('beat-card-beat-1-1').textContent).not.toContain(
      'lands',
    )
    expect(
      screen.getByText('↷ Then a time jump: The next morning'),
    ).not.toBeNull()
  })

  it('clicking a row selects it; clicking the open row goes back to the scene', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderLadder()
    const row = screen.getByTestId('beat-card-beat-1-1')
    expect(row.getAttribute('aria-expanded')).toBe('false')
    await user.click(row)
    expect(props.onSelectBeat).toHaveBeenCalledWith('beat-1-1')

    rerender(<BeatLadder {...props} selectedBeatId="beat-1-1" />)
    const open = screen.getByTestId('beat-card-beat-1-1')
    expect(open.getAttribute('aria-expanded')).toBe('true')
    await user.click(open)
    expect(props.onSelectBeat).toHaveBeenLastCalledWith(null)
  })

  it('expands only the selected row, with beat-scoped labels that leave "What happens" to the scene', () => {
    renderLadder({ selectedBeatId: 'beat-1-1' })
    expect(
      (screen.getByLabelText('Beat 1.1: What happens') as HTMLTextAreaElement)
        .value,
    ).toBe('Marta walks in mid-closing.')
    expect(screen.getByLabelText('Beat 1.1: Audience learns')).not.toBeNull()
    expect(screen.getByLabelText('Beat 1.1: Audience feels')).not.toBeNull()
    expect(screen.queryByLabelText('Beat 1.2: What happens')).toBeNull()
    // The scene's own field owns the exact name (e2e getByLabel strictness).
    expect(screen.queryByLabelText('What happens')).toBeNull()
  })

  it('Beat lock and Script lock call back with the flipped value and never take the scene lock-toggle id', async () => {
    const user = userEvent.setup()
    const { props } = renderLadder({ selectedBeatId: 'beat-1-1' })
    expect(screen.queryByTestId('lock-toggle')).toBeNull()

    await user.click(screen.getByTestId('beat-lock-toggle-beat-1-1'))
    expect(props.onToggleBeatLock).toHaveBeenCalledWith('beat-1-1', true)
    await user.click(screen.getByTestId('script-lock-toggle-beat-1-1'))
    expect(props.onToggleBeatScriptLock).toHaveBeenCalledWith('beat-1-1', true)
  })

  it('a locked toggle renders as the accent pill switch (port from Inspector.test)', () => {
    renderLadder({ selectedBeatId: 'beat-1-2' })
    const toggle = screen.getByTestId('script-lock-toggle-beat-1-2')
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.className).toContain('rounded-chip')
    expect(toggle.className).toContain('bg-tr-coral')
    expect(toggle.className).toContain('text-tr-surface-raised')
  })

  it('keeps the script behind a closed Script text disclosure, and opens the beat in Write', async () => {
    const user = userEvent.setup()
    const { props } = renderLadder({ selectedBeatId: 'beat-1-1' })
    const disclosure = screen
      .getByText('Script text')
      .closest('details') as HTMLDetailsElement
    expect(disclosure.open).toBe(false)
    expect(
      (screen.getByLabelText('Beat 1.1: Script') as HTMLTextAreaElement).value,
    ).toContain("We're closed.")

    await user.click(
      screen.getByRole('button', { name: 'Open beat in Write ↗' }),
    )
    expect(props.onOpenBeatInWrite).toHaveBeenCalledWith('beat-1-1')
  })

  it('an effectively locked beat is read-only, but its lock toggles still work (port from Inspector.test)', async () => {
    const user = userEvent.setup()
    const { props } = renderLadder({ selectedBeatId: 'beat-1-2' })
    expect(
      (screen.getByLabelText('Beat 1.2: What happens') as HTMLTextAreaElement)
        .readOnly,
    ).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

    await user.click(screen.getByTestId('beat-lock-toggle-beat-1-2'))
    expect(props.onToggleBeatLock).toHaveBeenCalledWith('beat-1-2', false)
  })

  it('disables both lock toggles while a save is pending', () => {
    renderLadder({ selectedBeatId: 'beat-1-1', pending: true })
    expect(
      (screen.getByTestId('beat-lock-toggle-beat-1-1') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId('script-lock-toggle-beat-1-1') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('saves an edited beat field through onSaveBeatField', async () => {
    const user = userEvent.setup()
    const { props } = renderLadder({ selectedBeatId: 'beat-1-1' })
    const learns = screen.getByLabelText('Beat 1.1: Audience learns')
    await user.clear(learns)
    await user.type(learns, 'She knows about the money.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSaveBeatField).toHaveBeenCalledWith(
      'beat-1-1',
      'audienceLearns',
      'She knows about the money.',
    )
  })

  it('says so when the scene has no beats yet', () => {
    renderLadder({ scene: scene({ beats: [] }) })
    expect(screen.getByText('No beats yet.')).not.toBeNull()
  })
})
