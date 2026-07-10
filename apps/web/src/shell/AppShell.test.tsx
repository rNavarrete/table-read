// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppShell } from './AppShell'

afterEach(cleanup)

describe('AppShell', () => {
  it('uses the Quiet Tool shell height and title treatment', () => {
    render(
      <AppShell activeMode="Write" ledgerCount={0} projectTitle="Long Pour">
        <p>Mode content</p>
      </AppShell>,
    )

    const shell = screen.getByRole('banner')
    const title = screen.getByRole('heading', { name: 'Long Pour' })

    expect(shell.className).toContain('h-shell-height')
    expect(title.className).toContain('font-display')
    expect(title.className).toContain('text-17')
    expect(title.className).toContain('font-semibold')
  })
})
