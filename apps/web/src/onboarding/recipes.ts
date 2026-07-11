import recipesJson from './recipes.json'

export interface RecipeStep {
  title: string
  body: string
  /** Matches `data-testid` or `data-recipe-target` on a real control. */
  target: string
}

export interface Recipe {
  id: string
  title: string
  summary: string
  /** Deep link including `?tour=<id>` and fixture project. */
  href: string
  steps: RecipeStep[]
}

export const RECIPES: Recipe[] = recipesJson as Recipe[]

export function getRecipe(id: string | null | undefined): Recipe | null {
  if (!id) return null
  return RECIPES.find((recipe) => recipe.id === id) ?? null
}

export function readTourIdFromLocation(
  search = window.location.search,
): string | null {
  return new URLSearchParams(search).get('tour')
}

/** Drop `tour` from the URL without a full navigation. */
export function clearTourParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('tour')) return
  url.searchParams.delete('tour')
  window.history.replaceState({}, '', url.toString())
}

const SEEN_KEY = 'tr.recipes.v1.seen'

export function recipesSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

export function markRecipesSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // ignore quota / private mode
  }
}

export function findRecipeTarget(target: string): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`[data-testid="${target}"]`) ??
    document.querySelector<HTMLElement>(`[data-recipe-target="${target}"]`)
  )
}
