// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TRUST_NOTE, WizardShell } from './WizardShell'

afterEach(() => {
  cleanup()
})

describe('WizardShell', () => {
  it('renders step labels, navigation, and the trust note', () => {
    render(
      <WizardShell
        title="Start from an idea"
        steps={[
          {
            id: 'basics',
            label: 'Project basics',
            title: 'Project basics',
            body: <p>Placeholder basics</p>,
          },
          {
            id: 'review',
            label: 'Review',
            title: 'Review and create',
            body: <p>Placeholder review</p>,
          },
        ]}
      />,
    )

    expect(screen.getByText('Start from an idea')).not.toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Project basics' }),
    ).not.toBeNull()
    expect(screen.getByText('Review')).not.toBeNull()
    expect(screen.getByText(TRUST_NOTE)).not.toBeNull()
    expect(
      screen.getByRole('link', { name: 'Cancel' }).getAttribute('href'),
    ).toBe('/projects')
    expect(
      (screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('moves forward and back without discarding the current step body', async () => {
    const user = userEvent.setup()

    render(
      <WizardShell
        title="Import a script"
        steps={[
          {
            id: 'source',
            label: 'Add script',
            title: 'Add the script',
            body: <p>Upload or paste placeholder</p>,
          },
          {
            id: 'basics',
            label: 'Confirm basics',
            title: 'Confirm basics',
            body: <p>Format placeholder</p>,
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Format placeholder')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Upload or paste placeholder')).not.toBeNull()
  })

  it('focuses the first invalid field when validation blocks continue', async () => {
    const user = userEvent.setup()
    const validate = vi.fn(() => false)

    render(
      <WizardShell
        title="Start from an idea"
        steps={[
          {
            id: 'basics',
            label: 'Project basics',
            title: 'Project basics',
            validate,
            body: (
              <label>
                Title
                <input aria-invalid="true" />
              </label>
            ),
          },
          {
            id: 'format',
            label: 'Format',
            title: 'Format',
            body: <p>Format placeholder</p>,
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(validate).toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByLabelText('Title'))
    expect(screen.queryByText('Format placeholder')).toBeNull()
  })
})
