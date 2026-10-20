import { expect, test, type Locator, type Page } from '@playwright/test'

// T3.1 acceptance criteria (build plan, verbatim): reorder scene-4 before
// scene-3 persists after reload; lock icon renders on beat-1-2 (locked in
// fixture); inspector shows motivations + affected ledger facts for the
// selected scene. Runs against the real api + seeded fixture DB (this
// harness — playwright.config.ts's webServer, e2e/start-api.sh) — no route
// interception, this is the real PATCH wiring.
//
// Shared-DB note (same design as write.spec.ts/error-states.spec.ts): one
// worker, one seeded project for the whole `make e2e` run. This file's
// mutations (scene moves, the scene-6 lock toggle, and a
// beat-4-1 Beat lock that the test switches back off) are chosen
// to be inert for every other spec — Write mode never reads `scene.act`,
// `scene.index`, or `scene.locked` (only `beat.locked`/`scriptLocked`
// gate its rendering, which is why the beat-4-1 lock is undone), so
// nothing here can break locked-beat/quiet-ai/write/error-states'
// assertions, in either run order.

test('reorder scene-4 before scene-3 (cross-act drag) persists after reload', async ({
  page,
}) => {
  // Under the sticky bar and chart, 720px can't show both rows: dragTo then
  // scrolls the target in after mousedown, and Chromium drops the drag.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/plan?project=proj-longpour')

  const actOne = page.getByTestId('act-frame-1') // ACT ONE: scene-2, scene-3 in the seeded fixture
  const actTwo = page.getByTestId('act-frame-2') // ACT TWO: scene-4 in the seeded fixture
  await expect(actOne.getByTestId('scene-card-scene-3')).toBeVisible()
  await expect(actTwo.getByTestId('scene-card-scene-4')).toBeVisible()

  // The left half of scene-3: insert before it (T3.8).
  await page
    .getByTestId('scene-card-scene-4')
    .dragTo(page.getByTestId('scene-card-scene-3'), {
      targetPosition: { x: 12, y: 53 },
    })

  // scene-4 now lives inside Act One's frame, immediately before scene-3
  // (Act One's other member, scene-2, sorts before both by index) — the
  // "reorder scene-4 before scene-3" acceptance criterion, made visually
  // concrete. Act Two is left with no scenes.
  await expect(actOne.getByTestId('scene-card-scene-4')).toBeVisible()
  await expect(actTwo.getByTestId('scene-card-scene-4')).toHaveCount(0)

  async function actOneOrder() {
    return page
      .getByTestId('act-frame-1')
      .locator('[data-testid^="scene-card-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  }
  expect(await actOneOrder()).toEqual([
    'scene-card-scene-2',
    'scene-card-scene-4',
    'scene-card-scene-3',
  ])

  await page.reload()

  await expect(
    page.getByTestId('act-frame-1').getByTestId('scene-card-scene-4'),
  ).toBeVisible()
  await expect(
    page.getByTestId('act-frame-2').getByTestId('scene-card-scene-4'),
  ).toHaveCount(0)
  expect(await actOneOrder()).toEqual([
    'scene-card-scene-2',
    'scene-card-scene-4',
    'scene-card-scene-3',
  ])
})

test('correcting a scene act in the inspector persists after reload', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')

  await page.getByTestId('scene-card-scene-5').click()
  const inspector = page.getByTestId('inspector')
  await inspector.getByRole('combobox', { name: 'Act' }).selectOption('2')

  await expect(
    page.getByTestId('act-frame-2').getByTestId('scene-card-scene-5'),
  ).toBeVisible()
  await expect(
    page.getByTestId('act-frame-3').getByTestId('scene-card-scene-5'),
  ).toHaveCount(0)

  await page.reload()

  await expect(
    page.getByTestId('act-frame-2').getByTestId('scene-card-scene-5'),
  ).toBeVisible()
  await expect(
    page.getByTestId('act-frame-3').getByTestId('scene-card-scene-5'),
  ).toHaveCount(0)
})

test('an empty act takes a dropped card as an act change, and it persists (T3.5)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  // scene-5 is Act Three's only scene in the fixture: park it in Act Two
  // (a no-op if an earlier test already did) so Act Three is empty.
  const card = page.getByTestId('scene-card-scene-5')
  await card.click()
  await page
    .getByTestId('inspector')
    .getByRole('combobox', { name: 'Act' })
    .selectOption('2')
  await expect(card).toHaveAttribute('draggable', 'true') // the PATCH has settled
  const empty = page.getByTestId('act-frame-3').getByText('No scenes yet')
  await expect(empty).toBeVisible()

  await card.dragTo(empty)
  await expect(
    page.getByTestId('act-frame-3').getByTestId('scene-card-scene-5'),
  ).toBeVisible()
  await expect(card).toHaveAttribute('draggable', 'true') // saved, not just optimistic

  await page.reload()
  await expect(
    page.getByTestId('act-frame-3').getByTestId('scene-card-scene-5'),
  ).toBeVisible()
})

