// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImpactedObject } from 'contract'
import { ChangeSetRow } from './ChangeSetRow'

afterEach(cleanup)

function row(overrides: Partial<ImpactedObject> = {}): ImpactedObject {
  return {
    objectType: 'beat',
    objectId: 'beat-4-2',
    applyMode: 'regenerate',
    reason: 'Marta searches the bar.',
    confidence: 'high',
    locked: false,
    before: 'Searches the bar safe.',
    after: null,
    continuityFlags: [],
    approved: false,
    ...overrides,
  }
}

const noop = () => {}

describe('ChangeSetRow', () => {
  it('renders a checkbox for unlocked regenerate rows', () => {
    render(
      <ChangeSetRow
        row={row()}
        selected
        expanded={false}
        previewing={false}
        onToggleSelected={noop}
        onToggleExpanded={noop}
      />,
    )
    expect(
      screen.getByRole('checkbox', { name: 'Select beat-4-2' }),
    ).not.toBeNull()
    expect(screen.getByText('direct')).not.toBeNull()
  })

  it('summarizes before and after as compact chips while collapsed', () => {
    render(
      <ChangeSetRow
        row={row({
          before: 'Searches the bar safe.',
          after: 'Searches the marina locker.',
        })}
        selected
        expanded={false}
        previewing={false}
        onToggleSelected={noop}
        onToggleExpanded={noop}
      />,
    )

    expect(screen.getByText('Before')).not.toBeNull()
    expect(screen.getByText('Searches the bar safe.')).not.toBeNull()
    expect(screen.getByText('After')).not.toBeNull()
    expect(screen.getByText('Searches the marina locker.')).not.toBeNull()
  })

  it('renders locked rows without a checkbox, with lock glyph and reduced opacity', () => {
    const { container } = render(
      <ChangeSetRow
        row={row({ locked: true, objectId: 'beat-1-2' })}
        selected={false}
        expanded={false}
        previewing={false}
        onToggleSelected={noop}
        onToggleExpanded={noop}
      />,
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByLabelText('Locked')).not.toBeNull()
    expect(
      container.querySelector('[data-testid="change-set-row-beat-1-2"]')
        ?.className,
    ).toContain('opacity-locked')
  })

  it('renders flag_only rows with info glyph and no checkbox', () => {
    render(
      <ChangeSetRow
        row={row({
          objectType: 'ledgerFact',
          objectId: 'fact-02',
          applyMode: 'flag_only',
          confidence: 'speculative',
        })}
        selected={false}
        expanded={false}
        previewing={false}
        onToggleSelected={noop}
        onToggleExpanded={noop}
      />,
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByLabelText('Flag only')).not.toBeNull()
    expect(screen.getByText('speculative')).not.toBeNull()
  })

  it('shows continuity flag chips', () => {
    render(
      <ChangeSetRow
        row={row({
          continuityFlags: [
            { factId: 'fact-02', explanation: 'Ice machine fact.' },
          ],
        })}
        selected={false}
        expanded={false}
        previewing={false}
        onToggleSelected={noop}
        onToggleExpanded={noop}
      />,
    )
    expect(screen.getByText('fact-02')).not.toBeNull()
  })

  it('continuity flag chip click calls onContinuityFlagClick', async () => {
    const user = userEvent.setup()
    const onContinuityFlagClick = vi.fn()
    render(
      <ChangeSetRow
        row={row({
          continuityFlags: [
            { factId: 'fact-02', explanation: 'Ice machine fact.' },
          ],
        })}
        selected={false}
        expanded={false}
        previewing={false}
        onToggleSelected={noop}
        onToggleExpanded={noop}
        onContinuityFlagClick={onContinuityFlagClick}
      />,
    )
    await user.click(screen.getByTestId('continuity-flag-fact-02'))
    expect(onContinuityFlagClick).toHaveBeenCalledWith('fact-02')
  })

  it('expanded with null after shows the preview ghost', () => {
    render(
      <ChangeSetRow
        row={row()}
        selected
        expanded
        previewing={false}
        onToggleSelected={noop}
        onToggleExpanded={noop}
      />,
    )
    expect(screen.getByText('Preview to generate')).not.toBeNull()
  })

  it('checkbox toggle calls onToggleSelected', async () => {
    const user = userEvent.setup()
    const onToggleSelected = vi.fn()
    render(
      <ChangeSetRow
        row={row()}
        selected={false}
        expanded={false}
        previewing={false}
        onToggleSelected={onToggleSelected}
        onToggleExpanded={noop}
      />,
    )
    await user.click(screen.getByRole('checkbox'))
    expect(onToggleSelected).toHaveBeenCalledWith('beat-4-2')
  })
})
