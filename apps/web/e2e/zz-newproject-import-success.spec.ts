import { expect, test } from '@playwright/test'

// Spec §12 flow 2 (verbatim): Dashboard → Import → upload fixture Fountain →
// explicit create/analyze → Plan scenes/beats → Ledger pending queue. Runs
// against the real api + seeded fixture DB + MockLlmClient — the real
// create-and-import pipeline and SSE stream, no route interception.
//
// Import mints globally unique `fact-<hex>` / `flag-<hex>` ids, so this can
// run alongside the seeded Long Pour ledger without UNIQUE collisions. The
// `zz-` prefix still keeps it last so earlier specs keep a stable seed.

const FILENAME = 'the-long-pour.fountain'
// Exactly six lines with a single slugline: the deterministic scene split
// yields one scene of six lines, which the MockLlmClient's default
// `segment_scene` (one beat, lines 1–6) covers exactly (fountain/parse.py
// coverage check). A longer/multi-scene source would not match the fixed mock.
const SOURCE = [
  'INT. THE LONG POUR - NIGHT',
  '',
  'DAN',
  'We are closed.',
  '',
  'Marta sets a coaster straight on the bar.',
].join('\n')

test('import a script → Plan shows scenes/beats and the Ledger pending queue', async ({
  page,
}) => {
  await page.goto('/projects/new/import')

  // Step 1 — upload the Fountain source.
  await page.getByLabel('Script file').setInputFiles({
    name: FILENAME,
    mimeType: 'text/plain',
    buffer: Buffer.from(SOURCE),
  })
  await expect(page.getByText(new RegExp(FILENAME))).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 2 — confirm basics (title prefilled from the filename).
  await expect(page.getByLabel('Title')).toHaveValue('the-long-pour')
  await page.getByRole('button', { name: 'Continue' }).click()
  // Step 3 — review source.
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 4 — the only AI trigger. Real SSE stream runs the create-and-import.
  await page.getByRole('button', { name: 'Create & analyze script' }).click()

  // On success the writer lands in Plan with the imported scene/beat.
  await page.waitForURL(/\/plan\?project=/, { timeout: 20_000 })
  await expect(page.getByTestId('scene-card-scene-1')).toBeVisible()

  // The imported fact is pending_review → the Ledger badge carries its count.
  const ledgerTab = page.getByRole('tab', { name: /Ledger/ })
  await expect(ledgerTab).toContainText(/\d/)

  // …and it is waiting in the Ledger review queue.
  await ledgerTab.click()
  await expect(page).toHaveURL(/\/ledger/)
  await expect(page.getByTestId('review-queue')).toBeVisible()
})
