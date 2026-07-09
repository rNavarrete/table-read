import { expect, test } from '@playwright/test'

// T3.1 acceptance criteria (build plan, verbatim): reorder scene-4 before
// scene-3 persists after reload; lock icon renders on beat-1-2 (locked in
// fixture); inspector shows motivations + affected ledger facts for the
// selected scene. Runs against the real api + seeded fixture DB (this
// harness — playwright.config.ts's webServer, e2e/start-api.sh) — no route
// interception, this is the real PATCH wiring.
//
// Shared-DB note (same design as write.spec.ts/error-states.spec.ts): one
// worker, one seeded project for the whole `make e2e` run. This file's
// mutations (the scene-3/scene-4 swap, the scene-6 lock toggle) are chosen
// to be inert for every other spec — Write mode never reads `scene.act`,
// `scene.index`, or `scene.locked` (only `beat.locked`/`scriptLocked`
// gate its rendering), so nothing here can break locked-beat/quiet-ai/
// write/error-states' assertions, in either run order.

test('reorder scene-4 before scene-3 (cross-act drag) persists after reload', async ({
  page,
}) => {
  await page.goto('/plan')

  const actOne = page.getByTestId('act-frame-1') // ACT ONE: scene-2, scene-3 in the seeded fixture
  const actTwo = page.getByTestId('act-frame-2') // ACT TWO: scene-4 in the seeded fixture
  await expect(actOne.getByTestId('scene-card-scene-3')).toBeVisible()
  await expect(actTwo.getByTestId('scene-card-scene-4')).toBeVisible()

  await page
    .getByTestId('scene-card-scene-4')
    .dragTo(page.getByTestId('scene-card-scene-3'))

  // scene-4 now lives inside Act One's frame, immediately before scene-3
  // (Act One's other member, scene-2, sorts before both by index) — the
  // "reorder scene-4 before scene-3" acceptance criterion, made visually
  // concrete. Act Two is left with no scenes.
  await expect(actOne.getByTestId('scene-card-scene-4')).toBeVisible()
  await expect(actTwo.getByTestId('scene-card-scene-4')).toHaveCount(0)

  async function actOneOrder() {
    return page
      .getByTestId('act-frame-1')
      .locator('[data-testid^="scene-card-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  }
  expect(await actOneOrder()).toEqual([
    'scene-card-scene-2',
    'scene-card-scene-4',
    'scene-card-scene-3',
  ])

  await page.reload()

  await expect(
    page.getByTestId('act-frame-1').getByTestId('scene-card-scene-4'),
  ).toBeVisible()
  await expect(
    page.getByTestId('act-frame-2').getByTestId('scene-card-scene-4'),
  ).toHaveCount(0)
  expect(await actOneOrder()).toEqual([
    'scene-card-scene-2',
    'scene-card-scene-4',
    'scene-card-scene-3',
  ])
})

test('lock icon renders on beat-1-2 (locked in fixture); beat-1-1 has none', async ({
  page,
}) => {
  await page.goto('/plan')

  const scene1 = page.getByTestId('scene-card-scene-1')
  await scene1.getByRole('button', { name: 'Expand beats' }).click()

  const beat12 = page.getByTestId('beat-card-beat-1-2')
  await expect(beat12).toBeVisible()
  await expect(beat12).toContainText('Locked')

  const beat11 = page.getByTestId('beat-card-beat-1-1')
  await expect(beat11).toBeVisible()
  await expect(beat11).not.toContainText('Locked')
})

test('inspector shows motivations and affected ledger facts for the selected scene', async ({
  page,
}) => {
  await page.goto('/plan')

  await page.getByTestId('scene-card-scene-1').click()
  const inspector = page.getByTestId('inspector')

  // Motivations table: characterId resolved to a display name, plus the
  // fixture's own objective text.
  await expect(inspector).toContainText('Marta Vega')
  await expect(inspector).toContainText('Dan Vega')
  await expect(inspector).toContainText(
    "Come home without admitting it's a retreat.",
  )

  // Affected facts: fixture facts whose sourceSpan.sceneId is scene-1.
  await expect(inspector).toContainText(
    "Marta has been away from Harbor's End for eight years",
  )
  await expect(inspector).toContainText(
    'Dan does not know that Marta saw the transfer',
  )
  // A fact whose sourceSpan.sceneId is a *different* scene must not appear.
  await expect(inspector).not.toContainText('stolen $40,000 is hidden')
})

test('locking a scene via the inspector disables drag and shows the read-only banner', async ({
  page,
}) => {
  await page.goto('/plan')

  const scene6 = page.getByTestId('scene-card-scene-6')
  await expect(scene6).toHaveAttribute('draggable', 'true')

  await scene6.click()
  const inspector = page.getByTestId('inspector')
  await expect(inspector.getByRole('switch')).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await inspector.getByRole('switch').click()

  await expect(inspector.getByText('Locked — unlock to edit')).toBeVisible()
  await expect(scene6).toHaveAttribute('draggable', 'false')
  await expect(scene6).toHaveAttribute('data-locked', 'true')

  // Persists: reload and the scene is still locked, still drag-disabled.
  await page.reload()
  await expect(page.getByTestId('scene-card-scene-6')).toHaveAttribute(
    'draggable',
    'false',
  )
})
