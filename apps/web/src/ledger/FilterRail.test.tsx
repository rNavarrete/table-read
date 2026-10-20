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
      { id: 'char-slug', name: 'INT. KITCHEN - DAY' },
      { id: 'char-extra', name: 'Waiter' },
      { id: 'char-a', name: 'Alice' },
      { id: 'char-b', name: 'Bob' },
      { id: 'char-c', name: 'Carol' },
      { id: 'char-d', name: 'Dave' },
      { id: 'char-e', name: 'Eve' },
      { id: 'char-f', name: 'Frank' },
      { id: 'char-g', name: 'Grace' },
      { id: 'char-h', name: 'Hank' },
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

const defaultFilters = {
  status: 'all' as const,
  characterId: null,
  factType: 'all' as const,
  secretsOnly: false,
}

describe('FilterRail', () => {
  it('shows CAST chrome with All facts and Manage', () => {
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
        onChange={vi.fn()}
        onManageCast={vi.fn()}
        facts={sampleFacts}
      />,
    )

    expect(screen.getByText('Cast')).toBeTruthy()
    expect(screen.getByText('All facts')).toBeTruthy()
    expect(screen.getByTestId('manage-cast-button').textContent).toMatch(
      /Manage/,
    )
    expect(screen.queryByText('Browse')).toBeNull()
  })

  it('sorts people by fact count and shows avatar pills', () => {
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    const marta = screen.getByTestId('cast-person-char-marta')
    const dan = screen.getByTestId('cast-person-char-dan')
    expect(marta.textContent).toMatch(/Marta Vega/)
    expect(marta.textContent).toMatch(/2/)
    expect(dan.textContent).toMatch(/2/)
    // Fact-holders sort above zero-count cast (Dan/Marta before Alice).
    const rail = screen.getByTestId('ledger-filter-rail').textContent ?? ''
    expect(rail.indexOf('Dan Vega')).toBeLessThan(rail.indexOf('Alice'))
    expect(rail.indexOf('Marta Vega')).toBeLessThan(rail.indexOf('Alice'))
  })

  it('filters people via search and reveals all matches', async () => {
    const user = userEvent.setup()
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    await user.type(screen.getByTestId('cast-search'), 'wait')
    expect(screen.getByTestId('cast-person-char-extra')).toBeTruthy()
    expect(screen.queryByTestId('cast-person-char-marta')).toBeNull()
    expect(screen.queryByTestId('cast-expand-toggle')).toBeNull()
  })

  it('collapses people beyond the top 10 with Show all', async () => {
    const user = userEvent.setup()
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    expect(screen.getByTestId('cast-expand-toggle').textContent).toMatch(
      /Show all 12/,
    )
    // Zero-count names sort after fact-holders; 11th/12th stay collapsed.
    expect(screen.queryByTestId('cast-person-char-extra')).toBeNull()
    expect(screen.queryByTestId('cast-person-char-slug')).toBeNull()
    await user.click(screen.getByTestId('cast-expand-toggle'))
    expect(screen.getByTestId('cast-person-char-extra')).toBeTruthy()
    expect(screen.getByTestId('cast-expand-toggle').textContent).toMatch(
      /Show fewer/,
    )
  })

  it('selects a character from the CAST list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
        onChange={onChange}
        facts={sampleFacts}
      />,
    )

    await user.click(screen.getByTestId('cast-person-char-marta'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-marta' }),
    )
  })

  it('collapses Status by default and shows pending count in summary', () => {
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    const status = screen.getByTestId('filter-rail-status')
    expect(status.hasAttribute('open')).toBe(false)
    expect(status.textContent).toMatch(/1 to review/)
  })

  it('exposes secret and superseded-history visibility controls with counts', () => {
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
        onChange={vi.fn()}
        facts={[
          ...sampleFacts,
          fact({
            id: 'f-secret',
            factType: 'knowledge',
            audienceKnows: false,
          }),
          fact({ id: 'f-old', factType: 'event', status: 'superseded' }),
        ]}
      />,
    )

    expect(screen.getByTestId('secrets-only-toggle')).toBeTruthy()
    expect(screen.getByTestId('hide-superseded-toggle')).toBeTruthy()
    expect(
      screen.getByText('◆ Secrets only').parentElement?.textContent,
    ).toMatch(/1/)
    expect(
      screen.getByText('Hide superseded').parentElement?.textContent,
    ).toMatch(/1/)
  })

  it('uses a compact As-of select instead of a radio list', async () => {
    const user = userEvent.setup()
    const onAsOfSceneChange = vi.fn()
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
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

    await user.selectOptions(select, 'scene-3')
    expect(onAsOfSceneChange).toHaveBeenCalledWith('scene-3')
  })

  it('marks selected CAST row and expands Status when non-default', () => {
    render(
      <FilterRail
        project={project}
        filters={{
          ...defaultFilters,
          status: 'pending_review',
          characterId: 'char-marta',
        }}
        onChange={vi.fn()}
        facts={sampleFacts}
      />,
    )

    expect(screen.getByTestId('cast-person-char-marta').className).toContain(
      'bg-tr-ledger-selected',
    )
    const status = screen.getByTestId('filter-rail-status')
    expect(status.hasAttribute('open')).toBe(true)
    expect(
      screen.getByLabelText('Needs review').parentElement?.className,
    ).toContain('bg-tr-ledger-selected')
  })
})

describe('cast filter accessibility', () => {
  it('gives every cast radio a name a screen reader can announce', () => {
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
        onChange={vi.fn()}
        onManageCast={vi.fn()}
        facts={sampleFacts}
      />,
    )

    // These announced as an indistinguishable row of radio "on" — the input is
    // visually hidden and the label's text sits in sibling spans, so nothing
    // named the control. UI spec §2 requires labelled controls.
    const named = screen
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('aria-label'))
    expect(named.every((name) => name && name.trim())).toBe(true)
    expect(named).toContain('All facts')
  })

  it('names each person radio for the person it filters to', () => {
    // The rail shows only people who appear in the facts, capped until
    // "Show all" — so assert over what it rendered, not the whole bible.
    render(
      <FilterRail
        project={project}
        filters={defaultFilters}
        onChange={vi.fn()}
        onManageCast={vi.fn()}
        facts={sampleFacts}
      />,
    )

    const names = new Set(
      screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label')),
    )
    const rendered = project.seriesBible.characters.filter((c) =>
      names.has(c.name),
    )
    expect(rendered.length).toBeGreaterThan(0)
    for (const character of rendered) {
      expect(screen.getByRole('radio', { name: character.name })).toBeTruthy()
    }
  })
})
