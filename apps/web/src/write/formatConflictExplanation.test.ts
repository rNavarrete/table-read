import { describe, expect, it } from 'vitest'
import { formatConflictExplanation } from './formatConflictExplanation'

describe('formatConflictExplanation', () => {
  it('keeps short human explanations', () => {
    expect(formatConflictExplanation("Dan doesn't know")).toBe(
      "Dan doesn't know",
    )
  })

  it('strips fact ids and audienceKnows jargon', () => {
    const raw =
      "Fact states Biff is 'considering the possibilities' privately (audienceKnows:false for his specific intentions/plan re: fact-27056bc89534); beat keeps this internal/behavioral only, not confessed aloud, preserving the fact's boundary. (fact-27056bc89534)"
    const cleaned = formatConflictExplanation(raw)
    expect(cleaned).not.toMatch(/audienceKnows/i)
    expect(cleaned).not.toMatch(/fact-/)
    expect(cleaned.toLowerCase()).toContain('biff')
  })

  it('falls back when nothing readable remains', () => {
    expect(formatConflictExplanation('fact-04 audienceKnows:false')).toBe(
      'This beat may disagree with something already in the Ledger.',
    )
  })
})
