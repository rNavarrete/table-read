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
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.8,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
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

  it('expands the controlled fact', () => {
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
        expandedFactId="f-event"
      />,
    )

    expect(screen.getByTestId('fact-card-f-event')).not.toBeNull()
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

  it('omits redundant chapter type cue and shows knower/irony cue', () => {
    const facts = [
      fact({
        id: 'f-knowledge',
        factType: 'knowledge',
        fact: 'Marta knows the ledger is short.',
        knownBy: ['char-marta', 'char-dan'],
      }),
      fact({
        id: 'f-audience',
        factType: 'knowledge',
        fact: 'The ledger is short.',
        knownBy: [],
      }),
      fact({
        id: 'f-secret',
        factType: 'knowledge',
        fact: 'Dan stole the cash.',
        knownBy: ['char-dan'],
        audienceKnows: false,
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

    expect(screen.queryByText('KNOWS')).toBeNull()
    expect(screen.getByText('2 knowers')).not.toBeNull()
    expect(screen.getByText('Audience')).not.toBeNull()
    expect(screen.getByText('Secret')).not.toBeNull()
    expect(screen.getAllByText(/ep 1 · sc 3 · beat 2/).length).toBeGreaterThan(0)
  })

  it('groups large knowledge chapters under knower subheads', () => {
    const facts = [
      ...Array.from({ length: 10 }, (_, i) =>
        fact({
          id: `aud-${i}`,
          factType: 'knowledge',
          fact: `Audience fact ${i}`,
          knownBy: [],
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        fact({
          id: `marta-${i}`,
          factType: 'knowledge',
          fact: `Marta fact ${i}`,
          knownBy: ['char-marta'],
        }),
      ),
    ]

    render(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
      />,
    )

    const chapter = screen.getByTestId('fact-chapter-knowledge')
    expect(chapter.querySelector('[data-testid="knower-group-Audience"]')).not.toBeNull()
    expect(
      chapter.querySelector('[data-testid="knower-group-Marta Vega"]'),
    ).not.toBeNull()
  })

  it('keeps full factType on expanded FactCard', async () => {
    const user = userEvent.setup()
    const facts = [
      fact({
        id: 'f-knowledge',
        factType: 'knowledge',
        fact: 'Marta knows the ledger is short.',
        knownBy: ['char-marta'],
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
    expect(screen.getByTestId('fact-card-f-knowledge').textContent).toContain(
      'knowledge',
    )
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
      <StoryAtlas facts={[]} allFacts={[]} project={project()} busy={false} />,
    )

    expect(screen.getByTestId('story-atlas')).not.toBeNull()
    expect(screen.getByText('No facts match.')).not.toBeNull()
  })

  it('uses the supplied empty message', () => {
    render(
      <StoryAtlas
        facts={[]}
        allFacts={[]}
        project={project()}
        busy={false}
        emptyMessage="Facts appear as you write."
      />,
    )

    expect(screen.getByText('Facts appear as you write.')).not.toBeNull()
  })

  it('creative polish: raised empty state and chapter display title', () => {
    const { rerender } = render(
      <StoryAtlas facts={[]} allFacts={[]} project={project()} busy={false} />,
    )
    const empty = screen.getByTestId('story-atlas')
    expect(empty.className).toContain('shadow-raised')
    expect(empty.textContent).toContain('No facts match.')

    const facts = [
      fact({
        id: 'f1',
        factType: 'event',
        fact: 'The till is short.',
      }),
    ]
    rerender(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
      />,
    )
    const toggle = screen.getByTestId('fact-chapter-toggle-event')
    expect(toggle.className).toContain('focus-visible:outline-tr-coral')
    expect(toggle.querySelector('.font-display')?.className).toContain(
      'text-17',
    )
  })

  it('creative polish: expanded row uses selected outline and lift', async () => {
    const user = userEvent.setup()
    const facts = [
      fact({
        id: 'f1',
        factType: 'event',
        fact: 'The till is short.',
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
    const row = screen.getByTestId('atlas-row-f1')
    expect(row.className).toContain('shadow-raised')
    await user.click(row)
    expect(screen.getByTestId('atlas-row-f1').className).toContain('shadow-lift')
    expect(screen.getByTestId('atlas-row-f1').className).toContain(
      'outline-tr-coral',
    )
  })

  it('chapters default expanded and collapse via header button', async () => {
    const user = userEvent.setup()
    const facts = [
      fact({
        id: 'f-event',
        factType: 'event',
        fact: 'Dan took cash from the register.',
      }),
      fact({
        id: 'f-knowledge',
        factType: 'knowledge',
        fact: 'Marta knows the ledger is short.',
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

    const toggle = screen.getByTestId('fact-chapter-toggle-event')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('atlas-row-f-event')).not.toBeNull()

    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('atlas-row-f-event')).toBeNull()
    // Other chapters stay open.
    expect(screen.getByTestId('atlas-row-f-knowledge')).not.toBeNull()

    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('atlas-row-f-event')).not.toBeNull()
  })

  it('knower subheads collapse independently within a chapter', async () => {
    const user = userEvent.setup()
    const facts = [
      ...Array.from({ length: 10 }, (_, i) =>
        fact({
          id: `aud-${i}`,
          factType: 'knowledge',
          fact: `Audience fact ${i}`,
          knownBy: [],
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        fact({
          id: `marta-${i}`,
          factType: 'knowledge',
          fact: `Marta fact ${i}`,
          knownBy: ['char-marta'],
        }),
      ),
    ]

    render(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
      />,
    )

    const audienceToggle = screen.getByTestId('knower-group-toggle-Audience')
    expect(audienceToggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('atlas-row-aud-0')).not.toBeNull()

    await user.click(audienceToggle)
    expect(audienceToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('atlas-row-aud-0')).toBeNull()
    expect(screen.getByTestId('atlas-row-marta-0')).not.toBeNull()
  })

  it('re-opens a collapsed chapter when its fact is selected', async () => {
    const user = userEvent.setup()
    const facts = [
      fact({
        id: 'f-event',
        factType: 'event',
        fact: 'Dan took cash from the register.',
      }),
    ]

    const { rerender } = render(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
        expandedFactId={null}
      />,
    )

    await user.click(screen.getByTestId('fact-chapter-toggle-event'))
    expect(screen.queryByTestId('atlas-row-f-event')).toBeNull()

    rerender(
      <StoryAtlas
        facts={facts}
        allFacts={facts}
        project={project()}
        busy={false}
        expandedFactId="f-event"
      />,
    )

    expect(
      screen.getByTestId('fact-chapter-toggle-event').getAttribute(
        'aria-expanded',
      ),
    ).toBe('true')
    expect(screen.getByTestId('atlas-row-f-event')).not.toBeNull()
    expect(screen.getByTestId('fact-card-f-event')).not.toBeNull()
  })

})
