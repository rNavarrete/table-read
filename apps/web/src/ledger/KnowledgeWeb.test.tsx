// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LedgerFact, Project } from 'contract'
import { KnowledgeWeb } from './KnowledgeWeb'

afterEach(cleanup)

const project = {
  id: 'proj-longpour',
  title: 'The Long Pour',
  seriesBible: {
    characters: [
      { id: 'char-reyes', name: 'Detective Ana Reyes' },
      { id: 'char-marta', name: 'Marta Vega' },
      { id: 'char-doc', name: 'Doc' },
    ],
  },
  seasons: [
    {
      episodes: [
        {
          id: 'ep-1',
          index: 0,
          scenes: [
            {
              id: 'scene-1',
              index: 0,
              beats: [{ id: 'beat-1-1', index: 0 }],
            },
          ],
        },
      ],
    },
  ],
} as unknown as Project

function fact(
  partial: Partial<LedgerFact> & Pick<LedgerFact, 'id'>,
): LedgerFact {
  return {
    fact: `text for ${partial.id}`,
    factType: 'knowledge',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-1',
      beatId: 'beat-1-1',
      startLine: null,
      endLine: null,
      charStart: null,
      charEnd: null,
    },
    sourceText: '',
    knownBy: [],
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.5,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
    ...partial,
  }
}

const reyesKnowledge = fact({
  id: 'reyes-knowledge',
  fact: 'Reyes knows the marina gate code',
  knownBy: ['char-reyes'],
  factType: 'knowledge',
})

const reyesPending = fact({
  id: 'reyes-pending',
  fact: 'Reyes suspects Marta is lying',
  knownBy: ['char-reyes'],
  factType: 'relationship',
  status: 'pending_review',
})

const martaKnowledge = fact({
  id: 'marta-knowledge',
  fact: 'Marta owns the harbor cafe',
  knownBy: ['char-marta'],
  factType: 'knowledge',
})

