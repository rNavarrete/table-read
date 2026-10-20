// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Scene, StoryOverviewBeatItem } from 'contract'
import {
  WhatTheSceneDoes,
  type WhatTheSceneDoesProps,
} from './WhatTheSceneDoes'
import { WithDrafts } from './testDrafts'

afterEach(cleanup)

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night',
    socialSituation: '',
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
    whatHappens: 'Marta walks back in.',
    audienceLearns: 'Eight years away.',
    audienceFeels: 'Unease.',
    motivations: [],
    beats: [
      {
        id: 'beat-1-1',
        index: 0,
        locked: false,
        whatHappens: 'Dan covers his shock.',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: false,
        actorCharacterId: null,
        actionVerb: '',
        targetCharacterId: null,
        reaction: '',
        kernel: null,
        pressureChoice: null,
      },
      {
        id: 'beat-1-2',
        index: 1,
        locked: true,
        whatHappens: 'Marta opens the books.',
        audienceLearns: '',
        audienceFeels: '',
        scriptText: '',
        scriptLocked: true,
        actorCharacterId: null,
        actionVerb: '',
        targetCharacterId: null,
        reaction: '',
        kernel: null,
        pressureChoice: null,
      },
    ],
    ...overrides,
  }
}

function landmark(
  overrides: Partial<StoryOverviewBeatItem> = {},
): StoryOverviewBeatItem {
  return {
    beatId: 'beat-1-2',
    label: 'Catalyst',
    summary: 'Marta finds the transfer.',
    sceneId: 'scene-1',
    act: 0,
    ...overrides,
  }
}

function props(
  overrides: Partial<WhatTheSceneDoesProps> = {},
): WhatTheSceneDoesProps {
  return {
    scene: scene(),
    landmarks: [],
    locked: false,
    saving: false,
    openingReview: false,
    onSaveField: vi.fn().mockResolvedValue(true),
    onOpenReview: vi.fn(),
    onSuggest: vi.fn().mockResolvedValue([]),
    onShowBeat: vi.fn(),
    ...overrides,
  }
}

describe('WhatTheSceneDoes', () => {
  it('leads with What happens, then the audience Learns / Feels', () => {
    render(<WhatTheSceneDoes {...props()} />, { wrapper: WithDrafts })
    const fields = screen
      .getAllByRole('textbox')
      .map((el) => el.getAttribute('aria-label'))
    expect(fields).toEqual([
      'What happens',
      'Audience learns',
      'Audience feels',
    ])
    expect(
      (screen.getByLabelText('What happens') as HTMLTextAreaElement).className,
    ).toContain('text-15')
    expect(screen.getByText('The audience')).not.toBeNull()
  })

  it('What happens is structural: Save field only and Open Review carry the draft', async () => {
    const user = userEvent.setup()
    const onSaveField = vi.fn().mockResolvedValue(true)
    const onOpenReview = vi.fn()
    render(<WhatTheSceneDoes {...props({ onSaveField, onOpenReview })} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText('What happens')
    await user.clear(field)
    await user.type(field, 'Marta stays outside.')

    await user.click(screen.getByRole('button', { name: 'Open Review' }))
    expect(onOpenReview).toHaveBeenCalledWith('Marta stays outside.')
    await user.click(screen.getByRole('button', { name: 'Save field only' }))
    expect(onSaveField).toHaveBeenCalledWith(
      'whatHappens',
      'Marta stays outside.',
    )
  })

  it('the audience fields save with a plain Save', async () => {
    const user = userEvent.setup()
    const onSaveField = vi.fn().mockResolvedValue(true)
    render(<WhatTheSceneDoes {...props({ onSaveField })} />, {
      wrapper: WithDrafts,
    })
    await user.type(screen.getByLabelText('Audience feels'), ' And dread.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSaveField).toHaveBeenCalledWith(
      'audienceFeels',
      'Unease. And dread.',
    )
  })

  it('shows a landmark callout that jumps to its beat', async () => {
    const user = userEvent.setup()
    const onShowBeat = vi.fn()
    render(
      <WhatTheSceneDoes {...props({ landmarks: [landmark()], onShowBeat })} />,
      { wrapper: WithDrafts },
    )
    expect(screen.getByText('Catalyst')).not.toBeNull()
    expect(screen.getByText(/Marta finds the transfer\./)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Beat 1.2' }))
    expect(onShowBeat).toHaveBeenCalledWith('beat-1-2')
  })

  it('a landmark on a beat this scene no longer has shows no beat link', () => {
    render(
      <WhatTheSceneDoes
        {...props({ landmarks: [landmark({ beatId: 'beat-9-9' })] })}
      />,
      { wrapper: WithDrafts },
    )
    expect(screen.getByText('Catalyst')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^Beat / })).toBeNull()
  })

  it('locked: every field is read-only and Suggest… is gone', () => {
    const onSuggest = vi.fn()
    render(
      <WhatTheSceneDoes
        {...props({
          scene: scene({ whatHappens: '' }),
          locked: true,
          onSuggest,
        })}
      />,
      { wrapper: WithDrafts },
    )
    for (const label of ['What happens', 'Audience learns', 'Audience feels']) {
      expect(
        (screen.getByLabelText(label) as HTMLTextAreaElement).readOnly,
      ).toBe(true)
    }
    expect(screen.queryByRole('button', { name: 'Suggest…' })).toBeNull()
    expect(onSuggest).not.toHaveBeenCalled()
  })

  it('offers Suggest… on an empty What happens and asks only on click', async () => {
    const user = userEvent.setup()
    const onSuggest = vi.fn().mockResolvedValue([])
    render(
      <WhatTheSceneDoes
        {...props({ scene: scene({ whatHappens: '' }), onSuggest })}
      />,
      { wrapper: WithDrafts },
    )
    expect(onSuggest).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Suggest…' }))
    expect(onSuggest).toHaveBeenCalledTimes(1)
  })

  it('leaves the turn and Why now to the panel header (T10.12)', () => {
    render(
      <WhatTheSceneDoes
        {...props({
          scene: scene({
            valueAtStake: 'trust',
            chargeIn: 'negative',
            chargeOut: 'positive',
            whyNow: 'The audit lands tomorrow.',
          }),
        })}
      />,
      { wrapper: WithDrafts },
    )
    expect(screen.queryByText('The turn')).toBeNull()
    expect(screen.queryByText('Why now')).toBeNull()
  })
})
