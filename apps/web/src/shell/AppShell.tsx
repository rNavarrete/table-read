import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SnapshotSummary } from 'contract'
import {
  exportFountain,
  listProjectSnapshots,
  restoreProject,
  undoProject,
} from '../api/client'
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

function formatSnapshotAge(value: string): string {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return 'recently'
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/**
 * The app shell (UI spec §2): a 52px top bar (project title, mode switcher,
 * undo/export/settings) over the mode content. Settings opens the privacy
 * panel (T6.3). Undo / Export call the real API when `projectId` is set.
 * Undo history dropdown lists ~20 ancestors (adoption A5).
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
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [history, setHistory] = useState<SnapshotSummary[] | null>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  // Read session stash during render (no effect): create navigates away, and
  // Review mutations re-render this shell as the parent of ReviewScreen.
  const draftDot = projectId ? hasDraftChangeSet(projectId) : false
  const undoEnabled = Boolean(projectId) && canUndo && !busy

  useEffect(() => {
    if (!historyOpen) return
    function onPointerDown(event: PointerEvent) {
      if (
        historyRef.current &&
        !historyRef.current.contains(event.target as Node)
      ) {
        setHistoryOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [historyOpen])

  async function openHistory() {
    if (!projectId || busy || !canUndo) return
    if (historyOpen) {
      setHistoryOpen(false)
      return
    }
    setHistoryOpen(true)
    setHistoryLoading(true)
    setHistory(null)
    try {
      const entries = await listProjectSnapshots(projectId)
      setHistory(entries)
    } catch (err) {
      setHistoryOpen(false)
      setToast(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not load undo history',
      )
    } finally {
      setHistoryLoading(false)
    }
  }

  async function handleUndo() {
    if (!projectId || busy) return
    setBusy(true)
    setHistoryOpen(false)
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

  async function handleRestore(snapshotId: string) {
    if (!projectId || busy) return
    setBusy(true)
    setHistoryOpen(false)
    try {
      await restoreProject(projectId, snapshotId)
      window.location.reload()
    } catch (err) {
      setToast(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Restore failed',
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

  const exportEnabled = Boolean(projectId) && !busy

  return (
    <div className="min-h-screen bg-tr-surface-page">
      <header className="relative z-[5] flex h-shell-height items-center gap-6 border-b border-tr-border bg-tr-surface-raised px-6">
        {projectId ? (
          <a
            href="/projects"
            className="font-script text-[14px] font-medium text-tr-text-primary"
          >
            {projectTitle}
          </a>
        ) : (
          <h1 className="font-script text-[14px] font-medium text-tr-text-primary">
            {projectTitle}
          </h1>
        )}
        <ModeSwitcher
          active={activeMode}
          ledgerCount={ledgerCount}
          hasDraftChangeSet={draftDot}
        />
        <div className="ml-auto flex items-center gap-4 text-13 text-tr-text-muted">
          <div ref={historyRef} className="relative flex items-center">
            <button
              type="button"
              disabled={!undoEnabled}
              data-testid="undo-button"
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
              disabled={!undoEnabled}
              data-testid="undo-history"
              aria-expanded={historyOpen}
              aria-haspopup="listbox"
              title={undoEnabled ? 'Undo history' : 'Nothing to undo'}
              onClick={() => void openHistory()}
              className={
                (undoEnabled
                  ? 'ml-1 text-tr-text-muted hover:text-tr-text-secondary'
                  : 'ml-1 cursor-not-allowed opacity-50') + ' px-0.5'
              }
            >
              ▾
            </button>
            {historyOpen && (
              <div
                role="listbox"
                aria-label="Undo history"
                className="absolute right-0 top-full z-40 mt-2 max-h-80 w-72 overflow-y-auto rounded-card border border-tr-border bg-tr-surface-raised py-1 shadow-lift"
              >
                {historyLoading && (
                  <p className="px-3 py-2 text-13 text-tr-text-muted">
                    Loading…
                  </p>
                )}
                {!historyLoading && history && history.length === 0 && (
                  <p className="px-3 py-2 text-13 text-tr-text-muted">
                    No earlier versions
                  </p>
                )}
                {!historyLoading &&
                  history?.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
                      className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-tr-surface-clay"
                      onClick={() => void handleRestore(entry.id)}
                    >
                      <span className="truncate text-13 text-tr-text-primary">
                        {entry.instruction}
                      </span>
                      <span className="text-13 text-tr-text-muted">
                        {formatSnapshotAge(entry.ts)}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
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
