// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BeatCandidate } from 'contract'
import { CandidateCard } from './CandidateCard'
import type { CandidateSlot } from './candidateReducer'

// No @testing-library/jest-dom in this project (see useQuietAi.test.tsx) —
// assertions read plain DOM properties instead of jest-dom matchers.
afterEach(cleanup)

function candidate(overrides: Partial<BeatCandidate> = {}): BeatCandidate {
  return {
    label: 'Quiet reveal',
    beatPlan: { whatHappens: 'w', audienceLearns: 'l', audienceFeels: 'f' },
    scriptText: 'Marta slides a note across the counter.',
    continuityConflicts: [],
    ...overrides,
  }
}

function noop() {}

const baseProps = {
  index: 0,
  projectId: 'proj-1',
  sceneId: 'scene-1',
  controlsHidden: false,
  accepting: false,
  acceptError: null,
  onAccept: noop,
  onSkip: noop,
  onReplace: noop,
  onRetryGeneration: noop,
}

describe('CandidateCard', () => {
  it('uses Quiet Tool card lift chrome', () => {
    const c = candidate()
    render(
      <CandidateCard {...baseProps} slot={{ status: 'done', candidate: c }} />,
    )
    const card = screen.getByTestId('candidate-card-0')
    expect(card.className).toContain('bg-tr-surface-raised')
    expect(card.className).toContain('hover:shadow-lift')
    expect(card.className).toContain('hover:-translate-y-px')
    expect(card.className).toContain('motion-reduce:transform-none')
  })

  it('streaming slot shows the growing provisional text and no action buttons — never actionable mid-stream', () => {
    const slot: CandidateSlot = {
      status: 'streaming',
      provisionalScriptText: 'Marta slides',
    }
    render(<CandidateCard {...baseProps} slot={slot} />)
    expect(screen.getByText('Marta slides')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /tune/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull()
  })

  it('done slot is actionable: Accept/Tune/Skip all present and call back with the candidate', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    const c = candidate()
    render(
      <CandidateCard
        {...baseProps}
        slot={{ status: 'done', candidate: c }}
        onAccept={onAccept}
      />,
    )

    expect(screen.getByText('Quiet reveal')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: /accept/i }))
    expect(onAccept).toHaveBeenCalledWith(c)
  })

  it('uses Quiet Tool action hierarchy for Accept, Tune, and Skip', () => {
    const c = candidate()
    render(
      <CandidateCard {...baseProps} slot={{ status: 'done', candidate: c }} />,
    )

    expect(screen.getByRole('button', { name: /accept/i }).className).toContain(
      'bg-tr-coral',
    )
    const tune = screen.getByRole('button', { name: /tune/i })
    expect(tune.className).toContain('border-tr-coral')
    expect(tune.className).toContain('text-tr-coral')
    expect(screen.getByRole('button', { name: /skip/i }).className).toContain(
      'opacity-60',
    )
  })

  it('failed slot renders the error-state treatment (message + Retry), never a partial actionable card', async () => {
    const user = userEvent.setup()
    const onRetryGeneration = vi.fn()
    const slot: CandidateSlot = {
      status: 'failed',
      error: {
        code: 'LLM_UNAVAILABLE',
        message: 'the language model is unavailable',
      },
    }
    render(
      <CandidateCard
        {...baseProps}
        slot={slot}
        onRetryGeneration={onRetryGeneration}
      />,
    )

    expect(
      screen.getByText(/the language model is unavailable/).textContent,
    ).toMatch(/unavailable/)
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetryGeneration).toHaveBeenCalled()
  })

  it('a continuity conflict blocks Accept until the writer acknowledges', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    const c = candidate({
      continuityConflicts: [
        {
          factId: 'fact-04',
          explanation:
            "Dan doesn't know yet (audienceKnows:false re: fact-04)",
        },
      ],
    })
    render(
      <CandidateCard
        {...baseProps}
        slot={{ status: 'done', candidate: c }}
        onAccept={onAccept}
      />,
    )

    const acceptButton = screen.getByRole('button', {
      name: /^accept/i,
    }) as HTMLButtonElement
    expect(acceptButton.disabled).toBe(true)
    expect(screen.getByTestId('continuity-conflict').textContent).toContain(
      'May conflict with the Ledger',
    )
    expect(screen.getByTestId('continuity-conflict').textContent).toContain(
      "Dan doesn't know yet",
    )
    expect(screen.getByTestId('continuity-conflict').textContent).not.toMatch(
      /audienceKnows|fact-04/i,
    )

    await user.click(screen.getByTestId('continuity-conflict-confirm'))
    expect(acceptButton.disabled).toBe(false)
    expect(screen.getByTestId('continuity-conflict').textContent).toContain(
      'Accept is unlocked',
    )
    await user.click(acceptButton)
    expect(onAccept).toHaveBeenCalledWith(c)
  })

  it('quiet-AI: controlsHidden removes the action row entirely (invisible, not just dimmed)', () => {
    const c = candidate()
    render(
      <CandidateCard
        {...baseProps}
        slot={{ status: 'done', candidate: c }}
        controlsHidden
      />,
    )
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /tune/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull()
  })

  it('an accept error shows the danger treatment on this card and relabels Accept as Retry', () => {
    const c = candidate()
    render(
      <CandidateCard
        {...baseProps}
        slot={{ status: 'done', candidate: c }}
        acceptError={{
          code: 'LLM_UNAVAILABLE',
          message: 'the language model is unavailable',
        }}
      />,
    )
    expect(screen.getByText(/accept failed/i)).not.toBeNull()
    expect(screen.getByRole('button', { name: /retry/i })).not.toBeNull()
  })

  it('accepting disables all three actions and labels Accept as "Accepting…"', () => {
    const c = candidate()
    render(
      <CandidateCard
        {...baseProps}
        slot={{ status: 'done', candidate: c }}
        accepting
      />,
    )
    expect(
      (screen.getByRole('button', { name: /accepting/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: /tune/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: /skip/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})
