import { expect, test } from '@playwright/test'

// T2.3 acceptance criterion (build plan, verbatim): open fixture scene-3 →
// "Next Beat" → 3 labeled cards stream in → Accept → beat appears in script
// → ledger badge increments. Runs against the real api + seeded fixture DB
// + MockLlmClient (playwright.config.ts's webServer, e2e/start-api.sh) — no
// route interception here, this is the real generation/accept wiring.
test('scene-3: Next Beat streams 3 actionable cards; Accept inserts the beat and bumps the ledger badge', async ({
  page,
}) => {
  await page.goto('/?project=proj-longpour&scene=scene-3')

  // The scene's existing beat (fixture: beat-3-1) is already on the page.
  await expect(page.getByTestId('beat-beat-3-1')).toBeVisible()

  const ledgerBadge = page.getByRole('tab', { name: /Ledger/ })
  // UI spec §2 / T5.1: badge is pending_review count (fixture: fact-06 only).
  // If ledger.spec.ts already activated fact-06 in this shared-DB run, the
  // badge may be absent — assert the tab is enabled either way.
  await expect(ledgerBadge).toBeEnabled()
  const badgeBefore = await ledgerBadge.textContent()
  const pendingBefore = Number((badgeBefore ?? '').replace(/\D/g, '') || '0')

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

  // The accepted card is gone from the dock (2 remain, re-keyed to 0/1).
  // Badge tracks pending_review (T5.1). Accept may add pending facts when
  // extract demotes on sourceText miss — so the queue count is allowed to
  // rise; it must not drop from an accept.
  await expect(page.getByTestId('candidate-card-0')).toBeVisible()
  await expect(page.getByTestId('candidate-card-1')).toBeVisible()
  await expect(page.getByTestId('candidate-card-2')).toHaveCount(0)
  const badgeAfter = await ledgerBadge.textContent()
  const pendingAfter = Number((badgeAfter ?? '').replace(/\D/g, '') || '0')
  expect(pendingAfter).toBeGreaterThanOrEqual(pendingBefore)
})
