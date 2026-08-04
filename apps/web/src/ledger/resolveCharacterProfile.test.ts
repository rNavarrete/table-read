import type { Character, LedgerFact, Motivation } from 'contract'
import { describe, expect, it } from 'vitest'
import { resolveCharacterProfile } from './resolveCharacterProfile'

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
    expect(profile.summary).toMatch(/Sam Seaborn wants to land the speech/)
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
