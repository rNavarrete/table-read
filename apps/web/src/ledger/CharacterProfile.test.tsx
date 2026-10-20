// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { Character, LedgerFact, Project } from 'contract'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('CharacterProfile — concealment', () => {
  function withSecrets(): { c: Character; project: Project } {
    const c = character({ id: 'char-sam', name: 'Sam Seaborn' })
    const other = character({ id: 'char-leo', name: 'Leo McGarry' })
    const project = {
      id: 'proj-1',
      title: 'West Wing',
      headSnapshotId: 'snap-1',
      seriesBible: { characters: [c, other] },
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
                  beats: [],
                  motivations: [
                    {
                      characterId: 'char-sam',
                      objective: 'get out before it costs him',
                      stakes: 'his job',
                      obstacle: 'she wants him to stay',
                      statedObjective: 'he simply has to go',
                      concealed: true,
                    },
                  ],
                },
              ],
              secrets: [
                {
                  id: 'secret-1',
                  summary: 'Sam spent the night with Laurie.',
                  factId: null,
                  holderCharacterIds: ['char-sam'],
                  concealedFromCharacterIds: ['char-leo'],
                  audienceKnows: true,
                  establishedSceneId: 'scene-1',
                  revealedSceneId: null,
                  concealmentSceneIds: ['scene-1'],
                  establishedQuote: '',
                  revealedQuote: '',
                  provenance: 'inferred',
                  locked: false,
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Project
    return { c, project }
  }

  it('shows what a character is hiding, and from whom', () => {
    const { c, project } = withSecrets()
    render(<CharacterProfile character={c} project={project} facts={[]} />)
    const hiding = screen.getByTestId('character-profile-hiding')
    expect(hiding.textContent).toContain('Sam spent the night with Laurie.')
    // Resolved to a display name, never a raw char- id.
    expect(hiding.textContent).toContain('Leo McGarry')
    expect(hiding.textContent).not.toContain('char-leo')
    // An unrevealed secret is an unpaid promise — surface it as such.
    expect(screen.getByTestId('character-secret-status').textContent).toBe(
      'Still concealed',
    )
  })

  it('separates what is kept FROM a character', () => {
    const { project } = withSecrets()
    const leo = character({ id: 'char-leo', name: 'Leo McGarry' })
    render(<CharacterProfile character={leo} project={project} facts={[]} />)
    // Same object, opposite dramatic function: for Leo this is irony, not
    // motive, so it must never appear under "Hiding".
    expect(screen.queryByTestId('character-profile-hiding')).toBeNull()
    expect(
      screen.getByTestId('character-profile-kept-from').textContent,
    ).toContain('Sam spent the night with Laurie.')
  })

  it('shows the stated/actual gap as an ulterior motive', () => {
    const { c, project } = withSecrets()
    render(<CharacterProfile character={c} project={project} facts={[]} />)
    const motives = screen.getByTestId('character-profile-motives')
    expect(motives.textContent).toContain('he simply has to go')
    expect(motives.textContent).toContain('get out before it costs him')
  })

  it('renders craft sections even with no bio or summary', () => {
    const { project } = withSecrets()
    const bare = character({
      id: 'char-sam',
      name: 'Sam Seaborn',
      presentation: '',
      hiding: '',
      traits: '',
      summary: '',
      bio: '',
    })
    render(<CharacterProfile character={bare} project={project} facts={[]} />)
    // An imported script has secrets long before it has prose.
    expect(screen.queryByTestId('character-profile-empty')).toBeNull()
    expect(screen.getByTestId('character-profile-hiding')).toBeTruthy()
  })
})

describe('CharacterProfile — arc (T10.6)', () => {
  function withArc(stops: { sceneId: string; headAt: string }[]) {
    const c = character({ presentation: '', hiding: '', traits: '' })
    const project = projectWith(c)
    const episode = project.seasons[0].episodes[0]
    episode.scenes.push({
      ...episode.scenes[0],
      id: 'scene-2',
      index: 1,
      motivations: [],
    })
    episode.characterArcs = [
      {
        characterId: c.id,
        want: 'to keep the room focused',
        need: 'to let Bartlet carry it',
        lie: '',
        ghost: 'the night he drank',
        continuumAxis: 'in control ↔ trusting',
        stops,
      },
    ]
    return { c, project }
  }

  it('shows want / need / ghost / continuum and each stop by scene, skipping empty fields', async () => {
    const { c, project } = withArc([
      { sceneId: 'scene-1', headAt: 'Holding every thread.' },
      { sceneId: 'scene-2', headAt: 'Lets one go.' },
    ])
    const onOpenScene = vi.fn()
    render(
      <CharacterProfile
        character={c}
        project={project}
        facts={[]}
        onOpenScene={onOpenScene}
      />,
    )
    const arc = screen.getByTestId('character-profile-arc')
    expect(screen.queryByTestId('character-profile-empty')).toBeNull()
    expect(arc.textContent).toContain('to let Bartlet carry it')
    expect(arc.textContent).toContain('the night he drank')
    expect(arc.textContent).toContain('in control ↔ trusting')
    expect(arc.textContent).not.toContain('Lie')
    expect(arc.textContent).toContain('sc 2 · Head at: Lets one go.')
    await userEvent.click(screen.getByRole('button', { name: 'sc 2' }))
    expect(onOpenScene).toHaveBeenCalledWith('scene-2')
  })

  it('no arc: no arc section', () => {
    const c = character()
    render(
      <CharacterProfile character={c} project={projectWith(c)} facts={[]} />,
    )
    expect(screen.queryByTestId('character-profile-arc')).toBeNull()
  })
})
