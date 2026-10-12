import { expect, test } from '@playwright/test'

// Sorts after the other zz- spec: the Story Circle check advances
// proj-longpour's head on the shared seeded DB.
test('structure tab: TV act structure from the beat sheet, then a Story Circle check', async ({
  page,
}) => {
  await page.goto('/ledger?project=proj-longpour')
  await page.getByRole('button', { name: 'Structure', exact: true }).click()
  const panel = page.getByTestId('structure-panel')
  await expect(panel).toBeVisible()
  // Seeded fixture: no beat sheet; actCount 4, cold open, no tag -> 9 rows, all Missing.
  await expect(panel.locator('[data-testid^="structure-row-"]')).toHaveCount(9)
  await expect(page.getByTestId('structure-row-cold-open')).toContainText(
    'Missing',
  )
  await expect(page.getByTestId('structure-row-climax')).toContainText(
    'Missing',
  )

  await page.getByTestId('structure-pick').selectOption('story_circle')
  await page.getByTestId('structure-check-button').click()
  await expect(
    panel.locator('[data-testid^="structure-row-circle_"]'),
  ).toHaveCount(8)
  // The prompt-derived mock makes stage 0 Hit; clicking it opens Write at its beat.
  await page.getByTestId('structure-row-circle_you').click()
  await expect(page).toHaveURL(/highlightBeat=/)
})
