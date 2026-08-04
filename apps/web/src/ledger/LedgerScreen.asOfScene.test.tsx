// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LedgerFact, Project } from 'contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerScreen } from './LedgerScreen'

vi.mock('../api/client', () => ({
  batchLedgerReview: vi.fn(),
  confirmLedgerFact: vi.fn(),
  editLedgerFact: vi.fn(),
  getLedger: vi.fn(),
  getLatestNarrativeMapRun: vi.fn(),
  getProject: vi.fn(),
  rejectLedgerFact: vi.fn(),
}))

vi.mock('../projects/resumeContext', () => ({
  loadResume: vi.fn(() => ({ mode: 'Ledger' as const, sceneId: null })),
  saveResume: vi.fn(),
}))

import { getLatestNarrativeMapRun, getLedger, getProject } from '../api/client'

beforeEach(() => {
  vi.mocked(getLatestNarrativeMapRun).mockResolvedValue(null)
})

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

    const select = await screen.findByLabelText('As of')
    expect(select.tagName).toBe('SELECT')
    const labels = Array.from(select.querySelectorAll('option')).map(
      (o) => o.textContent,
    )
    expect(labels[0]).toBe('Latest (all)')
    expect(labels).toContain('Kitchen')
    // Scene with no location yet falls back to a 1-based "Scene N" label.
    expect(labels).toContain('Scene 11')
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

    const select = await screen.findByLabelText('As of')
    await user.selectOptions(select, 'scene-3')

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

    const select = await screen.findByLabelText('As of')
    await user.selectOptions(select, 'scene-3')
    await waitFor(() => {
      expect(getLedger).toHaveBeenLastCalledWith('proj-1', {
        asOfScene: 'scene-3',
      })
    })

    await user.selectOptions(select, '')
    await waitFor(() => {
      expect(getLedger).toHaveBeenLastCalledWith('proj-1', undefined)
    })
  })
})
