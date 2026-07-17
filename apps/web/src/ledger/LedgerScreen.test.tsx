// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LedgerFact, Project } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LedgerScreen } from './LedgerScreen'

vi.mock('../api/client', () => ({
  batchLedgerReview: vi.fn(),
  confirmLedgerFact: vi.fn(),
  editLedgerFact: vi.fn(),
  getLedger: vi.fn(),
  getProject: vi.fn(),
  rejectLedgerFact: vi.fn(),
  exportFountain: vi.fn(),
  listProjectSnapshots: vi.fn(),
  restoreProject: vi.fn(),
  undoProject: vi.fn(),
}))

vi.mock('../projects/resumeContext', () => ({
  loadResume: vi.fn(() => ({ mode: 'Ledger' as const, sceneId: null })),
  saveResume: vi.fn(),
}))

import { batchLedgerReview, getLedger, getProject } from '../api/client'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  window.history.pushState({}, '', '/')
})

function project(headSnapshotId: string): Project {
  return {
    id: 'proj-1',
    title: 'West Wing Pilot',
    headSnapshotId,
    seriesBible: { characters: [] },
    seasons: [
      {
        episodes: [
          {
            id: 'ep-1',
            index: 0,
            scenes: [
              {
                id: 'scene-3',
                index: 2,
                beats: [{ id: 'beat-3-1', index: 0 }],
              },
              {
                id: 'scene-11',
                index: 10,
                beats: [{ id: 'beat-11-1', index: 0 }],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

function pendingFact(id: string, sceneId: string, beatId: string): LedgerFact {
  return {
    id,
    fact: `Fact ${id}`,
    factType: 'state',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId,
      beatId,
      startLine: 1,
      endLine: 1,
      charStart: 0,
      charEnd: 1,
    },
    sourceText: 'source',
    knownBy: [],
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.9,
    status: 'pending_review',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
  }
}

describe('LedgerScreen batch concurrency', () => {
  it('refreshes headSnapshotId before a second scene-batch accept', async () => {
    const user = userEvent.setup()
    const factA = pendingFact('fact-a', 'scene-3', 'beat-3-1')
    const factB = pendingFact('fact-b', 'scene-11', 'beat-11-1')
    const initialLedger = [factA, factB]

    vi.mocked(getProject)
      .mockResolvedValueOnce(project('snap-1'))
      .mockResolvedValueOnce(project('snap-2'))
      .mockResolvedValue(project('snap-3'))
    vi.mocked(getLedger).mockResolvedValue(initialLedger)
    vi.mocked(batchLedgerReview)
      .mockResolvedValueOnce({
        ledger: [
          { ...factA, status: 'active', provenance: 'writer_confirmed' },
          factB,
        ],
      })
      .mockResolvedValueOnce({
        ledger: [
          { ...factA, status: 'active', provenance: 'writer_confirmed' },
          { ...factB, status: 'active', provenance: 'writer_confirmed' },
        ],
      })

    window.history.pushState({}, '', '/ledger?project=proj-1')
    render(<LedgerScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('scene-accept-scene-3')).not.toBeNull()
    })

    await user.click(screen.getByTestId('scene-accept-scene-3'))
    await waitFor(() => {
      expect(batchLedgerReview).toHaveBeenCalledTimes(1)
    })
    expect(batchLedgerReview).toHaveBeenNthCalledWith(
      1,
      'proj-1',
      { confirmIds: ['fact-a'], rejectIds: [] },
      { expectedHeadSnapshotId: 'snap-1' },
    )

    await waitFor(() => {
      expect(
        (screen.getByTestId('scene-accept-scene-11') as HTMLButtonElement)
          .disabled,
      ).toBe(false)
    })
    await user.click(screen.getByTestId('scene-accept-scene-11'))
    await waitFor(() => {
      expect(batchLedgerReview).toHaveBeenCalledTimes(2)
    })

    expect(batchLedgerReview).toHaveBeenNthCalledWith(
      2,
      'proj-1',
      { confirmIds: ['fact-b'], rejectIds: [] },
      { expectedHeadSnapshotId: 'snap-2' },
    )
    // Initial load + one refresh after each successful mutation.
    expect(getProject).toHaveBeenCalledTimes(3)
  })
})

describe('LedgerScreen dual views', () => {
  it('shows the Atlas by default with the Ledger view switcher', async () => {
    vi.mocked(getProject).mockResolvedValue(project('snap-1'))
    vi.mocked(getLedger).mockResolvedValue([
      pendingFact('fact-a', 'scene-3', 'beat-3-1'),
    ])

    window.history.pushState({}, '', '/ledger?project=proj-1')
    render(<LedgerScreen />)

    expect(await screen.findByTestId('ledger-view-switcher')).not.toBeNull()
    expect(await screen.findByTestId('story-atlas')).not.toBeNull()
    expect(screen.getByText("What's true in this story")).not.toBeNull()
  })

  it('shows Knowledge Web after selecting Web', async () => {
    const user = userEvent.setup()
    vi.mocked(getProject).mockResolvedValue(project('snap-1'))
    vi.mocked(getLedger).mockResolvedValue([
      pendingFact('fact-a', 'scene-3', 'beat-3-1'),
    ])

    window.history.pushState({}, '', '/ledger?project=proj-1')
    render(<LedgerScreen />)

    await user.click(await screen.findByRole('button', { name: 'Web' }))

    expect(await screen.findByTestId('knowledge-web')).not.toBeNull()
  })

  it('opens and expands a URL-focused fact in Atlas', async () => {
    const focusedFact = {
      ...pendingFact('fact-a', 'scene-3', 'beat-3-1'),
      status: 'active' as const,
    }
    vi.mocked(getProject).mockResolvedValue(project('snap-1'))
    vi.mocked(getLedger).mockResolvedValue([focusedFact])
    localStorage.setItem('tr.ledger.view.proj-1', 'web')

    window.history.pushState({}, '', '/ledger?project=proj-1&fact=fact-a')
    render(<LedgerScreen />)

    expect(await screen.findByTestId('story-atlas')).not.toBeNull()
    expect(await screen.findByTestId('fact-card-fact-a')).not.toBeNull()
  })

  it('scrolls to the review queue from the pending chip', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    vi.mocked(getProject).mockResolvedValue(project('snap-1'))
    vi.mocked(getLedger).mockResolvedValue([
      pendingFact('fact-a', 'scene-3', 'beat-3-1'),
    ])

    window.history.pushState({}, '', '/ledger?project=proj-1')
    render(<LedgerScreen />)

    await user.click(await screen.findByRole('button', { name: '1 to review' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
