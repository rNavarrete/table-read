// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Character, Project, StoryThread } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadsPanel } from './ThreadsPanel'

afterEach(cleanup)

function character(id: string, name: string): Character {
  return {
    id,
    name,
    locked: false,
    aliases: [],
    embodiment: '',
    presentation: '',
    hiding: '',
    traits: '',
    seriesArc: '',
    summary: '',
    bio: '',
  }
}

function project(characters: Character[] = []): Project {
  return {
    id: 'proj-1',
    seriesBible: { characters },
    seasons: [
      {
        episodes: [
          {
            id: 'ep-1',
            index: 0,
            scenes: [
              { id: 'scene-3', index: 2, location: 'THE GARAGE', beats: [] },
              { id: 'scene-11', index: 10, beats: [] },
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

function thread(overrides: Partial<StoryThread> = {}): StoryThread {
  return {
    id: 'thread-a1',
    label: 'Sports Almanac temptation',
    summary: 'Biff eyes the almanac Marty dropped.',
    status: 'open',
    ownerCharacterIds: ['char-marty'],
    setupSceneId: 'scene-3',
    payoffSceneId: null,
    setupQuote: 'Marty drops the almanac on the counter.',
    payoffQuote: '',
    setupBeatId: null,
    payoffBeatId: null,
    locked: false,
    storyline: null,
    movements: [],
    closureLevel: null,
    secondJob: '',
    ...overrides,
  }
}

describe('ThreadsPanel', () => {
  it('shows an empty state when there are no threads', () => {
    render(
      <ThreadsPanel
        project={project()}
        threads={[]}
        onJumpToScene={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('threads-panel-empty')).not.toBeNull()
  })

  it('renders an open thread with its setup scene link', async () => {
    const user = userEvent.setup()
    const onJumpToScene = vi.fn()

    render(
      <ThreadsPanel
        project={project([character('char-marty', 'Marty McFly')])}
        threads={[thread()]}
        onJumpToScene={onJumpToScene}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Sports Almanac temptation')).not.toBeNull()
    expect(screen.getByText('Marty McFly')).not.toBeNull()
    expect(screen.getByTestId('thread-status-thread-a1').textContent).toBe(
      'open',
    )

    const setupLink = screen.getByTestId('thread-setup-scene-thread-a1')
    expect(setupLink.textContent).toContain('THE GARAGE')
    await user.click(setupLink)
    expect(onJumpToScene).toHaveBeenCalledWith('scene-3')

    expect(screen.queryByTestId('thread-payoff-scene-thread-a1')).toBeNull()
  })

  it('renders a paid-off thread with a payoff scene link', async () => {
    const user = userEvent.setup()
    const onJumpToScene = vi.fn()

    render(
      <ThreadsPanel
        project={project()}
        threads={[
          thread({
            id: 'thread-b2',
            status: 'paid_off',
            payoffSceneId: 'scene-11',
            payoffQuote: 'Biff finally cashes in.',
          }),
        ]}
        onJumpToScene={onJumpToScene}
        onClose={vi.fn()}
      />,
    )

    const payoffLink = screen.getByTestId('thread-payoff-scene-thread-b2')
    await user.click(payoffLink)
    expect(onJumpToScene).toHaveBeenCalledWith('scene-11')
  })

  it('numbers an unnamed scene by story position, not array position', () => {
    const moved = project()
    // A Plan move left the array alone: story order is scene-3, scene-11.
    moved.seasons[0].episodes[0].scenes = [
      { id: 'scene-11', act: 2, index: 10, location: '', beats: [] },
      { id: 'scene-3', act: 1, index: 2, location: 'THE GARAGE', beats: [] },
    ] as unknown as Project['seasons'][0]['episodes'][0]['scenes']
    render(
      <ThreadsPanel
        project={moved}
        threads={[thread({ status: 'paid_off', payoffSceneId: 'scene-11' })]}
        onJumpToScene={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByTestId('thread-payoff-scene-thread-a1').textContent,
    ).toContain('Scene 2')
  })

  it('groups threads under Open / Paid off / Abandoned headers', () => {
    render(
      <ThreadsPanel
        project={project()}
        threads={[
          thread({ id: 'thread-open', status: 'open' }),
          thread({
            id: 'thread-paid',
            status: 'paid_off',
            payoffSceneId: 'scene-11',
          }),
          thread({ id: 'thread-dead', status: 'abandoned' }),
        ]}
        onJumpToScene={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('threads-group-open')).not.toBeNull()
    expect(screen.getByTestId('threads-group-paid_off')).not.toBeNull()
    expect(screen.getByTestId('threads-group-abandoned')).not.toBeNull()
  })

  it('lists a thread’s movements in order with scene number, phase and what changed (T10.3)', async () => {
    const user = userEvent.setup()
    const onJumpToScene = vi.fn()
    render(
      <ThreadsPanel
        project={project()}
        threads={[
          thread({
            movements: [
              {
                sceneId: 'scene-3',
                beatId: null,
                phase: 'setup',
                summary: 'Marty drops it.',
              },
              {
                sceneId: 'scene-11',
                beatId: 'beat-11-1',
                phase: 'escalation',
                summary: '',
              },
            ],
          }),
        ]}
        onJumpToScene={onJumpToScene}
        onClose={vi.fn()}
      />,
    )

    const rows = screen
      .getByTestId('thread-movements-thread-a1')
      .querySelectorAll('li')
    expect([...rows].map((li) => li.textContent)).toEqual([
      'Scene 1sets up— Marty drops it.',
      'Scene 2escalates',
    ])
    await user.click(screen.getByRole('button', { name: 'Scene 2' }))
    expect(onJumpToScene).toHaveBeenCalledWith('scene-11')
  })

  it('a paid-off thread states the gap and how it is closed (T10.3)', () => {
    render(
      <ThreadsPanel
        project={project()}
        threads={[
          thread({
            status: 'paid_off',
            payoffSceneId: 'scene-11',
            closureLevel: 'thematic',
          }),
          thread({
            id: 'thread-c3',
            status: 'paid_off',
            payoffSceneId: 'scene-11',
          }),
        ]}
        onJumpToScene={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('thread-closure-thread-a1').textContent).toBe(
      'pays off 1 scene later · closed thematically',
    )
    expect(screen.getByTestId('thread-closure-thread-c3').textContent).toBe(
      'pays off 1 scene later',
    )
  })

  it('an open thread has no gap or closure line; the second job shows when set (T10.3)', () => {
    render(
      <ThreadsPanel
        project={project()}
        threads={[
          thread({ secondJob: 'Gets a laugh at Biff.' }),
          thread({ id: 'thread-d4' }),
        ]}
        onJumpToScene={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('thread-closure-thread-a1')).toBeNull()
    expect(screen.getByTestId('thread-second-job-thread-a1').textContent).toBe(
      'Second job Gets a laugh at Biff.',
    )
    expect(screen.queryByTestId('thread-second-job-thread-d4')).toBeNull()
    expect(screen.queryByTestId('thread-movements-thread-d4')).toBeNull()
  })

  it('the gap reads the same scene, plural and earlier, and nothing off the project (T10.3)', () => {
    const p = project()
    p.seasons[0].episodes[0].scenes.push({
      id: 'scene-40',
      index: 39,
      beats: [],
    } as unknown as Project['seasons'][0]['episodes'][0]['scenes'][0])
    const paid = (id: string, setupSceneId: string, payoffSceneId: string) =>
      thread({ id, status: 'paid_off', setupSceneId, payoffSceneId })
    render(
      <ThreadsPanel
        project={p}
        threads={[
          paid('thread-same', 'scene-3', 'scene-3'),
          paid('thread-back', 'scene-11', 'scene-3'),
          paid('thread-far', 'scene-3', 'scene-40'),
          paid('thread-gone', 'scene-3', 'scene-99'),
        ]}
        onJumpToScene={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const line = (id: string) =>
      screen.queryByTestId(`thread-closure-${id}`)?.textContent ?? null
    expect(line('thread-same')).toBe('pays off in the same scene')
    expect(line('thread-back')).toBe('pays off 1 scene earlier')
    expect(line('thread-far')).toBe('pays off 2 scenes later')
    expect(line('thread-gone')).toBeNull()
  })

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ThreadsPanel
        project={project()}
        threads={[thread()]}
        onJumpToScene={vi.fn()}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByTestId('threads-panel-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
