// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelSection } from './PanelSection'

afterEach(cleanup)

describe('PanelSection', () => {
  it('is a native details element carrying the scroll-spy contract and a counted title', () => {
    render(
      <PanelSection id="beats" title="Beats" count={3} open onToggle={() => {}}>
        <p>ladder</p>
      </PanelSection>,
    )
    const details = document.getElementById(
      'plan-section-beats',
    ) as HTMLDetailsElement
    expect(details.tagName).toBe('DETAILS')
    expect(details.dataset.planSection).toBe('beats')
    expect(details.open).toBe(true)
    expect(screen.getByText('Beats (3)')).not.toBeNull()
    expect(screen.queryByText('steers Next Beat')).toBeNull()
  })

  it('marks the sections that steer Next Beat', () => {
    render(
      <PanelSection
        id="scene"
        title="What the scene does"
        steersNextBeat
        open
        onToggle={() => {}}
      >
        <p>fields</p>
      </PanelSection>,
    )
    expect(screen.getByText('steers Next Beat')).not.toBeNull()
  })

  it('reports the new open state when the summary is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <PanelSection
        id="details"
        title="Details"
        open={false}
        onToggle={onToggle}
      >
        <p>fields</p>
      </PanelSection>,
    )
    await user.click(screen.getByText('Details').closest('summary')!)
    // jsdom queues the details `toggle` event (setTimeout 0).
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(true))
  })
})
