// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { loadLedgerView, saveLedgerView } from './viewPreference'

afterEach(() => {
  localStorage.clear()
})

describe('ledger view preference', () => {
  it('defaults to atlas when nothing is stored', () => {
    expect(loadLedgerView('proj-1')).toBe('atlas')
  })

  it('round-trips atlas and web per project', () => {
    saveLedgerView('proj-1', 'web')
    saveLedgerView('proj-2', 'atlas')
    saveLedgerView('proj-3', 'structure')

    expect(localStorage.getItem('tr.ledger.view.proj-1')).toBe('web')
    expect(loadLedgerView('proj-1')).toBe('web')
    expect(loadLedgerView('proj-2')).toBe('atlas')
    expect(loadLedgerView('proj-3')).toBe('structure')
  })

  it('falls back to atlas for invalid stored values', () => {
    localStorage.setItem('tr.ledger.view.proj-1', 'continuity-desk')

    expect(loadLedgerView('proj-1')).toBe('atlas')
  })
})
