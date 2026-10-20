// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Character,
  LedgerFact,
  Scene,
  Secret,
  StoryThread,
} from 'contract'
import { factsForScene, type SceneSecret, type SceneThread } from '../story'
import { WhatItTouches, type WhatItTouchesProps } from './WhatItTouches'

afterEach(cleanup)

function scene(id: string, index: number): Scene {
  return {
    id,
    index,
    act: 1,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: '',
    socialSituation: '',
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
  }
}

const SCENES = [scene('scene-1', 0), scene('scene-2', 1), scene('scene-4', 3)]

function character(id: string, name: string): Character {
  return {
    id,
    name,
    locked: false,
    aliases: [],
    embodiment: '',
    presentation: '',
    hiding: '',
    traits: '',
    seriesArc: '',
    summary: '',
    bio: '',
  }
}

const CHARACTERS = [
  character('char-marta', 'Marta Vega'),
  character('char-dan', 'Dan Vega'),
  character('char-luz', 'Luz Vega'),
  character('char-reyes', 'Detective Ana Reyes'),
]

function thread(overrides: Partial<StoryThread> = {}): StoryThread {
  return {
    id: 'thread-1',
    label: 'The missing money',
    summary: 'Marta finds the $40,000 hole in the books.',
    status: 'open',
    ownerCharacterIds: ['char-marta'],
    setupSceneId: 'scene-1',
    payoffSceneId: null,
    setupQuote: '',
    payoffQuote: '',
    setupBeatId: null,
    payoffBeatId: null,
    locked: false,
    storyline: null,
    ...overrides,
  }
}

function secret(overrides: Partial<Secret> = {}): Secret {
  return {
    id: 'secret-1',
    summary: 'Dan took the $40,000.',
    factId: null,
    holderCharacterIds: ['char-dan'],
    concealedFromCharacterIds: ['char-marta', 'char-luz', 'char-reyes'],
    audienceKnows: true,
    establishedSceneId: 'scene-2',
    revealedSceneId: 'scene-4',
    concealmentSceneIds: ['scene-1'],
    establishedQuote: '',
    revealedQuote: '',
    establishedBeatId: null,
    revealedBeatId: null,
    provenance: 'inferred',
    locked: false,
    ...overrides,
  }
}

function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: 'fact-01',
    fact: 'Marta has been away for eight years',
    factType: 'state',
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
    provenance: 'writer_confirmed',
    confidence: 0.9,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    knownByAsOf: null,
    ...overrides,
  }
}

function renderTouches(overrides: Partial<WhatItTouchesProps> = {}) {
  const props: WhatItTouchesProps = {
    scenes: SCENES,
    threads: [],
    secrets: [],
    facts: { shown: [], retired: [] },
    modes: null,
    relationshipMoments: [],
    characters: CHARACTERS,
    alsoInScene: [],
    onSelectScene: vi.fn(),
    onOpenFact: vi.fn(),
    onOpenLedger: vi.fn(),
    ...overrides,
  }
  render(<WhatItTouches {...props} />)
  return props
}

