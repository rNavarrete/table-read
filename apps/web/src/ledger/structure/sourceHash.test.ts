import { describe, expect, it } from 'vitest'
import type { Scene } from 'contract'
import { structureSourceHash } from './sourceHash'

const scene = (id: string, beats: { id: string; scriptText?: string }[]) =>
  ({ id, beats }) as unknown as Scene

describe('structureSourceHash', () => {
  it('matches the Python vector', async () => {
    const scenes = [
      scene('scene-1', [
        { id: 'beat-1-1', scriptText: 'INT. BAR - NIGHT\nMarta pours.' },
        { id: 'beat-1-2', scriptText: 'Café — “ok”' },
      ]),
      scene('scene-2', []),
      scene('scene-3', [{ id: 'beat-3-1' }]),
    ]
    expect(await structureSourceHash(scenes)).toBe(
      'b9c534c0bc4d1db690a5d82bb4c0e4a9f87ec02be3119977227131d62c27735f',
    )
    expect(await structureSourceHash([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
