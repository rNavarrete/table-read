// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { setLeaveGuard } from './modeNavigation'

const {
  exportBreakdownCsvMock,
  exportFountainMock,
  listProjectSnapshotsMock,
  restoreProjectMock,
  undoProjectMock,
} = vi.hoisted(() => ({
  exportBreakdownCsvMock: vi.fn(),
  exportFountainMock: vi.fn(),
  listProjectSnapshotsMock: vi.fn(),
  restoreProjectMock: vi.fn(),
  undoProjectMock: vi.fn(),
}))

const getLlmModeMock = vi.fn()
let reloadMock: ReturnType<typeof vi.fn>

vi.mock('../api/client', () => ({
  exportBreakdownCsv: exportBreakdownCsvMock,
  exportFountain: exportFountainMock,
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

  it('the project title asks the leave guard before going to the project list', async () => {
    const user = userEvent.setup()
    const assignMock = vi.fn()
    window.location.assign = assignMock
    let allow = false
    const guard = vi.fn(() => Promise.resolve(allow))
    setLeaveGuard(guard)
    try {
      render(
        <AppShell
          activeMode="Plan"
          ledgerCount={0}
          projectTitle="Long Pour"
          projectId="proj-1"
        >
          <p>Mode content</p>
        </AppShell>,
      )
      const title = screen.getByRole('link', { name: 'Long Pour' })
      expect(title.getAttribute('href')).toBe('/projects')

      await user.click(title)
      expect(guard).toHaveBeenCalledOnce()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(assignMock).not.toHaveBeenCalled()

      allow = true
      await user.click(title)
      await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/projects'))
    } finally {
      setLeaveGuard(null)
    }
  })

  describe('Export menu (T10.10)', () => {
    let downloads: string[]

    beforeEach(() => {
      downloads = []
      URL.createObjectURL = vi.fn(() => 'blob:export')
      URL.revokeObjectURL = vi.fn()
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
        function (this: HTMLAnchorElement) {
          downloads.push(this.download)
        },
      )
    })

    const shell = (projectId?: string) =>
      render(
        <AppShell
          activeMode="Plan"
          ledgerCount={0}
          projectTitle="The Long Pour"
          projectId={projectId}
        >
          <p>Mode content</p>
        </AppShell>,
      )

    it('is disabled with no project loaded', () => {
      shell()
      const button = screen.getByRole('button', { name: 'Export' })
      expect((button as HTMLButtonElement).disabled).toBe(true)
      expect(button.getAttribute('title')).toBe('Export (no project loaded)')
    })

    it('offers the Fountain script and the breakdown spreadsheet', async () => {
      const user = userEvent.setup()
      shell('proj-1')
      const button = screen.getByRole('button', { name: 'Export' })
      expect(button.getAttribute('aria-haspopup')).toBe('menu')
      expect(button.getAttribute('aria-expanded')).toBe('false')

      await user.click(button)

      expect(button.getAttribute('aria-expanded')).toBe('true')
      const items = screen.getAllByRole('menuitem')
      expect(items.map((item) => item.textContent)).toEqual([
        'Fountain script',
        'Breakdown spreadsheet (.csv)',
      ])
      expect(document.activeElement).toBe(items[0])
    })

    it('downloads the breakdown CSV under the project title and closes', async () => {
      const user = userEvent.setup()
      exportBreakdownCsvMock.mockResolvedValue(new Blob(['Scene\r\n']))
      shell('proj-1')

      await user.click(screen.getByRole('button', { name: 'Export' }))
      await user.click(
        screen.getByRole('menuitem', { name: 'Breakdown spreadsheet (.csv)' }),
      )

      await waitFor(() =>
        expect(downloads).toEqual(['The_Long_Pour-breakdown.csv']),
      )
      expect(exportBreakdownCsvMock).toHaveBeenCalledExactlyOnceWith('proj-1')
      expect(exportFountainMock).not.toHaveBeenCalled()
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('downloads the Fountain script as before', async () => {
      const user = userEvent.setup()
      exportFountainMock.mockResolvedValue('INT. BAR - NIGHT')
      shell('proj-1')

      await user.click(screen.getByRole('button', { name: 'Export' }))
      await user.click(
        screen.getByRole('menuitem', { name: 'Fountain script' }),
      )

      await waitFor(() => expect(downloads).toEqual(['The_Long_Pour.fountain']))
      expect(exportFountainMock).toHaveBeenCalledWith('proj-1')
    })

    it('moves with the arrow keys and closes on Escape, back on Export', async () => {
      const user = userEvent.setup()
      shell('proj-1')
      const button = screen.getByRole('button', { name: 'Export' })
      await user.click(button)
      const [fountain, csv] = screen.getAllByRole('menuitem')

      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(csv)
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(fountain)
      await user.keyboard('{ArrowUp}')
      expect(document.activeElement).toBe(csv)
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(button)
    })

    it('says so when the export fails', async () => {
      const user = userEvent.setup()
      exportBreakdownCsvMock.mockRejectedValue(new Error('Server error'))
      shell('proj-1')

      await user.click(screen.getByRole('button', { name: 'Export' }))
      await user.click(
        screen.getByRole('menuitem', { name: 'Breakdown spreadsheet (.csv)' }),
      )

      expect(await screen.findByText('Server error')).toBeTruthy()
      expect(downloads).toEqual([])
    })
  })
})
