// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LedgerFact, Project } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoryAtlas } from './StoryAtlas'

afterEach(() => {
  cleanup()
  window.localStorage?.clear()
})

function project(): Project {
  return {
    id: 'proj-1',
    title: 'Test Project',
    headSnapshotId: 'snap-1',
    format: { coldOpen: true },
    seriesBible: {
      characters: [
        { id: 'char-marta', name: 'Marta Vega' },
        { id: 'char-dan', name: 'Dan Vega' },
      ],
    },
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
                act: 1,
                beats: [{ id: 'beat-3-1', index: 1 }],
              },
            ],
            threads: [],
          },
        ],
      },
    ],
  } as unknown as Project
}

function fact(
  partial: Partial<LedgerFact> & Pick<LedgerFact, 'id' | 'factType' | 'fact'>,
): LedgerFact {
  return {
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-3',
      beatId: 'beat-3-1',
      startLine: null,
      endLine: null,
      charStart: null,
      charEnd: null,
    },
    sourceText: '',
    knownBy: [],
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.8,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
    ...partial,
  }
}

describe('StoryAtlas', () => {
  it('renders compact, source-grounded fact rows with Atlas controls', () => {
    const facts = [
      fact({
        id: 'f-knowledge',
        factType: 'knowledge',
        fact: 'Marta knows the ledger is short.',
        knownBy: ['char-marta'],
      }),
      fact({
        id: 'f-event',
        factType: 'event',
        fact: 'The till was emptied at midnight.',
        knownBy: ['char-dan'],
      }),
    ]
    render(<StoryAtlas facts={facts} allFacts={facts} project={project()} />)

    expect(screen.getByTestId('atlas-control-bar')).toBeTruthy()
    expect(screen.getByTestId('atlas-scene-strip')).toBeTruthy()
    expect(screen.getByTestId('atlas-group-header-scene-scene-3')).toBeTruthy()
    expect(screen.getByTestId('atlas-row-f-knowledge').textContent).toMatch(
      /Marta knows the ledger/,
    )
    expect(screen.getByTestId('atlas-ref-f-knowledge').textContent).toMatch(
      /ep 1 · sc 3 · beat 2/,
    )
  })

  it('marks a secret without hiding its source reference', () => {
    const facts = [
      fact({
        id: 'f-secret',
        factType: 'knowledge',
        fact: 'Josh suspects Lloyd.',
        knownBy: ['char-marta'],
        audienceKnows: false,
      }),
    ]
    render(<StoryAtlas facts={facts} allFacts={facts} project={project()} />)

    expect(screen.getByLabelText('Secret')).toBeTruthy()
    expect(screen.getByTestId('atlas-ref-f-secret').textContent).toMatch(/ep 1/)
  })

  it('opens a stable detail drawer instead of expanding the fact list', async () => {
    const user = userEvent.setup()
    const facts = [
      fact({
        id: 'f1',
        factType: 'knowledge',
        fact: 'Expand me.',
        knownBy: ['char-marta'],
      }),
    ]
    render(<StoryAtlas facts={facts} allFacts={facts} project={project()} />)

    expect(screen.queryByTestId('fact-card-f1')).toBeNull()
    await user.click(screen.getByTestId('atlas-row-f1'))
    expect(screen.getByTestId('fact-detail-drawer')).toBeTruthy()
    expect(screen.getByTestId('fact-card-f1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close fact details' }))
    expect(screen.queryByTestId('fact-card-f1')).toBeNull()
  })

  it('keeps active filter controls available in the empty state', () => {
    render(
      <StoryAtlas
        facts={[]}
        allFacts={[]}
        project={project()}
        emptyMessage="No facts match."
        filterChips={[
          { kind: 'secret', label: 'Secrets only', onClear: vi.fn() },
        ]}
      />,
    )

    expect(screen.getByTestId('atlas-control-bar')).toBeTruthy()
    expect(screen.getByTestId('atlas-filter-chip-secret')).toBeTruthy()
    expect(screen.getByText('No facts match these filters')).toBeTruthy()
    expect(screen.getByText('No facts match.')).toBeTruthy()
  })

  it('caps the rendered fact window and pages through a large ledger', async () => {
    const user = userEvent.setup()
    const facts = Array.from({ length: 80 }, (_, index) =>
      fact({
        id: `f-${index}`,
        factType: 'event',
        fact: `Fact ${index}`,
      }),
    )
    render(<StoryAtlas facts={facts} allFacts={facts} project={project()} />)

    expect(
      document.querySelectorAll('[data-testid^="atlas-row-"]'),
    ).toHaveLength(48)
    await user.click(screen.getByRole('button', { name: 'Next facts' }))
    expect(screen.getByText(/Facts 49–80 of 80/)).toBeTruthy()
    expect(
      document.querySelectorAll('[data-testid^="atlas-row-"]'),
    ).toHaveLength(32)
  })

  it('supports keyboard selection across rows', async () => {
    const user = userEvent.setup()
    const facts = [
      fact({ id: 'f1', factType: 'event', fact: 'First fact.' }),
      fact({ id: 'f2', factType: 'event', fact: 'Second fact.' }),
    ]
    render(<StoryAtlas facts={facts} allFacts={facts} project={project()} />)

    await user.keyboard('j')
    expect(screen.getByTestId('fact-card-f1')).toBeTruthy()
    await user.keyboard('j')
    expect(screen.getByTestId('fact-card-f2')).toBeTruthy()
  })
})
