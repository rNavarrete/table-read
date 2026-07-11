// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuggestionChips } from './SuggestionChips'

afterEach(cleanup)

describe('SuggestionChips', () => {
  it('inserts on click without submitting a form', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <SuggestionChips
          suggestions={['Have Marta wait', 'Cut to Reyes', 'Let Dan notice']}
          onPick={onPick}
        />
      </form>,
    )
    await user.click(screen.getByRole('listitem', { name: /Have Marta wait/ }))
    expect(onPick).toHaveBeenCalledWith('Have Marta wait')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
