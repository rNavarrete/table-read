// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { Character, LedgerFact, Project } from 'contract'
import { afterEach, describe, expect, it } from 'vitest'
import { CharacterProfile } from './CharacterProfile'

afterEach(() => cleanup())

function character(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-leo',
    name: 'Leo McGarry',
    locked: false,
    aliases: ['Leo'],
    embodiment: '',
    presentation: 'Steady chief of staff.',
    hiding: 'Carries the weight of every call.',
    traits: 'Cuts through noise.',
    seriesArc: '',
    summary: '',
    bio: '',
    ...overrides,
  }
}

function projectWith(character: Character): Project {
  return {
    id: 'proj-1',
    title: 'West Wing',
    headSnapshotId: 'snap-1',
    seriesBible: { characters: [character] },
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
                motivations: [
                  {
                    characterId: 'char-leo',
                    objective: 'to keep the room focused',
                    stakes: 'chaos',
                    obstacle: 'everyone talking',
                  },
                ],
                beats: [],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

describe('CharacterProfile', () => {
  it('renders summary and bio from bible craft fields', () => {
    const c = character()
    render(
      <CharacterProfile character={c} project={projectWith(c)} facts={[]} />,
    )
    expect(
      screen
        .getByTestId('character-profile')
        .getAttribute('data-profile-source'),
    ).toBe('bible')
    expect(
      screen.getByTestId('character-profile-summary').textContent,
    ).toContain('Cuts through noise.')
    expect(screen.getByTestId('character-profile-bio').textContent).toContain(
      'Steady chief of staff.',
    )
    expect(
      screen.getByTestId('character-profile-aliases').textContent,
    ).toContain('Leo')
  })

  it('shows empty state when no profile content exists', () => {
    const c = character({
      presentation: '',
      hiding: '',
      traits: '',
      aliases: [],
    })
    const project = {
      id: 'proj-1',
      title: 'West Wing',
      headSnapshotId: 'snap-1',
      seriesBible: { characters: [c] },
      seasons: [{ episodes: [{ id: 'ep-1', index: 0, scenes: [] }] }],
    } as unknown as Project
    render(
      <CharacterProfile
        character={c}
        project={project}
        facts={[] as LedgerFact[]}
      />,
    )
    expect(screen.getByTestId('character-profile-empty').textContent).toMatch(
      /No profile yet/,
    )
  })
})
