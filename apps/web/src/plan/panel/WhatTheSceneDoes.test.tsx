// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
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

  describe('the turn (T10.1)', () => {
    function turnRow() {
      const term = screen.getByText('The turn')
      return term.nextElementSibling as HTMLElement
    }

    it('states the value and its charges, spoken as words', () => {
      render(
        <WhatTheSceneDoes
          {...props({
            scene: scene({
              valueAtStake: 'trust',
              chargeIn: 'negative',
              chargeOut: 'positive',
            }),
          })}
        />,
        { wrapper: WithDrafts },
      )
      const row = turnRow()
      expect(row.textContent).toContain('Trust: ')
      expect(within(row).getByText('− → +').getAttribute('aria-hidden')).toBe(
        'true',
      )
      expect(within(row).getByText('negative to positive').className).toContain(
        'sr-only',
      )
    })

    it('reads "holds at" when the charge does not change', () => {
      render(
        <WhatTheSceneDoes
          {...props({
            scene: scene({
              valueAtStake: 'trust',
              chargeIn: 'mixed',
              chargeOut: 'mixed',
            }),
          })}
        />,
        { wrapper: WithDrafts },
      )
      const row = turnRow()
      expect(within(row).getByText('holds at ±')).not.toBeNull()
      expect(within(row).getByText('holds at mixed')).not.toBeNull()
    })

    it('shows a partial reading as returned', () => {
      render(
        <WhatTheSceneDoes
          {...props({ scene: scene({ chargeOut: 'negative' }) })}
        />,
        { wrapper: WithDrafts },
      )
      expect(turnRow().textContent).toBe('closes −closes negative')
    })

    it('shows Why now under the turn', () => {
      render(
        <WhatTheSceneDoes
          {...props({
            scene: scene({
              valueAtStake: 'trust',
              whyNow: 'The audit lands tomorrow.',
            }),
          })}
        />,
        { wrapper: WithDrafts },
      )
      expect(turnRow().textContent).toBe('Trust')
      expect(screen.getByText('Why now').nextElementSibling?.textContent).toBe(
        'The audit lands tomorrow.',
      )
    })

    it('neither row shows on a scene with no turn reading', () => {
      render(<WhatTheSceneDoes {...props()} />, { wrapper: WithDrafts })
      expect(screen.queryByText('The turn')).toBeNull()
      expect(screen.queryByText('Why now')).toBeNull()
    })
  })
})
