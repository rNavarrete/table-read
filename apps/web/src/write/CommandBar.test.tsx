// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandBar } from './CommandBar'

afterEach(cleanup)

describe('CommandBar', () => {
  it('uses Write redesign floating bar chrome', () => {
    render(<CommandBar onSubmit={() => {}} disabled={false} hidden={false} />)

    const bar = screen.getByTestId('command-bar')
    expect(bar.className).toContain('rounded-2xl')
    expect(bar.className).toContain('bg-tr-surface-raised')
    expect(bar.className).toContain('shadow-write-bar')
    expect(
      screen.getByRole('button', { name: /write it/i }).className,
    ).toContain('bg-tr-coral')
    expect(screen.getByPlaceholderText('Whisper the next move…')).not.toBeNull()
  })
})
