// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ChangeSet, Project } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewScreen } from './ReviewScreen'
import { pendingReviewCount } from './pendingReviewCount'

vi.mock('../api/client', () => ({
  applyChangeSet: vi.fn(),
  discardChangeSet: vi.fn(),
  dismissConsistencyFlag: vi.fn(),
  exportFountain: vi.fn(),
  flagChangeSet: vi.fn(),
  getChangeSet: vi.fn(),
  getLedger: vi.fn(),
  getProject: vi.fn(),
  listChangeSets: vi.fn(),
  previewChangeSet: vi.fn(),
  undoProject: vi.fn(),
}))

import { getLedger, getProject, listChangeSets } from '../api/client'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  window.history.pushState({}, '', '/')
})

function project(): Project {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    headSnapshotId: 'snap-root',
  } as Project
}

function changeSet(id: string, instruction: string): ChangeSet {
  return {
    id,
    projectId: 'proj-longpour',
    kind: 'edit',
    instruction,
    targetObjectId: 'scene-2',
    impacted: [],
    preview: null,
    status: 'draft',
    createdAt: '2024-01-01T00:00:00Z',
  }
}

describe('pendingReviewCount', () => {
  it('counts only pending_review facts (UI spec §2 badge)', () => {
    expect(
      pendingReviewCount([
        { status: 'pending_review' },
        { status: 'active' },
        { status: 'pending_review' },
        { status: 'rejected' },
      ]),
    ).toBe(2)
  })

  it('returns 0 for an empty ledger', () => {
    expect(pendingReviewCount([])).toBe(0)
  })
})

describe('ReviewScreen draft picker', () => {
  it('renders open Change Sets as raised Quiet Tool cards', async () => {
    vi.mocked(getProject).mockResolvedValue(project())
    vi.mocked(getLedger).mockResolvedValue([])
    vi.mocked(listChangeSets).mockResolvedValue([
      changeSet('cs-1', 'Move the money to the marina'),
      changeSet('cs-2', 'Make Marta confront Dan earlier'),
    ])
    window.history.pushState({}, '', '/review?project=proj-longpour')

    render(<ReviewScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('draft-change-sets')).not.toBeNull()
    })

    expect(listChangeSets).toHaveBeenCalledWith(
      'proj-longpour',
      'draft,previewing',
    )
    const card = screen.getByRole('button', {
      name: /Move the money to the marina/,
    })
    expect(card.className).toContain('shadow-raised')
    expect(card.className).toContain('hover:shadow-lift')
  })
})
