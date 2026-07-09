import { describe, expect, it } from 'vitest'
import { wordDiff } from './wordDiff'

describe('wordDiff', () => {
  it('marks unchanged words as equal', () => {
    expect(wordDiff('the bar safe', 'the bar safe')).toEqual([
      { kind: 'equal', text: 'the' },
      { kind: 'equal', text: ' ' },
      { kind: 'equal', text: 'bar' },
      { kind: 'equal', text: ' ' },
      { kind: 'equal', text: 'safe' },
    ])
  })

  it('marks replaced words as del + ins', () => {
    const tokens = wordDiff('hides at the bar', 'hides at the marina')
    expect(tokens).toContainEqual({ kind: 'del', text: 'bar' })
    expect(tokens).toContainEqual({ kind: 'ins', text: 'marina' })
    expect(tokens.filter((t) => t.kind === 'equal').map((t) => t.text)).toEqual(
      ['hides', ' ', 'at', ' ', 'the', ' '],
    )
  })

  it('handles empty after as all deletions', () => {
    expect(wordDiff('gone', '')).toEqual([{ kind: 'del', text: 'gone' }])
  })
})
