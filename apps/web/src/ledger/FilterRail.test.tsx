// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LedgerFact, Project } from 'contract'
import { FilterRail } from './FilterRail'

afterEach(cleanup)

const project = {
  seriesBible: {
    characters: [
      { id: 'char-marta', name: 'Marta Vega' },
      { id: 'char-dan', name: 'Dan Vega' },
    ],
  },
} as Project

function fact(
  partial: Partial<LedgerFact> & Pick<LedgerFact, 'id' | 'factType'>,
): LedgerFact {
  return {
    fact: 'x',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-3',
      beatId: null,
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

const sampleFacts: LedgerFact[] = [
  fact({
    id: 'f1',
    factType: 'knowledge',
    knownBy: ['char-marta'],
    status: 'pending_review',
  }),
  fact({
    id: 'f2',
    factType: 'knowledge',
    knownBy: ['char-marta', 'char-dan'],
  }),
  fact({ id: 'f3', factType: 'event', knownBy: ['char-dan'] }),
]

describe('FilterRail', () => {
  it('shows writer-facing status and browse labels', () => {
    render(
      <FilterRail
        project={project}
        filters={{
          status: 'all',
          characterId: null,
          factType: 'all',
        }}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    expect(screen.getByText('Needs review')).toBeTruthy()
    expect(screen.getByText('Browse')).toBeTruthy()
    expect(screen.getByText('People')).toBeTruthy()
    expect(screen.getByText('All truths')).toBeTruthy()
    expect(screen.getByText('World rules')).toBeTruthy()
  })

  it('puts People and Browse before Status in the rail', () => {
    render(
      <FilterRail
        project={project}
        filters={{
          status: 'all',
          characterId: null,
          factType: 'all',
        }}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    const rail = screen.getByTestId('ledger-filter-rail')
    const text = rail.textContent ?? ''
    expect(text.indexOf('People')).toBeLessThan(text.indexOf('Browse'))
    expect(text.indexOf('Browse')).toBeLessThan(text.indexOf('Status'))
  })

  it('shows People and Browse counts from facts', () => {
    render(
      <FilterRail
        project={project}
        filters={{
          status: 'all',
          characterId: null,
          factType: 'all',
        }}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    expect(screen.getByText(/Marta Vega/).textContent).toContain('(2)')
    expect(screen.getByText(/Dan Vega/).textContent).toContain('(2)')
    expect(screen.getByText(/Knowledge/).textContent).toContain('(2)')
    expect(screen.getByText(/Events/).textContent).toContain('(1)')
  })

  it('collapses Status by default and shows pending count in summary', () => {
    render(
      <FilterRail
        project={project}
        filters={{
          status: 'all',
          characterId: null,
          factType: 'all',
        }}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    const status = screen.getByTestId('filter-rail-status')
    expect(status.hasAttribute('open')).toBe(false)
    expect(status.textContent).toMatch(/1 to review/)
  })

  it('uses a compact As-of select instead of a radio list', async () => {
    const user = userEvent.setup()
    const onAsOfSceneChange = vi.fn()
    render(
      <FilterRail
        project={project}
        filters={{
          status: 'all',
          characterId: null,
          factType: 'all',
        }}
        onChange={vi.fn()}
        facts={sampleFacts}
        sceneOptions={[
          { id: 'scene-3', label: 'Kitchen' },
          { id: 'scene-11', label: 'Scene 11' },
        ]}
        asOfScene={null}
        onAsOfSceneChange={onAsOfSceneChange}
      />,
    )

    const select = screen.getByLabelText('As of')
    expect(select.tagName).toBe('SELECT')
    expect(screen.queryByLabelText('Latest (all)')).toBeNull()

    await user.selectOptions(select, 'scene-3')
    expect(onAsOfSceneChange).toHaveBeenCalledWith('scene-3')
  })

  it('marks active filters with Quiet Tool soft accent chrome', () => {
    render(
      <FilterRail
        project={project}
        filters={{
          status: 'pending_review',
          characterId: null,
          factType: 'all',
        }}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    expect(screen.getByTestId('ledger-filter-rail').className).toMatch(
      /border-tr-border/,
    )
    // Status expands when non-default so the active option is visible.
    const status = screen.getByTestId('filter-rail-status')
    expect(status.hasAttribute('open')).toBe(true)
    expect(
      screen.getByLabelText('Needs review').parentElement?.className,
    ).toContain('bg-tr-coral-soft')
    expect(
      screen.getByLabelText('Needs review').parentElement?.className,
    ).toContain('text-tr-accent-ink')
  })
})
