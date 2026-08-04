import { describe, expect, it } from 'vitest'
import type { Scene } from 'contract'
import { sceneLocationType } from './sceneType'

function scene(location: string, time = 'DAY'): Scene {
  return {
    id: 's1',
    index: 0,
    act: 1,
    storyline: 'A',
    locked: false,
    location,
    time,
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
  }
}

describe('sceneLocationType', () => {
  it('detects INT and EXT from location', () => {
    expect(sceneLocationType(scene('INT. OVAL OFFICE'))).toBe('int')
    expect(sceneLocationType(scene('EXT. GEORGETOWN'))).toBe('ext')
    expect(sceneLocationType(scene("JOSH'S OFFICE"))).toBe('other')
  })
})
