import { expect, test } from '@playwright/test'

// T2.3 acceptance criterion (build plan, verbatim): open fixture scene-3 →
// "Next Beat" → 3 labeled cards stream in → Accept → beat appears in script
// → ledger badge increments. Runs against the real api + seeded fixture DB
// + MockLlmClient (playwright.config.ts's webServer, e2e/start-api.sh) — no
// route interception here, this is the real generation/accept wiring.
test('scene-3: Next Beat streams 3 actionable cards; Accept inserts the beat and bumps the ledger badge', async ({
  page,
}) => {
  await page.goto('/?scene=scene-3')

  // The scene's existing beat (fixture: beat-3-1) is already on the page.
  await expect(page.getByTestId('beat-beat-3-1')).toBeVisible()

  const ledgerBadge = page.getByRole('tab', { name: 'Ledger' })
  await expect(ledgerBadge).toContainText('8') // fixture: 8 ledger facts at load

  await page.getByRole('button', { name: 'Next Beat' }).click()

  // 3 cards, each actionable (Accept present) only once candidate_done has
  // landed — never a partial/streaming card mistaken for actionable.
  for (const index of [0, 1, 2]) {
    const card = page.getByTestId(`candidate-card-${index}`)
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Accept' })).toBeVisible({
      timeout: 15_000,
    })
  }

  const firstCard = page.getByTestId('candidate-card-0')
  await expect(firstCard).toContainText('Quiet reveal') // MockLlmClient's default label

  await firstCard.getByRole('button', { name: 'Accept' }).click()

  // The accepted beat's script text appears in the canvas as a new beat row.
  await expect(page.getByTestId('beat-beat-3-2')).toBeVisible()
  await expect(page.getByTestId('beat-beat-3-2')).toHaveValue(
    /Marta slides a folded printout/,
  )

  // The accepted card is gone from the dock (2 remain, re-keyed to 0/1);
  // the ledger badge incremented from the accept response's `newFacts`.
  await expect(page.getByTestId('candidate-card-0')).toBeVisible()
  await expect(page.getByTestId('candidate-card-1')).toBeVisible()
  await expect(page.getByTestId('candidate-card-2')).toHaveCount(0)
  await expect(ledgerBadge).toContainText('9')
})
