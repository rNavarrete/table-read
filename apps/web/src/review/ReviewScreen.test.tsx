import { describe, expect, it } from 'vitest'
import { pendingReviewCount } from './pendingReviewCount'

describe('pendingReviewCount', () => {
  it('counts only pending_review facts (UI spec §2 badge)', () => {
    expect(
      pendingReviewCount([
        { status: 'pending_review' },
        { status: 'active' },
        { status: 'pending_review' },
        { status: 'rejected' },
      ]),
    ).toBe(2)
  })

  it('returns 0 for an empty ledger', () => {
    expect(pendingReviewCount([])).toBe(0)
  })
})
