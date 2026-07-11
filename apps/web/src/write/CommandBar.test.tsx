// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandBar } from './CommandBar'

afterEach(cleanup)

describe('CommandBar', () => {
  it('uses Quiet Tool floating pill chrome', () => {
    render(<CommandBar onSubmit={() => {}} disabled={false} hidden={false} />)

    const bar = screen.getByTestId('command-bar')
    expect(bar.className).toContain('max-w-script-col')
    expect(bar.className).toContain('rounded-chip')
    expect(bar.className).toContain('bg-tr-surface-raised')
    expect(bar.className).toContain('shadow-raised')
    expect(
      screen.getByRole('button', { name: /generate/i }).className,
    ).toContain('bg-tr-coral')
  })
})
