import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Fountain } from 'fountain-js'
import { describe, expect, it } from 'vitest'

// T1.3 acceptance: the fixture exports to valid Fountain that round-trips
// through fountain-js. The Python side (apps/api/tests/test_fountain_export.py)
// proves `to_fountain(fixture)` equals this committed golden byte-for-byte; this
// test proves the golden parses through fountain-js with the expected scene
// headings — together they cover "fixture exports to valid Fountain".
const goldenPath = fileURLToPath(
  new URL('../../../apps/api/tests/data/long-pour.fountain', import.meta.url),
)
const golden = readFileSync(goldenPath, 'utf-8')

describe('fixture Fountain export round-trips through fountain-js', () => {
  it('parses without error and produces tokens', () => {
    const parsed = new Fountain().parse(golden, true)
    expect(parsed.tokens.length).toBeGreaterThan(0)
  })

  it('reproduces the fixture scene-heading count', () => {
    const parsed = new Fountain().parse(golden, true)
    const sceneHeadings = parsed.tokens.filter(
      (t) => t.type === 'scene_heading',
    )
    // six scripted beats, each opening with a slugline (see the export module)
    expect(sceneHeadings.length).toBe(6)
  })
})
