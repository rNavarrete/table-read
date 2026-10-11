import { describe, expect, it } from 'vitest'
import { detectFormat } from './detectFormat'

const scene = (heading: string) => `${heading}\n\nSomeone does something.\n`

describe('detectFormat', () => {
  it('reads a cold open plus three printed acts, which no preset matches', () => {
    const source = [
      'COLD OPEN',
      scene('INT. SCHOOL - DAY'),
      'ACT ONE',
      scene('INT. HOUSE - NIGHT'),
      'END OF ACT ONE',
      'ACT TWO',
      scene('EXT. STREET - DAY'),
      'ACT THREE',
      scene('INT. KITCHEN - NIGHT'),
    ].join('\n')

    const detected = detectFormat(source)

    expect(detected.format).toEqual({
      genre: 'comedy',
      runtimeMinutes: 30,
      actCount: 3,
      coldOpen: true,
      tag: false,
      serialization: 0.3,
    })
    expect(detected.presetId).toBeNull()
    expect(detected.reason).toBe('cold open, 3 acts')
  })

  it('picks the preset a script matches exactly', () => {
    const source = [
      'COLD OPEN',
      scene('INT. A - DAY'),
      'ACT ONE',
      scene('INT. B - DAY'),
      'ACT TWO',
      scene('INT. C - DAY'),
    ].join('\n')
    expect(detectFormat(source).presetId).toBe('half-hour-comedy')
  })

  it('counts to the highest act printed when OCR has damaged a heading', () => {
    // West Wing pilot scan: "AcT Two" is mixed case, so it is not a marker.
    const source = [
      'TEASER',
      scene('INT. BAR - NIGHT'),
      'ACT ONE',
      scene('INT. WEST WING - DAY'),
      'AcT Two',
      scene('INT. OFFICE - DAY'),
      'ACT THREE',
      scene('INT. HALL - DAY'),
      'ACT FOUR',
      scene('INT. ROOM - NIGHT'),
      'END OF ACT FOUR',
    ].join('\n')

    const detected = detectFormat(source)

    expect(detected.format.actCount).toBe(4)
    expect(detected.format.coldOpen).toBe(true)
    expect(detected.format.genre).toBe('drama')
    expect(detected.format.runtimeMinutes).toBe(60)
    expect(detected.reason).toBe('cold open, 4 acts')
  })

  it('treats scenes before ACT ONE as a cold open, and none when it opens on ACT ONE', () => {
    const before = [
      scene('INT. A - DAY'),
      'ACT ONE',
      scene('INT. B - DAY'),
      'ACT TWO',
    ].join('\n')
    const opens = [
      'ACT ONE',
      scene('INT. A - DAY'),
      'ACT TWO',
      scene('INT. B - DAY'),
    ].join('\n')
    expect(detectFormat(before).format.coldOpen).toBe(true)
    expect(detectFormat(opens).format.coldOpen).toBe(false)
  })

  it('reads roman numerals, digits and a tag', () => {
    const source = [
      'ACT I',
      scene('INT. A - DAY'),
      'ACT 2',
      scene('INT. B - DAY'),
      'ACT III',
      'TAG',
      scene('INT. C - DAY'),
    ].join('\n')
    const detected = detectFormat(source)
    expect(detected.format.actCount).toBe(3)
    expect(detected.format.tag).toBe(true)
    expect(detected.reason).toBe('3 acts, tag')
  })

  it('ignores dialogue that mentions an act', () => {
    const source = [
      scene('INT. THEATRE - NIGHT'),
      'MARGE',
      'Act two was the best part.',
      'Act one.',
    ].join('\n')
    expect(detectFormat(source).presetId).toBe('actless-streaming')
  })

  it('falls back to actless when the script prints no act breaks', () => {
    const detected = detectFormat(scene('INT. A - DAY') + scene('INT. B - DAY'))
    expect(detected.presetId).toBe('actless-streaming')
    expect(detected.reason).toBe('no act breaks printed')
  })
})
