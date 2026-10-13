import { expect, test, type Page } from '@playwright/test'

// T2.5 Write autosave (UI spec §4 "Saving"): typed script text is saved
// through PATCH /projects/{pid} ~1 s after typing stops, and every Write
// mutation runs on one serial queue, so a save and an Accept never race
// each other into CONFLICT_STALE_HEAD. Scenes 2 and 4 are unlocked for the
// whole shared-DB run (plan.spec locks scene-6, review.spec scene-5).

function isProjectPatch(url: string, method: string) {
  return method === 'PATCH' && url.endsWith('/api/v1/projects/proj-longpour')
}

async function editBeat(page: Page, beatId: string, text: string) {
  await page
    .getByTestId(`beat-row-${beatId}`)
    .getByTestId('formatted-script')
    .click()
  const editor = page.getByTestId(`beat-${beatId}`)
  await expect(editor).toBeFocused()
  await editor.pressSequentially(text)
}

test.beforeEach(({ page }) => {
  // A reload while a save is pending would raise the native beforeunload
  // prompt; accept it so a regression fails on the assertions, not a hang.
  page.on('dialog', (dialog) => void dialog.accept())
})

test('typed text autosaves after a pause and survives a reload', async ({
  page,
}) => {
  await page.goto('/?project=proj-longpour&scene=scene-4')

  const saved = page.waitForResponse((res) =>
    isProjectPatch(res.url(), res.request().method()),
  )
  await editBeat(page, 'beat-4-1', ' AUTOSAVE-MARK')
  // No blur: the ~1 s debounce alone sends the save.
  expect((await saved).ok()).toBe(true)

  await page.reload()
  await expect(page.getByTestId('beat-row-beat-4-1')).toContainText(
    'AUTOSAVE-MARK',
  )
  await expect(page.getByTestId('write-save-failed')).toHaveCount(0)
})

test('type, then Accept while the save is still in flight: both persist, no error', async ({
  page,
}) => {
  // Hold the autosave PATCH on a promise (not a timer) and release it only
  // after Accept is clicked, so Accept is guaranteed to start while the save
  // is in flight. Without the shared queue, Accept would commit first and the
  // released save would 409 CONFLICT_STALE_HEAD, refetch and PATCH again.
  let releasePatch!: () => void
  const patchHeld = new Promise<void>((resolve) => (releasePatch = resolve))
  await page.route('**/api/v1/projects/proj-longpour', async (route) => {
    if (route.request().method() === 'PATCH') await patchHeld
    await route.fallback()
  })
  await page.goto('/?project=proj-longpour&scene=scene-2')
  const scene = page.getByTestId('write-scene-scene-2')
  const beatRows = scene.locator('[data-testid^="beat-row-"]')
  await expect(beatRows.first()).toBeVisible()
  const rowsBefore = await beatRows.count()

  await page.getByTestId('next-beat').click()
  const accept = page
    .getByTestId('candidate-card-0')
    .getByRole('button', { name: 'Accept' })
  await expect(accept).toBeVisible({ timeout: 15_000 })

  // Initial loads are done: record every api response from here on.
  const responses: { method: string; path: string; status: number }[] = []
  page.on('response', (res) => {
    const url = new URL(res.url())
    if (url.pathname.startsWith('/api/v1/')) {
      responses.push({
        method: res.request().method(),
        path: url.pathname,
        status: res.status(),
      })
    }
  })

  await editBeat(page, 'beat-2-1', ' RACE-MARK')
  const saveSent = page.waitForRequest((req) =>
    isProjectPatch(req.url(), req.method()),
  )
  const acceptDone = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      res.url().includes('/scenes/scene-2/beats'),
  )
  // Leaving the editor saves now (blur); Accept follows while it's held.
  await page.getByTestId('write-scrollport').click({ position: { x: 4, y: 4 } })
  await saveSent
  await accept.click()
  releasePatch()

  expect((await acceptDone).ok()).toBe(true)
  await expect(beatRows).toHaveCount(rowsBefore + 1)
  await expect(page.getByTestId('candidate-card-0')).not.toContainText(
    /conflict|failed|error/i,
  )
  await expect(page.getByTestId('write-save-failed')).toHaveCount(0)

  const project = '/api/v1/projects/proj-longpour'
  expect(
    responses.filter((r) => r.method === 'PATCH' && r.path === project),
  ).toHaveLength(1)
  expect(responses.filter((r) => r.status === 409)).toEqual([])
  expect(
    responses.filter((r) => r.method === 'GET' && r.path === project),
  ).toEqual([]) // no stale-head refetch
  // Order: the save landed before Accept ran on its head.
  const patchAt = responses.findIndex((r) => r.method === 'PATCH')
  const acceptAt = responses.findIndex((r) => r.path.endsWith('/beats'))
  expect(patchAt).toBeGreaterThanOrEqual(0)
  expect(patchAt).toBeLessThan(acceptAt)

  await page.unroute('**/api/v1/projects/proj-longpour')
  await page.reload()
  await expect(page.getByTestId('beat-row-beat-2-1')).toContainText('RACE-MARK')
  await expect(beatRows).toHaveCount(rowsBefore + 1)
})
