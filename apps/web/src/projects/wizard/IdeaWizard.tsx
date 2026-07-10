import { useState } from 'react'
import type { CharacterSeed, ProjectCreateRequest } from 'contract'
import { createProject } from '../../api/client'
import {
  FORMAT_PRESET_LABELS,
  FORMAT_PRESETS,
  type FormatPresetId,
} from './FormatPresets'
import { WizardShell } from './WizardShell'
import { clearDraft, loadDraft, saveDraft } from './wizardDraft'

const IDEA_PATH = '/projects/new/idea'

interface CharacterSeedDraft {
  name: string
  traits: string
}

interface IdeaDraft {
  idempotencyKey: string
  title: string
  premise: string
  presetId: FormatPresetId
  characters: CharacterSeedDraft[]
  existentialQuestion: string
  storiesToAvoidText: string
}

function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

function initialDraft(): IdeaDraft {
  return {
    idempotencyKey: newIdempotencyKey(),
    title: '',
    premise: '',
    presetId: 'one-hour-drama',
    characters: [{ name: '', traits: '' }],
    existentialQuestion: '',
    storiesToAvoidText: '',
  }
}

function normalizeDraft(draft: Partial<IdeaDraft> | null): IdeaDraft {
  return {
    ...initialDraft(),
    ...draft,
    idempotencyKey: draft?.idempotencyKey || newIdempotencyKey(),
    characters:
      draft?.characters && draft.characters.length > 0
        ? draft.characters
        : [{ name: '', traits: '' }],
  }
}

function presetSummary(presetId: FormatPresetId): string {
  const preset = FORMAT_PRESETS[presetId]
  return `${preset.genre}, ${preset.runtimeMinutes} min, ${preset.actCount} acts`
}

function hasEnteredData(draft: IdeaDraft): boolean {
  return Boolean(
    draft.title ||
    draft.premise ||
    draft.existentialQuestion ||
    draft.storiesToAvoidText ||
    draft.characters.some((character) => character.name || character.traits),
  )
}

function characterSeeds(characters: CharacterSeedDraft[]): CharacterSeed[] {
  return characters
    .map((character) => ({
      name: character.name.trim(),
      traits: character.traits.trim(),
    }))
    .filter((character) => character.name)
    .map((character) =>
      character.traits
        ? { name: character.name, traits: character.traits }
        : { name: character.name },
    )
}

function storiesToAvoid(text: string): string[] {
  return text
    .split('\n')
    .map((story) => story.trim())
    .filter(Boolean)
}

function projectCreateBody(draft: IdeaDraft): ProjectCreateRequest {
  const foundation = {
    existentialQuestion: draft.existentialQuestion.trim() || undefined,
    storiesToAvoid: storiesToAvoid(draft.storiesToAvoidText),
    characters: characterSeeds(draft.characters),
  }
  const hasFoundation =
    foundation.existentialQuestion ||
    foundation.storiesToAvoid.length > 0 ||
    foundation.characters.length > 0

  return {
    title: draft.title.trim(),
    premise: draft.premise.trim(),
    format: FORMAT_PRESETS[draft.presetId],
    ...(hasFoundation ? { foundation } : {}),
  }
}