test('the board is one tab stop: arrows select, Enter reaches the panel, Esc comes back (T3.5)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-1').click()
  const stop = page.locator('[data-scene-card][tabindex="0"]')
  await expect(stop).toHaveCount(1)

  await page.keyboard.press('ArrowRight')
  await expect(stop).toBeFocused()
  await expect(stop).toHaveAttribute('aria-pressed', 'true')
  await expect(stop).not.toHaveAttribute('data-testid', 'scene-card-scene-1')
  // The focused card names its scene; the live region doesn't repeat it.
  await expect(stop).toHaveAccessibleName(/^Scene 2,/)
  await expect(page.getByTestId('plan-live')).toHaveText('')

  await page.keyboard.press('Enter')
  await expect(
    page.getByTestId('inspector').locator('h2').first(),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(stop).toBeFocused()

  // A selection made away from a card is announced.
  await page
    .getByTestId('inspector')
    .getByRole('button', { name: 'Next scene' })
    .click()
  await expect(page.getByTestId('plan-live')).toContainText('Scene 3,')
})

test('lock icon renders on beat-1-2 (locked in fixture); beat-1-1 has none', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')

  // Beats live in the scene panel's beat ladder (T3.3), not on the board.
  await page.getByTestId('scene-card-scene-1').click()
  const inspector = page.getByTestId('inspector')

  const beat12 = inspector.getByTestId('beat-card-beat-1-2')
  await expect(beat12).toBeVisible()
  await expect(beat12).toContainText('Locked')

  const beat11 = inspector.getByTestId('beat-card-beat-1-1')
  await expect(beat11).toBeVisible()
  await expect(beat11).not.toContainText('Locked')
})

test('inspector shows motivations and affected ledger facts for the selected scene', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')

  await page.getByTestId('scene-card-scene-1').click()
  const inspector = page.getByTestId('inspector')

  // Motivations table: characterId resolved to a display name, plus the
  // fixture's own objective text.
  await expect(inspector).toContainText('Marta Vega')
  await expect(inspector).toContainText('Dan Vega')
  await expect(inspector).toContainText(
    "Come home without admitting it's a retreat.",
  )

  // Affected facts: fixture facts whose sourceSpan.sceneId is scene-1.
  await expect(inspector).toContainText(
    "Marta has been away from Harbor's End for eight years",
  )
  await expect(inspector).toContainText(
    'Dan does not know that Marta saw the transfer',
  )
  // A fact whose sourceSpan.sceneId is a *different* scene must not appear.
  await expect(inspector).not.toContainText('stolen $40,000 is hidden')
})

