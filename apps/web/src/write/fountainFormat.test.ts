import { describe, expect, it } from 'vitest'
import { parseFountainLines } from './fountainFormat'

describe('parseFountainLines', () => {
  it('classifies a standard Fountain beat', () => {
    const lines = parseFountainLines(
      [
        'INT. THE LONG POUR - NIGHT',
        '',
        'Dan counts the till.',
        '',
        'DAN',
        "We're closed.",
        '',
        'MARTA',
        '(dry)',
        "You're out of rum.",
      ].join('\n'),
    )
    expect(lines.map((l) => l.type)).toEqual([
      'scene_heading',
      'blank',
      'action',
      'blank',
      'character',
      'dialogue',
      'blank',
      'character',
      'parenthetical',
      'dialogue',
    ])
  })

  it('strips lone PDF element labels like ACTION', () => {
    const lines = parseFountainLines(
      [
        'INT. OFFICE - DAY',
        '',
        'ACTION',
        'Leo eats cereal.',
        '',
        'LEO',
        'Hi.',
      ].join('\n'),
    )
    expect(lines.map((l) => [l.type, l.text])).toEqual([
      ['scene_heading', 'INT. OFFICE - DAY'],
      ['blank', ''],
      ['action', 'Leo eats cereal.'],
      ['blank', ''],
      ['character', 'LEO'],
      ['dialogue', 'Hi.'],
    ])
  })

  it('treats CONTINUED lines as transitions', () => {
    const lines = parseFountainLines('(CONTINUED)\nCONTINUED:')
    expect(lines.every((l) => l.type === 'transition')).toBe(true)
  })

  it('drops lone page numbers from print PDFs', () => {
    const lines = parseFountainLines('DAN\nHello.\n\n10\n\nMARTA\nHi.')
    expect(lines.map((l) => l.text)).not.toContain('10')
  })

  it("keeps each line's source index across dropped lines", () => {
    expect(parseFountainLines('DAN\n10\nHello.').map((l) => l.line)).toEqual([
      0, 2,
    ])
  })
})
