// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project, StoryOverview } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverviewPanel } from './OverviewPanel'

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
      {
        sceneId: 'scene-1',
        summary: 'Marty calls for Doc.',
        storyOrder: null,
        storyTime: '',
        anachrony: 'none',
      },
      {
        sceneId: 'scene-2',
        summary: 'The chase begins.',
        storyOrder: null,
        storyTime: '',
        anachrony: 'none',
      },
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
    dramaticQuestion: '',
    centralArgument: '',
    antiTheme: '',
    provenance: 'inferred',
    locked: false,
    ...overrides,
  }
}

describe('OverviewPanel', () => {
  it('shows an empty state when overview is absent', () => {
    render(
      <OverviewPanel
        project={project()}
        overview={null}
        onJumpToScene={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('overview-panel-empty')).not.toBeNull()
  })

  it('renders logline, summary paragraphs, outline jump, and beat jump', async () => {
    const user = userEvent.setup()
    const onJumpToScene = vi.fn()
    render(
      <OverviewPanel
        project={project()}
        overview={overview()}
        onJumpToScene={onJumpToScene}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('overview-logline').textContent).toContain(
      'Marty',
    )
    expect(
      screen.getByTestId('overview-summary').querySelectorAll('p'),
    ).toHaveLength(2)
    expect(
      screen.getByTestId('overview-beat-act-beat-1-1').textContent,
    ).toContain('COLD OPEN')
    // Outline leads with story action, not location-as-title.
    expect(
      screen.getByTestId('overview-outline-scene-scene-1').textContent,
    ).toContain('Marty calls for Doc.')
    expect(
      screen.getByTestId('overview-outline-location-scene-1').textContent,
    ).toContain('THE LAB')
    await user.click(screen.getByTestId('overview-outline-scene-scene-1'))
    expect(onJumpToScene).toHaveBeenCalledWith('scene-1')
    await user.click(screen.getByTestId('overview-beat-scene-beat-1-1'))
    expect(onJumpToScene).toHaveBeenCalledWith('scene-1')
  })

  it('renders real paragraphs when summary has literal \\n\\n escapes', () => {
    render(
      <OverviewPanel
        project={project()}
        overview={overview({
          summary:
            'Marty rushes into an empty lab looking for Doc.\\n\\nFinding no one, he realizes the plan is already slipping away.',
        })}
        onJumpToScene={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const paras = screen.getByTestId('overview-summary').querySelectorAll('p')
    expect(paras).toHaveLength(2)
    expect(paras[0].textContent).toContain('Marty rushes')
    expect(paras[1].textContent).toContain('Finding no one')
    expect(screen.getByTestId('overview-summary').textContent).not.toContain(
      '\\n',
    )
  })

  it('shows TAG cue for Tag rows even when act is a numeric last act', () => {
    render(
      <OverviewPanel
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
        onJumpToScene={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('overview-beat-act-beat-2-1').textContent).toBe(
      'TAG',
    )
  })
})
