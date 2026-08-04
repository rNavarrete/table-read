import { describe, expect, it } from 'vitest'
import {
  assignCharacterAvatars,
  characterAvatar,
  hueForName,
  initialsCandidates,
  initialsForName,
} from './characterAvatar'

describe('characterAvatar', () => {
  it('derives stable hue from name', () => {
    expect(hueForName('Josh')).toBe(hueForName('Josh'))
    expect(hueForName('Josh')).not.toBe(hueForName('Sam'))
  })

  it('initials from multi-part and dotted names', () => {
    expect(initialsForName('C.J.')).toBe('CJ')
    expect(initialsForName('Mrs. Jacobi')).toBe('MJ')
    expect(initialsForName('Sam')).toBe('SA')
    expect(initialsForName('Mary Marsh')).toBe('MM')
  })

  it('returns oklch tint/ink for the hue', () => {
    const a = characterAvatar('Leo')
    expect(a.tint).toMatch(/^oklch\(0\.93 0\.045 \d+\)$/)
    expect(a.ink).toMatch(/^oklch\(0\.44 0\.11 \d+\)$/)
    expect(a.initials).toBe('LE')
  })
})

describe('assignCharacterAvatars', () => {
  it('avoids hue collisions across hash-colliding names', () => {
    const names = ['Cathy', 'Mandy', 'C.J.', 'Josh', 'Sam', 'Leo']
    const map = assignCharacterAvatars(names)
    const hues = names.map((n) => map.get(n)!.hue)
    expect(new Set(hues).size).toBe(names.length)
  })

  it('disambiguates MA-colliding single names', () => {
    const names = ['Mandy', 'Margaret', 'Mallory', 'Mary Marsh']
    const map = assignCharacterAvatars(names)
    const initials = names.map((n) => map.get(n)!.initials)
    expect(new Set(initials).size).toBe(names.length)
    expect(map.get('Mary Marsh')!.initials).toBe('MM')
    // Singles that would all be MA take later candidates.
    expect(initialsCandidates('Mandy')[0]).toBe('MA')
    expect(map.get('Mandy')!.initials).toBe('MA')
    expect(map.get('Margaret')!.initials).not.toBe('MA')
    expect(map.get('Mallory')!.initials).not.toBe('MA')
    expect(map.get('Mallory')!.initials).not.toBe(map.get('Margaret')!.initials)
  })

  it('is stable for the same cast order', () => {
    const names = ['Sam', 'Josh', 'Leo', 'C.J.']
    const a = assignCharacterAvatars(names)
    const b = assignCharacterAvatars(names)
    for (const n of names) {
      expect(a.get(n)).toEqual(b.get(n))
    }
  })
})
