// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Scene } from 'contract'
import { outlinePitch, SceneOutline } from './SceneOutline'

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
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
    whatHappens: 'Josh presses Leo',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...partial,
  }
}

describe('SceneOutline', () => {
  it('lists scenes with index, slug, and whatHappens pitch', () => {
    render(
      <SceneOutline
        scenes={[
          scene({
            id: 'scene-1',
            location: 'OVAL OFFICE',
            time: 'DAY',
            whatHappens: 'Josh presses Leo',
          }),
          scene({
            id: 'scene-2',
            location: "JOSH'S OFFICE",
            time: 'DAY',
            whatHappens: 'Sam decides to act',
          }),
          scene({
            id: 'scene-3',
            location: 'ROOSEVELT ROOM',
            time: 'DAY',
            whatHappens: '',
          }),
        ]}
        activeSceneId="scene-2"
        onSelect={() => {}}
      />,
    )
    const outline = screen.getByTestId('write-scene-outline')
    expect(outline.textContent).toMatch(/On the page/)
    expect(outline.textContent).toMatch(/3 scenes/)
    const row1 = screen.getByTestId('write-outline-scene-1')
    expect(row1.textContent).toContain('1')
    expect(row1.textContent).toContain('OVAL OFFICE')
    expect(row1.textContent).toContain('Josh presses Leo')
    expect(screen.getByTestId('write-outline-scene-2').textContent).toContain(
      'Sam decides to act',
    )
    // Empty pitch: slug only (no empty second line).
    expect(screen.getByTestId('write-outline-scene-3').textContent).toMatch(
      /3.*ROOSEVELT ROOM — DAY/,
    )
  })

  it('outlinePitch falls back to beat plan then script action for imports', () => {
    expect(
      outlinePitch(
        scene({
          id: 'scene-a',
          whatHappens: '',
          beats: [
            {
              id: 'beat-a-1',
              index: 0,
              locked: false,
              scriptLocked: false,
              actorCharacterId: null,
              actionVerb: '',
              targetCharacterId: null,
              reaction: '',
              whatHappens: 'Marty stalls Jennifer',
              audienceLearns: '',
              audienceFeels: '',
              scriptText: 'EXT. ALLEY - DAY\n\nMarty checks his watch.',
            },
          ],
        }),
      ),
    ).toBe('Marty stalls Jennifer')

    expect(
      outlinePitch(
        scene({
          id: 'scene-b',
          whatHappens: '',
          beats: [
            {
              id: 'beat-b-1',
              index: 0,
              locked: false,
              scriptLocked: false,
              actorCharacterId: null,
              actionVerb: '',
              targetCharacterId: null,
              reaction: '',
              whatHappens: '',
              audienceLearns: '',
              audienceFeels: '',
              scriptText: 'EXT. ALLEY - DAY\n\nMarty checks his watch.',
            },
          ],
        }),
      ),
    ).toBe('Marty checks his watch.')
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
    expect(active.className).toContain('bg-tr-write-selected')

    await user.click(screen.getByTestId('write-outline-scene-2'))
    expect(onSelect).toHaveBeenCalledWith('scene-2')
  })
})
