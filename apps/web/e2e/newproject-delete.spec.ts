import { expect, test } from '@playwright/test'

// Spec §12 flow 5 (verbatim): Permanent delete confirmation → project
// disappears and backend purge assertions pass. Runs against the real api +
// seeded fixture DB (playwright.config.ts webServer / e2e/start-api.sh).
//
// Self-contained on the shared DB: the test creates its own throwaway project
// via the real create endpoint (empty ledger → no fact-id collision with the
// seed) and deletes it through the dashboard overflow menu's typed-title
// confirmation, leaving the seeded fixture untouched.

const TITLE = 'Purge Me Flow Five'

const CREATE_BODY = {
  title: TITLE,
  format: {
    genre: 'drama',
    runtimeMinutes: 60,
    actCount: 5,
    coldOpen: true,
    tag: true,
    serialization: 0.7,
  },
  premise: 'A throwaway project created only to be permanently deleted.',
}

test('overflow menu → Permanently delete with typed title purges the project', async ({
  page,
}) => {
  const created = await page.request.post('/api/v1/projects', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: CREATE_BODY,
  })
  expect(created.status()).toBe(201)
  const projectId = (await created.json()).id as string

  await page.goto('/projects')

  // The freshly-created project is the most recent, so it heads the list.
  await expect(
    page.getByRole('link', { name: new RegExp(TITLE) }),
  ).toBeVisible()

  await page
    .getByRole('button', { name: `Project actions for ${TITLE}` })
    .click()
  await page.getByRole('menuitem', { name: 'Permanently delete' }).click()

  const dialog = page.getByRole('dialog', {
    name: `Permanently delete ${TITLE}`,
  })
  await expect(dialog).toBeVisible()

  // The delete button stays disabled until the exact title is typed.
  const confirm = dialog.getByRole('button', { name: 'Delete project' })
  await expect(confirm).toBeDisabled()
  await dialog
    .getByLabel('Type the project title to confirm')
    .fill('wrong title')
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Type the project title to confirm').fill(TITLE)
  await expect(confirm).toBeEnabled()
  await confirm.click()

  // The row disappears from the dashboard.
  await expect(page.getByRole('link', { name: new RegExp(TITLE) })).toHaveCount(
    0,
  )

  // Backend purge: the project is gone (canonical full-purge endpoint).
  const after = await page.request.get(`/api/v1/projects/${projectId}`)
  expect(after.status()).toBe(404)
})
