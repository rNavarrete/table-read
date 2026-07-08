// Validates docs/tableread-fixture.json's full persisted-state envelope
// against the Zod contract. Invoked by scripts/check_contract.py. Exits 1
// and prints the Zod issue list on failure.
import { readFileSync } from 'node:fs'
import { PersistedState } from '../src/index.ts'

const fixturePath = new URL(
  '../../../docs/tableread-fixture.json',
  import.meta.url,
)
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'))

const result = PersistedState.safeParse(fixture)
if (!result.success) {
  console.error(JSON.stringify(result.error.issues, null, 2))
  process.exit(1)
}
