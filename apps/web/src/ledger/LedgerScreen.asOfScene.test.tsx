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
}))

vi.mock('../projects/resumeContext', () => ({
  loadResume: vi.fn(() => ({ mode: 'Ledger' as const, sceneId: null })),
  saveResume: vi.fn(),
}))

import { getLedger, getProject } from '../api/client'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  window.history.pushState({}, '', '/')
})

function project(): Project {
  return {
    id: 'proj-1',
    title: 'West Wing Pilot',
    headSnapshotId: 'snap-1',
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
                location: 'Kitchen',
                beats: [],
              },
              {
                id: 'scene-11',
                index: 10,
                location: '',
                beats: [],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

function activeFact(id: string): LedgerFact {
  return {
    id,
    fact: `Fact ${id}`,
    factType: 'state',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-3',
      beatId: 'beat-3-1',
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
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
  }
}

describe('LedgerScreen As-of scene filter (T7.18)', () => {
  it('lists Latest (all) plus every episode scene, in order', async () => {
    vi.mocked(getProject).mockResolvedValue(project())
    vi.mocked(getLedger).mockResolvedValue([activeFact('fact-a')])

    window.history.pushState({}, '', '/ledger?project=proj-1')
    render(<LedgerScreen />)

    expect(await screen.findByLabelText('Latest (all)')).not.toBeNull()
    expect(screen.getByLabelText('Kitchen')).not.toBeNull()
    // Scene with no location yet falls back to a 1-based "Scene N" label.
    expect(screen.getByLabelText('Scene 11')).not.toBeNull()
  })

  it('selecting a scene calls the client with asOfScene', async () => {
    const user = userEvent.setup()
    vi.mocked(getProject).mockResolvedValue(project())
    vi.mocked(getLedger).mockResolvedValue([activeFact('fact-a')])

    window.history.pushState({}, '', '/ledger?project=proj-1')
    render(<LedgerScreen />)

    await waitFor(() => {
      expect(getLedger).toHaveBeenCalledWith('proj-1', undefined)
    })

    await user.click(await screen.findByLabelText('Kitchen'))

    await waitFor(() => {
      expect(getLedger).toHaveBeenLastCalledWith('proj-1', {
        asOfScene: 'scene-3',
      })
    })
  })

  it('selecting Latest (all) again drops asOfScene', async () => {
    const user = userEvent.setup()
    vi.mocked(getProject).mockResolvedValue(project())
    vi.mocked(getLedger).mockResolvedValue([activeFact('fact-a')])

    window.history.pushState({}, '', '/ledger?project=proj-1')
    render(<LedgerScreen />)

    await user.click(await screen.findByLabelText('Kitchen'))
    await waitFor(() => {
      expect(getLedger).toHaveBeenLastCalledWith('proj-1', {
        asOfScene: 'scene-3',
      })
    })

    await user.click(screen.getByLabelText('Latest (all)'))
    await waitFor(() => {
      expect(getLedger).toHaveBeenLastCalledWith('proj-1', undefined)
    })
  })
})
