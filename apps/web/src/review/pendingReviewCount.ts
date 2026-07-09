/** UI spec §2: Ledger badge = pending_review count (Write / Plan / Review). */
export function pendingReviewCount(
  ledger: ReadonlyArray<{ status: string }>,
): number {
  return ledger.filter((f) => f.status === 'pending_review').length
}
