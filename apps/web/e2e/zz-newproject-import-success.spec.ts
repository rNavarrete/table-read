import { expect, test } from '@playwright/test'

// Spec §12 flow 2 (verbatim): Dashboard → Import → upload fixture Fountain →
// explicit create/analyze → Plan scenes/beats → Ledger pending queue. Runs
// against the real api + seeded fixture DB + MockLlmClient — the real
// create-and-import pipeline and SSE stream, no route interception.
//
// WHY THIS SPEC RUNS LAST (the `zz-` prefix) AND EMPTIES THE DB FIRST:
// Playwright runs the e2e files serially in alphabetical order against one
// shared, fixture-seeded database. A real create-and-import mints ledger fact
// ids as bare ordinals (`fact-01`, ...; storage/models.py `LedgerFactRow.id`
// is the sole PK, not scoped by project), so importing while the seed's
// `fact-01…08` still exist hits `UNIQUE constraint failed: ledger_facts.id`
// and the import fails. (That global-ordinal fact id scheme is a real
// multi-project limitation from the Task 1/Task 5 work — see the Task 7
// report's Concerns section; it is out of scope to fix here.) Emptying the DB
// makes the mock's deterministic single extracted fact land cleanly. Because
// this destroys the shared seed, it must be the final spec — every other spec
// (which depends on proj-longpour) is alphabetically earlier and has already
// run by now.

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
  // Empty the shared DB so the imported project's ordinal fact ids don't
  // collide with the seed's (see the file header).
  const existing = await page.request.get('/api/v1/projects')
  for (const project of (await existing.json()) as Array<{ id: string }>) {
    const purged = await page.request.delete(`/api/v1/projects/${project.id}`)
    expect(purged.ok()).toBeTruthy()
  }

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
