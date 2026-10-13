// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Episode, Project } from 'contract'
import { EpisodePanel, type EpisodePanelProps } from './EpisodePanel'
import { WithDrafts } from './testDrafts'

afterEach(cleanup)

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: 'Episode premise text.',
    seasonFunction: '',
    storylines: [],
    scenes: [],
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads: [],
    secrets: [],
    storyOverview: null,
    narrativeMap: null,
    structureChecks: [],
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
      characters: [],
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

function props(overrides: Partial<EpisodePanelProps> = {}): EpisodePanelProps {
  const ep = overrides.episode ?? episode()
  return {
    project: project(ep),
    episode: ep,
    pending: false,
    openingReview: false,
    onSaveEpisodePremise: vi.fn().mockResolvedValue(true),
    onSaveSeriesPremise: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('EpisodePanel', () => {
  it('shows the episode title and both premises in the inspector aside', () => {
    render(<EpisodePanel {...props()} />, { wrapper: WithDrafts })
    expect(screen.getByTestId('inspector').className).toContain('w-panel-plan')
    expect(screen.getByText('Episode 1: Last Call')).not.toBeNull()
    expect(screen.getByDisplayValue('Episode premise text.')).not.toBeNull()
    expect(screen.getByDisplayValue('Series premise text.')).not.toBeNull()
  })

  it('a premise edit is structural: Save field only saves, Open Review stays disabled', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<EpisodePanel {...p} />, { wrapper: WithDrafts })
    await user.type(screen.getByLabelText('Series premise'), ' More.')
    expect(
      (screen.getByRole('button', { name: 'Open Review' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Save field only' }))
    expect(p.onSaveSeriesPremise).toHaveBeenCalledWith(
      'Series premise text. More.',
    )
  })

  it('a locked episode makes its premise read-only, not the series premise', () => {
    render(
      <EpisodePanel {...props({ episode: episode({ locked: true }) })} />,
      {
        wrapper: WithDrafts,
      },
    )
    expect(
      (screen.getByLabelText('Episode premise') as HTMLTextAreaElement)
        .readOnly,
    ).toBe(true)
    expect(
      (screen.getByLabelText('Series premise') as HTMLTextAreaElement).readOnly,
    ).toBe(false)
  })
})
