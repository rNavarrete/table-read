// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Character, Motivation } from 'contract'
import { AtAGlance, type AtAGlanceProps } from './AtAGlance'

afterEach(cleanup)

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

const characters = [
  character('char-berg', 'Bergstrom'),
  character('char-skinner', 'Skinner'),
  character('char-chuck', 'Chuck'),
  character('char-lisa', 'Lisa'),
]

function want(characterId: string, objective: string): Motivation {
  return {
    characterId,
    objective,
    stakes: '',
    obstacle: '',
    statedObjective: '',
    concealed: false,
  }
}

function props(overrides: Partial<AtAGlanceProps> = {}): AtAGlanceProps {
  return {
    turn: null,
    whyNow: '',
    clashes: [],
    modes: null,
    characters,
    ...overrides,
  }
}

function row(term: string): HTMLElement {
  return screen.getByText(term).nextElementSibling as HTMLElement
}

describe('AtAGlance', () => {
  it('states the turn, its charges spoken as words', () => {
    render(
      <AtAGlance
        {...props({
          turn: {
            stake: 'Recognition',
            charges: ['− → +', 'negative to positive'],
            holds: false,
          },
        })}
      />,
    )
    const turn = row('The turn')
    expect(turn.textContent).toContain('Recognition ')
    expect(within(turn).getByText('− → +').getAttribute('aria-hidden')).toBe(
      'true',
    )
    expect(within(turn).getByText('negative to positive').className).toContain(
      'sr-only',
    )
  })

  it('reads "holds at" when the charge does not change, and Why now beside it', () => {
    render(
      <AtAGlance
        {...props({
          turn: {
            stake: 'Order',
            charges: ['holds at ±', 'holds at mixed'],
            holds: true,
          },
          whyNow: 'The audit lands tomorrow.',
        })}
      />,
    )
    expect(within(row('The turn')).getByText('holds at ±')).not.toBeNull()
    expect(row('Why now').textContent).toBe('The audit lands tomorrow.')
  })

  it('sets two colliding wants against each other, labelled as read from wants and beats', () => {
    render(
      <AtAGlance
        {...props({
          clashes: [
            {
              a: want('char-berg', 'Win over a class of strangers'),
              b: want('char-skinner', "Check the stranger's credentials"),
            },
          ],
        })}
      />,
    )
    const clash = row('Clash')
    const [pair] = clash.querySelectorAll('[data-clash]')
    expect(pair.textContent).toBe(
      "Bergstrom wantsWin over a class of strangersvsSkinner wantsCheck the stranger's credentials",
    )
    expect(within(clash).getByText('From their wants and beats')).not.toBeNull()
  })

  it('shows who knows: dramatic irony and mystery, each with a spoken sentence', () => {
    render(
      <AtAGlance
        {...props({
          modes: {
            irony: ['char-skinner', 'char-chuck', 'char-berg'],
            mystery: ['char-lisa'],
            suspense: false,
          },
        })}
      />,
    )
    const knows = row('Who knows')
    expect(within(knows).getByText('Dramatic irony')).not.toBeNull()
    expect(
      within(knows).getByText('● the audience · ○ Skinner, Chuck +1'),
    ).not.toBeNull()
    expect(
      within(knows).getByText("The audience knows; Skinner, Chuck +1 don't.")
        .className,
    ).toContain('sr-only')
    expect(
      within(knows).getByText("Lisa knows; the audience doesn't."),
    ).not.toBeNull()
  })

  it('shows nothing for a scene with none of these readings (suspense alone included)', () => {
    const { container } = render(
      <AtAGlance
        {...props({ modes: { irony: [], mystery: [], suspense: true } })}
      />,
    )
    expect(container.textContent).toBe('')
  })
})
