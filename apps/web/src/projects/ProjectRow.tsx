import type { ProjectSummary } from 'contract'
import { projectModeHref } from './projectRouting'
import { rowStatus } from './dashboardStatus'

function formatStatus(project: ProjectSummary): string {
  const status = rowStatus(project)
  if (status === 'facts') {
    return `${project.pendingReviewCount} ${
      project.pendingReviewCount === 1 ? 'fact' : 'facts'
    } to review`
  }
  if (status === 'setup') return 'Continue setup'
  return 'Ready to write'
}

function formatMetadata(project: ProjectSummary): string {
  const genre =
    project.format.genre.charAt(0).toUpperCase() + project.format.genre.slice(1)
  return `${genre} · ${project.format.runtimeMinutes} min · ${project.format.actCount} acts`
}

function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return 'Last edited recently'
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 1) return 'Last edited just now'
  if (minutes < 60) return `Last edited ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Last edited ${hours}h ago`
  const days = Math.round(hours / 24)
  return `Last edited ${days}d ago`
}

export function ProjectRow({ project }: { project: ProjectSummary }) {
  return (
    <li>
      <a
        href={projectModeHref(project.id)}
        className="flex items-center gap-4 rounded-card border border-tr-border bg-tr-surface-raised p-4 shadow-raised transition hover:border-tr-border-strong hover:shadow-lift motion-reduce:transition-none"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-17 font-semibold text-tr-text-primary">
            {project.title}
          </p>
          <p className="mt-1 text-13 text-tr-text-secondary">
            {formatMetadata(project)}
          </p>
        </div>
        <div className="hidden text-right text-13 sm:block">
          <p className="font-medium text-tr-text-primary">
            {formatStatus(project)}
          </p>
          <p className="mt-1 text-tr-text-muted">
            {formatRelativeTime(project.updatedAt)}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Project actions for ${project.title}`}
          className="rounded-chip px-2 py-1 text-17 text-tr-text-muted hover:bg-tr-surface-clay hover:text-tr-text-primary"
          onClick={(event) => event.preventDefault()}
        >
          ...
        </button>
      </a>
    </li>
  )
}
