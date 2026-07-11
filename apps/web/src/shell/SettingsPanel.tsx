/**
 * Settings overlay — privacy copy (T6.3) + JSON export (adoption A6).
 *
 * Product language follows prompt spec §8 / design doc §7.1: state that
 * writing is not used for training under standard API terms; do not claim
 * ZDR / zero-data-retention unless a ZDR agreement is executed.
 */

import { useState } from 'react'
import { exportProjectJson } from '../api/client'

export interface SettingsPanelProps {
  open: boolean
  onClose: () => void
  /** When set, Privacy section offers full JSON export (adoption A6). */
  projectId?: string | null
  projectTitle?: string
}

const PRIVACY_COPY =
  'Your writing is sent to the language model to generate suggestions. Under standard API terms, it is not used for training.'

export function SettingsPanel({
  open,
  onClose,
  projectId = null,
  projectTitle = 'project',
}: SettingsPanelProps) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  if (!open) return null

  async function handleExportJson() {
    if (!projectId) return
    setExporting(true)
    setExportError(null)
    try {
      const envelope = await exportProjectJson(projectId)
      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const safeName = projectTitle.replace(/[^\w\-]+/g, '_').slice(0, 64)
      anchor.href = url
      anchor.download = `${safeName || 'project'}.tableread.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-end bg-tr-text-primary/40"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-full w-full max-w-sm flex-col border-l border-tr-border bg-tr-surface-raised shadow-lift"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-tr-border px-6 py-4">
          <h2
            id="settings-title"
            className="font-display text-17 text-tr-text-primary"
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-13 text-tr-text-secondary"
            aria-label="Close settings"
          >
            Close
          </button>
        </header>
        <section className="flex flex-col gap-3 px-6 py-5">
          <h3 className="text-15 text-tr-text-primary">Privacy</h3>
          <p className="text-13 text-tr-text-secondary">{PRIVACY_COPY}</p>
          {projectId ? (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-13 text-tr-text-secondary">
                Download a full JSON copy of this project (plan, ledger,
                snapshots, Change Sets). This is the portable export promised in
                the privacy controls — not Fountain script text.
              </p>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleExportJson()}
                className="self-start rounded-card border border-tr-coral bg-transparent px-3 py-1.5 text-13 font-medium text-tr-coral transition hover:bg-tr-coral-soft disabled:opacity-50"
              >
                {exporting ? 'Exporting…' : 'Export project JSON'}
              </button>
              {exportError ? (
                <p className="text-13 text-tr-danger" role="alert">
                  {exportError}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </aside>
    </div>
  )
}
