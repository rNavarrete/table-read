import { expect, test } from '@playwright/test'

// T5.1 acceptance criteria (build plan, verbatim): fixture fact-06
// (`pending_review`) shows in queue → edit text → provenance flips to
// `writer_authored`, status `active`. Runs against the real api + seeded
// fixture DB (playwright.config.ts webServer / e2e/start-api.sh).
//
// Shared-DB note: this spec mutates fact-06 (pending → active via edit).
// Other specs that assert the Ledger badge as the pending_review count
// must tolerate fact-06 already being reviewed if this runs first — the
// write.spec badge assertion uses the live pending count at load, not a
// hard-coded "1". Reject eligibility is covered by the API test
// `test_reject_plain_pending_review` (isPromptEligibleFact / ledger_filter).

test('fact-06 pending_review is in the queue; edit → writer_authored + active', async ({
  page,
}) => {
  await page.goto('/ledger?project=proj-longpour')

  const queue = page.getByTestId('review-queue')
  await expect(queue).toBeVisible()
  await expect(queue).toContainText('awaiting review')

  const card = queue.getByTestId('fact-card-fact-06')
  await expect(card).toBeVisible()
  await expect(card).toContainText('pending_review')
  await expect(card).toContainText('inferred')

  // ModeSwitcher badge = pending_review count (at least fact-06).
  const ledgerTab = page.getByRole('tab', { name: /Ledger/ })
  await expect(ledgerTab).toContainText(/\d/)

  await card.getByTestId('edit-fact-06').click()
  const textarea = page.getByTestId('fact-edit-text-fact-06')
  await textarea.fill('Reyes may be bluffing about the warrant.')
  await page.getByRole('button', { name: 'Save' }).click()

  // Leaves the review queue; card in the grid shows writer-authored + active.
  await expect(page.getByTestId('review-queue')).toHaveCount(0)
  const updated = page.getByTestId('fact-card-fact-06')
  await expect(updated).toBeVisible()
  await expect(updated).toContainText('writer-authored')
  await expect(updated).toContainText('active')
  await expect(updated).toContainText(
    'Reyes may be bluffing about the warrant.',
  )

  // Badge clears when the queue is empty (no amber count).
  await expect(page.getByRole('tab', { name: 'Ledger' })).toHaveText('Ledger')
})

test('Ledger tab is enabled from Write mode and navigates to /ledger', async ({
  page,
}) => {
  await page.goto('/?project=proj-longpour')
  const ledger = page.getByRole('tab', { name: /Ledger/ })
  await expect(ledger).toBeEnabled()
  await ledger.click()
  await expect(page).toHaveURL(/\/ledger/)
  await expect(page.getByTestId('ledger-filter-rail')).toBeVisible()
})
