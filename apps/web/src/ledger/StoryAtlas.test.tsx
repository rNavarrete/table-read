// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LedgerFact, Project } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoryAtlas } from './StoryAtlas'

afterEach(() => {
  cleanup()
})

function project(): Project {
  return {
    id: 'proj-1',
    title: 'Test Project',
    headSnapshotId: 'snap-1',
    seriesBible: {
      characters: [
        { id: 'char-marta', name: 'Marta Vega' },
        { id: 'char-dan', name: 'Dan Vega' },
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
                id: 'scene-3',
                index: 2,
                beats: [{ id: 'beat-3-1', index: 1 }],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

function fact(
  partial: Partial<LedgerFact> & Pick<LedgerFact, 'id' | 'factType' | 'fact'>,
): LedgerFact {
  return {
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-3',
      beatId: 'beat-3-1',
      startLine: null,
      endLine: null,
      charStart: null,
      charEnd: null,
    },
    sourceText: '',
    knownBy: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.8,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    ...partial,
  }
}

describe('StoryAtlas', () => {
  it('renders chapter titles grouped by fact type', () => {
    const facts = [
      fact({
        id: 'f-knowledge',
        factType: 'knowledge',
        fact: 'Marta knows the ledger is short.',
      }),
      fact({
        id: 'f-event',
        factType: 'event',
        fact: 'Dan took cash from the register.',
      }),
    ]

    render(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
      />,
    )

    expect(screen.getByTestId('story-atlas')).not.toBeNull()
    expect(screen.getByTestId('fact-chapter-knowledge')).not.toBeNull()
    expect(screen.getByTestId('fact-chapter-event')).not.toBeNull()
    expect(screen.getByText('People & knowledge')).not.toBeNull()
    expect(screen.getByText('Events')).not.toBeNull()
  })

  it('expands a row to show full fact detail via FactCard', async () => {
    const user = userEvent.setup()
    const facts = [
      fact({
        id: 'f-event',
        factType: 'event',
        fact: 'Dan took cash from the register.',
      }),
    ]

    render(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
      />,
    )

    expect(screen.queryByTestId('fact-card-f-event')).toBeNull()
    await user.click(screen.getByTestId('atlas-row-f-event'))
    const card = screen.getByTestId('fact-card-f-event')
    expect(card).not.toBeNull()
    expect(card.textContent).toContain('Dan took cash from the register.')
  })

  it('keeps only one fact expanded globally', async () => {
    const user = userEvent.setup()
    const facts = [
      fact({
        id: 'f-knowledge',
        factType: 'knowledge',
        fact: 'Marta knows the ledger is short.',
      }),
      fact({
        id: 'f-event',
        factType: 'event',
        fact: 'Dan took cash from the register.',
      }),
    ]

    render(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
      />,
    )

    await user.click(screen.getByTestId('atlas-row-f-knowledge'))
    expect(screen.getByTestId('fact-card-f-knowledge')).not.toBeNull()
    expect(screen.queryByTestId('fact-card-f-event')).toBeNull()

    await user.click(screen.getByTestId('atlas-row-f-event'))
    expect(screen.getByTestId('fact-card-f-event')).not.toBeNull()
    expect(screen.queryByTestId('fact-card-f-knowledge')).toBeNull()
  })

  it('shows collapsed scene cue and known-by summary', () => {
    const facts = [
      fact({
        id: 'f-knowledge',
        factType: 'knowledge',
        fact: 'Marta knows the ledger is short.',
        knownBy: ['char-marta', 'char-dan'],
      }),
    ]

    render(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
      />,
    )

    expect(screen.getByText('KNOWS')).not.toBeNull()
    expect(screen.getByText(/MV.*DV/)).not.toBeNull()
    expect(screen.getByText(/ep 1 · sc 3 · beat 2/)).not.toBeNull()
  })

  it('shows queue actions on expanded pending facts', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    const facts = [
      fact({
        id: 'f-pending',
        factType: 'state',
        fact: 'The safe is empty.',
        status: 'pending_review',
      }),
    ]

    render(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
        onAccept={onAccept}
      />,
    )

    await user.click(screen.getByTestId('atlas-row-f-pending'))
    await user.click(screen.getByTestId('accept-f-pending'))
    expect(onAccept).toHaveBeenCalledWith('f-pending')
  })

  it('shows filtered-empty copy when no facts', () => {
    render(
      <StoryAtlas
        facts={[]}
        allFacts={[]}
        project={project()}
        busy={false}
      />,
    )

    expect(screen.getByTestId('story-atlas')).not.toBeNull()
    expect(screen.getByText('No facts match these filters.')).not.toBeNull()
  })
})
