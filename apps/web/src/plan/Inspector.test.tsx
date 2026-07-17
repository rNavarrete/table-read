// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Episode, LedgerFact, Project, Scene } from 'contract'
import { Inspector } from './Inspector'

afterEach(cleanup)

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: 'Alone',
    whatHappens: 'Marta walks back in.',
    audienceLearns: 'Eight years away.',
    audienceFeels: 'Unease.',
    motivations: [
      {
        characterId: 'char-marta',
        objective: 'Come home',
        stakes: 'Everything',
        obstacle: 'Dan',
      },
    ],
    beats: [
      {
        id: 'beat-1-1',
        index: 0,
        locked: false,
        whatHappens: 'wh',
        audienceLearns: 'al',
        audienceFeels: 'af',
        scriptText: 'INT. BAR\n\nDAN\nHi.',
        scriptLocked: false,
      },
      {
        id: 'beat-1-2',
        index: 1,
        locked: true,
        whatHappens: 'locked wh',
        audienceLearns: 'locked al',
        audienceFeels: 'locked af',
        scriptText: 'Locked script.',
        scriptLocked: true,
      },
    ],
    ...overrides,
  }
}

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: 'Episode premise text.',
    seasonFunction: '',
    storylines: [],
    scenes: [scene()],
    ...overrides,
  }
}

function project(ep: Episode): Project {
  return {
    id: 'proj-longpour',
    title: 'The Long Pour',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: false,
      serialization: 0.8,
    },
    enabledComponents: [],
    premise: 'Series premise text.',
    seriesBible: {
      existentialQuestion: { text: '', locked: false },
      worldRules: [],
      storiesToAvoid: [],
      characters: [
        {
          id: 'char-marta',
          name: 'Marta Vega',
          locked: false,
          embodiment: '',
          presentation: '',
          hiding: '',
          traits: '',
          seriesArc: '',
        },
      ],
      relationships: [],
      audienceGoals: [],
      narratorGoals: [],
      worldQA: [],
    },
    seasons: [
      {
        id: 'season-1',
        index: 0,
        locked: false,
        seasonArc: '',
        characterArcs: [],
        episodes: [ep],
      },
    ],
    headSnapshotId: 'snap-root',
    defaultCraftLevel: 'standard',
  }
}

function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: 'fact-01',
    fact: 'Marta has been away for eight years',
    factType: 'state',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-1',
      beatId: 'beat-1-1',
      startLine: null,
      endLine: null,
      charStart: null,
      charEnd: null,
    },
    sourceText: '',
    knownBy: [],
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'writer_confirmed',
    confidence: 0.9,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
    ...overrides,
  }
}

const noop = () => {}

