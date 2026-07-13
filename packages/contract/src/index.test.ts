import { describe, expect, it } from 'vitest'
import { InferredActBreaks } from './index'

// Placeholder scaffold test — real schema tests land in T0.2.
describe('contract scaffold', () => {
  it('runs the test harness', () => {
    expect(true).toBe(true)
  })

  it('validates typed inferred act starts', () => {
    expect(
      InferredActBreaks.parse({
        starts: [
          { act: 0, startSceneIndex: 0 },
          { act: 1, startSceneIndex: 3 },
        ],
      }),
    ).toEqual({
      starts: [
        { act: 0, startSceneIndex: 0 },
        { act: 1, startSceneIndex: 3 },
      ],
    })
    expect(() => InferredActBreaks.parse({ starts: [] })).toThrow()
  })
})
