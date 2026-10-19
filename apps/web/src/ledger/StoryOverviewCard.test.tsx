// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project, StoryOverview } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoryOverviewCard } from './StoryOverviewCard'

afterEach(cleanup)

function project(): Project {
  return {
    id: 'proj-1',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 4,
      coldOpen: true,
      tag: true,
      serialization: 0.5,
    },
    seasons: [
      {
        episodes: [
          {
            id: 'ep-1',
            index: 0,
            scenes: [
              {
                id: 'scene-1',
                index: 0,
                location: 'THE LAB',
                beats: [{ id: 'beat-1-1' }],
              },
              {
                id: 'scene-2',
                index: 1,
                location: '',
                beats: [{ id: 'beat-2-1' }],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

function overview(overrides: Partial<StoryOverview> = {}): StoryOverview {
  return {
    logline:
      'When Marty finds an empty lab, he must locate Doc before the plan collapses.',
    outline: [
      { sceneId: 'scene-1', summary: 'Marty calls for Doc.' },
      { sceneId: 'scene-2', summary: 'The chase begins.' },
    ],
    beatSheet: [
      {
        beatId: 'beat-1-1',
        label: 'Teaser',
        summary: 'Marty arrives to silence.',
        sceneId: 'scene-1',
        act: 0,
      },
    ],
    summary:
      'Marty rushes into an empty lab looking for Doc.\n\nFinding no one, he realizes the plan is already slipping away.',
    provenance: 'inferred',
    locked: false,
    ...overrides,
  }
}

const counts = {
  sceneCount: 2,
  threadCount: 3,
  factCount: 12,
}

describe('StoryOverviewCard', () => {
  it('shows empty state when overview is absent', () => {
    render(
      <StoryOverviewCard
        project={project()}
        overview={null}
        {...counts}
        onJumpToScene={vi.fn()}
      />,
    )
    expect(screen.getByTestId('overview-panel-empty')).not.toBeNull()
    expect(screen.getByTestId('overview-status-empty')).not.toBeNull()
    expect(screen.queryByTestId('overview-expand-toggle')).toBeNull()
  })

  it('keeps logline visible and expands summary, outline jump, beat jump', async () => {
    const user = userEvent.setup()
    const onJumpToScene = vi.fn()
    render(
      <StoryOverviewCard
        project={project()}
        overview={overview()}
        {...counts}
        onJumpToScene={onJumpToScene}
      />,
    )

    expect(screen.getByTestId('overview-logline').textContent).toContain(
      'Marty',
    )
    expect(screen.getByTestId('overview-status-ready')).not.toBeNull()
    expect(screen.getByTestId('story-overview-card').textContent).toMatch(
      /2 scenes/,
    )
    expect(screen.queryByTestId('overview-expanded')).toBeNull()

    await user.click(screen.getByTestId('overview-expand-toggle'))
    expect(screen.getByTestId('overview-expanded')).not.toBeNull()
    expect(
      screen.getByTestId('overview-summary').querySelectorAll('p'),
    ).toHaveLength(2)
    expect(
      screen.getByTestId('overview-beat-act-beat-1-1').textContent,
    ).toContain('COLD OPEN')
    expect(
      screen.getByTestId('overview-outline-scene-scene-1').textContent,
    ).toContain('Marty calls for Doc.')
    expect(
      screen.getByTestId('overview-outline-location-scene-1').textContent,
    ).toContain('THE LAB')

    await user.click(screen.getByTestId('overview-outline-scene-scene-1'))
    expect(onJumpToScene).toHaveBeenCalledWith('scene-1')

    // Beat sheet is a disclosure — open it for the jump control.
    await user.click(screen.getByText(/Beat sheet/))
    await user.click(screen.getByTestId('overview-beat-scene-beat-1-1'))
    expect(onJumpToScene).toHaveBeenCalledWith('scene-1')
  })

  it('lists the outline in story order and numbers it by story position', async () => {
    const user = userEvent.setup()
    const moved = project()
    // A Plan move put scene-2 first (act / index) and left the array — and
    // the import-order outline — alone.
    moved.seasons[0].episodes[0].scenes =
      moved.seasons[0].episodes[0].scenes.map((scene) => ({
        ...scene,
        act: 1,
        index: scene.id === 'scene-2' ? 0 : 1,
      }))
    render(
      <StoryOverviewCard
        project={moved}
        overview={overview()}
        {...counts}
        onJumpToScene={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('overview-expand-toggle'))
    const rows = Array.from(
      screen
        .getByTestId('overview-outline')
        .querySelectorAll<HTMLElement>(
          '[data-testid^="overview-outline-scene-"]',
        ),
    )
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'overview-outline-scene-scene-2',
      'overview-outline-scene-scene-1',
    ])
    expect(rows.map((r) => r.textContent?.match(/^\d+/)?.[0])).toEqual([
      '1',
      '2',
    ])
    expect(
      screen.getByTestId('overview-outline-location-scene-2').textContent,
    ).toBe('SCENE 1')
  })

  it('renders real paragraphs when summary has literal \\n\\n escapes', async () => {
    const user = userEvent.setup()
    render(
      <StoryOverviewCard
        project={project()}
        overview={overview({
          summary:
            'Marty rushes into an empty lab looking for Doc.\\n\\nFinding no one, he realizes the plan is already slipping away.',
        })}
        {...counts}
        onJumpToScene={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('overview-expand-toggle'))
    const paras = screen.getByTestId('overview-summary').querySelectorAll('p')
    expect(paras).toHaveLength(2)
    expect(paras[0]!.textContent).toContain('Marty rushes')
    expect(paras[1]!.textContent).toContain('Finding no one')
    expect(screen.getByTestId('overview-summary').textContent).not.toContain(
      '\\n',
    )
  })

  it('shows TAG cue for Tag rows even when act is a numeric last act', async () => {
    const user = userEvent.setup()
    render(
      <StoryOverviewCard
        project={project()}
        overview={overview({
          beatSheet: [
            {
              beatId: 'beat-2-1',
              label: 'Tag',
              summary: 'A quiet button.',
              sceneId: 'scene-2',
              act: 4,
            },
          ],
        })}
        {...counts}
        onJumpToScene={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('overview-expand-toggle'))
    await user.click(screen.getByText(/Beat sheet/))
    expect(screen.getByTestId('overview-beat-act-beat-2-1').textContent).toBe(
      'TAG',
    )
  })
})
