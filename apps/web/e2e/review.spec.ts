import { expect, test } from '@playwright/test'

/**
 * T4.3 Review UI acceptance journey (build plan, paraphrased):
 * trigger scene-premise change → rows render with 1 disabled locked row →
 * preview → apply → board reflects only approved changes; Flag only leaves
 * project untouched and Change Set `flagged`.
 *
 * Runs against the real api + seeded DB + MockLlmClient (e2e/start-api.sh).
 * Preview/apply/discard/flag are live endpoints — no page.route mocks.
 *
 * Locked row: PATCH-lock scene-5 before Open Review so the marina blast
 * includes a disabled locked regenerate row. MockLlmClient's default
 * regenerate payload covers scene-2 + beat-4-2; scene-5 stays out of the
 * approved set (locked → not selectable).
 */

const MARINA = 'Dan hides the money at the marina instead of the bar'
const PROJECT_ID = 'proj-longpour'

async function lockScene5(
  request: import('@playwright/test').APIRequestContext,
) {
  const res = await request.patch(`/api/v1/projects/${PROJECT_ID}`, {
    data: [
      {
        op: 'replace',
        path: '/seasons/0/episodes/0/scenes/4/locked',
        value: true,
      },
    ],
  })
  expect(res.ok()).toBeTruthy()
}

test('Review journey: Open Review → locked row → preview → apply → plan board', async ({
  page,
  request,
}) => {
  await lockScene5(request)

  const before = await (
    await request.get(`/api/v1/projects/${PROJECT_ID}`)
  ).json()
  const scenesBefore = before.seasons[0].episodes[0].scenes as Array<{
    id: string
    whatHappens: string
    beats?: Array<{ id: string; whatHappens: string }>
  }>
  const scene2Before = scenesBefore.find((s) => s.id === 'scene-2')!.whatHappens
  const scene5Before = scenesBefore.find((s) => s.id === 'scene-5')!.whatHappens
  const beat42Before = scenesBefore
    .find((s) => s.id === 'scene-4')!
    .beats!.find((b) => b.id === 'beat-4-2')!.whatHappens

  await page.goto('/plan?project=proj-longpour')

  await page.getByTestId('scene-card-scene-2').click()
  const inspector = page.getByTestId('inspector')
  await inspector.getByLabel('What happens').fill(MARINA)
  await inspector.getByRole('button', { name: 'Open Review' }).click()

  await expect(page).toHaveURL(/\/review\?.*changeSet=/)
  await expect(page.getByTestId('change-set-panel')).toBeVisible()
  await expect(page.getByText(MARINA)).toBeVisible()

  // Locked row: no checkbox, lock glyph present.
  const lockedRow = page.getByTestId('change-set-row-scene-5')
  await expect(lockedRow).toBeVisible()
  await expect(lockedRow.getByLabel('Locked')).toBeVisible()
  await expect(lockedRow.getByRole('checkbox')).toHaveCount(0)

  // Flag-only fact from real create (marina mock blast).
  await expect(page.getByTestId('change-set-row-fact-02')).toBeVisible()
  await expect(
    page.getByTestId('change-set-row-fact-02').getByLabel('Flag only'),
  ).toBeVisible()

  // Uncheck beat-4-2, then re-check — proves selection toggles and that
  // Apply stays gated on Preview for the final approved set.
  const beat42 = page.getByTestId('change-set-row-beat-4-2')
  const beat42Check = beat42.getByRole('checkbox')
  await expect(beat42Check).toBeChecked()
  await beat42Check.uncheck()
  await expect(beat42Check).not.toBeChecked()
  await beat42Check.check()

  const scene2 = page.getByTestId('change-set-row-scene-2')
  await expect(scene2.getByRole('checkbox')).toBeChecked()

  const applyBtn = page.getByRole('button', { name: 'Apply selected' })
  await expect(applyBtn).toBeDisabled()

  await page.getByRole('button', { name: 'Preview selected' }).click()
  await expect(applyBtn).toBeEnabled()

  await scene2.getByRole('button', { name: 'Expand row' }).click()
  await expect(scene2.getByTestId('diff-after')).not.toContainText(
    'Preview to generate',
  )

  await applyBtn.click()
  await expect(page.getByTestId('applied-summary')).toBeVisible()

  // Persisted project / Plan board: approved regenerates applied; locked
  // scene-5 unchanged.
  const after = await (
    await request.get(`/api/v1/projects/${PROJECT_ID}`)
  ).json()
  const scenesAfter = after.seasons[0].episodes[0].scenes as Array<{
    id: string
    whatHappens: string
    beats?: Array<{ id: string; whatHappens: string }>
  }>
  const scene2After = scenesAfter.find((s) => s.id === 'scene-2')!
  const scene5After = scenesAfter.find((s) => s.id === 'scene-5')!
  const beat42After = scenesAfter
    .find((s) => s.id === 'scene-4')!
    .beats!.find((b) => b.id === 'beat-4-2')!

  expect(scene2After.whatHappens).not.toBe(scene2Before)
  expect(scene2After.whatHappens.toLowerCase()).toContain('marina')
  expect(beat42After.whatHappens).not.toBe(beat42Before)
  expect(scene5After.whatHappens).toBe(scene5Before)

  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-2').click()
  await expect(
    page.getByTestId('inspector').getByLabel('What happens'),
  ).toHaveValue(/marina/i)
})

test('after preview, mode-switcher re-entry still finds the Change Set', async ({
  page,
}) => {
  // Preview flips status to `previewing`; Review picker must list it (not
  // only `draft`) so Apply remains reachable after navigating away.
  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-2').click()
  await page.getByTestId('inspector').getByLabel('What happens').fill(MARINA)
  await page
    .getByTestId('inspector')
    .getByRole('button', { name: 'Open Review' })
    .click()
  await expect(page.getByTestId('change-set-panel')).toBeVisible()

  await page.getByRole('button', { name: 'Preview selected' }).click()
  await expect(
    page.getByRole('button', { name: 'Apply selected' }),
  ).toBeEnabled()

  // Mode switcher clears ?changeSet= and lands on the open picker / auto-open.
  await page.getByRole('tab', { name: 'Plan' }).click()
  await expect(page).toHaveURL(/\/plan/)
  await page.getByRole('tab', { name: 'Review' }).click()

  await expect(page.getByTestId('change-set-panel')).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText(MARINA)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Apply selected' }),
  ).toBeEnabled()
})

test('Flag only marks Change Set flagged without mutating the project', async ({
  page,
  request,
}) => {
  const before = await (
    await request.get(`/api/v1/projects/${PROJECT_ID}`)
  ).json()

  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-2').click()
  await page.getByTestId('inspector').getByLabel('What happens').fill(MARINA)
  await page
    .getByTestId('inspector')
    .getByRole('button', { name: 'Open Review' })
    .click()
  await expect(page.getByTestId('change-set-panel')).toBeVisible()

  await page.getByRole('button', { name: 'Flag only' }).click()
  await expect(page.getByText('flagged')).toBeVisible()

  const after = await (
    await request.get(`/api/v1/projects/${PROJECT_ID}`)
  ).json()
  expect(after.seasons[0].episodes[0].scenes).toEqual(
    before.seasons[0].episodes[0].scenes,
  )
})
