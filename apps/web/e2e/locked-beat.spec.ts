import { expect, test } from '@playwright/test'

// Fixture scene-1 has beat-1-2 locked (both `locked` and `scriptLocked`);
// beat-1-1 is not. UI spec §4: written beats render formatted and click into
// a plain-text editor; locked beats stay formatted and non-editable, with a
// gutter lock glyph and a focus hint ("Locked — click the lock to edit").
test('locked beat (beat-1-2) renders read-only with a focus hint; the unlocked beat stays editable', async ({
  page,
}) => {
  await page.goto('/?project=proj-longpour&scene=scene-1')

  const lockedRow = page.getByTestId('beat-row-beat-1-2')
  const locked = lockedRow.getByTestId('formatted-script')
  await expect(locked).toBeVisible()
  await expect(lockedRow.getByRole('textbox')).toHaveCount(0)

  // The hint is collapsed until the locked beat is focused — checked before
  // anything else touches focus, so this isn't polluted by a later click.
  const hint = lockedRow.getByText('Locked — click the lock to edit')
  await expect(hint).toBeHidden()
  await locked.click()
  await expect(hint).toBeVisible()

  // Clicking or typing never opens an editor on the locked beat — the
  // client never even attempts to mutate it.
  const before = await locked.textContent()
  await page.keyboard.type('should not appear')
  await expect(locked).toHaveText(before ?? '')
  await expect(lockedRow.getByRole('textbox')).toHaveCount(0)

  // The unlocked beat opens its plain-text editor on click.
  await page
    .getByTestId('beat-row-beat-1-1')
    .getByRole('button', { name: /click to edit/ })
    .click()
  await expect(page.getByTestId('beat-beat-1-1')).toBeEditable()
})
