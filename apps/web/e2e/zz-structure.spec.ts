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

test('structure tab: a Turning Points check places its stages in words', async ({
  page,
}) => {
  await page.goto('/ledger?project=proj-longpour')
  await page.getByRole('button', { name: 'Structure', exact: true }).click()
  await page.getByTestId('structure-pick').selectOption('turning_points')
  await page.getByTestId('structure-check-button').click()
  // The prompt-derived mock cites the seeded beats in order; the server places
  // them by share of the fixture's script text.
  await expect(
    page.getByTestId('structure-placement-tp_opportunity'),
  ).toHaveText('at 9% · expected 11% ± 7')
  await expect(
    page.getByTestId('structure-placement-tp_major_setback'),
  ).toContainText('earlier than usual')
  await expect(
    page.getByTestId('structure-placement-tp_point_of_no_return'),
  ).toHaveCount(0)
})
