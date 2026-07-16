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
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.5,
    status: 'active',
    supersedes: null,
    supersededBy: null,
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

  it('renders fact node buttons with web-fact test ids', () => {
    render(
      <KnowledgeWeb
        facts={[reyesKnowledge, reyesPending, martaKnowledge]}
        allFacts={[reyesKnowledge, reyesPending, martaKnowledge]}
        project={project}
        characterId="char-reyes"
        busy={false}
      />,
    )

    expect(screen.getByTestId('web-fact-reyes-knowledge')).toBeTruthy()
    expect(screen.getByTestId('web-fact-reyes-pending')).toBeTruthy()
    expect(screen.queryByTestId('web-fact-marta-knowledge')).toBeNull()
  })

  it('styles pending fact nodes with amber-soft background', () => {
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

  it('clicking a fact node opens FactCard detail panel', async () => {
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
      screen.getByTestId('fact-card-reyes-knowledge').textContent,
    ).toContain('Reyes knows the marina gate code')
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

  it('shows audience empty state when characterId is null', () => {
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
  })
})
