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

  it('Undo waits for beforeHistoryChange (Write save flush) and cancels on false', async () => {
    const user = userEvent.setup()
    undoProjectMock.mockResolvedValue({ id: 'proj-1' })
    let release!: (ok: boolean) => void
    const beforeHistoryChange = vi.fn(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    )

    render(
      <AppShell
        activeMode="Write"
        ledgerCount={0}
        projectTitle="Long Pour"
        projectId="proj-1"
        beforeHistoryChange={beforeHistoryChange}
      >
        <p>Mode content</p>
      </AppShell>,
    )

    await user.click(screen.getByTestId('undo-button'))
    expect(beforeHistoryChange).toHaveBeenCalledOnce()
    expect(undoProjectMock).not.toHaveBeenCalled()
    release(false)
    await waitFor(() =>
      expect(
        (screen.getByTestId('undo-button') as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    expect(undoProjectMock).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('undo-button'))
    release(true)
    await waitFor(() => expect(undoProjectMock).toHaveBeenCalledWith('proj-1'))
  })
})

describe('demo-mode banner', () => {
  it('warns the writer when AI results are fixture data', async () => {
    getLlmModeMock.mockResolvedValueOnce({ status: 'ok', llmMode: 'mock' })
    render(
      <AppShell projectTitle="The Long Pour" activeMode="Write" ledgerCount={0}>
        <div />
      </AppShell>,
    )
    const banner = await screen.findByTestId('mock-llm-banner')
    expect(banner.textContent).toMatch(/sample data/i)
  })

  it('stays out of the way when the real client is configured', async () => {
    render(
      <AppShell projectTitle="The Long Pour" activeMode="Write" ledgerCount={0}>
        <div />
      </AppShell>,
    )
    await waitFor(() => expect(getLlmModeMock).toHaveBeenCalled())
    expect(screen.queryByTestId('mock-llm-banner')).toBeNull()
  })

  it('says nothing when the health check cannot be reached', async () => {
    getLlmModeMock.mockRejectedValueOnce(new Error('offline'))
    render(
      <AppShell projectTitle="The Long Pour" activeMode="Write" ledgerCount={0}>
        <div />
      </AppShell>,
    )
    await waitFor(() => expect(getLlmModeMock).toHaveBeenCalled())
    expect(screen.queryByTestId('mock-llm-banner')).toBeNull()
  })
})
