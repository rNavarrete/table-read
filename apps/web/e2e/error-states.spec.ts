import { expect, test } from '@playwright/test'
import { sseBody } from './sse-fixtures'

// UI spec §3 Error state + obligations 3/7/9. `MockLlmClient`'s responses
// always succeed, so the failure scenarios here are produced by Playwright
// route interception layered on top of the real api (see
// playwright.config.ts's header comment for why the suite is split this
// way). Each test below uses a scene no other spec file touches, so these
// are independent of test-run order.

test('a dropped connection before any candidate arrives shows the dock-level error card; the canvas stays untouched', async ({
  page,
}) => {
  await page.goto('/?project=proj-longpour&scene=scene-2')
  await expect(page.getByTestId('beat-beat-2-1')).toBeVisible() // scene loaded before snapshotting count
  const beatCountBefore = await page.locator('[data-testid^="beat-"]').count()

  await page.route('**/scenes/scene-2/candidates', (route) => route.abort())
  await page.getByRole('button', { name: 'Next Beat' }).click()

  await expect(page.getByText(/Connection lost/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.locator('[data-testid^="beat-"]')).toHaveCount(
    beatCountBefore,
  )
})

test('one candidate_failed leaves the other two cards actionable — never a partial actionable card for the failed one', async ({
  page,
}) => {
  await page.goto('/?project=proj-longpour&scene=scene-5')

  await page.route('**/scenes/scene-5/candidates', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: sseBody([
        { event: 'candidate_start', data: { index: 0 } },
        {
          event: 'candidate_failed',
          data: {
            error: {
              code: 'LLM_UNAVAILABLE',
              message: 'the language model is unavailable',
            },
          },
        },
        { event: 'candidate_start', data: { index: 1 } },
        {
          event: 'candidate_done',
          data: {
            label: 'Card two',
            beatPlan: {
              whatHappens: 'w',
              audienceLearns: 'l',
              audienceFeels: 'f',
            },
            scriptText: 'Second candidate script.',
            continuityConflicts: [],
          },
        },
        { event: 'candidate_start', data: { index: 2 } },
        {
          event: 'candidate_done',
          data: {
            label: 'Card three',
            beatPlan: {
              whatHappens: 'w',
              audienceLearns: 'l',
              audienceFeels: 'f',
            },
            scriptText: 'Third candidate script.',
            continuityConflicts: [],
          },
        },
        { event: 'done', data: {} },
      ]),
    }),
  )
  await page.getByRole('button', { name: 'Next Beat' }).click()

  const failedCard = page.getByTestId('candidate-card-0')
  await expect(
    failedCard.getByText(/the language model is unavailable/),
  ).toBeVisible()
  await expect(failedCard.getByRole('button', { name: 'Accept' })).toHaveCount(
    0,
  )
  await expect(failedCard.getByRole('button', { name: 'Retry' })).toBeVisible()

  await expect(
    page
      .getByTestId('candidate-card-1')
      .getByRole('button', { name: 'Accept' }),
  ).toBeVisible()
  await expect(
    page
      .getByTestId('candidate-card-2')
      .getByRole('button', { name: 'Accept' }),
  ).toBeVisible()
})

test('a 503 on accept rolls back: the card shows the error, the script canvas ends up unchanged', async ({
  page,
}) => {
  await page.goto('/?project=proj-longpour&scene=scene-4')
  await expect(page.getByTestId('beat-beat-4-1')).toBeVisible() // scene loaded before snapshotting count
  const beatCountBefore = await page.locator('[data-testid^="beat-"]').count()

  await page.getByRole('button', { name: 'Next Beat' }).click()
  const card = page.getByTestId('candidate-card-0')
  await expect(card.getByRole('button', { name: 'Accept' })).toBeVisible({
    timeout: 15_000,
  })

  await page.route('**/scenes/scene-4/beats', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'LLM_UNAVAILABLE',
          message: 'the language model is unavailable',
        },
      }),
    }),
  )
  await card.getByRole('button', { name: 'Accept' }).click()

  await expect(card.getByText(/Accept failed/)).toBeVisible()
  await expect(card.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText(
    'The language model is unavailable — try again in a moment',
  )
  // The optimistic insert was rolled back — beat count matches pre-accept.
  await expect(page.locator('[data-testid^="beat-"]')).toHaveCount(
    beatCountBefore,
  )
})

test('empty scene (scene-6): clear empty copy on the canvas, single Next Beat button in the dock', async ({
  page,
}) => {
  await page.goto('/?project=proj-longpour&scene=scene-6')
  await expect(page.getByText('No beats in this scene yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next Beat' })).toBeVisible()
})

test('mid-stream SSE disconnect: card-0 Accept stays; Retry for the failed in-flight card; canvas unchanged', async ({
  page,
}) => {
  // scene-5 is also used by the candidate_failed test above; this route
  // replaces the whole body with a partial stream (no terminal `done`), so
  // the two tests stay independent as long as they don't share a worker.
  await page.goto('/?project=proj-longpour&scene=scene-5')
  await expect(page.getByTestId('beat-beat-5-1')).toBeVisible()
  const beatCountBefore = await page.locator('[data-testid^="beat-"]').count()

  await page.route('**/scenes/scene-5/candidates', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: sseBody([
        { event: 'candidate_start', data: { index: 0 } },
        {
          event: 'candidate_done',
          data: {
            label: 'Survived card',
            beatPlan: {
              whatHappens: 'w',
              audienceLearns: 'l',
              audienceFeels: 'f',
            },
            scriptText: 'First candidate completed before the drop.',
            continuityConflicts: [],
          },
        },
        { event: 'candidate_start', data: { index: 1 } },
        { event: 'delta', data: { text: 'Partial draft that never finishes' } },
        // No candidate_done for index 1, no candidate 2, no terminal `done` —
        // the client treats clean EOF without `done` as a connection error.
      ]),
    }),
  )
  await page.getByRole('button', { name: 'Next Beat' }).click()

  await expect(
    page
      .getByTestId('candidate-card-0')
      .getByRole('button', { name: 'Accept' }),
  ).toBeVisible()
  await expect(
    page.getByTestId('candidate-card-1').getByRole('button', { name: 'Retry' }),
  ).toBeVisible()
  await expect(page.locator('[data-testid^="beat-"]')).toHaveCount(
    beatCountBefore,
  )
})
