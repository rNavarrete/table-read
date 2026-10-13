// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

const { listProjectSnapshotsMock, restoreProjectMock, undoProjectMock } =
  vi.hoisted(() => ({
    listProjectSnapshotsMock: vi.fn(),
    restoreProjectMock: vi.fn(),
    undoProjectMock: vi.fn(),
  }))

const getLlmModeMock = vi.fn()
let reloadMock: ReturnType<typeof vi.fn>

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

beforeEach(() => {
  // AppShell reloads after undo/restore so every mode re-fetches the restored
  // head. jsdom does not implement navigation, so without this the reload
  // escapes as an unhandled error: the test passes, the run reports "1 error",
  // and `make test` exits non-zero with nothing failing.
  reloadMock = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadMock },
  })
  getLlmModeMock.mockResolvedValue({ status: 'ok', llmMode: 'real' })
  vi.stubGlobal('fetch', (url: string) =>
    String(url).includes('/health')
      ? getLlmModeMock().then((body: unknown) => ({
          ok: true,
          json: () => Promise.resolve(body),
        }))
      : Promise.reject(new Error(`unexpected fetch: ${url}`)),
  )
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
    expect(title.className).toContain('font-script')
    expect(title.className).toContain('text-[14px]')
    expect(title.className).toContain('font-medium')
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
    expect(
      await screen.findByRole('option', { name: /Direct edit/ }),
    ).toBeTruthy()
    await user.click(screen.getByRole('option', { name: /Direct edit/ }))

    await waitFor(() => {
      expect(restoreProjectMock).toHaveBeenCalledWith('proj-1', 'snap-parent')
    })
    // The reload is the point: there is no shared project store across
    // Write/Plan/Review/Ledger, so the restored head only reaches the other
    // modes by re-fetching.
    await waitFor(() => expect(reloadMock).toHaveBeenCalled())
  })

  it('Undo runs its request through runHistoryChange (Write queue) and stays put when it declines', async () => {
    const user = userEvent.setup()
    undoProjectMock.mockResolvedValue({ id: 'proj-1' })
    let decline = true
    const runHistoryChange = vi.fn(async (request: () => Promise<unknown>) => {
      if (decline) return false // a save failed: no undo
      await request()
      return true
    })

    render(
      <AppShell
        activeMode="Write"
        ledgerCount={0}
        projectTitle="Long Pour"
        projectId="proj-1"
        runHistoryChange={runHistoryChange}
      >
        <p>Mode content</p>
      </AppShell>,
    )

    await user.click(screen.getByTestId('undo-button'))
    await waitFor(() =>
      expect(
        (screen.getByTestId('undo-button') as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    expect(runHistoryChange).toHaveBeenCalledOnce()
    expect(undoProjectMock).not.toHaveBeenCalled()
    expect(reloadMock).not.toHaveBeenCalled()

    decline = false
    await user.click(screen.getByTestId('undo-button'))
    await waitFor(() => expect(reloadMock).toHaveBeenCalled())
    // The undo request ran inside the runner, not beside it.
    expect(undoProjectMock).toHaveBeenCalledWith('proj-1')
    expect(runHistoryChange).toHaveBeenCalledTimes(2)
  })
})
