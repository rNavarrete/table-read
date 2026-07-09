import { expect, test } from '@playwright/test'

// Quiet-AI rule (UI spec §3 / CLAUDE.md rule 8): while the script canvas has
// focus, the dock dims to 40% and every AI control — Next Beat, the command
// bar, and each card's Accept/Tune/Skip row — goes fully invisible, not just
// dimmed (reconciling the two clauses; see the task report for the reading).
test('AI controls go invisible and the dock dims while a script textarea is focused', async ({
  page,
}) => {
  await page.goto('/?scene=scene-3')

  const nextBeat = page.getByRole('button', { name: 'Next Beat' })
  const commandBar = page.getByPlaceholder('Tell the scene where to go…')
  const dock = page.getByTestId('candidate-dock')

  await expect(nextBeat).toBeVisible()
  await expect(commandBar).toBeVisible()

  // Generate a round first so there are per-card Accept/Tune/Skip buttons to
  // hide too, not just the empty-dock Next Beat button.
  await nextBeat.click()
  const firstCardAccept = page
    .getByTestId('candidate-card-0')
    .getByRole('button', {
      name: 'Accept',
    })
  await expect(firstCardAccept).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('beat-beat-3-1').click()

  await expect(nextBeat).toBeHidden()
  await expect(commandBar).toBeHidden()
  await expect(firstCardAccept).toBeHidden()
  await expect(dock).toHaveCSS('opacity', '0.4')

  // Blurring the canvas (focus leaves it entirely) restores everything.
  await page.locator('body').click({ position: { x: 5, y: 5 } })

  await expect(nextBeat).toBeVisible()
  await expect(commandBar).toBeVisible()
  await expect(firstCardAccept).toBeVisible()
  await expect(dock).not.toHaveCSS('opacity', '0.4')
})
