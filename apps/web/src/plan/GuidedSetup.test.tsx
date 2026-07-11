// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeSet, InitialSceneSkeletonCandidate } from 'contract'
import { GuidedSetup } from './GuidedSetup'

const { generateMock, createMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  createMock: vi.fn(),
}))
vi.mock('../api/client', () => ({
  generateSceneSkeletonCandidates: generateMock,
  createSceneSkeletonChangeSet: createMock,
}))

afterEach(cleanup)

function candidate(
  candidateId: string,
  overrides: Partial<InitialSceneSkeletonCandidate> = {},
): InitialSceneSkeletonCandidate {
  return {
    candidateId,
    basedOnSnapshotId: 'snap-root',
    label: `Label ${candidateId}`,
    scenes: [
      {
        proposalId: `${candidateId}-proposal-1`,
        act: 1,
        storyline: 'A',
        location: 'INT. THE LONG POUR - MORNING',
        time: 'MORNING',
        socialSituation: '',
        whatHappens: 'Marta confronts Dan.',
        audienceLearns: '',
        audienceFeels: '',
        motivations: [],
        beatPlanSeeds: [],
      },
    ],
    ...overrides,
  }
}

function changeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: 'cs-1',
    projectId: 'proj-x',
    kind: 'initial_scene_skeleton',
    instruction: 'Label a',
    targetObjectId: 'ep-1',
    impacted: [],
    preview: null,
    status: 'previewing',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  generateMock.mockReset()
  createMock.mockReset()
  Object.defineProperty(window, 'location', {
    value: {
      ...window.location,
      href: 'http://localhost/plan?project=proj-x',
      assign: vi.fn(),
    },
    writable: true,
  })
})

describe('GuidedSetup', () => {
  it('does not call generation until the explicit gesture (rule 8)', () => {
    render(<GuidedSetup projectId="proj-x" />)
    expect(screen.getByText('Generate scene skeleton')).not.toBeNull()
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('generates exactly three candidates and shows them side by side', async () => {
    const user = userEvent.setup()
    generateMock.mockResolvedValue([
      candidate('a'),
      candidate('b'),
      candidate('c'),
    ])
    render(
      <GuidedSetup
        projectId="proj-x"
        premise="A bartender finds a wire transfer."
        characters={[
          { id: 'char-marta', name: 'Marta' },
          { id: 'char-dan', name: 'Dan' },
        ]}
      />,
    )

    await user.click(screen.getByText('Generate scene skeleton'))

    await waitFor(() => {
      expect(screen.getByTestId('skeleton-candidates')).not.toBeNull()
    })
    expect(generateMock).toHaveBeenCalledWith('proj-x')
    expect(screen.getAllByText(/Choose this/)).toHaveLength(3)
    expect(screen.getAllByText('1 scene')).toHaveLength(3)
    expect(screen.getAllByText('Marta confronts Dan.')).toHaveLength(3)
    expect(screen.getByTestId('guided-setup-foundation').textContent).toContain(
      'Marta',
    )
  })

  it('skip for now dismisses without generating', async () => {
    const user = userEvent.setup()
    const onSkip = vi.fn()
    render(<GuidedSetup projectId="proj-x" onSkip={onSkip} />)
    await user.click(screen.getByText('Skip for now'))
    expect(onSkip).toHaveBeenCalledOnce()
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('choosing a candidate creates a Change Set and navigates to Review, never writing directly', async () => {
    const user = userEvent.setup()
    generateMock.mockResolvedValue([
      candidate('a'),
      candidate('b'),
      candidate('c'),
    ])
    const created = changeSet({ id: 'cs-42' })
    createMock.mockResolvedValue(created)
    render(<GuidedSetup projectId="proj-x" />)

    await user.click(screen.getByText('Generate scene skeleton'))
    await waitFor(() => screen.getByTestId('skeleton-candidates'))

    const chooseButtons = screen.getAllByText(/Choose this/)
    await user.click(chooseButtons[0])

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith('proj-x', candidate('a'))
    })
    expect(window.location.assign).toHaveBeenCalledWith(
      expect.stringContaining('changeSet=cs-42'),
    )
  })

  it('surfaces a generation error without crashing', async () => {
    const user = userEvent.setup()
    generateMock.mockRejectedValue(
      new Error('the language model is unavailable'),
    )
    render(<GuidedSetup projectId="proj-x" />)

    await user.click(screen.getByText('Generate scene skeleton'))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('unavailable')
    })
  })
})