test('locking a scene via the inspector disables drag and shows the read-only banner', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')

  const scene6 = page.getByTestId('scene-card-scene-6')
  await expect(scene6).toHaveAttribute('draggable', 'true')

  await scene6.click()
  const inspector = page.getByTestId('inspector')
  // The scene toggle keeps `lock-toggle`; an open beat adds its own switches.
  const lockToggle = inspector.getByTestId('lock-toggle')
  await expect(lockToggle).toHaveAttribute('aria-checked', 'false')
  await lockToggle.click()

  await expect(
    inspector.getByText(
      'Locked — unlock to edit. Review will never change this scene.',
    ),
  ).toBeVisible()
  await expect(scene6).toHaveAttribute('draggable', 'false')
  await expect(scene6).toHaveAttribute('data-locked', 'true')

  // Persists: reload and the scene is still locked, still drag-disabled.
  await page.reload()
  await expect(page.getByTestId('scene-card-scene-6')).toHaveAttribute(
    'draggable',
    'false',
  )
})

test('editing location is silent; editing whatHappens offers the Review path; both persist (T3.2)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')

  // scene-2 is unlocked in the fixture; pick it so neither edit is blocked.
  // (The shared-DB note above holds: scene field edits are inert for the
  // other specs, which key only off beat locks.)
  await page.getByTestId('scene-card-scene-2').click()
  const inspector = page.getByTestId('inspector')

  // 1) Non-structural: editing location shows a plain Save — no footer bar.
  // Location lives in the Details section, closed by default (T3.3).
  await inspector.locator('#plan-section-details > summary').click()
  const location = inspector.getByLabel('Location')
  await location.fill('INT. THE MARINA - DAY')
  await expect(
    inspector.getByText('Structural change — review impact?'),
  ).toHaveCount(0)
  await inspector.getByRole('button', { name: 'Save', exact: true }).click()
  // Server response replaces the draft; the Save button clears once saved.
  await expect(
    inspector.getByRole('button', { name: 'Save', exact: true }),
  ).toHaveCount(0)

  // 2) Structural: editing whatHappens surfaces the "review impact?" footer
  // with Open Review (T4.3) and Save field only. This test stays on the
  // Save-field-only path; the Open Review journey lives in review.spec.ts.
  const whatHappens = inspector.getByLabel('What happens')
  await whatHappens.fill('A structural rewrite of the scene.')
  await expect(
    inspector.getByText('Structural change — review impact?'),
  ).toBeVisible()
  await expect(
    inspector.getByRole('button', { name: 'Open Review' }),
  ).toBeEnabled()
  await inspector.getByRole('button', { name: 'Save field only' }).click()
  await expect(
    inspector.getByText('Structural change — review impact?'),
  ).toHaveCount(0)

  // 3) Both persist across a reload.
  await page.reload()
  await page.getByTestId('scene-card-scene-2').click()
  const reloaded = page.getByTestId('inspector')
  await expect(reloaded.getByLabel('Location')).toHaveValue(
    'INT. THE MARINA - DAY',
  )
  await expect(reloaded.getByLabel('What happens')).toHaveValue(
    'A structural rewrite of the scene.',
  )
})

test('a Beat lock set in the panel persists after reload (T3.3)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  await page.getByTestId('scene-card-scene-4').click()
  const inspector = page.getByTestId('inspector')

  await inspector.getByTestId('beat-card-beat-4-1').click()
  const beatLock = inspector.getByTestId('beat-lock-toggle-beat-4-1')
  await expect(beatLock).toHaveAttribute('aria-checked', 'false')
  await beatLock.click()
  await expect(beatLock).toHaveAttribute('aria-checked', 'true')
  await expect(beatLock).toBeEnabled() // the PATCH has settled
  await expect(inspector.getByTestId('beat-card-beat-4-1')).toContainText(
    'Locked',
  )

  await page.reload()
  await page.getByTestId('scene-card-scene-4').click()
  const reloaded = page.getByTestId('inspector')
  await reloaded.getByTestId('beat-card-beat-4-1').click()
  const reloadedLock = reloaded.getByTestId('beat-lock-toggle-beat-4-1')
  await expect(reloadedLock).toHaveAttribute('aria-checked', 'true')

  // Shared DB: other specs key off beat locks, so put this one back.
  await reloadedLock.click()
  await expect(reloadedLock).toHaveAttribute('aria-checked', 'false')
  await expect(reloadedLock).toBeEnabled()
})

