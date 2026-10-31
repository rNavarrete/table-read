import { describe, expect, it } from 'vitest'
import pricing from '../../../../../config/llm_pricing.json'
import {
  entityChunks,
  estimateImportCost,
  importCostCopy,
} from './importCostEstimate'

// The calibration check (T11.2): the two complete imports in
// import-diagnostics.log, as scripts/import_cost_report.py prices them. Both
// paid 1-hour cache writes, so they are re-estimated at that rate. When the
// pipeline changes, re-measure and re-tune here.
const MEASURED = [
  { run: 'import-28f20507', sceneCount: 37, charCount: 41_874, actual: 2.33 },
  { run: 'import-c45b4084', sceneCount: 179, charCount: 128_303, actual: 8.9 },
].map((m) => ({
  ...m,
  estimate: estimateImportCost({
    ...m,
    cacheWriteMultiplier: pricing.cacheWrite1hMultiplier,
  })!,
}))
const worstError = Math.max(
  ...MEASURED.map(
    ({ estimate, actual }) => Math.abs(estimate.about - actual) / actual,
  ),
)

describe('estimateImportCost calibration', () => {
  it.each(MEASURED)(
    'the band contains $run ($actual)',
    ({ estimate, actual }) => {
      expect(estimate.low).toBeLessThanOrEqual(actual)
      expect(estimate.high).toBeGreaterThanOrEqual(actual)
    },
  )

  it('lands within 5% of each measured import', () => {
    expect(worstError).toBeLessThan(0.05)
  })

  it.each(MEASURED)(
    'puts "at most" 15% beyond the worse error for $run',
    ({ estimate }) => {
      expect(estimate.high / estimate.about - 1).toBeGreaterThanOrEqual(
        worstError + 0.15,
      )
    },
  )
})

describe('estimateImportCost', () => {
  it('has no estimate without scenes', () => {
    expect(estimateImportCost({ sceneCount: 0, charCount: 100 })).toBeNull()
  })

  it('prices 5-minute cache writes by default', () => {
    const script = { sceneCount: 37, charCount: 41_874 }
    expect(estimateImportCost(script)!.about).toBeLessThan(
      estimateImportCost({
        ...script,
        cacheWriteMultiplier: pricing.cacheWrite1hMultiplier,
      })!.about,
    )
  })

  it('costs more for a longer script: every call reads the cached script', () => {
    const short = estimateImportCost({ sceneCount: 54, charCount: 37_000 })!
    const long = estimateImportCost({ sceneCount: 54, charCount: 125_000 })!
    expect(long.about).toBeGreaterThan(short.about)
  })

  // A facts call's prompt (cast + cached episode) passes Haiku's 100K-token
  // threshold at ~134K source characters: every call then pays 5x.
  it("steps up when facts prompts cross Haiku's long-prompt tier", () => {
    const at = (charCount: number) =>
      estimateImportCost({ sceneCount: 60, charCount })!.about
    const below = at(133_000) - at(131_000)
    const across = at(135_000) - at(133_000)
    expect(across).toBeGreaterThan(10 * below)
  })

  it('chunks entities by summary size and by 12 scenes', () => {
    expect(entityChunks(37, 41_874)).toBe(6)
    expect(entityChunks(120, 1_000)).toBe(10)
  })
})

describe('importCostCopy', () => {
  const estimate = { low: 1.9, about: 2.24, high: 2.91 }

  it('names the API key on a real key', () => {
    expect(importCostCopy(37, estimate, 'real')).toBe(
      'This script has 37 scenes. Importing it will cost about $2.24 on your API key, and at most $2.91.',
    )
  })

  it('says demo mode costs nothing on the mock', () => {
    expect(importCostCopy(37, estimate, 'mock')).toBe(
      'This script has 37 scenes. Demo mode — no cost.',
    )
  })

  it.each([null, 'unconfigured'])(
    'quotes the cost without naming a key when the mode is %s',
    (mode) => {
      expect(importCostCopy(1, estimate, mode)).toBe(
        'This script has 1 scene. Importing it will cost about $2.24, and at most $2.91.',
      )
    },
  )

  it('shows no estimate without scenes, never $0', () => {
    expect(importCostCopy(0, null, 'real')).toBe(
      'No scenes found, so there is no cost estimate.',
    )
  })
})
