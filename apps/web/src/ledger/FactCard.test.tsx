// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LedgerFact, Project } from 'contract'
import { FactCard } from './FactCard'
import { FactDetailDrawer } from './FactDetailDrawer'

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
              id: 'scene-4',
              index: 3,
              beats: [{ id: 'beat-4-1', index: 0 }],
            },
          ],
        },
      ],
    },
  ],
} as unknown as Project

function makeFact(partial: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: 'fact-06',
    fact: 'Reyes is running a night stakeout on the marina robbery from Harbor Street',
    factType: 'state',
    sourceSpan: {
      episodeId: 'ep-1',
      sceneId: 'scene-4',
      beatId: 'beat-4-1',
      startLine: 2,
      endLine: 2,
      charStart: 93,
      charEnd: 121,
    },
    sourceText: 'eyes on the dark marina gate',
    knownBy: ['char-reyes'],
    knowledgeEvents: [],
    audienceKnows: true,
    provenance: 'inferred',
    confidence: 0.72,
    status: 'pending_review',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
    ...partial,
  }
}

describe('FactCard', () => {
  it('renders fact fields, known-by chip, provenance, status, confidence', () => {
    const fact = makeFact()
    render(
      <FactCard fact={fact} allFacts={[fact]} project={project} queueActions />,
    )
    expect(screen.getByTestId('fact-card-fact-06').textContent).toContain(
      'Reyes is running a night stakeout',
    )
    expect(screen.getByText('state')).toBeTruthy()
    expect(screen.getByText('inferred')).toBeTruthy()
    expect(screen.getByText('pending_review')).toBeTruthy()
    expect(screen.getByTestId('confidence-bar')).toBeTruthy()
    expect(screen.getByText('DR')).toBeTruthy() // Detective Ana Reyes → D+R
    // sc = story position: scene-4 is this episode's only scene.
    expect(screen.getByTestId('source-span-fact-06').textContent).toMatch(
      /ep 1 · sc 1 · beat 1/,
    )
  })

  it('T7.23: prefers knownByAsOf chips + label over baseline knownBy when set', () => {
    const fact = makeFact({
      knownBy: ['char-reyes'],
      knownByAsOf: ['char-reyes', 'char-marta'],
    })
    render(<FactCard fact={fact} allFacts={[fact]} project={project} />)

    expect(screen.getByText('Known by (as of this scene)')).toBeTruthy()
    expect(screen.getByText('DR')).toBeTruthy()
    expect(screen.getByText('MV')).toBeTruthy() // Marta Vega → M+V
  })

  it('falls back to baseline knownBy label/chips when knownByAsOf is null', () => {
    const fact = makeFact({ knownBy: ['char-reyes'], knownByAsOf: null })
    render(<FactCard fact={fact} allFacts={[fact]} project={project} />)

    expect(screen.getByText('Known by')).toBeTruthy()
    expect(screen.queryByText('Known by (as of this scene)')).toBeNull()
  })

  it('uses Quiet Tool fact-card chrome and confidence colors', () => {
    const fact = makeFact()
    render(<FactCard fact={fact} allFacts={[fact]} project={project} />)

    expect(screen.getByTestId('fact-card-fact-06').className).toMatch(
      /border-tr-border/,
    )
    expect(screen.getByTestId('confidence-bar').className).toMatch(
      /bg-tr-surface-sunken/,
    )
    expect(screen.getByTestId('confidence-bar-fill').className).toMatch(
      /bg-tr-sage/,
    )
  })

  it('queue actions fire Accept / Reject / Edit save', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    const onReject = vi.fn()
    const onEdit = vi.fn()
    const fact = makeFact()
    render(
      <FactCard
        fact={fact}
        allFacts={[fact]}
        project={project}
        queueActions
        onAccept={onAccept}
        onReject={onReject}
        onEdit={onEdit}
      />,
    )

    await user.click(screen.getByTestId('accept-fact-06'))
    expect(onAccept).toHaveBeenCalledWith('fact-06')

    await user.click(screen.getByTestId('reject-fact-06'))
    expect(onReject).toHaveBeenCalledWith('fact-06')

    await user.click(screen.getByTestId('edit-fact-06'))
    const textarea = screen.getByTestId('fact-edit-text-fact-06')
    await user.clear(textarea)
    await user.type(textarea, 'Reyes may be bluffing about the warrant.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onEdit).toHaveBeenCalledWith(
      'fact-06',
      expect.objectContaining({
        fact: 'Reyes may be bluffing about the warrant.',
        knownBy: ['char-reyes'],
      }),
    )
  })

  it('superseded facts show strikethrough and expandable chain', async () => {
    const user = userEvent.setup()
    const oldFact = makeFact({
      id: 'fact-old',
      fact: 'Old claim',
      status: 'superseded',
      supersededBy: 'fact-new',
    })
    const newFact = makeFact({
      id: 'fact-new',
      fact: 'New claim',
      status: 'active',
      supersedes: 'fact-old',
      provenance: 'writer_confirmed',
    })
    render(
      <FactCard
        fact={oldFact}
        allFacts={[oldFact, newFact]}
        project={project}
      />,
    )
    expect(screen.getByText('Old claim').className).toMatch(/line-through/)
    await user.click(screen.getByTestId('supersede-link-fact-old'))
    expect(
      screen.getByTestId('supersede-chain-fact-old').textContent,
    ).toContain('fact-new')
  })

  it('creative polish: raised card surface and queue action motion', () => {
    render(
      <FactCard
        fact={makeFact({ status: 'pending_review' })}
        allFacts={[makeFact({ status: 'pending_review' })]}
        project={project}
        queueActions
      />,
    )
    const card = screen.getByTestId('fact-card-fact-06')
    expect(card.className).toContain('shadow-raised')
    expect(screen.getByTestId('accept-fact-06').className).toContain(
      'duration-standard',
    )
  })
})

describe('fact detail beliefs (T10.4)', () => {
  const misled = makeFact({
    knowledgeEvents: [
      {
        sceneId: 'scene-4',
        characterIds: ['char-marta'],
        kind: 'misinformed',
        quote: '',
        belief: 'the stakeout is about the robbery',
      },
    ],
  })

  it('the fact card and the Atlas drawer state what a misinformed character believes', () => {
    render(<FactCard fact={misled} allFacts={[misled]} project={project} />)
    expect(
      screen.getByText(
        'Marta Vega believes: the stakeout is about the robbery',
      ),
    ).toBeTruthy()
    cleanup()

    render(
      <FactDetailDrawer
        fact={misled}
        allFacts={[misled]}
        project={project}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Beliefs')).toBeTruthy()
    expect(
      screen.getByText(
        'Marta Vega believes: the stakeout is about the robbery',
      ),
    ).toBeTruthy()
  })

  it('shows no Beliefs section without one', () => {
    const plain = makeFact()
    render(
      <FactDetailDrawer
        fact={plain}
        allFacts={[plain]}
        project={project}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByText('Beliefs')).toBeNull()
  })
})
