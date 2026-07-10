// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectSummary } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listProjects } from '../api/client'
import { DashboardScreen } from './DashboardScreen'
import { rowStatus } from './dashboardStatus'
import { saveResume } from './resumeContext'

vi.mock('../api/client', () => ({
  listProjects: vi.fn(),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.resetAllMocks()
})

const format = {
  genre: 'drama',
  runtimeMinutes: 60,
  actCount: 4,
  coldOpen: true,
  tag: false,
  serialization: 0.8,
} as const

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    format,
    updatedAt: '2026-07-10T19:00:00Z',
    pendingReviewCount: 0,
    setupState: 'ready',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('rowStatus', () => {
  it('prioritizes pending facts over setup and ready states', () => {
    expect(
      rowStatus(project({ pendingReviewCount: 2, setupState: 'incomplete' })),
    ).toBe('facts')
    expect(rowStatus(project({ setupState: 'incomplete' }))).toBe('setup')
    expect(rowStatus(project())).toBe('ready')
  })
})

describe('DashboardScreen', () => {
  it('renders a stable loading state while projects load', () => {
    const request = deferred<ProjectSummary[]>()
    vi.mocked(listProjects).mockReturnValue(request.promise)

    render(<DashboardScreen />)

    expect(screen.getByText('What are we writing?')).not.toBeNull()
    expect(screen.getByLabelText('Loading recent projects')).not.toBeNull()
  })

  it('renders empty launcher cards when there are no projects', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    render(<DashboardScreen />)

    expect(await screen.findByText('No projects yet')).not.toBeNull()
    expect(
      screen
        .getByRole('link', { name: /Start from an idea/i })
        .getAttribute('href'),
    ).toBe('/projects/new/idea')
    expect(
      screen
        .getByRole('link', { name: /Import a script/i })
        .getAttribute('href'),
    ).toBe('/projects/new/import')
  })

  it('opens the top-right new-project path chooser', async () => {
    vi.mocked(listProjects).mockResolvedValue([])
    const user = userEvent.setup()

    render(<DashboardScreen />)

    await screen.findByText('No projects yet')
    await user.click(screen.getByRole('button', { name: '+ New project' }))

    const dialog = screen.getByRole('dialog', { name: 'Choose a project path' })

    expect(dialog).not.toBeNull()
    expect(
      within(dialog)
        .getByRole('link', { name: /Start from an idea/i })
        .getAttribute('href'),
    ).toBe('/projects/new/idea')
    expect(
      within(dialog)
        .getByRole('link', { name: /Import a script/i })
        .getAttribute('href'),
    ).toBe('/projects/new/import')
  })

  it('renders at most five recent projects with status text', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: 'proj-1', title: 'Facts', pendingReviewCount: 3 }),
      project({ id: 'proj-2', title: 'Setup', setupState: 'incomplete' }),
      project({ id: 'proj-3', title: 'Ready' }),
      project({ id: 'proj-4', title: 'Four' }),
      project({ id: 'proj-5', title: 'Five' }),
      project({ id: 'proj-6', title: 'Six' }),
    ])

    render(<DashboardScreen />)

    expect(await screen.findByText('Facts')).not.toBeNull()
    expect(screen.getByText('3 facts to review')).not.toBeNull()
    expect(screen.getByText('Continue setup')).not.toBeNull()
    expect(screen.getAllByText('Ready to write').length).toBeGreaterThan(0)
    expect(screen.queryByText('Six')).toBeNull()
  })

  it('links a recent project to its last local mode and scene', async () => {
    vi.mocked(listProjects).mockResolvedValue([project()])
    saveResume('proj-longpour', { mode: 'Plan', sceneId: 'scene-3' })

    render(<DashboardScreen />)

    expect(
      (await screen.findByRole('link', { name: /The Long Pour/ })).getAttribute(
        'href',
      ),
    ).toBe('/plan?project=proj-longpour&scene=scene-3')
  })

  it('renders a search-empty state and can clear search', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ title: 'The Long Pour' }),
    ])
    const user = userEvent.setup()

    render(<DashboardScreen />)

    await screen.findByText('The Long Pour')
    await user.type(screen.getByLabelText('Search projects'), 'missing')

    expect(screen.getByText('No projects match "missing"')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByText('The Long Pour')).not.toBeNull()
  })

  it('renders an error state with retry', async () => {
    vi.mocked(listProjects)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([project()])

    render(<DashboardScreen />)

    expect(await screen.findByText('Could not load projects')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('The Long Pour')).not.toBeNull()
  })
})
