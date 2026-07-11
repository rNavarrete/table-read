// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from 'contract'
import { FilterRail } from './FilterRail'

afterEach(cleanup)

const project = {
  seriesBible: {
    characters: [{ id: 'char-marta', name: 'Marta Vega' }],
  },
} as Project

describe('FilterRail', () => {
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
      />,
    )

    expect(screen.getByTestId('ledger-filter-rail').className).toMatch(
      /border-tr-border/,
    )
    expect(
      screen.getByLabelText('pending_review').parentElement?.className,
    ).toContain('bg-tr-coral-soft')
    expect(
      screen.getByLabelText('pending_review').parentElement?.className,
    ).toContain('text-tr-accent-ink')
  })
})
