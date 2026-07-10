// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { clearDraft, loadDraft, saveDraft } from './wizardDraft'

afterEach(() => {
  localStorage.clear()
})

describe('wizard draft storage', () => {
  it('round-trips draft data under a versioned path key', () => {
    const draft = {
      title: 'The Long Pour',
      premise: 'A bar owner faces a debt collector.',
    }

    saveDraft('/projects/new/idea', draft)

    expect(localStorage.getItem('tr.wizard.v1./projects/new/idea')).toBe(
      JSON.stringify(draft),
    )
    expect(loadDraft('/projects/new/idea')).toEqual(draft)
  })

  it('isolates drafts by wizard path and clears only the selected path', () => {
    saveDraft('/projects/new/idea', { title: 'Idea' })
    saveDraft('/projects/new/import', { source: 'INT. BAR - NIGHT' })

    clearDraft('/projects/new/idea')

    expect(loadDraft('/projects/new/idea')).toBeNull()
    expect(loadDraft('/projects/new/import')).toEqual({
      source: 'INT. BAR - NIGHT',
    })
  })
})
