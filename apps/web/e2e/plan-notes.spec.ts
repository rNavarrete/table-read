import { expect, test } from '@playwright/test'

// T3.4 notes and drafts journeys (redesign spec §4.6 notes strip, §4.9
// drafts). Real api + seeded fixture + MockLlmClient (e2e/start-api.sh), no
// route interception.
//
// MockLlmClient.scan_consistency always returns one tension note on scene-5,
// so a "Save field only" on any What happens creates one. Shared DB: earlier
// specs can leave more scene-5 notes behind, so note counts are relative.
// This file writes scene-2 whatHappens (plan.spec rewrites it anyway) and
// scene-5 audienceFeels; review.spec reads whatHappens fresh from the API and
// no other spec reads audienceFeels. It also locks and unlocks scene-5 and
// creates, then discards, one Change Set, so Review's single-draft auto-open
// in review.spec still holds.

test('a story note can be read, dismissed and brought back with Undo; saving still works after', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-2').click()
  const inspector = page.getByTestId('inspector')
  await inspector
    .getByLabel('What happens', { exact: true })
    .fill('Dan moves the money before dawn.')
  await inspector.getByRole('button', { name: 'Save field only' }).click()
  await expect(
    inspector.getByText('Structural change — review impact?'),
  ).toHaveCount(0)

  await page.getByTestId('scene-card-scene-5').click()
  const strip = inspector.getByTestId('notes-strip')
  await expect(strip).toContainText('⚑')
  await expect(
    page
      .getByTestId('scene-card-scene-5')
      .getByTestId('consistency-flag-badge'),
  ).toContainText('⚑')
  await strip.getByRole('button', { name: 'Show', exact: true }).click()
  const notes = strip.locator('[data-testid^="note-"]')
  await expect(notes.first()).toContainText('stakes reference the bar')
  const before = await notes.count()

  await notes
    .first()
    .getByRole('button', { name: 'Dismiss', exact: true })
    .click()
  const toast = page.getByTestId('toast')
  await expect(toast).toContainText('Note dismissed.')
  await expect(notes).toHaveCount(before - 1)

  await toast.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(toast).toHaveCount(0)
  await expect(inspector.getByTestId('notes-strip')).toContainText(
    `⚑ ${before} note`,
  )

  // The dismiss and its undo each moved the head; a save now must not 409.
  const feels = inspector.getByLabel('Audience feels', { exact: true })
  await feels.fill('Dread, then a flash of relief.')
  await inspector.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    inspector.getByRole('button', { name: 'Save', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByTestId('toast')).toHaveCount(0)

  await page.reload()
  await page.getByTestId('scene-card-scene-5').click()
  await expect(
    page.getByTestId('inspector').getByLabel('Audience feels', { exact: true }),
  ).toHaveValue('Dread, then a flash of relief.')
})

test('drafts survive scene switches, and leaving Plan asks first', async ({
  page,
}) => {
  // A native beforeunload prompt here is a bug: record it and dismiss it
  // (which also cancels the navigation, so the URL check fails loudly).
  const nativeDialogs: string[] = []
  page.on('dialog', (dialog) => {
    nativeDialogs.push(dialog.type())
    void dialog.dismiss()
  })

  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-2').click()
  const inspector = page.getByTestId('inspector')
  const learns = inspector.getByLabel('Audience learns', { exact: true })
  await learns.fill('Dan has a second key to the basement.')

  await page.getByTestId('scene-card-scene-3').click()
  await expect(
    page.getByTestId('scene-card-scene-2').getByTestId('unsaved-dot'),
  ).toBeVisible()
  await expect(inspector.getByTestId('unsaved-chip')).toHaveCount(0)

  await page.getByTestId('scene-card-scene-2').click()
  await expect(learns).toHaveValue('Dan has a second key to the basement.')
  await expect(inspector.getByTestId('unsaved-chip')).toBeVisible()

  const writeTab = page
    .getByTestId('mode-switcher')
    .getByRole('tab', { name: 'Write' })
  const dialog = page.getByTestId('leave-plan-dialog')
  await writeTab.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Stay in Plan' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/plan\?/)
  await expect(learns).toHaveValue('Dan has a second key to the basement.')

  await writeTab.click()
  await dialog.getByRole('button', { name: 'Discard and leave' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  expect(nativeDialogs).toEqual([])
})

test('Draft a fix in Review… sends a note to Review as an editable instruction; never on a locked scene', async ({
  page,
  request,
}) => {
  await page.goto('/plan?project=proj-longpour')
  // A Save field only on scene-2 leaves a scene-5 note (MockLlmClient scan).
  // New text: the first test already saved its own.
  await page.getByTestId('scene-card-scene-2').click()
  const inspector = page.getByTestId('inspector')
  await inspector
    .getByLabel('What happens', { exact: true })
    .fill('Dan moves the money to the marina at dawn.')
  await inspector.getByRole('button', { name: 'Save field only' }).click()
  await expect(
    inspector.getByText('Structural change — review impact?'),
  ).toHaveCount(0)

  await page.getByTestId('scene-card-scene-5').click()
  const strip = inspector.getByTestId('notes-strip')
  await strip.getByRole('button', { name: 'Show', exact: true }).click()
  const note = strip
    .locator('[data-testid^="note-"]')
    .filter({ hasText: 'stakes reference the bar' })
    .first()
  const draftFix = note.getByRole('button', { name: 'Draft a fix in Review…' })
  await expect(draftFix).toBeVisible()

  // Rule 2: never offered on a locked scene. Lock, check, unlock (shared DB).
  const lock = inspector.getByTestId('lock-toggle')
  await lock.click()
  await expect(lock).toHaveAttribute('aria-checked', 'true')
  await expect(draftFix).toHaveCount(0)
  await lock.click()
  await expect(lock).toHaveAttribute('aria-checked', 'false')

  await draftFix.click()
  const box = note.getByLabel('Fix instruction')
  await expect(box).toHaveValue(
    /^Fix this continuity note in the Kitchen scene \(5th on the board\): .*stakes reference the bar/,
  )
  // No raw id, and no "scene n" a model would read as an id.
  await expect(box).not.toHaveValue(/scene-|fact-|\[|\bscenes? \d|\bbeat \d/i)
  await expect(note).toContainText(
    'Nothing changes until you apply it in Review. Locked scenes are never changed.',
  )
  const instruction = `${await box.inputValue()} Keep the fight; point it at the marina.`
  await box.fill(instruction)
  await note.getByRole('button', { name: 'Open Review' }).click()

  await expect(page).toHaveURL(/\/review\?.*changeSet=/)
  await expect(page.getByTestId('change-set-panel')).toContainText(instruction)

  // Shared DB: discard it, so Review's single-draft auto-open still holds.
  const cid = new URL(page.url()).searchParams.get('changeSet')
  const discarded = await request.post(`/api/v1/change-sets/${cid}/discard`)
  expect(discarded.ok()).toBeTruthy()
})
