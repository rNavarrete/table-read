import { useState } from 'react'
import { FORMAT_PRESETS, type FormatPresetId } from './FormatPresets'
import { IdeaWizard } from './IdeaWizard'
import { WizardShell } from './WizardShell'
import { loadDraft, saveDraft } from './wizardDraft'

const IMPORT_PATH = '/projects/new/import'

interface ImportDraft {
  source: string
  title: string
  presetId: FormatPresetId
}

function presetSummary(presetId: FormatPresetId): string {
  const preset = FORMAT_PRESETS[presetId]
  return `${preset.genre}, ${preset.runtimeMinutes} min, ${preset.actCount} acts`
}

function useWizardDraft<T>(path: string, initialDraft: T) {
  const [draft, setDraft] = useState<T>(
    () => loadDraft<T>(path) ?? initialDraft,
  )

  function updateDraft(nextDraft: T) {
    setDraft(nextDraft)
    saveDraft(path, nextDraft)
  }

  return [draft, updateDraft] as const
}

export function IdeaWizardRoute() {
  return <IdeaWizard />
}

export function ImportWizardRoute() {
  const [draft, setDraft] = useWizardDraft<ImportDraft>(IMPORT_PATH, {
    source: '',
    title: '',
    presetId: 'one-hour-drama',
  })

  return (
    <WizardShell
      title="Import a script"
      hasEnteredData={Boolean(draft.source || draft.title)}
      steps={[
        {
          id: 'source',
          label: 'Add script',
          title: 'Add the script',
          body: (
            <label className="text-13 font-medium text-tr-text-primary">
              Paste script text
              <textarea
                value={draft.source}
                onChange={(event) =>
                  setDraft({ ...draft, source: event.target.value })
                }
                className="mt-1 block min-h-40 w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
              />
            </label>
          ),
        },
        {
          id: 'basics',
          label: 'Confirm basics',
          title: 'Confirm basics',
          body: (
            <div className="grid gap-4">
              <label className="text-13 font-medium text-tr-text-primary">
                Title
                <input
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                  className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                />
              </label>
              <p>{presetSummary(draft.presetId)}</p>
            </div>
          ),
        },
        {
          id: 'review',
          label: 'Review source',
          title: 'Review source',
          body: (
            <p>Source review and explicit analysis trigger land in Task 5.</p>
          ),
        },
        {
          id: 'analyze',
          label: 'Analyze',
          title: 'Analyze',
          body: <p>Import progress stages are implemented in Task 5.</p>,
        },
      ]}
    />
  )
}
