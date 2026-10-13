// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeavePlanDialog } from './LeavePlanDialog'

// jsdom 29 has no showModal/close.
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.open = true
})
const close = vi.fn(function (this: HTMLDialogElement) {
  this.open = false
})

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = showModal
  HTMLDialogElement.prototype.close = close
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const noop = () => {}

describe('LeavePlanDialog', () => {
  it('opens as a modal when open and closes when not', () => {
    const { rerender } = render(
      <LeavePlanDialog
        open={false}
        draftCount={2}
        onStay={noop}
        onDiscard={noop}
      />,
    )
    const dialog = screen.getByTestId('leave-plan-dialog') as HTMLDialogElement
    expect(showModal).not.toHaveBeenCalled()
    expect(dialog.open).toBe(false)

    rerender(
      <LeavePlanDialog open draftCount={2} onStay={noop} onDiscard={noop} />,
    )
    expect(showModal).toHaveBeenCalledOnce()
    expect(dialog.open).toBe(true)
    expect(screen.getByText('You have unsaved edits in Plan.')).not.toBeNull()
    expect(dialog.textContent).toContain('2 fields have changes')

    rerender(
      <LeavePlanDialog
        open={false}
        draftCount={2}
        onStay={noop}
        onDiscard={noop}
      />,
    )
    expect(close).toHaveBeenCalledOnce()
    expect(dialog.open).toBe(false)
  })

  it('Stay, Discard and Esc answer through the callbacks', async () => {
    const user = userEvent.setup()
    const onStay = vi.fn()
    const onDiscard = vi.fn()
    render(
      <LeavePlanDialog
        open
        draftCount={1}
        onStay={onStay}
        onDiscard={onDiscard}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Stay in Plan' }))
    expect(onStay).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Discard and leave' }))
    expect(onDiscard).toHaveBeenCalledOnce()

    fireEvent(
      screen.getByTestId('leave-plan-dialog'),
      new Event('cancel', { cancelable: true }),
    )
    expect(onStay).toHaveBeenCalledTimes(2)
  })
})
