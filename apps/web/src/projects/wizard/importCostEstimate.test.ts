import { describe, expect, it } from 'vitest'
import { estimateImportCost, formatImportCostLine } from './importCostEstimate'

describe('estimateImportCost', () => {
  it('returns zeros/null for zero scenes', () => {
    expect(estimateImportCost({ sceneCount: 0, charCount: 100 })).toEqual({
      estimatedModelCalls: 0,
      estimatedCostUsd: null,
    })
  })

  it('includes bounded Sonnet entity chunks plus three Opus macro calls', () => {
    const r = estimateImportCost({ sceneCount: 110, charCount: 175_000 })
    expect(r.estimatedModelCalls).toBe(234)
    expect(r.estimatedCostUsd).not.toBeNull()
    expect(r.estimatedCostUsd!.low).toBeGreaterThan(0)
    expect(r.estimatedCostUsd!.high).toBeGreaterThanOrEqual(
      r.estimatedCostUsd!.low,
    )
  })

  it('prices the Sonnet worker, Opus macro, and Haiku extraction mix', () => {
    const r = estimateImportCost({ sceneCount: 10, charCount: 40_000 })
    expect(r.estimatedModelCalls).toBe(25)
    expect(r.estimatedCostUsd!.low).toBeGreaterThan(0.05)
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
