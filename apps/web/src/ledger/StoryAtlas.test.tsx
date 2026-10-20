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
    delivery: null,
    neededBySceneId: null,
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
    // sc = story position: scene-3 is this episode's only scene.
    expect(screen.getByTestId('atlas-ref-f-knowledge').textContent).toMatch(
      /ep 1 · sc 1 · beat 2/,
    )
  })

  it('orders, groups, numbers and strips scenes in story order, not array order', async () => {
    const user = userEvent.setup()
    const moved = {
      ...project(),
      seasons: [
        {
          episodes: [
            {
              id: 'ep-1',
              index: 0,
              threads: [],
              // A Plan move left the array alone: story order is early, late.
              scenes: [
                {
                  id: 'scene-late',
                  act: 2,
                  index: 0,
                  location: 'DOCK',
                  beats: [{ id: 'beat-late', index: 0 }],
                },
                {
                  id: 'scene-early',
                  act: 1,
                  index: 1,
                  location: 'BAR',
                  beats: [{ id: 'beat-early', index: 0 }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Project
    const span = (sceneId: string, beatId: string) => ({
      ...fact({ id: 'x', factType: 'event', fact: '' }).sourceSpan,
      sceneId,
      beatId,
    })
    const facts = [
      fact({
        id: 'f-late',
        factType: 'event',
        fact: 'Late.',
        sourceSpan: span('scene-late', 'beat-late'),
      }),
      fact({
        id: 'f-early',
        factType: 'event',
        fact: 'Early.',
        sourceSpan: span('scene-early', 'beat-early'),
      }),
    ]
    render(<StoryAtlas facts={facts} allFacts={facts} project={moved} />)

    const rows = screen.getAllByTestId(/^atlas-row-/)
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'atlas-row-f-early',
      'atlas-row-f-late',
    ])
    expect(
      screen.getByTestId('atlas-group-header-scene-scene-late').textContent,
    ).toContain('Scene 2')
    expect(screen.getByTestId('atlas-ref-f-late').textContent).toMatch(/sc 2/)
    // The strip's ticks run in story order; tick 1 is the early scene.
    await user.click(screen.getByTestId('atlas-scene-tick-1'))
    expect(screen.getByTestId('atlas-filter-chip-scene').textContent).toContain(
      'Scene 1',
    )
    expect(screen.queryByTestId('atlas-row-f-late')).toBeNull()
    expect(screen.getByTestId('atlas-row-f-early')).toBeTruthy()
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