describe('Inspector', () => {
  it('nothing selected: shows the episode summary and the series premise', () => {
    const ep = episode()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={null}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    expect(screen.getByText(/Last Call/)).not.toBeNull()
    // Episode + series premise are structural, editable fields (textareas).
    expect(screen.getByDisplayValue('Episode premise text.')).not.toBeNull()
    expect(screen.getByDisplayValue('Series premise text.')).not.toBeNull()
  })

  it('scene selected: shows motivations (with resolved character name) and affected facts', () => {
    const ep = episode()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[
          fact({ id: 'fact-01' }),
          fact({
            id: 'fact-02',
            sourceSpan: { ...fact().sourceSpan, sceneId: 'scene-2' },
          }),
        ]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    expect(screen.getByText('Marta Vega')).not.toBeNull() // resolved from characterId
    expect(screen.getByText('Come home')).not.toBeNull()
    // Only the fact whose sourceSpan.sceneId is scene-1 shows up.
    expect(
      screen.getByText('Marta has been away for eight years'),
    ).not.toBeNull()
    expect(screen.queryByText(/fact-02/)).toBeNull()
  })

  it('locked scene selected: read-only banner shown, whatHappens is read-only', () => {
    const ep = episode({ scenes: [scene({ locked: true })] })
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    expect(screen.getByText('Locked — unlock to edit')).not.toBeNull()
    const textarea = screen.getByDisplayValue(
      'Marta walks back in.',
    ) as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)
    expect(
      (screen.getByRole('combobox', { name: 'Act' }) as HTMLSelectElement)
        .disabled,
    ).toBe(true)
  })

  it('disables the Act select when the containing episode is locked', () => {
    const ep = episode({ locked: true })
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )

    expect(
      (screen.getByRole('combobox', { name: 'Act' }) as HTMLSelectElement)
        .disabled,
    ).toBe(true)
  })

  it('disables the Act select while a scene patch is pending', () => {
    const ep = episode()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )

    expect(
      (screen.getByRole('combobox', { name: 'Act' }) as HTMLSelectElement)
        .disabled,
    ).toBe(true)
  })

  it('saves a format-constrained act selection immediately', async () => {
    const user = userEvent.setup()
    const onSaveSceneField = vi.fn()
    const ep = episode()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={onSaveSceneField}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    const select = screen.getByRole('combobox', { name: 'Act' })
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['COLD OPEN', 'ACT ONE', 'ACT TWO', 'ACT THREE', 'ACT FOUR'])
    await user.selectOptions(select, '2')
    expect(onSaveSceneField).toHaveBeenCalledWith('scene-1', 'act', 2)
  })

  it('scene lock toggle calls onToggleSceneLock with the flipped value', async () => {
    const user = userEvent.setup()
    const ep = episode()
    const onToggleSceneLock = vi.fn()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending={false}
        onToggleSceneLock={onToggleSceneLock}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    await user.click(screen.getByRole('switch'))
    expect(onToggleSceneLock).toHaveBeenCalledWith('scene-1', true)
  })

  it('locked lock toggles render as accent pill switches without changing semantics', () => {
    const ep = episode({ scenes: [scene({ locked: true })] })
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.className).toContain('rounded-chip')
    expect(toggle.className).toContain('bg-tr-coral')
    expect(toggle.className).toContain('text-tr-surface-raised')
  })

  it('editing whatHappens (structural) shows the "Structural change" footer bar; Save field only calls back with field + draft', async () => {
    const user = userEvent.setup()
    const ep = episode()
    const onSaveSceneField = vi.fn()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={onSaveSceneField}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    expect(screen.queryByText('Structural change — review impact?')).toBeNull()

    const textarea = screen.getByDisplayValue('Marta walks back in.')
    await user.clear(textarea)
    await user.type(textarea, 'A rewritten summary.')

    expect(
      screen.getByText('Structural change — review impact?'),
    ).not.toBeNull()
    // Without onOpenReview the button stays disabled (episode/series premise
    // path); scene fields pass onOpenReview from PlanScreen.
    const openReview = screen.getByRole('button', {
      name: 'Open Review',
    }) as HTMLButtonElement
    expect(openReview.disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Save field only' }))
    expect(onSaveSceneField).toHaveBeenCalledWith(
      'scene-1',
      'whatHappens',
      'A rewritten summary.',
    )
  })

  it('Open Review calls onOpenReview with scene id and the dirty draft', async () => {
    const user = userEvent.setup()
    const ep = episode()
    const onOpenReview = vi.fn()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
        onOpenReview={onOpenReview}
      />,
    )
    const textarea = screen.getByDisplayValue('Marta walks back in.')
    await user.clear(textarea)
    await user.type(textarea, 'Marina rewrite.')
    await user.click(screen.getByRole('button', { name: 'Open Review' }))
    expect(onOpenReview).toHaveBeenCalledWith('scene-1', 'Marina rewrite.')
  })

  it('editing location (non-structural) is silent: a plain Save, no "Structural change" bar', async () => {
    const user = userEvent.setup()
    const ep = episode()
    const onSaveSceneField = vi.fn()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={onSaveSceneField}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    const input = screen.getByDisplayValue('INT. THE LONG POUR - NIGHT')
    await user.clear(input)
    await user.type(input, 'INT. MARINA - DAY')

    // Non-structural: a plain Save button, never the structural footer.
    expect(screen.queryByText('Structural change — review impact?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save field only' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSaveSceneField).toHaveBeenCalledWith(
      'scene-1',
      'location',
      'INT. MARINA - DAY',
    )
  })

  it('beat selected: shows beat fields and the scriptLocked toggle', () => {
    const ep = episode()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'beat', sceneId: 'scene-1', beatId: 'beat-1-2' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={noop}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    expect(screen.getByDisplayValue('locked wh')).not.toBeNull() // now an editable field, read-only when locked
    expect(screen.getByText('Locked — unlock to edit')).not.toBeNull() // scriptLocked → effectively locked
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('beat scriptLocked toggle calls onToggleBeatScriptLock with the flipped value', async () => {
    const user = userEvent.setup()
    const ep = episode()
    const onToggleBeatScriptLock = vi.fn()
    render(
      <Inspector
        project={project(ep)}
        episode={ep}
        ledger={[]}
        selection={{ type: 'beat', sceneId: 'scene-1', beatId: 'beat-1-1' }}
        pending={false}
        onToggleSceneLock={noop}
        onToggleBeatScriptLock={onToggleBeatScriptLock}
        onSaveSceneField={noop}
        onSaveBeatField={noop}
        onSaveProjectField={noop}
        onSaveEpisodeField={noop}
      />,
    )
    await user.click(screen.getByRole('switch'))
    expect(onToggleBeatScriptLock).toHaveBeenCalledWith(
      'scene-1',
      'beat-1-1',
      true,
    )
  })
})
