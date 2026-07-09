/**
 * Settings overlay — privacy copy for T6.3.
 *
 * Product language follows prompt spec §8 / design doc §7.1: state that
 * writing is not used for training under standard API terms; do not claim
 * ZDR / zero-data-retention unless a ZDR agreement is executed.
 */

export interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

const PRIVACY_COPY =
  'Your writing is sent to the language model to generate suggestions. Under standard API terms, it is not used for training.'

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  if (!open) return null

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
        </section>
      </aside>
    </div>
  )
}
