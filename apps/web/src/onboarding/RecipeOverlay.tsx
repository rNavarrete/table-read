import { useEffect, useState } from 'react'
import {
  clearTourParam,
  findRecipeTarget,
  getRecipe,
  markRecipesSeen,
  type Recipe,
} from './recipes'

export interface RecipeOverlayProps {
  recipe: Recipe
  onClose: () => void
}

/**
 * Guided overlay for adoption A9 — coach card + highlight ring on a real
 * control identified by recipe step `target` (data-testid / data-recipe-target).
 */
export function RecipeOverlay({ recipe, onClose }: RecipeOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const step = recipe.steps[stepIndex]
  const isLast = stepIndex >= recipe.steps.length - 1

  useEffect(() => {
    markRecipesSeen()
  }, [])

  useEffect(() => {
    if (!step) return
    const el = findRecipeTarget(step.target)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    el.classList.add('recipe-highlight')
    return () => {
      el.classList.remove('recipe-highlight')
    }
  }, [step])

  function finish() {
    clearTourParam()
    onClose()
  }

  if (!step) return null

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50"
      data-testid="recipe-overlay"
      data-recipe-id={recipe.id}
      data-recipe-step={String(stepIndex)}
    >
      <div
        className="pointer-events-auto absolute bottom-6 right-6 w-full max-w-sm rounded-card border border-tr-border bg-tr-surface-raised p-4 shadow-lift"
        role="dialog"
        aria-modal="false"
        aria-labelledby="recipe-step-title"
      >
        <p className="text-12 uppercase tracking-wide text-tr-text-muted">
          {recipe.title} · {stepIndex + 1}/{recipe.steps.length}
        </p>
        <h2
          id="recipe-step-title"
          className="mt-2 font-display text-17 font-semibold text-tr-text-primary"
        >
          {step.title}
        </h2>
        <p className="mt-2 text-13 leading-6 text-tr-text-secondary">
          {step.body}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {stepIndex > 0 ? (
            <button
              type="button"
              className="text-13 text-tr-text-secondary underline"
              onClick={() => setStepIndex((i) => i - 1)}
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            data-testid="recipe-next"
            className="rounded-card bg-tr-coral px-3 py-1.5 text-13 font-medium text-tr-surface-raised transition hover:bg-tr-coral-hover"
            onClick={() => {
              if (isLast) finish()
              else setStepIndex((i) => i + 1)
            }}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
          <button
            type="button"
            data-testid="recipe-skip"
            className="ml-auto text-13 text-tr-text-muted underline"
            onClick={finish}
          >
            Skip recipe
          </button>
        </div>
      </div>
    </div>
  )
}

/** Mount when `?tour=` is present; resolves recipe from data. */
export function RecipeHost() {
  const [recipeId, setRecipeId] = useState(() =>
    new URLSearchParams(window.location.search).get('tour'),
  )
  const recipe = getRecipe(recipeId)

  if (!recipe) return null
  return (
    <RecipeOverlay
      recipe={recipe}
      onClose={() => setRecipeId(null)}
    />
  )
}
