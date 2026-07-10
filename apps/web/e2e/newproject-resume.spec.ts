import { expect, test } from '@playwright/test'

// Spec §12 flow 4 (verbatim): Reopen recent project → valid last mode/scene
// resumes; stale scene falls back safely. Runs against the real api + seeded
// fixture DB (proj-longpour). Read-only on the DB: it only sets the
// browser-local resume context (design spec §9.5) and navigates, so it never
// mutates the shared seed.

const RESUME_KEY = 'tr.resume.v1.proj-longpour'

test('a valid last mode + scene resumes on reopen', async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [RESUME_KEY, JSON.stringify({ mode: 'Plan', sceneId: 'scene-3' })],
  )

  await page.goto('/projects')
  await page
    .getByRole('link', { name: /The Long Pour/ })
    .first()
    .click()

  await expect(page).toHaveURL(/\/plan\?project=proj-longpour&scene=scene-3/)
  await expect(page.getByTestId('scene-card-scene-3')).toBeVisible()
})

test('a stale last scene falls back safely to the first scene', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [
      RESUME_KEY,
      JSON.stringify({ mode: 'Plan', sceneId: 'scene-does-not-exist' }),
    ],
  )

  await page.goto('/projects')
  await page
    .getByRole('link', { name: /The Long Pour/ })
    .first()
    .click()

  // The href carries the stale scene id, but Plan resolves it safely: no crash,
  // no guided-setup fallback, and the board renders the first scene instead.
  await expect(page).toHaveURL(/\/plan\?project=proj-longpour/)
  await expect(page.getByTestId('guided-setup')).toHaveCount(0)
  await expect(page.getByTestId('scene-card-scene-1')).toBeVisible()
})