describe('WhatItTouches', () => {
  it('lists only this scene’s active and pending facts; retired ones wait behind "Show n retired" (port from Inspector.test)', async () => {
    const user = userEvent.setup()
    const ledger = [
      fact({ id: 'fact-01' }),
      fact({
        id: 'fact-02',
        fact: 'The stolen $40,000 is hidden inside the ice machine',
        sourceSpan: { ...fact().sourceSpan, sceneId: 'scene-2' },
      }),
      fact({
        id: 'fact-09',
        fact: 'Marta left town nine years ago',
        status: 'superseded',
      }),
    ]
    renderTouches({ facts: factsForScene(ledger, 'scene-1') })

    expect(
      screen.getByText('Marta has been away for eight years'),
    ).not.toBeNull()
    expect(screen.queryByText(/ice machine/)).toBeNull()
    expect(screen.queryByText('Marta left town nine years ago')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show 1 retired' }))
    expect(screen.getByText('Marta left town nine years ago')).not.toBeNull()
    expect(screen.getByText('Superseded')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Hide retired' })).not.toBeNull()
  })

  it('a pending fact reads Unconfirmed; a fact hidden from the audience says so; type and Known by show', () => {
    renderTouches({
      facts: {
        shown: [
          fact({
            id: 'fact-06',
            status: 'pending_review',
            audienceKnows: false,
            factType: 'world_rule',
            knownBy: ['char-marta', 'char-dan', 'char-luz'],
          }),
        ],
        retired: [],
      },
    })
    const row = screen.getByRole('button', { name: /Marta has been away/ })
    expect(within(row).getByText('Unconfirmed')).not.toBeNull()
    expect(within(row).getByText('world rule')).not.toBeNull()
    expect(within(row).getByText('◆ hidden from the audience')).not.toBeNull()
    expect(
      within(row).getByText('Known by Marta Vega, Dan Vega +1'),
    ).not.toBeNull()
  })

  it('a fact opens in Ledger, and "Open in Ledger →" opens the Ledger', async () => {
    const user = userEvent.setup()
    const props = renderTouches({ facts: { shown: [fact()], retired: [] } })
    await user.click(
      screen.getByRole('button', { name: /Marta has been away/ }),
    )
    expect(props.onOpenFact).toHaveBeenCalledWith('fact-01')
    await user.click(screen.getByRole('button', { name: 'Open in Ledger →' }))
    expect(props.onOpenLedger).toHaveBeenCalled()
  })

  it('threads link to the other end; a setup with no payoff scene says Never paid off', async () => {
    const user = userEvent.setup()
    const threads: SceneThread[] = [
      {
        thread: thread({ id: 'thread-1', payoffSceneId: 'scene-4' }),
        role: 'sets_up',
        otherSceneId: 'scene-4',
      },
      {
        thread: thread({ id: 'thread-2', label: 'The foreclosure notice' }),
        role: 'sets_up',
        otherSceneId: null,
      },
      {
        thread: thread({ id: 'thread-4', label: 'A deleted payoff' }),
        role: 'sets_up',
        otherSceneId: 'scene-99',
      },
      {
        thread: thread({
          id: 'thread-3',
          label: 'Her old stool',
          setupSceneId: 'scene-2',
        }),
        role: 'pays_off',
        otherSceneId: 'scene-2',
      },
    ]
    const props = renderTouches({ threads })

    expect(screen.getAllByText('↗ Sets up')).toHaveLength(3)
    expect(screen.getByText('↘ Pays off')).not.toBeNull()
    expect(screen.getAllByText('Never paid off')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Pays off in 4 →' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-4')
    await user.click(screen.getByRole('button', { name: 'Set up in 2 →' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-2')
  })

  it('the secret reads as a dramatic-irony callout, naming who in this scene is in the dark', async () => {
    const user = userEvent.setup()
    const secrets: SceneSecret[] = [
      { secret: secret(), role: 'kept', inTheDark: ['char-marta'] },
    ]
    const props = renderTouches({ secrets })

    expect(screen.getByText('Dramatic irony.')).not.toBeNull()
    expect(
      screen.getByText(
        "The audience and Dan Vega know; Marta Vega, Luz Vega +1 don't.",
      ),
    ).not.toBeNull()
    expect(
      screen.getByText('In this scene, Marta Vega is in the dark.'),
    ).not.toBeNull()
    expect(screen.getByText('◆ Kept here')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Set in 2' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-2')
    await user.click(screen.getByRole('button', { name: 'Out in 4' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-4')
  })

  it('someone placed in the scene only by dialogue cues is labelled as such', () => {
    renderTouches({
      secrets: [
        {
          secret: secret(),
          role: 'kept',
          inTheDark: ['char-marta', 'char-luz'],
        },
      ],
      alsoInScene: [CHARACTERS[2]],
    })
    expect(
      screen.getByText('In this scene, Marta Vega is in the dark.'),
    ).not.toBeNull()
    expect(
      screen.getByText(
        'In this scene, Luz Vega is in the dark · from dialogue cues',
      ),
    ).not.toBeNull()
  })

  it('a secret the audience has not been told says so, and its own scene gets no self-link', () => {
    renderTouches({
      secrets: [
        {
          secret: secret({
            audienceKnows: false,
            establishedSceneId: 'scene-1',
          }),
          role: 'set',
          inTheDark: [],
        },
      ],
    })
    expect(
      screen.getByText("Dan Vega knows; the audience, Marta Vega +2 don't."),
    ).not.toBeNull()
    expect(screen.getByText('◆ Set here')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^Set in/ })).toBeNull()
    expect(screen.queryByText(/in the dark/)).toBeNull()
  })

  it('orders who knows a secret in words, from either side alone', () => {
    renderTouches({
      secrets: [
        {
          secret: secret({ concealedFromCharacterIds: ['char-marta'] }),
          role: 'kept',
          inTheDark: [],
        },
        {
          secret: secret({
            id: 'secret-2',
            holderCharacterIds: [],
            concealedFromCharacterIds: [],
            audienceKnows: false,
          }),
          role: 'kept',
          inTheDark: [],
        },
      ],
    })
    expect(
      screen.getByText("The audience and Dan Vega know; Marta Vega doesn't."),
    ).not.toBeNull()
    expect(screen.getByText("The audience doesn't know.")).not.toBeNull()
  })

  it('states the knowledge mode above the facts: mystery, irony or both', () => {
    renderTouches({
      facts: { shown: [fact()], retired: [] },
      modes: { mystery: ['char-dan'], irony: [], suspense: false },
    })
    const facts = screen.getByRole('heading', {
      name: 'Facts established here',
    }).parentElement!
    expect(
      within(facts).getByText("— Dan Vega knows; the audience doesn't.", {
        exact: false,
      }).textContent,
    ).toBe("Mystery — Dan Vega knows; the audience doesn't.")
    expect(within(facts).queryByText('Dramatic irony')).toBeNull()
    cleanup()

    renderTouches({
      facts: { shown: [fact()], retired: [] },
      modes: {
        mystery: ['char-dan'],
        irony: ['char-marta', 'char-luz'],
        suspense: false,
      },
    })
    expect(screen.getByText('Dramatic irony').parentElement!.textContent).toBe(
      "Dramatic irony — the audience knows; Marta Vega and Luz Vega don't.",
    )
    expect(screen.getByText('Mystery')).not.toBeNull()
    expect(screen.queryByText('Suspense')).toBeNull()
  })

  it('says suspense when the audience and the characters share what they know, and nothing with no fact in play', () => {
    renderTouches({
      facts: { shown: [fact()], retired: [] },
      modes: { mystery: [], irony: [], suspense: true },
    })
    expect(screen.getByText('Suspense').parentElement!.textContent).toBe(
      'Suspense — the audience knows what the characters here know.',
    )
    cleanup()

    renderTouches({ facts: { shown: [fact()], retired: [] } })
    expect(screen.queryByText(/Mystery|Dramatic irony|Suspense/)).toBeNull()
  })

  it('relationship moments read "A & B: label"', () => {
    renderTouches({
      relationshipMoments: [
        {
          between: ['char-marta', 'char-dan'],
          label: 'estranged co-owners',
          sceneId: 'scene-1',
          quote: '',
        },
      ],
    })
    expect(
      screen.getByText('Marta Vega & Dan Vega: estranged co-owners'),
    ).not.toBeNull()
  })

  it('each empty group gets one quiet line; with nothing at all the section is one line', () => {
    renderTouches({ facts: { shown: [fact()], retired: [] } })
    expect(screen.getByText('No threads start or land here.')).not.toBeNull()
    expect(screen.getByText('No secret is kept here.')).not.toBeNull()
    expect(screen.getByText('No relationship moments recorded.')).not.toBeNull()
    cleanup()

    renderTouches()
    expect(
      screen.getByText(
        'Nothing recorded yet: no threads, secret, facts or relationship moments touch this scene.',
      ),
    ).not.toBeNull()
    expect(screen.queryByText('No threads start or land here.')).toBeNull()
  })
})
