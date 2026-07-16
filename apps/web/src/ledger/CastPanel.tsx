import { useState } from 'react'
import type { Character, LedgerFact, Project } from 'contract'
import {
  deleteCharacter,
  mergeCharacterInto,
  renameCharacter,
} from '../api/client'
import { ApiError } from '../api/errors'
import { Card } from '../plan/Card'
import { Chip } from '../plan/Chip'

export interface CastPanelProps {
  project: Project
  ledger: LedgerFact[]
  onProjectChange: (next: Project) => void
  onLedgerChange: (next: LedgerFact[]) => void
  onClose: () => void
}

type RowMenu = { characterId: string; action: 'rename' | 'merge' | 'delete' }

function withCharacters(project: Project, characters: Character[]): Project {
  return {
    ...project,
    seriesBible: { ...project.seriesBible, characters },
  }
}

/**
 * Cast review surface (data contract §4 Cast management, T7.16): rename,
 * merge, and delete characters from the Ledger's PEOPLE rail. Server is the
 * source of truth — every action applies optimistically and rolls back the
 * project/ledger state on a 4xx/5xx response (UI spec §1 optimistic-update
 * convention).
 */
export function CastPanel({
  project,
  ledger,
  onProjectChange,
  onLedgerChange,
  onClose,
}: CastPanelProps) {
  const characters = project.seriesBible.characters
  const [menu, setMenu] = useState<RowMenu | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameAliases, setRenameAliases] = useState('')
  const [mergeTargetId, setMergeTargetId] = useState('')

  function openMenu(character: Character, action: RowMenu['action']) {
    setError(null)
    setMenu({ characterId: character.id, action })
    if (action === 'rename') {
      setRenameName(character.name)
      setRenameAliases(character.aliases.join(', '))
    }
    if (action === 'merge') {
      setMergeTargetId(characters.find((c) => c.id !== character.id)?.id ?? '')
    }
  }

  function closeMenu() {
    setMenu(null)
    setError(null)
  }

  async function handleRename(characterId: string) {
    if (busy) return
    const before = characters
    const name = renameName.trim()
    const aliases = renameAliases
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
    if (!name) return

    setBusy(true)
    setError(null)
    onProjectChange(
      withCharacters(
        project,
        before.map((c) => (c.id === characterId ? { ...c, name, aliases } : c)),
      ),
    )
    try {
      await renameCharacter(
        project.id,
        characterId,
        { name, aliases },
        {
          expectedHeadSnapshotId: project.headSnapshotId,
        },
      )
      setMenu(null)
    } catch (err) {
      onProjectChange(withCharacters(project, before))
      setError(
        err instanceof ApiError ? err.message : 'Failed to rename character.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleMerge(characterId: string) {
    if (busy || !mergeTargetId) return
    const beforeProject = project
    const beforeLedger = ledger
    const source = characters.find((c) => c.id === characterId)
    const target = characters.find((c) => c.id === mergeTargetId)
    if (!source || !target) return

    setBusy(true)
    setError(null)
    onProjectChange(
      withCharacters(
        project,
        characters
          .filter((c) => c.id !== characterId)
          .map((c) =>
            c.id === mergeTargetId
              ? {
                  ...c,
                  aliases: Array.from(
                    new Set([...c.aliases, ...source.aliases, source.name]),
                  ).filter((a) => a !== c.name),
                }
              : c,
          ),
      ),
    )
    try {
      const result = await mergeCharacterInto(
        project.id,
        characterId,
        mergeTargetId,
        { expectedHeadSnapshotId: project.headSnapshotId },
      )
      onProjectChange(result.project)
      onLedgerChange(result.ledger)
      setMenu(null)
    } catch (err) {
      onProjectChange(beforeProject)
      onLedgerChange(beforeLedger)
      setError(
        err instanceof ApiError ? err.message : 'Failed to merge character.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(characterId: string) {
    if (busy) return
    const before = characters

    setBusy(true)
    setError(null)
    onProjectChange(
      withCharacters(
        project,
        before.filter((c) => c.id !== characterId),
      ),
    )
    try {
      await deleteCharacter(project.id, characterId, {
        expectedHeadSnapshotId: project.headSnapshotId,
      })
      setMenu(null)
    } catch (err) {
      onProjectChange(withCharacters(project, before))
      if (err instanceof ApiError && err.code === 'VALIDATION') {
        const counts = err.details as
          { facts?: number; relationships?: number } | undefined
        setError(
          `Still referenced by ${counts?.facts ?? 0} fact(s) and ${
            counts?.relationships ?? 0
          } relationship(s).`,
        )
      } else {
        setError(
          err instanceof ApiError ? err.message : 'Failed to delete character.',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      variant="raised"
      className="flex flex-col gap-3"
      aria-label="Manage cast"
      data-testid="cast-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-15 text-tr-text-primary">Manage cast</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-card px-2 py-1 text-13 text-tr-text-muted"
          data-testid="cast-panel-close"
        >
          Close
        </button>
      </div>
      {error && (
        <p className="text-13 text-tr-danger" role="alert">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {characters.map((character) => (
          <li
            key={character.id}
            className="flex flex-col gap-2 rounded-card border border-tr-border p-3"
            data-testid={`cast-row-${character.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-15 text-tr-text-primary">
                  {character.name}
                </span>
                {character.locked && <Chip hue="amber">locked</Chip>}
                {character.aliases.map((alias) => (
                  <Chip key={alias} hue="neutral">
                    {alias}
                  </Chip>
                ))}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openMenu(character, 'rename')}
                  className="rounded-card px-2 py-0.5 text-12 text-tr-text-secondary disabled:opacity-50"
                  data-testid={`cast-rename-${character.id}`}
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={busy || characters.length < 2}
                  onClick={() => openMenu(character, 'merge')}
                  className="rounded-card px-2 py-0.5 text-12 text-tr-text-secondary disabled:opacity-50"
                  data-testid={`cast-merge-${character.id}`}
                >
                  Merge into…
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openMenu(character, 'delete')}
                  className="rounded-card px-2 py-0.5 text-12 text-tr-danger disabled:opacity-50"
                  data-testid={`cast-delete-${character.id}`}
                >
                  Delete
                </button>
              </div>
            </div>

            {menu?.characterId === character.id && menu.action === 'rename' && (
              <div
                className="flex flex-col gap-2 rounded-card bg-tr-surface-sunken p-2"
                data-testid={`cast-rename-form-${character.id}`}
              >
                <label className="flex flex-col gap-1 text-12 text-tr-text-muted">
                  Name
                  <input
                    className="rounded-card border border-tr-border bg-tr-surface-page p-1.5 text-13 text-tr-text-primary"
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-12 text-tr-text-muted">
                  Aliases (comma-separated)
                  <input
                    className="rounded-card border border-tr-border bg-tr-surface-page p-1.5 text-13 text-tr-text-primary"
                    value={renameAliases}
                    onChange={(e) => setRenameAliases(e.target.value)}
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !renameName.trim()}
                    onClick={() => handleRename(character.id)}
                    className="rounded-card bg-tr-sage-soft px-3 py-1 text-13 text-tr-text-primary disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closeMenu}
                    className="rounded-card px-3 py-1 text-13 text-tr-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {menu?.characterId === character.id && menu.action === 'merge' && (
              <div
                className="flex flex-col gap-2 rounded-card bg-tr-surface-sunken p-2"
                data-testid={`cast-merge-form-${character.id}`}
              >
                <label className="flex flex-col gap-1 text-12 text-tr-text-muted">
                  Merge into
                  <select
                    className="rounded-card border border-tr-border bg-tr-surface-page p-1.5 text-13 text-tr-text-primary"
                    value={mergeTargetId}
                    onChange={(e) => setMergeTargetId(e.target.value)}
                  >
                    {characters
                      .filter((c) => c.id !== character.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !mergeTargetId}
                    onClick={() => handleMerge(character.id)}
                    className="rounded-card bg-tr-sage-soft px-3 py-1 text-13 text-tr-text-primary disabled:opacity-50"
                  >
                    Merge
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closeMenu}
                    className="rounded-card px-3 py-1 text-13 text-tr-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {menu?.characterId === character.id && menu.action === 'delete' && (
              <div
                className="flex flex-col gap-2 rounded-card bg-tr-surface-sunken p-2"
                data-testid={`cast-delete-form-${character.id}`}
              >
                <p className="text-13 text-tr-text-primary">
                  Delete {character.name}? This can&apos;t be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDelete(character.id)}
                    className="rounded-card bg-tr-danger px-3 py-1 text-13 font-medium text-tr-surface-raised disabled:opacity-50"
                    data-testid={`cast-confirm-delete-${character.id}`}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closeMenu}
                    className="rounded-card px-3 py-1 text-13 text-tr-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
