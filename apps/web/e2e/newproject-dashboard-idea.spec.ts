import { expect, test } from '@playwright/test'

// Spec §12 flow 1 (verbatim): Empty DB → dashboard → Start from idea → create
// → guided Plan setup. Runs against the real api + seeded fixture DB
// (playwright.config.ts webServer / e2e/start-api.sh).
//
// Shared-DB note: the e2e harness always seeds proj-longpour and the other
// specs depend on it, so this spec cannot truly empty the database without
// breaking them. The *empty-dashboard* view is therefore produced by
// intercepting only `GET /api/v1/projects` → `[]` (the same route-interception
// precedent as error-states.spec.ts, layered on the real api for a state the
// shared seed can't show). Everything after that is the real flow: the idea
// wizard POSTs a real project (create is not intercepted — a fresh project has
// an empty ledger, so no fact-id collision with the seed) and lands on the
// real Plan guided-setup surface. The created project is purged via the api at
// the end so it never pollutes the shared list for later specs.

test('empty dashboard → Start from an idea → create → guided Plan setup', async ({
  page,
}) => {
  await page.route('**/api/v1/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
      return
    }
    await route.fallback()
  })

  await page.goto('/projects')

  // Empty state preserves both creation cards (design spec §4.4).
  await expect(page.getByText('No projects yet')).toBeVisible()
  await page
    .getByRole('link', { name: /Start from an idea/ })
    .first()
    .click()

  await expect(page).toHaveURL(/\/projects\/new\/idea/)

  // Step 1 — Project basics (title + premise required; no LLM anywhere here).
  await page.getByLabel('Title').fill('The Ferry Line')
  await page
    .getByLabel('Premise')
    .fill('Two estranged siblings run a failing harbor bar.')
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 2 — Format (default preset is fine).
  await page.getByRole('button', { name: 'Continue' }).click()
  // Step 3 — Story foundation (optional, skip).
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 4 — Review and create. The button is Create project, not Generate.
  await expect(
    page.getByText('No AI runs when you create this project.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Create project' }).click()

  // Lands on the real Plan guided-setup surface (design spec §6): the project
  // has no scene skeleton yet, so Plan shows Guided setup, not the board.
  await page.waitForURL(/\/plan\?project=/)
  await expect(page.getByTestId('guided-setup')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Generate scene skeleton' }),
  ).toBeVisible()

  // Cleanup: purge the project we created so the shared list stays as seeded.
  const projectId = new URL(page.url()).searchParams.get('project')
  expect(projectId).not.toBeNull()
  const deleted = await page.request.delete(`/api/v1/projects/${projectId}`)
  expect(deleted.ok()).toBeTruthy()
})
