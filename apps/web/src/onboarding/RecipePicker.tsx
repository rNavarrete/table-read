import { RECIPES } from './recipes'

/**
 * Dashboard recipe picker (adoption A9). Persistent section listing
 * data-driven deep links into the fixture project — the first-run offer
 * is this section itself (no blocking modal).
 */
export function RecipePicker() {
  return (
    <section
      className="space-y-4"
      aria-label="Workflow recipes"
      data-testid="recipe-picker"
    >
      <div>
        <p className="text-12 uppercase tracking-wide text-tr-text-muted">
          Learn by doing
        </p>
        <h2 className="mt-1 font-display text-22 font-semibold text-tr-text-primary">
          Workflow recipes
        </h2>
        <p className="mt-2 text-13 leading-6 text-tr-text-secondary">
          Short guided tours on The Long Pour fixture — real UI, not docs. New
          here? Start with any recipe below.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {RECIPES.map((recipe) => (
          <li key={recipe.id}>
            <a
              href={recipe.href}
              data-testid={`recipe-link-${recipe.id}`}
              className="block rounded-card border border-tr-border bg-tr-surface-raised p-4 shadow-raised transition hover:border-tr-coral hover:shadow-lift"
            >
              <h3 className="font-display text-15 font-semibold text-tr-text-primary">
                {recipe.title}
              </h3>
              <p className="mt-1 text-13 text-tr-text-secondary">
                {recipe.summary}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
