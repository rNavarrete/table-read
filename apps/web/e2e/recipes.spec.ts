import { expect, test } from '@playwright/test'

/**
 * Adoption A9 — each workflow recipe completes (all coach steps) against
 * the seeded Long Pour fixture. One worker / shared DB (playwright.config).
 */

const RECIPES = [
  'break-first-scene',
  'lock-and-regenerate',
  'review-a-change',
  'audit-facts',
  'suggest-and-write',
  'undo-timeline',
] as const

const HREFS: Record<(typeof RECIPES)[number], string> = {
  'break-first-scene':
    '/?project=proj-longpour&scene=scene-3&tour=break-first-scene',
  'lock-and-regenerate': '/plan?project=proj-longpour&tour=lock-and-regenerate',
  'review-a-change': '/review?project=proj-longpour&tour=review-a-change',
  'audit-facts': '/ledger?project=proj-longpour&tour=audit-facts',
  'suggest-and-write':
    '/?project=proj-longpour&scene=scene-3&tour=suggest-and-write',
  'undo-timeline': '/?project=proj-longpour&scene=scene-3&tour=undo-timeline',
}

test('dashboard offers recipe picker', async ({ page }) => {
  await page.goto('/projects')
  await expect(page.getByTestId('recipe-picker')).toBeVisible()
  for (const id of RECIPES) {
    await expect(page.getByTestId(`recipe-link-${id}`)).toBeVisible()
  }
})

for (const id of RECIPES) {
  test(`recipe ${id} completes end-to-end`, async ({ page }) => {
    await page.goto(HREFS[id])
    const overlay = page.getByTestId('recipe-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay).toHaveAttribute('data-recipe-id', id)

    // Advance until Done dismisses the overlay (3–5 steps).
    for (let i = 0; i < 6; i++) {
      if (!(await overlay.isVisible().catch(() => false))) break
      const next = page.getByTestId('recipe-next')
      const label = await next.textContent()
      await next.click()
      if (label?.trim() === 'Done') break
    }
    await expect(page.getByTestId('recipe-overlay')).toHaveCount(0)
  })
}
