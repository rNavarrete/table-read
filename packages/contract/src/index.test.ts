import { describe, expect, it } from 'vitest'
import { InferredActBreaks } from './index'

// Placeholder scaffold test — real schema tests land in T0.2.
describe('contract scaffold', () => {
  it('runs the test harness', () => {
    expect(true).toBe(true)
  })

  it('accepts non-negative integral JSON numbers for inferred act starts', () => {
    expect(
      InferredActBreaks.parse({
        starts: [
          { act: 0, startSceneIndex: 0 },
          { act: 1.0, startSceneIndex: 3.0 },
        ],
      }),
    ).toEqual({
      starts: [
        { act: 0, startSceneIndex: 0 },
        { act: 1, startSceneIndex: 3 },
      ],
    })
  })

  it.each([
    ['numeric strings', { act: '1', startSceneIndex: 0 }],
    ['numeric index strings', { act: 1, startSceneIndex: '0' }],
    ['booleans', { act: true, startSceneIndex: 0 }],
    ['boolean indices', { act: 1, startSceneIndex: false }],
    ['fractional acts', { act: 1.5, startSceneIndex: 0 }],
    ['fractional scene indices', { act: 1, startSceneIndex: 0.5 }],
    ['negative acts', { act: -1, startSceneIndex: 0 }],
    ['negative scene indices', { act: 1, startSceneIndex: -1 }],
  ])('rejects %s in inferred act starts', (_label, start) => {
    expect(() => InferredActBreaks.parse({ starts: [start] })).toThrow()
  })

  it('rejects empty inferred act starts', () => {
    expect(() => InferredActBreaks.parse({ starts: [] })).toThrow()
  })
})
