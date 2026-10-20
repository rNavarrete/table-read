// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Project } from 'contract'
import fixtureJson from '../../../../docs/tableread-fixture.json'
import { HighlightBar } from './HighlightBar'
import { boardModel, NO_HIGHLIGHT, type BoardModel } from './story'

afterEach(cleanup)

// "The Long Pour": cast from recorded wants — Dan in 5 scenes, Marta in 4,
// Reyes in 1; no threads, secrets, flags or overview.
const fixture = fixtureJson as unknown as { project: Project }

function model(characters = true): BoardModel {
  const project: Project = structuredClone(fixture.project)
  if (!characters) project.seriesBible.characters = []
  return boardModel(project, project.seasons[0].episodes[0], [])
}

function renderBar(props: Partial<ComponentProps<typeof HighlightBar>> = {}) {
  const onHighlight = vi.fn()
  const onToggleFold = vi.fn()
  const onNext = vi.fn()
  render(
    <HighlightBar
      model={model()}
      highlight={NO_HIGHLIGHT}
      fold={false}
      onHighlight={onHighlight}
      onToggleFold={onToggleFold}
      onNext={onNext}
      {...props}
    />,
  )
  return { onHighlight, onToggleFold, onNext }
}

describe('HighlightBar', () => {
  it("offers None, Setups & payoffs, The secret, Continuity, Act shape, Turns, Clashes, Who knows and Who's in it, with scene counts; the active one is pressed", () => {
    renderBar({ highlight: { kind: 'acts', who: null } })
    const group = screen.getByRole('group', { name: 'Highlight' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      'None',
      'Setups & payoffs 0',
      'The secret 0',
      'Continuity 0',
      'Act shape 5',
      'Turns 1',
      'Clashes 3',
      'Who knows 0',
      "Who's in it 5",
    ])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
    ])
  })

  it('a click picks a highlight; clicking the pressed one goes back to None', async () => {
    const user = userEvent.setup()
    const { onHighlight } = renderBar({
      highlight: { kind: 'acts', who: null },
    })
    await user.click(screen.getByRole('button', { name: /Act shape/ }))
    expect(onHighlight).toHaveBeenLastCalledWith(NO_HIGHLIGHT)
    await user.click(screen.getByRole('button', { name: 'None' }))
    expect(onHighlight).toHaveBeenLastCalledWith(NO_HIGHLIGHT)

    cleanup()
    const second = renderBar()
    await user.click(screen.getByRole('button', { name: /Act shape/ }))
    expect(second.onHighlight).toHaveBeenLastCalledWith({
      kind: 'acts',
      who: null,
    })
  })

  it("Who's in it starts on the most-present character; the select switches character", async () => {
    const user = userEvent.setup()
    const { onHighlight } = renderBar()
    const select = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Character to highlight',
    })
    expect(select.title).toBe('From dialogue cues and recorded wants')
    // A placeholder until Who's in it is on, so picking the most-present
    // character is a change too.
    expect(select.value).toBe('')
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Dan Vega', 'Marta Vega', 'Detective Ana Reyes'])

    await user.click(screen.getByRole('button', { name: /Who's in it/ }))
    expect(onHighlight).toHaveBeenLastCalledWith({
      kind: 'who',
      who: 'char-dan',
    })
    await user.selectOptions(select, 'char-marta')
    expect(onHighlight).toHaveBeenLastCalledWith({
      kind: 'who',
      who: 'char-marta',
    })
    await user.selectOptions(select, 'char-dan')
    expect(onHighlight).toHaveBeenLastCalledWith({
      kind: 'who',
      who: 'char-dan',
    })
  })

  it("Who's in it counts the active character's scenes", () => {
    renderBar({ highlight: { kind: 'who', who: 'char-marta' } })
    expect(
      screen.getByRole('button', { name: /Who's in it/ }).textContent,
    ).toBe("Who's in it 4")
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Character to highlight',
      }).value,
    ).toBe('char-marta')
  })

  it("with no cast, Who's in it reads 0 and the select is disabled", () => {
    renderBar({ model: model(false) })
    const who = screen.getByRole<HTMLButtonElement>('button', {
      name: /Who's in it/,
    })
    expect(who.textContent).toBe("Who's in it 0")
    expect(who.disabled).toBe(true)
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Character to highlight',
      }).disabled,
    ).toBe(true)
  })

  it('a highlight with no matches does nothing', async () => {
    const user = userEvent.setup()
    const { onHighlight } = renderBar({
      highlight: { kind: 'acts', who: null },
    })
    for (const name of [/Setups & payoffs/, /The secret/, /Continuity/]) {
      const button = screen.getByRole<HTMLButtonElement>('button', { name })
      expect(button.disabled).toBe(true)
      await user.click(button)
    }
    expect(onHighlight).not.toHaveBeenCalled()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'None' }).disabled,
    ).toBe(false)
  })

  it('a disabled highlight looks disabled: muted text, its count kept, no hover fill', () => {
    renderBar()
    const off = screen.getByRole('button', { name: /The secret/ })
    expect(off.className).toContain('disabled:text-tr-text-muted')
    expect(off.className).not.toMatch(/(^|\s)hover:/)
    // The count inherits the muted text and stays visible.
    expect(off.textContent).toBe('The secret 0')
    expect(off.querySelector('span')?.className).not.toMatch(/text-tr-text/)
    // An enabled one still fills on hover.
    expect(
      screen.getByRole('button', { name: /Act shape/ }).className,
    ).toContain('enabled:hover:bg-tr-surface-raised')
  })

  it('Fold the rest is a pressed toggle; Next note becomes Next match under a highlight and calls onNext', async () => {
    const user = userEvent.setup()
    const { onToggleFold, onNext } = renderBar()
    const fold = screen.getByRole('button', { name: 'Fold the rest' })
    expect(fold.getAttribute('aria-pressed')).toBe('false')
    await user.click(fold)
    expect(onToggleFold).toHaveBeenCalledOnce()

    const next = screen.getByRole('button', { name: 'Next note' })
    expect(next.getAttribute('aria-keyshortcuts')).toBe('N')
    expect(next.title).toMatch(/Shift\+N/)
    await user.click(next)
    expect(onNext).toHaveBeenCalledOnce()

    cleanup()
    renderBar({ highlight: { kind: 'acts', who: null }, fold: true })
    expect(
      screen
        .getByRole('button', { name: 'Fold the rest' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByRole('button', { name: 'Next match' })).toBeTruthy()
  })
})
