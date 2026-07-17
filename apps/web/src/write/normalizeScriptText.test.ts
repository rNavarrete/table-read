import { describe, expect, it } from 'vitest'
import {
  normalizeScriptText,
  withNormalizedScriptText,
} from './normalizeScriptText'

describe('normalizeScriptText', () => {
  it('leaves already-real newlines alone', () => {
    expect(normalizeScriptText('DAN\nHello.')).toBe('DAN\nHello.')
  })

  it('turns literal backslash-n into real newlines', () => {
    expect(normalizeScriptText('DAN\\nHello.\\n\\nMARTA\\nHi.')).toBe(
      'DAN\nHello.\n\nMARTA\nHi.',
    )
  })

  it('handles \\r\\n and \\t literals', () => {
    expect(normalizeScriptText('A\\r\\nB\\tC')).toBe('A\nB\tC')
  })

  it('is a no-op when there is no backslash', () => {
    const plain = 'INT. OFFICE - DAY'
    expect(normalizeScriptText(plain)).toBe(plain)
  })
})

describe('withNormalizedScriptText', () => {
  it('returns the same object when nothing changes', () => {
    const c = { scriptText: 'DAN\nHi.', label: 'A' }
    expect(withNormalizedScriptText(c)).toBe(c)
  })

  it('returns a copy when escapes are collapsed', () => {
    const c = { scriptText: 'DAN\\nHi.', label: 'A' }
    const next = withNormalizedScriptText(c)
    expect(next).not.toBe(c)
    expect(next.scriptText).toBe('DAN\nHi.')
    expect(c.scriptText).toBe('DAN\\nHi.')
  })
})
