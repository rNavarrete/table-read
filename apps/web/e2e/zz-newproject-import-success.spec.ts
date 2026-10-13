import { expect, test } from '@playwright/test'

// Spec §12 flow 2 (verbatim): Dashboard → Import → upload fixture Fountain →
// explicit create/analyze → Plan scenes/beats → Ledger pending queue. The
// import board (2026-10-12) holds at the finale until Open your story. Runs
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

test('import a script → the board holds at the finale → Open your story shows the pending queue', async ({
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

  // Step 2 — Check & start: title prefilled from the filename. No format
  // question; the import works the format out from the script.
  await expect(page.getByLabel('Title')).toHaveValue('the-long-pour')
  await expect(page.getByRole('radio')).toHaveCount(0)

  // The only AI trigger. Real SSE stream runs the create-and-import.
  await page.getByRole('button', { name: 'Create & analyze script' }).click()

  // The board builds live from `found` frames. The mock finishes in under a
  // second, so it must still reach the finale, and it holds there: nothing
  // navigates until the writer chooses.
  const board = page.getByTestId('import-board')
  await expect(board.getByTestId('board-finale')).toBeVisible({
    timeout: 20_000,
  })
  await expect(board.getByTestId('board-headline')).toHaveText(
    'The board is up.',
  )
  await expect(board.getByTestId('board-card-0')).toHaveAttribute(
    'data-state',
    'read',
  )
  await expect(board.locator('[data-testid^="board-act-"]')).not.toHaveCount(0)
  await expect(page).toHaveURL(/\/projects\/new\/import/)

  // Open your story (focused) lands on the Ledger's Story tab.
  const openStory = board.getByTestId('open-your-story')
  await expect(openStory).toBeFocused()

  // A read card opens its beats beside the board (T9.17), the finale
  // included, without moving a card; Esc closes it and focus returns.
  const card = board.getByTestId('board-card-0')
  const layout = () =>
    card.evaluate((el: HTMLElement) => [el.offsetLeft, el.offsetTop])
  const before = await layout()
  const readCard = board.getByRole('button', { name: 'Read scene 1' })
  await readCard.click()
  const reading = board.getByTestId('board-reading')
  await expect(reading).toContainText(
    '~ Marta confronts Dan with the transfer record.',
  )
  await expect(reading).toContainText(
    'Audience learns · Marta has proof of the transfer.',
  )
  expect(await layout()).toEqual(before)
  await page.keyboard.press('Escape')
  await expect(reading).toBeHidden()
  await expect(readCard).toBeFocused()

  await openStory.click()
  await page.waitForURL(/\/ledger\?project=/)
  await expect(
    page.getByRole('button', { name: 'Story', pressed: true }),
  ).toBeVisible()

  // The imported fact is pending_review → the Ledger badge carries its count…
  await expect(page.getByRole('tab', { name: /Ledger/ })).toContainText(/\d/)

  // …and it is waiting in the review queue on the Story tab.
  await expect(page.getByTestId('review-queue')).toBeVisible()
})
