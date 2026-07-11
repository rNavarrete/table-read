// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

const {
  listProjectSnapshotsMock,
  restoreProjectMock,
  undoProjectMock,
} = vi.hoisted(() => ({
  listProjectSnapshotsMock: vi.fn(),
  restoreProjectMock: vi.fn(),
  undoProjectMock: vi.fn(),
}))

vi.mock('../api/client', () => ({
  exportFountain: vi.fn(),
  listProjectSnapshots: listProjectSnapshotsMock,
  restoreProject: restoreProjectMock,
  undoProject: undoProjectMock,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

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

  it('opens undo history and restores a selected ancestor', async () => {
    const user = userEvent.setup()
    listProjectSnapshotsMock.mockResolvedValue([
      {
        id: 'snap-parent',
        instruction: 'Direct edit',
        ts: new Date().toISOString(),
      },
    ])
    restoreProjectMock.mockResolvedValue({ id: 'proj-1' })

    render(
      <AppShell
        activeMode="Write"
        ledgerCount={0}
        projectTitle="Long Pour"
        projectId="proj-1"
      >
        <p>Mode content</p>
      </AppShell>,
    )

    await user.click(screen.getByTitle('Undo history'))
    expect(await screen.findByRole('option', { name: /Direct edit/ })).toBeTruthy()
    await user.click(screen.getByRole('option', { name: /Direct edit/ }))

    await waitFor(() => {
      expect(restoreProjectMock).toHaveBeenCalledWith('proj-1', 'snap-parent')
    })
  })
})
