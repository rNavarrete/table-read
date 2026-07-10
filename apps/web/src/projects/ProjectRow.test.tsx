// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectSummary } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteProject } from '../api/client'
import { ProjectRow } from './ProjectRow'

vi.mock('../api/client', () => ({
  deleteProject: vi.fn(),
  exportFountain: vi.fn(),
  patchProject: vi.fn(),
}))

afterEach(() => {
  cleanup()
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

describe('ProjectRow overflow menu', () => {
  it('exposes Rename, Export Fountain, and Permanently delete', async () => {
    const user = userEvent.setup()
    render(<ProjectRow project={project()} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Project actions for The Long Pour',
      }),
    )

    expect(screen.getByRole('menuitem', { name: 'Rename' })).not.toBeNull()
    expect(
      screen.getByRole('menuitem', { name: 'Export Fountain' }),
    ).not.toBeNull()
    expect(
      screen.getByRole('menuitem', { name: 'Permanently delete' }),
    ).not.toBeNull()
  })
})

describe('Permanently delete confirmation', () => {
  it('requires the exact typed title before deleting', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteProject).mockResolvedValue(undefined)
    const onDeleted = vi.fn()

    render(<ProjectRow project={project()} onDeleted={onDeleted} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Project actions for The Long Pour',
      }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: 'Permanently delete' }),
    )

    const confirm = screen.getByRole('button', {
      name: 'Delete project',
    }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    const input = screen.getByLabelText('Type the project title to confirm')
    await user.type(input, 'The Long Pou')
    expect(confirm.disabled).toBe(true)

    await user.type(input, 'r')
    expect(confirm.disabled).toBe(false)

    await user.click(confirm)

    expect(deleteProject).toHaveBeenCalledWith('proj-longpour')
    expect(onDeleted).toHaveBeenCalledWith('proj-longpour')
  })

  it('keeps the project visible and reports the error on a failed purge', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteProject).mockRejectedValue(new Error('server exploded'))
    const onDeleted = vi.fn()

    render(<ProjectRow project={project()} onDeleted={onDeleted} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Project actions for The Long Pour',
      }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: 'Permanently delete' }),
    )
    await user.type(
      screen.getByLabelText('Type the project title to confirm'),
      'The Long Pour',
    )
    await user.click(screen.getByRole('button', { name: 'Delete project' }))

    expect(await screen.findByText('server exploded')).not.toBeNull()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
