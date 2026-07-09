import type { ReactNode } from 'react'
import { ModeSwitcher, type Mode } from './ModeSwitcher'

export interface AppShellProps {
  projectTitle: string
  activeMode: Mode
  ledgerCount: number
  children: ReactNode
}

/**
 * The app shell (UI spec §2): a 56px top bar (project title, mode switcher,
 * undo/export/settings) over the mode content. Undo/export/settings are
 * stubs — obligation 2 scopes this task to "the minimal shell this task
 * needs," and none of the three has a wired destination yet (undo has no UI
 * task of its own in the build plan; export/settings are later milestones).
 */
export function AppShell({
  projectTitle,
  activeMode,
  ledgerCount,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-tr-surface-page">
      <header className="flex h-14 items-center gap-6 bg-tr-surface-sunken px-6">
        <h1 className="font-display text-17 text-tr-text-primary">
          {projectTitle}
        </h1>
        <ModeSwitcher active={activeMode} ledgerCount={ledgerCount} />
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
            disabled
            title="Settings (not built yet)"
            className="cursor-not-allowed"
          >
            Settings
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
