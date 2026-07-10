import { useState } from 'react'
import { FORMAT_PRESET_LABELS, FORMAT_PRESETS, type FormatPresetId } from './FormatPresets'
import { WizardShell } from './WizardShell'
import { loadDraft, saveDraft } from './wizardDraft'

const IDEA_PATH = '/projects/new/idea'
const IMPORT_PATH = '/projects/new/import'

interface IdeaDraft {
  title: string
  premise: string
  presetId: FormatPresetId
}

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
  const [draft, setDraft] = useState<T>(() => loadDraft<T>(path) ?? initialDraft)

  function updateDraft(nextDraft: T) {
    setDraft(nextDraft)
    saveDraft(path, nextDraft)
  }

  return [draft, updateDraft] as const
}

export function IdeaWizardRoute() {
  const [draft, setDraft] = useWizardDraft<IdeaDraft>(IDEA_PATH, {
    title: '',
    premise: '',
    presetId: 'one-hour-drama',
  })

  return (
    <WizardShell
      title="Start from an idea"
      hasEnteredData={Boolean(draft.title || draft.premise)}
      steps={[
        {
          id: 'basics',
          label: 'Project basics',
          title: 'Project basics',
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
              <label className="text-13 font-medium text-tr-text-primary">
                Premise
                <textarea
                  value={draft.premise}
                  onChange={(event) =>
                    setDraft({ ...draft, premise: event.target.value })
                  }
                  className="mt-1 block min-h-28 w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                />
              </label>
            </div>
          ),
        },
        {
          id: 'format',
          label: 'Format',
          title: 'Format',
          body: (
            <div className="grid gap-3">
              {Object.keys(FORMAT_PRESETS).map((presetId) => (
                <label
                  key={presetId}
                  className="rounded-card border border-tr-border bg-tr-surface-page p-3 text-13 text-tr-text-primary"
                >
                  <input
                    type="radio"
                    name="idea-format-preset"
                    checked={draft.presetId === presetId}
                    onChange={() =>
                      setDraft({ ...draft, presetId: presetId as FormatPresetId })
                    }
                    className="mr-2"
                  />
                  {FORMAT_PRESET_LABELS[presetId as FormatPresetId]} ·{' '}
                  {presetSummary(presetId as FormatPresetId)}
                </label>
              ))}
            </div>
          ),
        },
        {
          id: 'foundation',
          label: 'Story foundation',
          title: 'Story foundation',
          body: <p>Characters, theme, and stories to avoid land in Task 4.</p>,
        },
        {
          id: 'review',
          label: 'Review',
          title: 'Review and create',
          body: <p>Project creation is wired in Task 4. No AI call starts here.</p>,
        },
      ]}
    />
  )
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
          body: <p>Source review and explicit analysis trigger land in Task 5.</p>,
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
