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
  // The Ledger opens on Atlas; the review queue lives on the Story tab.
  await page.getByRole('button', { name: 'Story', exact: true }).click()

  const queue = page.getByTestId('review-queue')
  await expect(queue).toBeVisible()
  await expect(queue).toContainText('unconfirmed')
  // Collapsed by default (owner decision 2026-10-11); open it to review.
  await page.getByTestId('review-queue-toggle').click()

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

  // Leaves the review queue; its card in the Atlas grid shows writer-authored
  // + active (the grid is on the Atlas tab, the queue on Story).
  await expect(page.getByTestId('review-queue')).toHaveCount(0)
  await page.getByRole('button', { name: 'Atlas', exact: true }).click()
  const updated = page.getByTestId('atlas-row-fact-06')
  await expect(updated).toBeVisible()
  await expect(updated).toContainText(
    'Reyes may be bluffing about the warrant.',
  )
  const ledger = (await (
    await page.request.get('/api/v1/projects/proj-longpour/ledger')
  ).json()) as Array<{ id: string; provenance: string; status: string }>
  const saved = ledger.find((fact) => fact.id === 'fact-06')
  expect(saved?.provenance).toBe('writer_authored')
  expect(saved?.status).toBe('active')

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