test("Who's in it rings the matching cards and N selects the next match (T3.6)", async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  const scene1 = page.getByTestId('scene-card-scene-1')
  await scene1.click()
  const bar = page.getByRole('group', { name: 'Highlight' })
  await bar.getByRole('button', { name: /Who's in it/ }).click()
  await page.getByLabel('Character to highlight').selectOption('char-marta')
  await expect(page.getByTestId('plan-live')).toContainText(
    'Highlight: Marta Vega.',
  )
  // scene-1 records Marta's want in the fixture.
  await expect(scene1).toHaveAttribute('data-match', 'true')

  await scene1.focus() // keys are ignored while the select has focus
  await page.keyboard.press('n')
  const selected = page.locator('[data-scene-card][aria-pressed="true"]')
  await expect(selected).not.toHaveAttribute(
    'data-testid',
    'scene-card-scene-1',
  )
  await expect(selected).toHaveAttribute('data-match', 'true')
})

test('Esc shows the Episode view, and Story Layers is gone (T3.6)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  await expect(page.getByTestId('story-layers-panel')).toHaveCount(0)
  await page.getByTestId('scene-card-scene-2').click()
  await page.keyboard.press('Escape')

  const panel = page.getByTestId('inspector')
  await expect(panel.locator('h2').first()).toContainText('Last Call')
  await expect(panel.getByTestId('lock-toggle')).toHaveCount(0)
  await expect(page.getByTestId('scene-card-scene-2')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await panel
    .locator('#plan-section-ep-cast')
    .getByRole('button', { name: /Dan Vega/ })
    .click()
  await expect(
    page
      .getByRole('group', { name: 'Highlight' })
      .getByRole('button', { name: /Who's in it/ }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('an act change that plays a payoff first shows the Order note, and Undo the move restores the order (T3.7)', async ({
  page,
  request,
}) => {
  // The fixture has no threads: seed one (setup scene-2 → payoff scene-5) and
  // clear it again whatever happens, so later specs see the fixture's [].
  const threads = (value: unknown[]) =>
    request.patch('/api/v1/projects/proj-longpour', {
      data: [{ op: 'replace', path: '/seasons/0/episodes/0/threads', value }],
    })
  const seeded = await threads([
    {
      id: 'thread-e2e-cash',
      label: 'The moved cash',
      summary: 'Dan moves the cash; later the count comes up short.',
      status: 'paid_off',
      ownerCharacterIds: [],
      setupSceneId: 'scene-2',
      payoffSceneId: 'scene-5',
      setupQuote: '',
      payoffQuote: '',
      setupBeatId: null,
      payoffBeatId: null,
      locked: false,
    },
  ])
  expect(seeded.ok()).toBeTruthy()
  try {
    await page.goto('/plan?project=proj-longpour')
    const arc = page.getByTestId('chart-arc-thread-e2e-cash')
    await expect(arc).toHaveAttribute('data-tone', 'sky')
    await page.getByTestId('scene-card-scene-5').click()
    const inspector = page.getByTestId('inspector')

    // The cold open plays before scene-2's act: the payoff now comes first.
    await inspector.getByRole('combobox', { name: 'Act' }).selectOption('0')
    await expect(
      page.getByTestId('act-frame-0').getByTestId('scene-card-scene-5'),
    ).toBeVisible()
    // The strip opened itself (scene-5 also keeps plan-notes.spec's note).
    const orderNote = inspector.getByText(/before its setup in scene 3/)
    await expect(orderNote).toBeVisible()
    await expect(arc).toHaveAttribute('data-tone', 'amber')
    await expect(page.getByTestId('scene-card-scene-2')).toContainText(
      '⚠ order with 2',
    )

    await inspector.getByRole('button', { name: 'Undo the move' }).click()
    await expect(orderNote).toHaveCount(0)
    await expect(
      page.getByTestId('act-frame-0').getByTestId('scene-card-scene-5'),
    ).toHaveCount(0)
    await expect(arc).toHaveAttribute('data-tone', 'sky')
    await expect(page.getByTestId('plan-live')).toContainText('Move undone.')

    await page.reload() // undone on the server, not just on screen
    await expect(
      page.getByTestId('act-frame-0').getByTestId('scene-card-scene-5'),
    ).toHaveCount(0)
  } finally {
    await threads([])
  }
})

/** This harness always runs the mock LLM, so AppShell shows its demo banner,
 * from its own /health call: it can land after the board and push the screen
 * down. A click pressed before it and released after it is lost, and a drag
 * started first loses its target (Playwright's retry of the unsteady hover
 * scrolls the source to the bottom edge). Wait for it before either. */
function waitForBanner(page: Page) {
  return expect(page.getByTestId('mock-llm-banner')).toBeVisible()
}

test('the episode chart draws a block per scene and a block selects its scene (T3.7)', async ({
  page,
}) => {
  await page.goto('/plan?project=proj-longpour')
  const chart = page.getByTestId('episode-chart')
  await expect(chart.locator('[data-chart-block]')).toHaveCount(6)
  await expect(chart.locator('svg')).toHaveAttribute('aria-hidden', 'true')
  await expect(chart).toContainText('the board below lists every scene')

  await waitForBanner(page)
  await chart.getByTestId('chart-block-scene-3').click()
  await expect(page.getByTestId('scene-card-scene-3')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

// T3.8 insert reorder. State here, after the tests above: act 0 [scene-1] ·
// act 1 [scene-2, scene-4, scene-3] · act 2 empty · act 3 [scene-5] · act 4
// [scene-6, locked]; numbers 1–6 in that board order. Act frames follow the
// optimistic doc while the save is pending, and the board ignores ⌥←/⌥→
// while a write is in flight: after every move that saves, wait for the
// card to turn draggable again before the next key or click.

/** An act frame's scene ids, in board order. */
function actOrder(page: Page, act: number) {
  return page
    .getByTestId(`act-frame-${act}`)
    .locator('[data-scene-card]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-scene-id')))
}

/** Starts a drag from `from` and holds it over `to` at x (two moves, so
 * Chromium fires dragover). The caller ends it with page.mouse.up(). The
 * source is centred first, clear of the sticky header, so `to` (its row or
 * the next) is in view too: a scroll after mousedown drops the drag. */
async function dragOver(page: Page, from: Locator, to: Locator, x: number) {
  await waitForBanner(page)
  await from.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await from.hover()
  await page.mouse.down()
  await to.hover({ position: { x, y: 53 } })
  await to.hover({ position: { x: x + 2, y: 53 } })
}

test('a drop inserts where it lands, with a coral bar, and ⌥→ steps a card across an act break (T3.8)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/plan?project=proj-longpour')
  const scene2 = page.getByTestId('scene-card-scene-2')
  const scene3 = page.getByTestId('scene-card-scene-3')

  // The right half of scene-3: the bar after it, and the sky tape.
  await dragOver(page, scene2, scene3, 130)
  await expect(
    scene3.locator('[data-insert-bar][data-side="after"]'),
  ).toBeVisible()
  await expect(scene3.locator('[data-tape]')).toHaveText('Move 2 here')
  await page.mouse.up()
  await expect
    .poll(() => actOrder(page, 1))
    .toEqual(['scene-4', 'scene-3', 'scene-2'])
  await expect(scene2).toHaveAttribute('draggable', 'true')

  // The last card of act 1 steps into the empty act 2, in place.
  await scene2.click()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(
    page.getByTestId('act-frame-2').getByTestId('scene-card-scene-2'),
  ).toBeVisible()
  await expect(scene2).toBeFocused()
  await expect(page.getByTestId('plan-live')).toContainText(
    'Moved to ACT TWO, scene 4 of 6.',
  )
  await expect(scene2).toHaveAttribute('draggable', 'true')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect
    .poll(() => actOrder(page, 1))
    .toEqual(['scene-4', 'scene-3', 'scene-2'])
  await expect(scene2).toHaveAttribute('draggable', 'true')

  await page.reload()
  await expect(scene2).toBeVisible()
  expect(await actOrder(page, 1)).toEqual(['scene-4', 'scene-3', 'scene-2'])
})

test('a move past a locked scene is refused on the target and sends nothing (T3.8)', async ({
  page,
  request,
}) => {
  // Its own setup, so it passes alone too: scene-5 last in act 3, scene-6
  // alone in act 4 and locked (their fixture places). Scenes 4 and 5 in the
  // array (it never reorders) are scene-5 and scene-6. Through `request`, so
  // the page's PATCH count starts at 0; scene-6 stays locked, as it is after
  // the lock test above.
  const set = (i: number, field: string, value: unknown) => ({
    op: 'replace',
    path: `/seasons/0/episodes/0/scenes/${i}/${field}`,
    value,
  })
  const setup = await request.patch('/api/v1/projects/proj-longpour', {
    data: [
      set(4, 'act', 3),
      set(4, 'index', 4),
      set(5, 'act', 4),
      set(5, 'index', 5),
      set(5, 'locked', true),
    ],
  })
  expect(setup.ok()).toBeTruthy()

  await page.setViewportSize({ width: 1280, height: 900 })
  let patches = 0
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches += 1
  })
  await page.goto('/plan?project=proj-longpour')
  const scene5 = page.getByTestId('scene-card-scene-5')
  const scene6 = page.getByTestId('scene-card-scene-6')

  // After scene-6 would shift it: the reason on the target, no bar, no drop.
  await dragOver(page, scene5, scene6, 130)
  await expect(scene6.locator('[data-tape]')).toHaveText(
    "Can't move past scene 6: it's locked",
  )
  await expect(page.locator('[data-insert-bar]')).toHaveCount(0)
  await page.mouse.up()
  await expect(
    page.getByTestId('act-frame-3').getByTestId('scene-card-scene-5'),
  ).toBeVisible()
  expect(patches).toBe(0)

  // Into act 4 in place leaves scene-6 where it is: allowed.
  await scene5.click()
  await page.keyboard.press('Alt+ArrowRight')
  await expect.poll(() => actOrder(page, 4)).toEqual(['scene-5', 'scene-6'])
  await expect(scene5).toHaveAttribute('draggable', 'true')
  expect(patches).toBe(1)

  // Past scene-6 is refused: the toast (an alert) says why.
  await page.keyboard.press('Alt+ArrowRight')
  await expect(page.getByTestId('toast')).toContainText(
    "Can't move past scene 6: it's locked",
  )
  expect(await actOrder(page, 4)).toEqual(['scene-5', 'scene-6'])
  expect(patches).toBe(1)

  await page.keyboard.press('Alt+ArrowLeft')
  await expect(
    page.getByTestId('act-frame-3').getByTestId('scene-card-scene-5'),
  ).toBeVisible()
  await expect(scene5).toHaveAttribute('draggable', 'true')
  expect(patches).toBe(2)
})

test('the Act select keeps focus through its save, and a move into a collapsed act opens it (T3.8)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/plan?project=proj-longpour')
  const scene5 = page.getByTestId('scene-card-scene-5')
  await scene5.click()
  const actTwo = page.getByTestId('act-frame-2')
  await actTwo.getByRole('button', { name: 'Hide ACT TWO' }).click()
  const select = page
    .getByTestId('inspector')
    .getByRole('combobox', { name: 'Act' })

  await select.focus()
  await select.selectOption('2')
  await expect(actTwo.getByTestId('scene-card-scene-5')).toBeVisible()
  await expect(
    actTwo.getByRole('button', { name: 'Hide ACT TWO' }),
  ).toHaveAttribute('aria-expanded', 'true')
  await expect(scene5).toHaveAttribute('draggable', 'true') // saved
  await expect(select).toBeFocused()

  await select.selectOption('3')
  await expect(
    page.getByTestId('act-frame-3').getByTestId('scene-card-scene-5'),
  ).toBeVisible()
  await expect(scene5).toHaveAttribute('draggable', 'true')
  await expect(select).toBeFocused()
})
