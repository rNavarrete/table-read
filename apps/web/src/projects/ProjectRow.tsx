import { useState } from 'react'
import type { ProjectSummary } from 'contract'
import { deleteProject, exportFountain, patchProject } from '../api/client'
import { projectModeHref } from './projectRouting'
import { rowStatus } from './dashboardStatus'

function formatStatus(project: ProjectSummary): string {
  const status = rowStatus(project)
  if (status === 'facts') {
    return `${project.pendingReviewCount} ${
      project.pendingReviewCount === 1 ? 'fact' : 'facts'
    } to review`
  }
  if (status === 'setup') return 'Continue setup'
  return 'Ready to write'
}

function formatMetadata(project: ProjectSummary): string {
  const genre =
    project.format.genre.charAt(0).toUpperCase() + project.format.genre.slice(1)
  return `${genre} · ${project.format.runtimeMinutes} min · ${project.format.actCount} acts`
}

function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return 'Last edited recently'
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 1) return 'Last edited just now'
  if (minutes < 60) return `Last edited ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Last edited ${hours}h ago`
  const days = Math.round(hours / 24)
  return `Last edited ${days}d ago`
}

function triggerDownload(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

type Dialog = 'none' | 'rename' | 'delete'

export interface ProjectRowProps {
  project: ProjectSummary
  onDeleted?: (projectId: string) => void
  onRenamed?: (projectId: string, title: string) => void
}

export function ProjectRow({ project, onDeleted, onRenamed }: ProjectRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>('none')
  const [confirmTitle, setConfirmTitle] = useState('')
  const [renameTitle, setRenameTitle] = useState(project.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function closeDialog() {
    setDialog('none')
    setConfirmTitle('')
    setRenameTitle(project.title)
    setError(null)
    setBusy(false)
  }

  async function handleExport() {
    setMenuOpen(false)
    try {
      const text = await exportFountain(project.id)
      triggerDownload(`${project.title}.fountain`, text)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not export project.',
      )
    }
  }

  async function handleRename() {
    if (busy) return
    const nextTitle = renameTitle.trim()
    if (!nextTitle || nextTitle === project.title) {
      closeDialog()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await patchProject(project.id, [
        { op: 'replace', path: '/title', value: nextTitle },
      ])
      onRenamed?.(project.id, nextTitle)
      closeDialog()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not rename project.',
      )
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (busy || confirmTitle !== project.title) return
    setBusy(true)
    setError(null)
    try {
      await deleteProject(project.id)
      onDeleted?.(project.id)
      // Row is unmounted by the parent on success; no further state needed.
    } catch (caught) {
      // Design spec §11: a failed purge leaves the project visible and
      // reports the error — keep the dialog open with the message.
      setError(
        caught instanceof Error ? caught.message : 'Could not delete project.',
      )
      setBusy(false)
    }
  }

  return (
    <li className="relative">
      <div className="flex items-center gap-4 rounded-card border border-tr-border bg-tr-surface-raised p-4 shadow-raised transition hover:border-tr-border-strong hover:shadow-lift motion-reduce:transition-none">
        <a
          href={projectModeHref(project.id)}
          className="flex min-w-0 flex-1 items-center gap-4"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-17 font-semibold text-tr-text-primary">
              {project.title}
            </p>
            <p className="mt-1 text-13 text-tr-text-secondary">
              {formatMetadata(project)}
            </p>
          </div>
          <div className="hidden text-right text-13 sm:block">
            <p className="font-medium text-tr-text-primary">
              {formatStatus(project)}
            </p>
            <p className="mt-1 text-tr-text-muted">
              {formatRelativeTime(project.updatedAt)}
            </p>
          </div>
        </a>
        <button
          type="button"
          aria-label={`Project actions for ${project.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="rounded-chip px-2 py-1 text-17 text-tr-text-muted hover:bg-tr-surface-clay hover:text-tr-text-primary"
          onClick={() => setMenuOpen((open) => !open)}
        >
          ...
        </button>
      </div>

      {menuOpen && (
        <div
          role="menu"
          aria-label={`${project.title} actions`}
          className="absolute right-2 top-14 z-10 w-48 rounded-card border border-tr-border bg-tr-surface-raised py-1 shadow-lift"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              setRenameTitle(project.title)
              setDialog('rename')
            }}
            className="block w-full px-4 py-2 text-left text-13 text-tr-text-primary hover:bg-tr-surface-clay"
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleExport()}
            className="block w-full px-4 py-2 text-left text-13 text-tr-text-primary hover:bg-tr-surface-clay"
          >
            Export Fountain
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              setConfirmTitle('')
              setDialog('delete')
            }}
            className="block w-full px-4 py-2 text-left text-13 text-tr-danger hover:bg-tr-surface-clay"
          >
            Permanently delete
          </button>
        </div>
      )}

      {dialog === 'rename' && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-tr-text-primary/40 px-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Rename ${project.title}`}
            className="w-full max-w-md rounded-card border border-tr-border bg-tr-surface-raised p-6 shadow-lift"
          >
            <h2 className="font-display text-17 font-semibold text-tr-text-primary">
              Rename project
            </h2>
            <label className="mt-4 block text-13 font-medium text-tr-text-primary">
              Title
              <input
                autoFocus
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                aria-label="New project title"
                className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
              />
            </label>
            {error && <p className="mt-3 text-13 text-tr-danger">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-card border border-tr-border px-3 py-1.5 text-13 font-medium text-tr-text-secondary hover:border-tr-border-strong hover:text-tr-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRename()}
                className="rounded-card bg-tr-coral px-3 py-1.5 text-13 font-medium text-tr-surface-raised transition hover:bg-tr-coral-hover disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === 'delete' && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-tr-text-primary/40 px-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Permanently delete ${project.title}`}
            className="w-full max-w-md rounded-card border border-tr-border bg-tr-surface-raised p-6 shadow-lift"
          >
            <h2 className="font-display text-17 font-semibold text-tr-text-primary">
              Permanently delete this project?
            </h2>
            <p className="mt-2 text-13 leading-6 text-tr-text-secondary">
              This purges the plan, script, ledger, and history for{' '}
              <span className="font-medium text-tr-text-primary">
                {project.title}
              </span>
              . There is no Trash — this cannot be undone.
            </p>
            <label className="mt-4 block text-13 font-medium text-tr-text-primary">
              Type the project title to confirm
              <input
                autoFocus
                value={confirmTitle}
                onChange={(event) => setConfirmTitle(event.target.value)}
                aria-label="Type the project title to confirm"
                className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-danger"
              />
            </label>
            {error && <p className="mt-3 text-13 text-tr-danger">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-card border border-tr-border px-3 py-1.5 text-13 font-medium text-tr-text-secondary hover:border-tr-border-strong hover:text-tr-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || confirmTitle !== project.title}
                onClick={() => void handleDelete()}
                className="rounded-card bg-tr-danger px-3 py-1.5 text-13 font-medium text-tr-surface-raised transition disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}
