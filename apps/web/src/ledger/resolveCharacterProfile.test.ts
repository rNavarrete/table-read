import type { Character, LedgerFact, Motivation, Project } from 'contract'
import { describe, expect, it } from 'vitest'
import {
  motivationsForCharacter,
  resolveCharacterProfile,
} from './resolveCharacterProfile'

function character(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-sam',
    name: 'Sam Seaborn',
    locked: false,
    aliases: ['Sam'],
    embodiment: '',
    presentation: '',
    hiding: '',
    traits: '',
    seriesArc: '',
    summary: '',
    bio: '',
    ...overrides,
  }
}

function fact(
  id: string,
  text: string,
  overrides: Partial<LedgerFact> = {},
): LedgerFact {
  return {
    id,
    fact: text,
    factType: 'event',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-1',
      beatId: 'beat-1-1',
      startLine: 1,
      endLine: 1,
      charStart: 0,
      charEnd: 1,
    },
    sourceText: 'source',
    knownBy: ['char-sam'],
    audienceKnows: true,
    confidence: 0.9,
    provenance: 'inferred',
    status: 'active',
    establishedIn: 'scene-1',
    supersededBy: null,
    knowledgeEvents: [],
    knownByAsOf: null,
    ...overrides,
  } as LedgerFact
}

describe('resolveCharacterProfile', () => {
  it('prefers stored summary and bio', () => {
    const profile = resolveCharacterProfile(
      character({
        summary: 'Deputy communications director.',
        bio: 'Idealistic speechwriter.',
        traits: 'should not win',
      }),
      [fact('f1', 'Sam drafts a speech.')],
    )
    expect(profile.source).toBe('stored')
    expect(profile.summary).toBe('Deputy communications director.')
    expect(profile.bio).toBe('Idealistic speechwriter.')
  })

  it('falls back to craft bible fields', () => {
    const profile = resolveCharacterProfile(
      character({
        traits: 'Speaks in polished paragraphs.',
        presentation: 'Boyish earnestness.',
        hiding: 'Afraid of becoming cynical.',
        embodiment: 'Words as moral action.',
      }),
      [],
    )
    expect(profile.source).toBe('bible')
    expect(profile.summary).toBe('Speaks in polished paragraphs.')
    expect(profile.bio).toContain('Boyish earnestness.')
    expect(profile.bio).toContain('Afraid of becoming cynical.')
    expect(profile.bio).toContain('Words as moral action.')
  })

  it('derives from knownBy facts and motivations without re-import', () => {
    const motivations: Motivation[] = [
      {
        characterId: 'char-sam',
        objective: 'to land the speech',
        stakes: 'the vote fails',
        obstacle: 'CJ cuts the line',
        statedObjective: '',
        concealed: false,
      },
    ]
    const profile = resolveCharacterProfile(
      character(),
      [
        fact('f1', 'Sam stays up rewriting the education speech.'),
        fact('f2', 'Sam knows Leo is protecting the President.', {
          factType: 'knowledge',
        }),
      ],
      motivations,
    )
    expect(profile.source).toBe('derived')
    // Colon rather than a spliced verb: objectives are imperative phrases,
    // so "wants {objective}" produced "Sam wants Find out who…".
    expect(profile.summary).toMatch(/Sam Seaborn wants: to land the speech/)
    expect(profile.bio).toContain('Sam stays up rewriting')
    expect(profile.bio).toContain('to land the speech')
  })

  it('returns empty when nothing is available', () => {
    const profile = resolveCharacterProfile(character(), [])
    expect(profile.source).toBe('empty')
    expect(profile.summary).toBe('')
    expect(profile.bio).toBe('')
  })
})

describe('bio derivation is biography, not plot', () => {
  it('ignores facts the character merely knows', () => {
    // Sam was in the room for the B-story briefing, so knownBy includes him
    // — but the Cuban refugee count is not Sam's biography.
    const profile = resolveCharacterProfile(
      character(),
      [
        fact('f1', 'Approximately 1,200 Cubans left Havana this morning.', {
          factType: 'event',
        }),
        fact('f2', 'Sam Seaborn is 31 years old.', { factType: 'state' }),
      ],
      [],
    )
    expect(profile.bio).toContain('Sam Seaborn is 31')
    expect(profile.bio).not.toContain('Cubans')
  })

  it('ranks who someone is above what happened around them', () => {
    const profile = resolveCharacterProfile(
      character(),
      [
        fact('f1', 'Sam Seaborn runs from the hotel at dawn.', {
          factType: 'event',
        }),
        fact('f2', 'Sam Seaborn is the deputy communications director.', {
          factType: 'state',
        }),
      ],
      [],
    )
    expect(profile.bio.indexOf('deputy communications')).toBeLessThan(
      profile.bio.indexOf('runs from the hotel'),
    )
  })

  it('matches an alias but not a longer name that merely contains it', () => {
    const c = { ...character(), name: 'Sam', aliases: ['Sam Seaborn'] }
    const profile = resolveCharacterProfile(
      c,
      [
        fact('f1', 'Sam Seaborn keeps his own counsel.', { factType: 'state' }),
        fact('f2', 'Sammy Davis sings at the benefit.', { factType: 'state' }),
      ],
      [],
    )
    expect(profile.bio).toContain('keeps his own counsel')
    expect(profile.bio).not.toContain('Sammy')
  })

  it('leaves the bio empty rather than borrowing someone else’s facts', () => {
    const profile = resolveCharacterProfile(
      character(),
      [fact('f1', 'Leo tells the staff to stand down.', { factType: 'event' })],
      [],
    )
    expect(profile.bio).toBe('')
  })
})

describe('motivationsForCharacter', () => {
  it('lists them in story order, not array order', () => {
    const want = (objective: string): Motivation => ({
      characterId: 'char-sam',
      objective,
      stakes: '',
      obstacle: '',
      statedObjective: '',
      concealed: false,
    })
    // A Plan move left the array alone: story order is early, late.
    const project = {
      seasons: [
        {
          episodes: [
            {
              scenes: [
                {
                  id: 'scene-late',
                  act: 2,
                  index: 0,
                  motivations: [want('late')],
                },
                {
                  id: 'scene-early',
                  act: 1,
                  index: 1,
                  motivations: [want('early')],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Project
    expect(
      motivationsForCharacter(project, 'char-sam').map((m) => m.objective),
    ).toEqual(['early', 'late'])
  })
})
