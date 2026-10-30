import { describe, expect, it } from 'vitest'
import { analyzeSource } from './importSourceStats'

describe('analyzeSource', () => {
  it('returns zero stats for empty source', () => {
    expect(analyzeSource('')).toEqual({
      charCount: 0,
      byteCount: 0,
      lineCount: 1,
      detectedSceneCount: 0,
      estimatedCostUsd: null,
    })
  })

  it('counts sluglines deterministically', () => {
    const source =
      'INT. BAR - NIGHT\nDan pours.\nEXT. STREET - DAY\nMarta leaves.'
    const stats = analyzeSource(source)
    expect(stats.detectedSceneCount).toBe(2)
    expect(stats.estimatedCostUsd?.about).toBeGreaterThan(0)
    expect(stats.lineCount).toBe(4)
    expect(stats.charCount).toBe(source.length)
  })

  it('counts numbered, forced and EXT/INT headings but not prose or ellipses', () => {
    const source = [
      '17 INT. OFFICE - DAY 17',
      'A12 EXT. STREET - NIGHT',
      '.FLASHBACK',
      'EXT/INT CAR - DAY',
      'int. kitchen - day',
      'Int. Kitchen - Day',
      'Ext. is short for exterior.',
      '...and then he left.',
    ].join('\n')
    expect(analyzeSource(source).detectedSceneCount).toBe(6)
  })

  it('treats sluglineless content as one scene when non-empty', () => {
    expect(analyzeSource('Just some plain text.').detectedSceneCount).toBe(1)
  })

  it('counts multi-byte characters by their UTF-8 byte length', () => {
    const stats = analyzeSource('café')
    expect(stats.charCount).toBe(4)
    expect(stats.byteCount).toBe(5) // é is 2 bytes in UTF-8
  })
})
