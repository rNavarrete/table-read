// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Character, Motivation } from 'contract'
import { WhoWantsWhat } from './WhoWantsWhat'

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
  character('char-marta', 'Marta Vega'),
  character('char-dan', 'Dan Vega'),
  character('char-luz', 'Luz Vega'),
]

function motivation(overrides: Partial<Motivation> = {}): Motivation {
  return {
    characterId: 'char-marta',
    objective: 'Come home',
    stakes: 'Everything',
    obstacle: 'Dan',
    statedObjective: '',
    concealed: false,
    ...overrides,
  }
}

describe('WhoWantsWhat', () => {
  it('one card per motivation with the name resolved and Wants / Up against / At stake', () => {
    render(
      <WhoWantsWhat
        motivations={[motivation()]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    const card = screen.getByRole('listitem')
    expect(within(card).getByText('Marta Vega')).not.toBeNull()
    expect(within(card).getByText('Come home')).not.toBeNull()
    expect(within(card).getByText('Dan')).not.toBeNull()
    expect(within(card).getByText('Everything')).not.toBeNull()
    expect(
      within(card)
        .getAllByRole('term')
        .map((el) => el.textContent),
    ).toEqual(['Wants', 'Up against', 'At stake'])
  })

  it('shows Says only when the stated want differs from the real one', () => {
    render(
      <WhoWantsWhat
        motivations={[
          motivation({ statedObjective: 'Just visiting for a week' }),
          motivation({
            characterId: 'char-dan',
            objective: 'Keep the office shut',
            statedObjective: 'Keep the office shut',
          }),
        ]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    const [marta, dan] = screen.getAllByRole('listitem')
    const says = within(marta).getByText('Just visiting for a week')
    expect(says.className).toContain('italic')
    expect(within(dan).queryByText('Says')).toBeNull()
  })

  it('marks a concealed want with a Hidden agenda chip', () => {
    render(
      <WhoWantsWhat
        motivations={[
          motivation({ statedObjective: 'Just visiting', concealed: true }),
        ]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    expect(screen.getByText('Hidden agenda')).not.toBeNull()
  })

  it('reads a stored motivation without statedObjective / concealed (raw PATCH doc)', () => {
    const raw = {
      characterId: 'char-marta',
      objective: 'Come home',
      stakes: '',
      obstacle: '',
    } as unknown as Motivation
    render(
      <WhoWantsWhat
        motivations={[raw]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    expect(screen.getByText('Come home')).not.toBeNull()
    expect(screen.queryByText('Says')).toBeNull()
    expect(screen.queryByText('Hidden agenda')).toBeNull()
    // Empty fields leave no empty rows.
    expect(screen.queryByText('Up against')).toBeNull()
  })

  it('falls back to the character id when the bible has no such character', () => {
    render(
      <WhoWantsWhat
        motivations={[motivation({ characterId: 'char-gone' })]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    expect(screen.getByText('char-gone')).not.toBeNull()
  })

  it('no recorded wants: one quiet line', () => {
    render(
      <WhoWantsWhat
        motivations={[]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    expect(screen.getByText('No wants recorded for this scene.')).not.toBeNull()
    expect(screen.queryByText(/Also in the scene/)).toBeNull()
  })

  it('names the rest of the cast, labelled as read from dialogue cues', () => {
    render(
      <WhoWantsWhat
        motivations={[]}
        characters={characters}
        alsoInScene={[characters[2], characters[1]]}
      />,
    )
    expect(
      screen.getByText('Also in the scene: Luz Vega, Dan Vega', {
        exact: false,
      }),
    ).not.toBeNull()
    expect(screen.getByText('· from dialogue cues')).not.toBeNull()
  })

  it("Head at closes an arc character's card, or stands alone without a want", () => {
    render(
      <WhoWantsWhat
        motivations={[motivation()]}
        characters={characters}
        alsoInScene={[characters[1], characters[2]]}
        headAt={[
          { characterId: 'char-marta', headAt: 'Suspicious, testing Dan.' },
          { characterId: 'char-dan', headAt: 'Cornered.' },
        ]}
      />,
    )
    const [marta, dan] = screen.getAllByRole('listitem')
    const terms = (el: HTMLElement) =>
      within(el)
        .getAllByRole('term')
        .map((t) => t.textContent)
    expect(terms(marta).at(-1)).toBe('Head at')
    expect(within(marta).getByText('Suspicious, testing Dan.')).not.toBeNull()
    expect(within(dan).getByText('Dan Vega')).not.toBeNull()
    expect(terms(dan)).toEqual(['Head at'])
    expect(within(dan).getByText('Cornered.')).not.toBeNull()
    // Dan has a card now; only Luz is left to name from dialogue cues.
    expect(
      screen.getByText('Also in the scene: Luz Vega', { exact: false }),
    ).not.toBeNull()
  })

  it('no arc stop in the scene: no Head at row', () => {
    render(
      <WhoWantsWhat
        motivations={[motivation()]}
        characters={characters}
        alsoInScene={[]}
      />,
    )
    expect(screen.queryByText('Head at')).toBeNull()
  })
})
