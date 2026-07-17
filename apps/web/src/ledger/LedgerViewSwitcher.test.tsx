// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LedgerViewSwitcher } from './LedgerViewSwitcher'
import { loadLedgerView } from './viewPreference'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('LedgerViewSwitcher', () => {
  it('renders Atlas and Web segments with switcher test id', () => {
    render(
      <LedgerViewSwitcher
        projectId="proj-1"
        value="atlas"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('ledger-view-switcher')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Atlas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Web' })).toBeTruthy()
  })

  it('marks the active segment with coral-soft accent chrome', () => {
    render(
      <LedgerViewSwitcher
        projectId="proj-1"
        value="web"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Web' }).className).toContain(
      'bg-tr-coral-soft',
    )
    expect(screen.getByRole('button', { name: 'Web' }).className).toContain(
      'text-tr-accent-ink',
    )
    expect(screen.getByRole('button', { name: 'Web' }).className).toContain(
      'duration-standard',
    )
  })

  it('calls onChange and persists the view when a segment is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <LedgerViewSwitcher
        projectId="proj-1"
        value="atlas"
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Web' }))

    expect(onChange).toHaveBeenCalledWith('web')
    expect(loadLedgerView('proj-1')).toBe('web')
  })
})
