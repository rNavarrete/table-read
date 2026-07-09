import { expect, test } from '@playwright/test'

// Fixture scene-1 has beat-1-2 locked (both `locked` and `scriptLocked`);
// beat-1-1 is not. UI spec §3: locked beats render read-only with a gutter
// lock glyph and a focus hint ("Locked — click the lock to edit"); the
// writer can still write immediately before/after a locked beat.
test('locked beat (beat-1-2) renders read-only with a focus hint; the unlocked beat stays editable', async ({
  page,
}) => {
  await page.goto('/?scene=scene-1')

  const unlocked = page.getByTestId('beat-beat-1-1')
  await expect(unlocked).toBeEditable()

  const locked = page.getByTestId('beat-beat-1-2')
  await expect(locked).toBeVisible()
  await expect(locked).not.toBeEditable()

  // The hint is collapsed until the locked beat is focused — checked before
  // anything else touches focus, so this isn't polluted by a later click.
  const hint = page.getByText('Locked — click the lock to edit')
  await expect(hint).toBeHidden()
  await locked.click()
  await expect(hint).toBeVisible()

  // Typing into the locked textarea is a no-op (the DOM itself enforces
  // `readOnly` — this is not a server round trip, just confirming the
  // client never even attempts to mutate it).
  const before = await locked.inputValue()
  await page.keyboard.type('should not appear')
  await expect(locked).toHaveValue(before)
})
