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

  // Step 2 — Check & start (title prefilled from the filename).
  await expect(page.getByLabel('Title')).toHaveValue('retry-me')

  // Inject a failure mid-stage on the only AI trigger: parsing finished and
  // dealt one card, then segmenting stopped.
  await page.route('**/api/v1/projects/import', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: sseBody([
        { event: 'stage', data: { type: 'stage', name: 'parsing_scenes' } },
        {
          event: 'found',
          data: {
            type: 'found',
            stage: 'parsing_scenes',
            data: {
              kind: 'scenes',
              scenes: [
                {
                  index: 0,
                  slugline: 'INT. THE LONG POUR - NIGHT',
                  lineCount: 6,
                  intExt: 'int',
                },
              ],
            },
          },
        },
        { event: 'stage', data: { type: 'stage', name: 'segmenting_beats' } },
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
  await expect(
    page.getByRole('link', { name: 'Return to dashboard' }),
  ).toHaveAttribute('href', '/projects')

  // The board freezes where it got to: the step that failed reads Stopped,
  // the step before it is done, and the unread card stays unread.
  const board = page.getByTestId('import-board')
  await expect(
    board.getByTestId('board-step-segmenting_beats'),
  ).toHaveAttribute('data-status', 'stopped')
  await expect(board.getByTestId('board-step-segmenting_beats')).toContainText(
    'Stopped',
  )
  await expect(board.getByTestId('board-step-parsing_scenes')).toHaveAttribute(
    'data-status',
    'done',
  )
  await expect(board.getByTestId('board-card-0')).toHaveAttribute(
    'data-state',
    'pending',
  )
  await expect(board.getByTestId('segmenting_beats-indeterminate')).toHaveCount(
    0,
  )

  // Still on the wizard — never navigated to Plan.
  await expect(page).toHaveURL(/\/projects\/new\/import/)

  // No project appeared on the backend (the import transaction is atomic; the
  // intercepted stream means the server never even ran it).
  const list = await page.request.get('/api/v1/projects')
  const titles = ((await list.json()) as Array<{ title: string }>).map(
    (project) => project.title,
  )
  expect(titles).not.toContain('retry-me')

  // Source remains available for retry: Edit source opens the script text in
  // place, still holding the uploaded source.
  await page.getByRole('button', { name: 'Edit source' }).click()
  await expect(page.getByLabel('Script text')).toBeFocused()
  await expect(page.getByLabel('Script text')).toHaveValue(SOURCE)
})
