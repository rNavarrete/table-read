// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

afterEach(cleanup)

describe('SettingsPanel', () => {
  it('states writing is not used for training and does not claim ZDR', () => {
    render(<SettingsPanel open onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    const text = dialog.textContent ?? ''

    expect(text).toMatch(/not used for training/i)
    expect(text).not.toMatch(/ZDR|zero-data|zero data retention/i)
  })

  it('calls onClose when the close control is activated', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SettingsPanel open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when closed', () => {
    const { container } = render(<SettingsPanel open={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
