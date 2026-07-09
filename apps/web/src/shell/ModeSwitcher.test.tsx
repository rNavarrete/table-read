// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModeSwitcher } from './ModeSwitcher'

afterEach(cleanup)

describe('ModeSwitcher', () => {
  it('Write active: Plan is enabled and clickable; Review/Ledger stay disabled', () => {
    render(<ModeSwitcher active="Write" ledgerCount={0} />)
    const write = screen.getByRole('tab', { name: 'Write' })
    const plan = screen.getByRole('tab', { name: 'Plan' })
    const review = screen.getByRole('tab', { name: 'Review' })
    const ledger = screen.getByRole('tab', { name: 'Ledger' })

    expect(write.getAttribute('aria-selected')).toBe('true')
    expect((plan as HTMLButtonElement).disabled).toBe(false)
    expect((review as HTMLButtonElement).disabled).toBe(true)
    expect((ledger as HTMLButtonElement).disabled).toBe(true)
  })

  it('Plan active: Write is enabled and clickable', () => {
    render(<ModeSwitcher active="Plan" ledgerCount={0} />)
    const write = screen.getByRole('tab', { name: 'Write' })
    const plan = screen.getByRole('tab', { name: 'Plan' })
    expect(plan.getAttribute('aria-selected')).toBe('true')
    expect((write as HTMLButtonElement).disabled).toBe(false)
  })

  it('clicking the inactive Plan tab navigates to /plan, preserving the query string', async () => {
    const user = userEvent.setup()
    const assignSpy = vi.fn()
    const original = window.location
    // jsdom's location.assign isn't implemented (logs a virtual-console
    // error) — stub it so this test observes the call without that noise.
    Object.defineProperty(window, 'location', {
      value: {
        ...original,
        href: 'http://localhost/?project=proj-longpour',
        assign: assignSpy,
      },
      writable: true,
    })

    render(<ModeSwitcher active="Write" ledgerCount={0} />)
    await user.click(screen.getByRole('tab', { name: 'Plan' }))

    expect(assignSpy).toHaveBeenCalledWith(
      'http://localhost/plan?project=proj-longpour',
    )

    Object.defineProperty(window, 'location', {
      value: original,
      writable: true,
    })
  })

  it('shows the ledger count badge on the Ledger tab', () => {
    render(<ModeSwitcher active="Write" ledgerCount={8} />)
    expect(screen.getByRole('tab', { name: /Ledger/ }).textContent).toContain(
      '8',
    )
  })
})
