import { describe, expect, it } from 'vitest'
import { FORMAT_PRESETS } from './FormatPresets'

describe('FORMAT_PRESETS', () => {
  it('matches the approved new-project format presets exactly', () => {
    expect(FORMAT_PRESETS).toEqual({
      'one-hour-drama': {
        genre: 'drama',
        runtimeMinutes: 60,
        actCount: 5,
        coldOpen: true,
        tag: true,
        serialization: 0.7,
      },
      'half-hour-comedy': {
        genre: 'comedy',
        runtimeMinutes: 30,
        actCount: 2,
        coldOpen: true,
        tag: false,
        serialization: 0.3,
      },
      'actless-streaming': {
        genre: 'dramedy',
        runtimeMinutes: 60,
        actCount: 1,
        coldOpen: false,
        tag: false,
        serialization: 0.8,
      },
    })
  })
})
