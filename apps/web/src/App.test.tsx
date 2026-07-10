// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { TRUST_NOTE } from './projects/wizard/WizardShell'

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('App wizard routes', () => {
  it('renders the idea wizard shell at /projects/new/idea', () => {
    window.history.pushState({}, '', '/projects/new/idea')

    render(<App />)

    expect(screen.getByText('Start from an idea')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Project basics' })).not.toBeNull()
    expect(screen.getByText(TRUST_NOTE)).not.toBeNull()
    expect(screen.queryByText('Coming soon.')).toBeNull()
  })

  it('renders the import wizard shell at /projects/new/import', () => {
    window.history.pushState({}, '', '/projects/new/import')

    render(<App />)

    expect(screen.getByText('Import a script')).not.toBeNull()
    expect(screen.getByText('Add the script')).not.toBeNull()
    expect(screen.getByText(TRUST_NOTE)).not.toBeNull()
    expect(screen.queryByText('Coming soon.')).toBeNull()
  })
})
