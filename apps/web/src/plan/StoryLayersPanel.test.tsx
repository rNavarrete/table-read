// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Episode, Project, Scene } from 'contract'
import { StoryLayersPanel } from './StoryLayersPanel'

afterEach(cleanup)

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: '',
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...overrides,
  }
}

function episode(scenes: Scene[]): Episode {
  return {
    id: 'ep-1',
    index: 0,
    locked: false,
    title: 'Last Call',
    premise: '',
    seasonFunction: '',
    storylines: [],
    scenes,
    timelineAnchors: [],
    relationshipStates: [],
    objectStates: [],
    threads: [],
    secrets: [],
    storyOverview: null,
    narrativeMap: null,
    structureChecks: [],
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
    premise: '',
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

const noop = () => {}

describe('StoryLayersPanel', () => {
  it('lists acts and nested scenes; clicking a scene selects it', async () => {
    const user = userEvent.setup()
    const ep = episode([scene()])
    const onSelectScene = vi.fn()
    render(
      <StoryLayersPanel
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectNothing={noop}
        onSelectScene={onSelectScene}
        onToggleActCollapse={noop}
      />,
    )
    expect(screen.getByText('COLD OPEN')).not.toBeNull()
    await user.click(screen.getByText(/INT\. THE LONG POUR - NIGHT/))
    expect(onSelectScene).toHaveBeenCalledWith('scene-1')
  })

  it('the eye toggle collapses an act, hiding its nested scene list', async () => {
    const user = userEvent.setup()
    const ep = episode([scene()])
    const onToggleActCollapse = vi.fn()
    const { rerender } = render(
      <StoryLayersPanel
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectNothing={noop}
        onSelectScene={noop}
        onToggleActCollapse={onToggleActCollapse}
      />,
    )
    expect(screen.getByText(/INT\. THE LONG POUR - NIGHT/)).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Hide COLD OPEN' }))
    expect(onToggleActCollapse).toHaveBeenCalledWith(0)

    // The panel is controlled by `collapsedActs` (state lives in PlanScreen);
    // simulate the parent reacting to the callback above.
    rerender(
      <StoryLayersPanel
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set([0])}
        onSelectNothing={noop}
        onSelectScene={noop}
        onToggleActCollapse={onToggleActCollapse}
      />,
    )
    expect(screen.queryByText(/INT\. THE LONG POUR - NIGHT/)).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Show COLD OPEN' }),
    ).not.toBeNull()
  })

  it('clicking Bible or Episode clears the selection (nothing-selected state)', async () => {
    const user = userEvent.setup()
    const ep = episode([scene()])
    const onSelectNothing = vi.fn()
    render(
      <StoryLayersPanel
        project={project(ep)}
        episode={ep}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        collapsedActs={new Set()}
        onSelectNothing={onSelectNothing}
        onSelectScene={noop}
        onToggleActCollapse={noop}
      />,
    )
    await user.click(screen.getByText('Bible'))
    expect(onSelectNothing).toHaveBeenCalledTimes(1)
    await user.click(screen.getByText(/Episode:/))
    expect(onSelectNothing).toHaveBeenCalledTimes(2)
  })

  it('selected scene rows use soft accent fill with accent ink text', () => {
    const ep = episode([scene()])
    render(
      <StoryLayersPanel
        project={project(ep)}
        episode={ep}
        selection={{ type: 'scene', sceneId: 'scene-1' }}
        collapsedActs={new Set()}
        onSelectNothing={noop}
        onSelectScene={noop}
        onToggleActCollapse={noop}
      />,
    )
    const selectedScene = screen.getByRole('button', {
      name: /INT\. THE LONG POUR - NIGHT/,
    })
    expect(selectedScene.className).toContain('bg-tr-coral-soft')
    expect(selectedScene.className).toContain('text-tr-accent-ink')
  })

  it('the connector-row footer stub is disabled with the v2 tooltip', () => {
    const ep = episode([scene()])
    render(
      <StoryLayersPanel
        project={project(ep)}
        episode={ep}
        selection={null}
        collapsedActs={new Set()}
        onSelectNothing={noop}
        onSelectScene={noop}
        onToggleActCollapse={noop}
      />,
    )
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.disabled).toBe(true)
    expect(checkbox.closest('label')?.getAttribute('title')).toBe(
      'Setup/payoff threads — v2',
    )
  })
})
