// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Scene } from 'contract'
import { SceneOutline } from './SceneOutline'

afterEach(cleanup)

function scene(partial: Partial<Scene> & { id: string }): Scene {
  return {
    index: 0,
    act: 1,
    storyline: 'A',
    locked: false,
    location: 'OVAL OFFICE',
    time: 'DAY',
    socialSituation: '',
    whatHappens: 'Josh presses Leo',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...partial,
  }
}

describe('SceneOutline', () => {
  it('lists scenes with index and slug', () => {
    render(
      <SceneOutline
        scenes={[
          scene({ id: 'scene-1', location: 'OVAL OFFICE', time: 'DAY' }),
          scene({ id: 'scene-2', location: "JOSH'S OFFICE", time: 'DAY' }),
        ]}
        activeSceneId="scene-2"
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('write-scene-outline').textContent).toContain(
      'Scenes · 2',
    )
    expect(screen.getByTestId('write-outline-scene-1').textContent).toContain(
      '1. OVAL OFFICE',
    )
    expect(screen.getByTestId('write-outline-scene-2').textContent).toContain(
      "2. JOSH'S OFFICE",
    )
  })

  it('marks the active scene and reports clicks', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <SceneOutline
        scenes={[
          scene({ id: 'scene-1' }),
          scene({ id: 'scene-2', location: "JOSH'S OFFICE" }),
        ]}
        activeSceneId="scene-1"
        onSelect={onSelect}
      />,
    )
    const active = screen.getByTestId('write-outline-scene-1')
    expect(active.getAttribute('aria-current')).toBe('true')
    expect(active.className).toContain('bg-tr-coral-soft')

    await user.click(screen.getByTestId('write-outline-scene-2'))
    expect(onSelect).toHaveBeenCalledWith('scene-2')
  })
})
