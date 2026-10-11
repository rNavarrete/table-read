// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Character, LedgerFact, Project } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CastPanel } from './CastPanel'

vi.mock('../api/client', () => ({
  renameCharacter: vi.fn(),
  mergeCharacterInto: vi.fn(),
  deleteCharacter: vi.fn(),
}))

import {
  deleteCharacter,
  mergeCharacterInto,
  renameCharacter,
} from '../api/client'
import { ApiError } from '../api/errors'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function character(
  id: string,
  name: string,
  extra: Partial<Character> = {},
): Character {
  return {
    id,
    name,
    locked: false,
    aliases: [],
    embodiment: '',
    presentation: '',
    hiding: '',
    traits: '',
    seriesArc: '',
    summary: '',
    bio: '',
    ...extra,
  }
}

function project(characters: Character[]): Project {
  return {
    id: 'proj-1',
    headSnapshotId: 'snap-1',
    seriesBible: { characters },
  } as unknown as Project
}

describe('CastPanel', () => {
  it('renames a character optimistically', async () => {
    const user = userEvent.setup()
    vi.mocked(renameCharacter).mockResolvedValue(character('char-a', 'Ann'))
    const onProjectChange = vi.fn()

    render(
      <CastPanel
        project={project([character('char-a', 'Anna')])}
        ledger={[]}
        onProjectChange={onProjectChange}
        onLedgerChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('cast-rename-char-a'))
    const input = screen.getByLabelText('Name')
    await user.clear(input)
    await user.type(input, 'Ann')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Optimistic: the project state updates before the request resolves.
    expect(onProjectChange).toHaveBeenCalledWith(
      expect.objectContaining({
        seriesBible: {
          characters: [expect.objectContaining({ id: 'char-a', name: 'Ann' })],
        },
      }),
    )
    await waitFor(() =>
      expect(renameCharacter).toHaveBeenCalledWith(
        'proj-1',
        'char-a',
        { name: 'Ann', aliases: [] },
        { expectedHeadSnapshotId: 'snap-1' },
      ),
    )
  })

  it('rolls back a rename on a 409 LOCKED_OBJECT response', async () => {
    const user = userEvent.setup()
    vi.mocked(renameCharacter).mockRejectedValue(
      new ApiError(409, {
        code: 'LOCKED_OBJECT',
        message: 'character is locked',
      }),
    )
    const original = project([character('char-a', 'Anna')])
    const onProjectChange = vi.fn()

    render(
      <CastPanel
        project={original}
        ledger={[]}
        onProjectChange={onProjectChange}
        onLedgerChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('cast-rename-char-a'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'character is locked',
      )
    })
    // Rollback: the last call restores the pre-mutation project.
    const lastCall = onProjectChange.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual(original)
  })

  it('merges a character and applies the server response', async () => {
    const user = userEvent.setup()
    const source = character('char-a', 'Anna', { aliases: ['Annie'] })
    const target = character('char-b', 'Beth')
    const mergedProject = project([
      character('char-b', 'Beth', { aliases: ['Annie', 'Anna'] }),
    ])
    const mergedLedger: LedgerFact[] = []
    vi.mocked(mergeCharacterInto).mockResolvedValue({
      project: mergedProject,
      ledger: mergedLedger,
    })
    const onProjectChange = vi.fn()
    const onLedgerChange = vi.fn()

    render(
      <CastPanel
        project={project([source, target])}
        ledger={[]}
        onProjectChange={onProjectChange}
        onLedgerChange={onLedgerChange}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('cast-merge-char-a'))
    await user.selectOptions(screen.getByLabelText('Merge into'), 'char-b')
    await user.click(screen.getByRole('button', { name: 'Merge' }))

    await waitFor(() =>
      expect(mergeCharacterInto).toHaveBeenCalledWith(
        'proj-1',
        'char-a',
        'char-b',
        { expectedHeadSnapshotId: 'snap-1' },
      ),
    )
    await waitFor(() =>
      expect(onProjectChange).toHaveBeenLastCalledWith(mergedProject),
    )
    expect(onLedgerChange).toHaveBeenLastCalledWith(mergedLedger)
  })

  it('rolls back project and ledger on a failed merge', async () => {
    const user = userEvent.setup()
    vi.mocked(mergeCharacterInto).mockRejectedValue(
      new ApiError(409, {
        code: 'LOCKED_OBJECT',
        message: 'cannot merge a locked character',
      }),
    )
    const originalProject = project([
      character('char-a', 'Anna'),
      character('char-b', 'Beth'),
    ])
    const originalLedger: LedgerFact[] = []
    const onProjectChange = vi.fn()
    const onLedgerChange = vi.fn()

    render(
      <CastPanel
        project={originalProject}
        ledger={originalLedger}
        onProjectChange={onProjectChange}
        onLedgerChange={onLedgerChange}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('cast-merge-char-a'))
    await user.click(screen.getByRole('button', { name: 'Merge' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'cannot merge a locked character',
      )
    })
    expect(onProjectChange).toHaveBeenLastCalledWith(originalProject)
    expect(onLedgerChange).toHaveBeenLastCalledWith(originalLedger)
  })

  it('deletes an unreferenced character optimistically', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteCharacter).mockResolvedValue(undefined)
    const onProjectChange = vi.fn()

    render(
      <CastPanel
        project={project([character('char-a', 'Anna')])}
        ledger={[]}
        onProjectChange={onProjectChange}
        onLedgerChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('cast-delete-char-a'))
    await user.click(screen.getByTestId('cast-confirm-delete-char-a'))

    await waitFor(() =>
      expect(deleteCharacter).toHaveBeenCalledWith('proj-1', 'char-a', {
        expectedHeadSnapshotId: 'snap-1',
      }),
    )
    expect(onProjectChange).toHaveBeenCalledWith(
      expect.objectContaining({ seriesBible: { characters: [] } }),
    )
  })

  it('rolls back delete and shows reference counts on 409 VALIDATION', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteCharacter).mockRejectedValue(
      new ApiError(409, {
        code: 'VALIDATION',
        message: 'character is still referenced',
        details: { facts: 2, relationships: 1 },
      }),
    )
    const original = project([character('char-a', 'Anna')])
    const onProjectChange = vi.fn()

    render(
      <CastPanel
        project={original}
        ledger={[]}
        onProjectChange={onProjectChange}
        onLedgerChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('cast-delete-char-a'))
    await user.click(screen.getByTestId('cast-confirm-delete-char-a'))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Still referenced by 2 fact(s) and 1 relationship(s).',
      )
    })
    expect(onProjectChange).toHaveBeenLastCalledWith(original)
  })

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <CastPanel
        project={project([character('char-a', 'Anna')])}
        ledger={[]}
        onProjectChange={vi.fn()}
        onLedgerChange={vi.fn()}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByTestId('cast-panel-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
