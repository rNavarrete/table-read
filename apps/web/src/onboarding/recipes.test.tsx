// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecipeOverlay } from './RecipeOverlay'
import { RecipePicker } from './RecipePicker'
import { getRecipe, RECIPES } from './recipes'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('recipes data', () => {
  it('defines 6–8 task-shaped recipes with 3–5 steps each', () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(6)
    expect(RECIPES.length).toBeLessThanOrEqual(8)
    for (const recipe of RECIPES) {
      expect(recipe.steps.length).toBeGreaterThanOrEqual(3)
      expect(recipe.steps.length).toBeLessThanOrEqual(5)
      expect(recipe.href).toContain(`tour=${recipe.id}`)
      expect(recipe.href).toContain('proj-longpour')
    }
  })

  it('resolves known recipe ids', () => {
    expect(getRecipe('break-first-scene')?.title).toMatch(/first scene/i)
    expect(getRecipe('nope')).toBeNull()
  })
})

describe('RecipeOverlay', () => {
  it('advances steps and finishes on Done', async () => {
    const user = userEvent.setup()
    const recipe = getRecipe('break-first-scene')!
    const onClose = vi.fn()
    render(<RecipeOverlay recipe={recipe} onClose={onClose} />)

    expect(
      screen.getByTestId('recipe-overlay').getAttribute('data-recipe-id'),
    ).toBe('break-first-scene')
    await user.click(screen.getByTestId('recipe-next'))
    expect(
      screen.getByTestId('recipe-overlay').getAttribute('data-recipe-step'),
    ).toBe('1')
    await user.click(screen.getByTestId('recipe-next'))
    await user.click(screen.getByTestId('recipe-next'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('RecipePicker', () => {
  it('lists every recipe link on the dashboard section', () => {
    render(<RecipePicker />)
    expect(screen.getByTestId('recipe-picker')).not.toBeNull()
    expect(screen.getByText(/New here/i)).not.toBeNull()
    for (const recipe of RECIPES) {
      expect(screen.getByTestId(`recipe-link-${recipe.id}`)).not.toBeNull()
    }
  })
})
