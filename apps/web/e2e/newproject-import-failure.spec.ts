import { expect, test } from '@playwright/test'
import { sseBody } from './sse-fixtures'

// Spec §12 flow 3 (verbatim): Inject import failure → no project appears →
// source remains available for retry. Runs against the real api + seeded
// fixture DB, with Playwright route interception on the create-and-import SSE
// stream to inject the failure (the same split as error-states.spec.ts:
// MockLlmClient always succeeds, so a failure must be layered on top).

const FILENAME = 'retry-me.fountain'
const SOURCE =
  'INT. THE LONG POUR - NIGHT\n\nDAN\nWe are closed.\n\nMarta sets a coaster.'

test('an import failure creates no project and keeps the source for retry', async ({
  page,
}) => {
  await page.goto('/projects/new/import')

  // Step 1 — upload the script (selecting a file never analyzes it).
  await page.getByLabel('Script file').setInputFiles({
    name: FILENAME,
    mimeType: 'text/plain',
    buffer: Buffer.from(SOURCE),
  })
  await expect(page.getByText(new RegExp(FILENAME))).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 2 — confirm basics (title prefilled from the filename).
  await expect(page.getByLabel('Title')).toHaveValue('retry-me')
  await page.getByRole('button', { name: 'Continue' }).click()
  // Step 3 — review source.
  await page.getByRole('button', { name: 'Continue' }).click()

  // Inject a terminal `failed` event on the only AI trigger.
  await page.route('**/api/v1/projects/import', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: sseBody([
        {
          event: 'failed',
          data: {
            type: 'failed',
            error: {
              code: 'LLM_UNAVAILABLE',
              message: 'the language model is unavailable',
            },
          },
        },
      ]),
    }),
  )

  await page.getByRole('button', { name: 'Create & analyze script' }).click()

  // Truthful failure: nothing was created, the draft is intact, Retry offered.
  await expect(
    page.getByText(/Import failed: the language model is unavailable/),
  ).toBeVisible()
  await expect(
    page.getByText(
      'Nothing was created. Your script and settings are still here.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()

  // Still on the wizard — never navigated to Plan.
  await expect(page).toHaveURL(/\/projects\/new\/import/)

  // No project appeared on the backend (the import transaction is atomic; the
  // intercepted stream means the server never even ran it).
  const list = await page.request.get('/api/v1/projects')
  const titles = ((await list.json()) as Array<{ title: string }>).map(
    (project) => project.title,
  )
  expect(titles).not.toContain('retry-me')

  // Source remains available for retry: Edit source returns to step 1 with the
  // uploaded file still in the draft.
  await page.getByRole('button', { name: 'Edit source' }).click()
  await expect(page.getByText(new RegExp(FILENAME))).toBeVisible()
})
