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

  it('walks scenes by act and index, beats by index (Python vector)', async () => {
    const at = (id: string, act: number, index: number, beats: object[]) =>
      ({ id, act, index, beats }) as unknown as Scene
    const scenes = [
      at('scene-a', 1, 1, [
        { id: 'beat-a-2', index: 1, scriptText: 'two' },
        { id: 'beat-a-1', index: 0, scriptText: 'one' },
      ]),
      at('scene-b', 1, 0, [{ id: 'beat-b-1', index: 0, scriptText: 'b' }]),
      at('scene-c', 0, 5, [{ id: 'beat-c-1', index: 0, scriptText: 'c' }]),
    ]
    expect(await structureSourceHash(scenes)).toBe(
      'a609cf03fd17c719082283cd94f032e7cf5fef723207e1f1666b9b9aea702ce6',
    )
  })
})
