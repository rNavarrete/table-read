import { expect, test, type Page } from '@playwright/test'

/**
 * T4.3 Review UI acceptance journey (build plan, paraphrased):
 * trigger scene-premise change → rows render with 1 disabled locked row →
 * uncheck one → preview → diffs visible → apply → board reflects only
 * approved changes; Flag only leaves project untouched and Change Set
 * `flagged`.
 *
 * Preview/apply/discard/flag are owned by Agent D and are NOT on this
 * branch — this spec uses `page.route` to mock those lifecycle endpoints
 * while exercising real `POST /change-sets` create against the seeded API
 * + MockLlmClient. Wave 3 should drop the mocks once T4.2 merges.
 */

const MARINA = 'Dan hides the money at the marina instead of the bar'

function previewBody(changeSet: Record<string, unknown>, approved: string[]) {
  const impacted = (changeSet.impacted as Array<Record<string, unknown>>).map(
    (row) => {
      if (!approved.includes(row.objectId as string)) return row
      if (row.applyMode !== 'regenerate' || row.locked) return row
      return {
        ...row,
        after: `${row.before as string} → marina rewrite`,
        approved: true,
      }
    },
  )
  return {
    ...changeSet,
    status: 'previewing',
    impacted,
    preview: {
      beatUpdates: approved
        .filter((id) => id.startsWith('beat-'))
        .map((beatId) => ({
          beatId,
          beatPlan: {
            whatHappens: 'Marina rewrite',
            audienceLearns: 'al',
            audienceFeels: 'af',
          },
          scriptText: 'INT. MARINA\n\nDAN\nHere.',
        })),
      sceneUpdates: approved
        .filter((id) => id.startsWith('scene-'))
        .map((sceneId) => ({
          sceneId,
          fields: {
            whatHappens: MARINA,
            audienceLearns: null,
            audienceFeels: null,
            location: null,
            time: null,
            socialSituation: null,
          },
        })),
      continuityConflicts: [],
      basedOnSnapshotId: 'snap-root',
      generatedAt: '2024-06-01T00:00:00.000Z',
    },
  }
}

