import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

// T10.10: the top bar's Export menu downloads the breakdown CSV from the real
// endpoint — named from the project title, header first, board order.
test('Export → Breakdown spreadsheet downloads the scene breakdown CSV', async ({
  page,
}) => {
  await page.goto('/?project=proj-longpour&scene=scene-1')

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('menuitem', { name: 'Breakdown spreadsheet (.csv)' })
      .click(),
  ])

  expect(download.suggestedFilename()).toBe('The_Long_Pour-breakdown.csv')
  const text = await readFile(await download.path(), 'utf-8')
  const [header, first] = text.replace(/^\uFEFF/, '').split('\r\n')
  expect(header.split(',').slice(0, 4)).toEqual([
    'Scene',
    'Act',
    'Storyline',
    'Location',
  ])
  expect(first.startsWith('1,COLD OPEN,A,')).toBe(true)
})
