import { expect, test } from '@playwright/test'
import { sseBody } from './sse-fixtures'

// T11.3: an import paused at the writer's spending limit, then continued with
// a higher one. The mock costs nothing (demo mode), so it can never reach a
// limit: the first stream is intercepted with the pause the server sends
// (data contract §4 `IMPORT_SPEND_LIMIT`), and Continue goes through to the
// real api + MockLlmClient, which finishes the import. The server's own
// pause and resume are pinned by apps/api/tests/test_import_spend_limit.py.
// `zz-` keeps it after the specs that need the seed unchanged.

const FILENAME = 'over-budget.fountain'
// One six-line scene: what the mock's default `segment_scene` covers.
const SOURCE = [
  'INT. THE LONG POUR - NIGHT',
  '',
  'DAN',
  'We are closed.',
  '',
  'Marta sets a coaster straight on the bar.',
].join('\n')

test('a paused import continues with a higher limit on the same key', async ({
  page,
}) => {
  await page.goto('/projects/new/import')
  await page.getByLabel('Script file').setInputFiles({
    name: FILENAME,
    mimeType: 'text/plain',
    buffer: Buffer.from(SOURCE),
  })
  await expect(page.getByText(new RegExp(FILENAME))).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('over-budget')

  const requests: Array<{ body: Record<string, unknown>; key: string }> = []
  await page.route('**/api/v1/projects/import', async (route) => {
    const request = route.request()
    requests.push({
      body: request.postDataJSON() as Record<string, unknown>,
      key: request.headers()['idempotency-key'],
    })
    if (requests.length > 1) return route.continue()
    return route.fulfill({
      contentType: 'text/event-stream',
      body: sseBody([
        { event: 'stage', data: { type: 'stage', name: 'parsing_scenes' } },
        {
          event: 'progress',
          data: {
            type: 'progress',
            stage: 'parsing_scenes',
            done: 1,
            total: 1,
            spentUsd: 0,
          },
        },
        { event: 'stage', data: { type: 'stage', name: 'segmenting_beats' } },
        {
          event: 'failed',
          data: {
            type: 'failed',
            error: {
              code: 'IMPORT_SPEND_LIMIT',
              message: 'paused at $4.82 of your $5.00 limit',
              details: { spentUsd: 4.82, maxCostUsd: 5, remainingUsd: 2.1 },
            },
          },
        },
      ]),
    })
  })

  await page.getByRole('button', { name: 'Create & analyze script' }).click()

  // Paused, not failed: what it spent, what is left, Continue and Stop.
  const paused = page.getByTestId('import-paused')
  await expect(paused).toContainText(
    'Paused at $4.82 of your $5.00 limit. About $2.10 more should finish this import.',
  )
  await expect(page.getByText(/Import failed/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  await expect(page.getByTestId('board-step-segmenting_beats')).toHaveAttribute(
    'data-status',
    'stopped',
  )

  await page.getByRole('button', { name: 'Continue (up to $8.00)' }).click()

  // The same request and key with the higher limit; the real import runs.
  await expect(page.getByTestId('board-finale')).toBeVisible({
    timeout: 20_000,
  })
  expect(requests).toHaveLength(2)
  expect(requests[1].key).toBe(requests[0].key)
  expect(requests[1].body).toMatchObject({
    title: 'over-budget',
    maxCostUsd: 8,
  })
  // Demo mode: the receipt says so instead of a price.
  await expect(page.getByTestId('import-cost')).toHaveText(
    'Demo mode — no cost',
  )

  const list = await page.request.get('/api/v1/projects')
  const titles = ((await list.json()) as Array<{ title: string }>).map(
    (project) => project.title,
  )
  expect(titles).toContain('over-budget')
})
