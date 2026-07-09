// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { useQuietAi } from './useQuietAi'

// This project doesn't run @testing-library/react's vitest auto-cleanup
// plugin (would need a global setup file for one test module) — clean up
// the DOM between cases manually instead.
afterEach(cleanup)

function Harness() {
  const { quiet, canvasHandlers } = useQuietAi()
  return (
    <div>
      <span data-testid="quiet-state">{quiet ? 'quiet' : 'active'}</span>
      <div data-testid="canvas" {...canvasHandlers}>
        <input data-testid="beat-a" />
        <input data-testid="beat-b" />
      </div>
      <button data-testid="outside">Outside</button>
    </div>
  )
}

describe('useQuietAi', () => {
  it('starts active (not quiet)', () => {
    render(<Harness />)
    expect(screen.getByTestId('quiet-state').textContent).toBe('active')
  })

  it('goes quiet when a descendant of the canvas gains focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByTestId('beat-a'))
    expect(screen.getByTestId('quiet-state').textContent).toBe('quiet')
  })

  it('stays quiet when focus moves between two beats inside the canvas', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByTestId('beat-a'))
    await user.click(screen.getByTestId('beat-b'))
    expect(screen.getByTestId('quiet-state').textContent).toBe('quiet')
  })

  it('goes active again once focus leaves the canvas entirely', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByTestId('beat-a'))
    await user.click(screen.getByTestId('outside'))
    expect(screen.getByTestId('quiet-state').textContent).toBe('active')
  })
})