async function mockLifecycle(page: Page) {
  let lastChangeSet: Record<string, unknown> | null = null

  await page.route('**/api/v1/projects/*/change-sets', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const body = (await response.json()) as Record<string, unknown>
    lastChangeSet = body
    // Inject a locked regenerate row so the acceptance "1 disabled locked
    // row" is observable even when the fixture's default blast has none.
    const impacted = [...(body.impacted as Array<Record<string, unknown>>)]
    if (!impacted.some((r) => r.locked)) {
      impacted.push({
        objectType: 'beat',
        objectId: 'beat-1-2',
        applyMode: 'regenerate',
        reason: 'Locked fixture beat (e2e inject).',
        confidence: 'high',
        locked: true,
        before: 'Locked script stays.',
        after: null,
        continuityFlags: [],
        approved: false,
      })
      body.impacted = impacted
    }
    lastChangeSet = body
    await route.fulfill({
      status: response.status(),
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })

  await page.route('**/api/v1/change-sets/*/preview', async (route) => {
    const req = route.request().postDataJSON() as {
      approvedObjectIds: string[]
    }
    if (!lastChangeSet) {
      await route.fulfill({
        status: 404,
        body: JSON.stringify({
          error: { code: 'NOT_FOUND', message: 'no change set' },
        }),
      })
      return
    }
    const body = previewBody(lastChangeSet, req.approvedObjectIds)
    lastChangeSet = body
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })

  await page.route('**/api/v1/change-sets/*/apply', async (route) => {
    const req = route.request().postDataJSON() as {
      approvedObjectIds: string[]
    }
    if (!lastChangeSet) {
      await route.fulfill({ status: 404, body: '{}' })
      return
    }
    const changeSet = {
      ...lastChangeSet,
      status: 'applied',
      impacted: (lastChangeSet.impacted as Array<Record<string, unknown>>).map(
        (row) => ({
          ...row,
          approved: req.approvedObjectIds.includes(row.objectId as string),
        }),
      ),
    }
    lastChangeSet = changeSet
    const project = await (
      await page.request.get('/api/v1/projects/proj-longpour')
    ).json()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project,
        changeSet,
        consistencyFlags: [
          {
            id: 'flag-e2e-1',
            objectType: 'scene',
            objectId: 'scene-5',
            factId: null,
            explanation:
              "Scene 5 still stages the argument around the bar's finances",
            severity: 'tension',
            status: 'open',
            sourceChange: changeSet.id,
          },
        ],
      }),
    })
  })

  await page.route('**/api/v1/change-sets/*/flag', async (route) => {
    if (!lastChangeSet) {
      await route.fulfill({ status: 404, body: '{}' })
      return
    }
    const body = { ...lastChangeSet, status: 'flagged' }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })

  await page.route('**/api/v1/change-sets/*/discard', async (route) => {
    if (!lastChangeSet) {
      await route.fulfill({ status: 404, body: '{}' })
      return
    }
    const body = { ...lastChangeSet, status: 'discarded' }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}

test('Review journey: Open Review → locked row → uncheck → preview → apply (mocked lifecycle)', async ({
  page,
}) => {
  await mockLifecycle(page)
  await page.goto('/plan')

  await page.getByTestId('scene-card-scene-2').click()
  const inspector = page.getByTestId('inspector')
  const whatHappens = inspector.getByLabel('What happens')
  await whatHappens.fill(MARINA)
  await inspector.getByRole('button', { name: 'Open Review' }).click()

  await expect(page).toHaveURL(/\/review\?.*changeSet=/)
  await expect(page.getByTestId('change-set-panel')).toBeVisible()
  await expect(page.getByText(MARINA)).toBeVisible()

  // Locked row: no checkbox, lock glyph present.
  const lockedRow = page.getByTestId('change-set-row-beat-1-2')
  await expect(lockedRow).toBeVisible()
  await expect(lockedRow.getByLabel('Locked')).toBeVisible()
  await expect(lockedRow.getByRole('checkbox')).toHaveCount(0)

  // Flag-only fact from real create (marina mock blast).
  await expect(page.getByTestId('change-set-row-fact-02')).toBeVisible()
  await expect(
    page.getByTestId('change-set-row-fact-02').getByLabel('Flag only'),
  ).toBeVisible()

  // Uncheck one regenerate row (scene-2), leave beat-4-2 selected if present.
  const scene2 = page.getByTestId('change-set-row-scene-2')
  const scene2Check = scene2.getByRole('checkbox')
  await expect(scene2Check).toBeChecked()
  await scene2Check.uncheck()

  const applyBtn = page.getByRole('button', { name: 'Apply selected' })
  await expect(applyBtn).toBeDisabled()

  await page.getByRole('button', { name: 'Preview selected' }).click()
  await expect(applyBtn).toBeEnabled()

  // Expand a previewed row and assert after pane filled.
  const beatRow = page.getByTestId('change-set-row-beat-4-2')
  if (await beatRow.count()) {
    await beatRow.getByRole('button', { name: 'Expand row' }).click()
    await expect(beatRow.getByTestId('diff-after')).not.toContainText(
      'Preview to generate',
    )
  }

  await applyBtn.click()
  await expect(page.getByTestId('applied-summary')).toBeVisible()
  await expect(page.getByTestId('post-apply-flags')).toContainText('Scene 5')
})

test('Flag only marks Change Set flagged without requiring preview (mocked)', async ({
  page,
}) => {
  await mockLifecycle(page)
  await page.goto('/plan')
  await page.getByTestId('scene-card-scene-2').click()
  await page.getByTestId('inspector').getByLabel('What happens').fill(MARINA)
  await page
    .getByTestId('inspector')
    .getByRole('button', { name: 'Open Review' })
    .click()
  await expect(page.getByTestId('change-set-panel')).toBeVisible()

  await page.getByRole('button', { name: 'Flag only' }).click()
  // Flag leaves us on Review with status chip; panel still shows the set.
  await expect(page.getByText('flagged')).toBeVisible()
})
