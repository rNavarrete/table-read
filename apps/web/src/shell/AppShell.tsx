import { useEffect, useState, type ReactNode } from 'react'
import { hasDraftChangeSet } from '../review/changeSetSession'
import { ModeSwitcher, type Mode } from './ModeSwitcher'
import { navigateToMode } from './modeNavigation'
import { SettingsPanel } from './SettingsPanel'

export interface AppShellProps {
  projectTitle: string
  activeMode: Mode
  ledgerCount: number
  /** Project id for the Review amber-dot (draft Change Set). Optional —
   * when omitted the dot stays off. */
  projectId?: string
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
 * The app shell (UI spec §2): a 56px top bar (project title, mode switcher,
 * undo/export/settings) over the mode content. Undo/export remain stubs;
 * Settings opens the privacy panel (T6.3).
 */
export function AppShell({
  projectTitle,
  activeMode,
  ledgerCount,
  projectId,
  children,
}: AppShellProps) {
  useModeShortcuts()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Read session stash during render (no effect): create navigates away, and
  // Review mutations re-render this shell as the parent of ReviewScreen.
  const draftDot = projectId ? hasDraftChangeSet(projectId) : false

  return (
    <div className="min-h-screen bg-tr-surface-page">
      <header className="flex h-14 items-center gap-6 bg-tr-surface-sunken px-6">
        <h1 className="font-display text-17 text-tr-text-primary">
          {projectTitle}
        </h1>
        <ModeSwitcher
          active={activeMode}
          ledgerCount={ledgerCount}
          hasDraftChangeSet={draftDot}
        />
        <div className="ml-auto flex items-center gap-4 text-13 text-tr-text-muted">
          <button
            type="button"
            disabled
            title="Undo (not wired yet)"
            className="cursor-not-allowed"
          >
            Undo
          </button>
          <button
            type="button"
            disabled
            title="Export (not built yet)"
            className="cursor-not-allowed"
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
      />
    </div>
  )
}