describe('KnowledgeWeb', () => {
  it('shows focus label from buildKnowledgeGraph', () => {
    render(
      <KnowledgeWeb
        facts={[reyesKnowledge, martaKnowledge]}
        allFacts={[reyesKnowledge, martaKnowledge]}
        project={project}
        characterId="char-reyes"
        busy={false}
      />,
    )

    expect(screen.getByTestId('knowledge-web')).toBeTruthy()
    expect(screen.getByTestId('web-focus-label').textContent).toBe(
      'Detective Ana Reyes',
    )
  })

  it('renders ranked fact rows in a scrollable list (hybrid layout)', () => {
    render(
      <KnowledgeWeb
        facts={[reyesKnowledge, reyesPending, martaKnowledge]}
        allFacts={[reyesKnowledge, reyesPending, martaKnowledge]}
        project={project}
        characterId="char-reyes"
        busy={false}
      />,
    )

    expect(screen.getByTestId('knowledge-web-focus-strip')).toBeTruthy()
    expect(screen.getByTestId('knowledge-web-list')).toBeTruthy()
    expect(screen.getByTestId('web-fact-reyes-knowledge')).toBeTruthy()
    expect(screen.getByTestId('web-fact-reyes-pending')).toBeTruthy()
    expect(screen.queryByTestId('web-fact-marta-knowledge')).toBeNull()
    // Primary view is list+detail — not a radial card fan.
    expect(screen.queryByTestId('knowledge-web-svg')).toBeNull()
    expect(screen.queryByTestId('web-spoke-reyes-knowledge')).toBeNull()
  })

  it('shows type cue, scene, and knower count on fact rows', () => {
    render(
      <KnowledgeWeb
        facts={[reyesKnowledge]}
        allFacts={[reyesKnowledge]}
        project={project}
        characterId="char-reyes"
        busy={false}
      />,
    )

    const row = screen.getByTestId('web-fact-reyes-knowledge')
    expect(row.textContent).toContain('KNOWS')
    expect(
      screen.getByTestId('web-fact-scene-reyes-knowledge').textContent,
    ).toContain('sc 1')
    expect(
      screen.getByTestId('web-fact-knowers-reyes-knowledge').textContent,
    ).toContain('1 knower')
  })

  it('styles pending fact rows with amber-soft background', () => {
    render(
      <KnowledgeWeb
        facts={[reyesKnowledge, reyesPending]}
        allFacts={[reyesKnowledge, reyesPending]}
        project={project}
        characterId="char-reyes"
        busy={false}
      />,
    )

    expect(screen.getByTestId('web-fact-reyes-pending').className).toMatch(
      /bg-tr-amber-soft/,
    )
    expect(
      screen.getByTestId('web-fact-reyes-knowledge').className,
    ).not.toMatch(/bg-tr-amber-soft/)
  })

  it('marks the selected fact row and opens FactCard detail', async () => {
    const user = userEvent.setup()
    render(
      <KnowledgeWeb
        facts={[reyesKnowledge, reyesPending]}
        allFacts={[reyesKnowledge, reyesPending]}
        project={project}
        characterId="char-reyes"
        busy={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('fact-card-reyes-knowledge')).toBeNull()

    await user.click(screen.getByTestId('web-fact-reyes-knowledge'))
    expect(screen.getByTestId('fact-card-reyes-knowledge')).toBeTruthy()
    expect(
      screen
        .getByTestId('web-fact-reyes-knowledge')
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByTestId('web-fact-reyes-knowledge').className).toMatch(
      /shadow-lift/,
    )
  })

  it('supports keyboard selection of fact rows', async () => {
    const user = userEvent.setup()
    render(
      <KnowledgeWeb
        facts={[reyesKnowledge, reyesPending]}
        allFacts={[reyesKnowledge, reyesPending]}
        project={project}
        characterId="char-reyes"
        busy={false}
      />,
    )

    const row = screen.getByTestId('web-fact-reyes-knowledge')
    row.focus()
    expect(document.activeElement).toBe(row)
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('fact-card-reyes-knowledge')).toBeTruthy()
  })

  it('opens the selected fact in Atlas', async () => {
    const user = userEvent.setup()
    const onOpenInAtlas = vi.fn()
    render(
      <KnowledgeWeb
        facts={[reyesKnowledge]}
        allFacts={[reyesKnowledge]}
        project={project}
        characterId="char-reyes"
        busy={false}
        onOpenInAtlas={onOpenInAtlas}
      />,
    )

    await user.click(screen.getByTestId('web-fact-reyes-knowledge'))
    await user.click(screen.getByRole('button', { name: 'Open in Atlas' }))

    expect(onOpenInAtlas).toHaveBeenCalledWith('reyes-knowledge')
  })

  it('shows +N more overflow chrome that browses Atlas', async () => {
    const user = userEvent.setup()
    const onBrowseInAtlas = vi.fn()
    const many = Array.from({ length: 30 }, (_, i) =>
      fact({
        id: `fact-${i}`,
        knownBy: ['char-reyes'],
        factType: 'event',
        fact: `Event fact ${i}`,
      }),
    )

    render(
      <KnowledgeWeb
        facts={many}
        allFacts={many}
        project={project}
        characterId="char-reyes"
        busy={false}
        onBrowseInAtlas={onBrowseInAtlas}
      />,
    )

    const overflow = screen.getByTestId('knowledge-web-overflow')
    expect(overflow.textContent).toContain('+6 more')
    await user.click(overflow)
    expect(onBrowseInAtlas).toHaveBeenCalledTimes(1)
  })

  it('hides fact–fact mini-edges by default', () => {
    render(
      <KnowledgeWeb
        facts={[
          fact({
            id: 'shared-a',
            knownBy: ['char-reyes', 'char-marta'],
            fact: 'Shared secret A',
          }),
          fact({
            id: 'shared-b',
            knownBy: ['char-reyes', 'char-marta'],
            fact: 'Shared secret B',
          }),
        ]}
        allFacts={[]}
        project={project}
        characterId="char-reyes"
        busy={false}
      />,
    )

    expect(screen.queryByTestId('edge-sk-shared-a-shared-b')).toBeNull()
  })

  it('marks related rows when a fact is selected', async () => {
    const user = userEvent.setup()
    render(
      <KnowledgeWeb
        facts={[
          fact({
            id: 'shared-a',
            knownBy: ['char-reyes', 'char-marta'],
            fact: 'Shared secret A',
          }),
          fact({
            id: 'shared-b',
            knownBy: ['char-reyes', 'char-marta'],
            fact: 'Shared secret B',
          }),
        ]}
        allFacts={[]}
        project={project}
        characterId="char-reyes"
        busy={false}
      />,
    )

    await user.click(screen.getByTestId('web-fact-shared-a'))
    expect(
      screen.getByTestId('web-fact-shared-b').getAttribute('data-related'),
    ).toBe('true')
    expect(
      screen.getByTestId('web-fact-shared-a').getAttribute('data-related'),
    ).toBeNull()
  })

  it('shows queue actions in detail when selected fact is pending', async () => {
    const user = userEvent.setup()
    render(
      <KnowledgeWeb
        facts={[reyesPending]}
        allFacts={[reyesPending]}
        project={project}
        characterId="char-reyes"
        busy={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('web-fact-reyes-pending'))
    expect(screen.getByTestId('accept-reyes-pending')).toBeTruthy()
    expect(screen.getByTestId('edit-reyes-pending')).toBeTruthy()
    expect(screen.getByTestId('reject-reyes-pending')).toBeTruthy()
  })

  it('shows empty state when no fact nodes match focus', () => {
    render(
      <KnowledgeWeb
        facts={[martaKnowledge]}
        allFacts={[martaKnowledge]}
        project={project}
        characterId="char-reyes"
        busy={false}
      />,
    )

    expect(screen.getByTestId('knowledge-web-empty')).toBeTruthy()
    expect(screen.getByTestId('knowledge-web-empty').textContent).toContain(
      'No knowledge facts for Detective Ana Reyes yet',
    )
  })

  it('shows audience empty state with People nudge when characterId is null', () => {
    render(
      <KnowledgeWeb
        facts={[reyesKnowledge]}
        allFacts={[reyesKnowledge]}
        project={project}
        characterId={null}
        busy={false}
      />,
    )

    expect(screen.getByTestId('knowledge-web-empty').textContent).toContain(
      'No knowledge facts for Audience yet',
    )
    expect(
      screen.getByTestId('knowledge-web-people-nudge').textContent,
    ).toMatch(/Pick a person in People/i)
  })

  it('nudges Audience focus when the web is sparse', () => {
    const audienceFact = fact({
      id: 'audience-1',
      knownBy: [],
      fact: 'Everyone knows the pier floods',
    })

    render(
      <KnowledgeWeb
        facts={[audienceFact]}
        allFacts={[audienceFact]}
        project={project}
        characterId={null}
        busy={false}
      />,
    )

    expect(
      screen.getByTestId('knowledge-web-people-nudge').textContent,
    ).toMatch(/pick a person in People/i)
  })

  it('creative polish: list rows use 15px fact text and focus strip legend', () => {
    const f = fact({
      id: 'f1',
      factType: 'knowledge',
      fact: 'Marta knows the till is short.',
      knownBy: ['char-reyes'],
    })
    render(
      <KnowledgeWeb
        facts={[f]}
        allFacts={[f]}
        project={project}
        busy={false}
        characterId="char-reyes"
      />,
    )
    expect(screen.getByTestId('web-focus-node').textContent).toContain('Focus')
    const row = screen.getByTestId('web-fact-f1')
    expect(row.className).toContain('shadow-raised')
    expect(row.innerHTML).toContain('text-15')
  })

})
