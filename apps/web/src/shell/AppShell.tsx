import { useEffect, useState, type ReactNode } from 'react'
import { exportFountain, undoProject } from '../api/client'
import { ApiError } from '../api/errors'
import { hasDraftChangeSet } from '../review/changeSetSession'
import { ModeSwitcher, type Mode } from './ModeSwitcher'
import { navigateToMode } from './modeNavigation'
import { SettingsPanel } from './SettingsPanel'
import { Toast } from './Toast'

export interface AppShellProps {
  projectTitle: string
  activeMode: Mode
  ledgerCount: number
  /** Project id for the Review amber-dot (draft Change Set). Optional —
   * when omitted the dot stays off. Required for Undo / Export. */
  projectId?: string
  /**
   * Optional override for Undo (e.g. Review "Undo all" after apply). When
   * omitted, Undo calls `POST /projects/{pid}/undo` and reloads so every
   * mode picks up the restored head.
   */
  onUndo?: () => void | Promise<void>
  /** When false, Undo stays disabled (e.g. at root snapshot). Default true
   * when `projectId` is set. */
  canUndo?: boolean
  children: ReactNode
}

const SHORTCUT_MODES: Record<string, Mode> = {
  '1': 'Write',
  '2': 'Plan',
  '3': 'Review',
  '4': 'Ledger',
}

/** UI spec §2: "Keyboard: ⌘1–4 switch modes." Mounted once here (the shell
 * every mode screen renders), not per-mode. All four modes navigate. */
function useModeShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.metaKey) return
      const mode = SHORTCUT_MODES[event.key]
      if (!mode) return
      event.preventDefault()
      navigateToMode(mode)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}

/**
 * The app shell (UI spec §2): a 52px top bar (project title, mode switcher,
 * undo/export/settings) over the mode content. Settings opens the privacy
 * panel (T6.3). Undo / Export call the real API when `projectId` is set.
 */
export function AppShell({
  projectTitle,
  activeMode,
  ledgerCount,
  projectId,
  onUndo,
  canUndo = true,
  children,
}: AppShellProps) {
  useModeShortcuts()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // Read session stash during render (no effect): create navigates away, and
  // Review mutations re-render this shell as the parent of ReviewScreen.
  const draftDot = projectId ? hasDraftChangeSet(projectId) : false
  const undoEnabled = Boolean(projectId) && canUndo && !busy
  const exportEnabled = Boolean(projectId) && !busy

  async function handleUndo() {
    if (!projectId || busy) return
    setBusy(true)
    try {
      if (onUndo) {
        await onUndo()
      } else {
        // No in-shell head cache — omit If-Match; server still CAS-guards
        // against the observed head so concurrent undos cannot both win.
        await undoProject(projectId)
        // Full reload so every mode re-fetches the restored head (no shared
        // project store across Write/Plan/Review/Ledger yet).
        window.location.reload()
      }
    } catch (err) {
      setToast(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Undo failed',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleExport() {
    if (!projectId || busy) return
    setBusy(true)
    try {
      const text = await exportFountain(projectId)
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${projectTitle.replace(/[^\w.-]+/g, '_') || 'script'}.fountain`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-tr-surface-page">
      <header className="flex h-shell-height items-center gap-6 bg-tr-surface-sunken px-6">
        {projectId ? (
          <a
            href="/projects"
            className="font-display text-17 font-semibold text-tr-text-primary"
          >
            {projectTitle}
          </a>
        ) : (
          <h1 className="font-display text-17 font-semibold text-tr-text-primary">
            {projectTitle}
          </h1>
        )}
        <ModeSwitcher
          active={activeMode}
          ledgerCount={ledgerCount}
          hasDraftChangeSet={draftDot}
        />
        <div className="ml-auto flex items-center gap-4 text-13 text-tr-text-muted">
          <button
            type="button"
            disabled={!undoEnabled}
            title={
              !projectId
                ? 'Undo (no project loaded)'
                : !canUndo
                  ? 'Nothing to undo'
                  : 'Undo last change'
            }
            onClick={() => void handleUndo()}
            className={
              undoEnabled
                ? 'text-tr-text-muted hover:text-tr-text-secondary'
                : 'cursor-not-allowed opacity-50'
            }
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!exportEnabled}
            title={
              exportEnabled ? 'Export Fountain' : 'Export (no project loaded)'
            }
            onClick={() => void handleExport()}
            className={
              exportEnabled
                ? 'text-tr-text-muted hover:text-tr-text-secondary'
                : 'cursor-not-allowed opacity-50'
            }
          >
            Export
          </button>
          <button
            type="button"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            className="text-tr-text-muted hover:text-tr-text-secondary"
          >
            Settings
          </button>
        </div>
      </header>
      <main>{children}</main>
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projectId={projectId}
        projectTitle={projectTitle}
      />
      {toast && (
        <Toast tone="danger" onDismiss={() => setToast(null)}>
          {toast}
        </Toast>
      )}
    </div>
  )
}
