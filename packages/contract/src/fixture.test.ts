import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PersistedState } from './index'

// The fixture is the single real-world instance of the full persisted-state
// envelope (data contract §5 / task T0.2 controller notes): project, ledger,
// snapshots, consistencyFlags, changeSets, suggestionHistory. This test must
// validate the actual committed fixture file, not a hand-rolled subset.
const fixturePath = fileURLToPath(
  new URL('../../../docs/tableread-fixture.json', import.meta.url),
)
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'))

describe('fixture validates against the Zod contract', () => {
  it('parses the full persisted-state envelope with no errors', () => {
    const result = PersistedState.safeParse(fixture)
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })
})
