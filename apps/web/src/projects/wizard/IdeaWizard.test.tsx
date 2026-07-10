// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectCreateRequest } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, loadDraft, saveDraft } from './wizardDraft'
import { IdeaWizard } from './IdeaWizard'
import { createProject } from '../../api/client'

vi.mock('../../api/client', () => ({
  createProject: vi.fn(),
}))

const mockedCreateProject = vi.mocked(createProject)

afterEach(() => {
  cleanup()
  localStorage.clear()
  mockedCreateProject.mockReset()
  vi.restoreAllMocks()
})

function stubLocationAssign() {
  const assignSpy = vi.fn()
  const original = window.location
  Object.defineProperty(window, 'location', {
    value: {
      ...original,
      href: 'http://localhost/projects/new/idea',
      assign: assignSpy,
    },
    writable: true,
  })
  return { assignSpy, original }
}

describe('IdeaWizard', () => {
  it('creates a project from idea inputs, clears the draft, and opens Plan', async () => {
    const user = userEvent.setup()
    const { assignSpy, original } = stubLocationAssign()
    mockedCreateProject.mockResolvedValue({
      id: 'proj-created',
      title: 'Harbor Lights',
      premise: 'A dock worker inherits a haunted ferry.',
      format: {
        genre: 'comedy',
        runtimeMinutes: 30,
        actCount: 2,
        coldOpen: true,
        tag: false,
        serialization: 0.3,
      },
      enabledComponents: [],
      seriesBible: {
        existentialQuestion: { text: '', locked: false },
        worldRules: [],
        storiesToAvoid: [],
        characters: [],
        relationships: [],
        audienceGoals: [],
        narratorGoals: [],
        worldQA: [],
      },
      seasons: [],
      headSnapshotId: 'snap-created',
    })

    render(<IdeaWizard />)

    await user.type(screen.getByLabelText('Title'), 'Harbor Lights')
    await user.type(
      screen.getByLabelText('Premise'),
      'A dock worker inherits a haunted ferry.',
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByLabelText(/Half-hour comedy/))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Character name 1'), 'June')
    await user.type(screen.getByLabelText('Character traits 1'), 'restless')
    await user.click(screen.getByRole('button', { name: 'Add character' }))
    await user.type(screen.getByLabelText('Character name 2'), 'Omar')
    await user.type(
      screen.getByLabelText('Existential question'),
      'Can home be chosen?',
    )
    await user.type(
      screen.getByLabelText('Stories to avoid'),
      'Chosen one trope',
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(mockedCreateProject).toHaveBeenCalled())
    const [body, opts] = mockedCreateProject.mock.calls[0] as [
      ProjectCreateRequest,
      { idempotencyKey: string },
    ]
    expect(body).toEqual({
      title: 'Harbor Lights',
      premise: 'A dock worker inherits a haunted ferry.',
      format: {
        genre: 'comedy',
        runtimeMinutes: 30,
        actCount: 2,
        coldOpen: true,
        tag: false,
        serialization: 0.3,
      },
      foundation: {
        existentialQuestion: 'Can home be chosen?',
        storiesToAvoid: ['Chosen one trope'],
        characters: [{ name: 'June', traits: 'restless' }, { name: 'Omar' }],
      },
    })
    expect(opts.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(loadDraft('/projects/new/idea')).toBeNull()
    expect(assignSpy).toHaveBeenCalledWith('/plan?project=proj-created')

    Object.defineProperty(window, 'location', {
      value: original,
      writable: true,
    })
  })

  it('reuses an idempotency key retained with the draft', async () => {
    saveDraft('/projects/new/idea', {
      idempotencyKey: '00000000-0000-4000-8000-000000000011',
      title: 'Saved',
      premise: 'Saved premise',
      presetId: 'one-hour-drama',
      characters: [{ name: '', traits: '' }],
      existentialQuestion: '',
      storiesToAvoidText: '',
    })
    mockedCreateProject.mockResolvedValue({
      id: 'proj-saved',
      title: 'Saved',
      premise: 'Saved premise',
      format: {
        genre: 'drama',
        runtimeMinutes: 60,
        actCount: 5,
        coldOpen: true,
        tag: true,
        serialization: 0.7,
      },
      enabledComponents: [],
      seriesBible: {
        existentialQuestion: { text: '', locked: false },
        worldRules: [],
        storiesToAvoid: [],
        characters: [],
        relationships: [],
        audienceGoals: [],
        narratorGoals: [],
        worldQA: [],
      },
      seasons: [],
      headSnapshotId: 'snap-saved',
    })
    const { original } = stubLocationAssign()

    render(<IdeaWizard />)
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Create project' }),
    )

    await waitFor(() => expect(mockedCreateProject).toHaveBeenCalled())
    expect(mockedCreateProject.mock.calls[0][1]).toEqual({
      idempotencyKey: '00000000-0000-4000-8000-000000000011',
    })
    clearDraft('/projects/new/idea')
    Object.defineProperty(window, 'location', {
      value: original,
      writable: true,
    })
  })
})