export function IdeaWizard() {
  const [draft, setDraft] = useState<IdeaDraft>(() =>
    normalizeDraft(loadDraft<Partial<IdeaDraft>>(IDEA_PATH)),
  )
  const [basicsTouched, setBasicsTouched] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateDraft(nextDraft: IdeaDraft) {
    setDraft(nextDraft)
    saveDraft(IDEA_PATH, nextDraft)
  }

  function updateCharacter(index: number, patch: Partial<CharacterSeedDraft>) {
    updateDraft({
      ...draft,
      characters: draft.characters.map((character, characterIndex) =>
        characterIndex === index ? { ...character, ...patch } : character,
      ),
    })
  }

  function validateBasics(): boolean {
    setBasicsTouched(true)
    return Boolean(draft.title.trim() && draft.premise.trim())
  }

  async function handleCreate() {
    if (isCreating) return
    setIsCreating(true)
    setError(null)
    try {
      const project = await createProject(projectCreateBody(draft), {
        idempotencyKey: draft.idempotencyKey,
      })
      clearDraft(IDEA_PATH)
      window.location.assign(`/plan?project=${encodeURIComponent(project.id)}`)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not create project.',
      )
      setIsCreating(false)
    }
  }

  return (
    <WizardShell
      title="Start from an idea"
      hasEnteredData={hasEnteredData(draft)}
      finalActionLabel={isCreating ? 'Creating...' : 'Create project'}
      isFinalActionDisabled={isCreating}
      onFinalAction={handleCreate}
      steps={[
        {
          id: 'basics',
          label: 'Project basics',
          title: 'Project basics',
          validate: validateBasics,
          body: (
            <div className="grid gap-4">
              <label className="text-13 font-medium text-tr-text-primary">
                Title
                <input
                  value={draft.title}
                  aria-invalid={basicsTouched && !draft.title.trim()}
                  onChange={(event) =>
                    updateDraft({ ...draft, title: event.target.value })
                  }
                  className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                />
              </label>
              <label className="text-13 font-medium text-tr-text-primary">
                Premise
                <textarea
                  value={draft.premise}
                  aria-invalid={basicsTouched && !draft.premise.trim()}
                  onChange={(event) =>
                    updateDraft({ ...draft, premise: event.target.value })
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
                      updateDraft({
                        ...draft,
                        presetId: presetId as FormatPresetId,
                      })
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
          body: (
            <div className="grid gap-5">
              <div className="grid gap-3">
                {draft.characters.map((character, index) => (
                  <div key={index} className="grid gap-3 sm:grid-cols-2">
                    <label className="text-13 font-medium text-tr-text-primary">
                      Character name {index + 1}
                      <input
                        value={character.name}
                        onChange={(event) =>
                          updateCharacter(index, { name: event.target.value })
                        }
                        className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                      />
                    </label>
                    <label className="text-13 font-medium text-tr-text-primary">
                      Character traits {index + 1}
                      <input
                        value={character.traits}
                        onChange={(event) =>
                          updateCharacter(index, { traits: event.target.value })
                        }
                        className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                      />
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    updateDraft({
                      ...draft,
                      characters: [
                        ...draft.characters,
                        { name: '', traits: '' },
                      ],
                    })
                  }
                  className="justify-self-start rounded-card border border-tr-border px-3 py-2 text-13 font-medium text-tr-text-secondary hover:border-tr-border-strong hover:text-tr-text-primary"
                >
                  Add character
                </button>
              </div>
              <label className="text-13 font-medium text-tr-text-primary">
                Existential question
                <input
                  value={draft.existentialQuestion}
                  onChange={(event) =>
                    updateDraft({
                      ...draft,
                      existentialQuestion: event.target.value,
                    })
                  }
                  className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                />
              </label>
              <label className="text-13 font-medium text-tr-text-primary">
                Stories to avoid
                <textarea
                  value={draft.storiesToAvoidText}
                  onChange={(event) =>
                    updateDraft({
                      ...draft,
                      storiesToAvoidText: event.target.value,
                    })
                  }
                  className="mt-1 block min-h-24 w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                />
              </label>
            </div>
          ),
        },
        {
          id: 'review',
          label: 'Review',
          title: 'Review and create',
          body: (
            <div className="grid gap-3">
              <p>
                {draft.title.trim() || 'Untitled project'} ·{' '}
                {presetSummary(draft.presetId)}
              </p>
              <p>{draft.premise.trim() || 'No premise entered yet.'}</p>
              <p>
                {characterSeeds(draft.characters).length} initial character
                {characterSeeds(draft.characters).length === 1 ? '' : 's'}
              </p>
              <p>No AI runs when you create this project.</p>
              {error && <p className="text-tr-danger">{error}</p>}
            </div>
          ),
        },
      ]}
    />
  )
}
