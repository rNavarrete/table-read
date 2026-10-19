import { describe, expect, it } from 'vitest'
import { estimateImportCost, formatImportCostLine } from './importCostEstimate'

describe('estimateImportCost', () => {
  it('returns zeros/null for zero scenes', () => {
    expect(estimateImportCost({ sceneCount: 0, charCount: 100 })).toEqual({
      estimatedModelCalls: 0,
      estimatedCostUsd: null,
    })
  })

  it('counts 2N + ceil(N/10) + 4 model calls', () => {
    expect(
      estimateImportCost({ sceneCount: 110, charCount: 175_000 })
        .estimatedModelCalls,
    ).toBe(235)
    expect(
      estimateImportCost({ sceneCount: 10, charCount: 40_000 })
        .estimatedModelCalls,
    ).toBe(25)
  })

  // Round 2 measured ~$2.64 for a 68-scene, ~37k-character import; the
  // estimate used to say $0.65-$1.14.
  it.each([54, 68])('brackets ~$2.64 for %i scenes of ~37k characters', (n) => {
    const { low, high } = estimateImportCost({
      sceneCount: n,
      charCount: 37_000,
    }).estimatedCostUsd!
    expect(low).toBeLessThanOrEqual(2.64)
    expect(high).toBeGreaterThanOrEqual(2.64)
    expect(high / low).toBeLessThan(2)
  })

  it('costs more for a longer script: every call reads the cached script', () => {
    const short = estimateImportCost({ sceneCount: 54, charCount: 37_000 })
    const long = estimateImportCost({ sceneCount: 54, charCount: 125_000 })
    expect(long.estimatedCostUsd!.low).toBeGreaterThan(
      short.estimatedCostUsd!.low,
    )
  })
})

describe('formatImportCostLine', () => {
  it('formats scene count, model calls, and cost range', () => {
    expect(
      formatImportCostLine({
        detectedSceneCount: 2,
        estimatedModelCalls: 9,
        estimatedCostUsd: { low: 0.01, high: 0.03 },
      }),
    ).toBe('2 scene(s) detected · ~9 model calls · Est. $0.01–$0.03')
  })
})
