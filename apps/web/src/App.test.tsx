// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./write/WriteScreen', () => ({
  WriteScreen: () => <div data-testid="write-screen">Write</div>,
}))

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('App routing', () => {
  it('shows a stub for /projects/new/idea instead of WriteScreen', () => {
    window.history.pushState({}, '', '/projects/new/idea')

    render(<App />)

    expect(screen.getByText('Start from an idea')).not.toBeNull()
    expect(screen.getByText('Coming soon.')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Back to projects' }).getAttribute('href')).toBe(
      '/projects',
    )
    expect(screen.queryByTestId('write-screen')).toBeNull()
  })

  it('shows a stub for /projects/new/import instead of WriteScreen', () => {
    window.history.pushState({}, '', '/projects/new/import')

    render(<App />)

    expect(screen.getByText('Import a script')).not.toBeNull()
    expect(screen.getByText('Coming soon.')).not.toBeNull()
    expect(screen.queryByTestId('write-screen')).toBeNull()
  })
})
