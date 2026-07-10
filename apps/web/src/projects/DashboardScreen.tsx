import { useEffect, useMemo, useState } from 'react'
import type { ProjectSummary } from 'contract'
import { listProjects } from '../api/client'
import { ProjectRow } from './ProjectRow'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; projects: ProjectSummary[] }
  | { status: 'error'; message: string }

function LauncherCard({
  href,
  eyebrow,
  title,
  body,
}: {
  href: string
  eyebrow: string
  title: string
  body: string
}) {
  return (
    <a
      href={href}
      className="rounded-card border border-tr-border bg-tr-surface-raised p-5 shadow-raised transition hover:border-tr-coral hover:shadow-lift motion-reduce:transition-none"
    >
      <p className="text-12 uppercase tracking-wide text-tr-text-muted">
        {eyebrow}
      </p>
      <h2 className="mt-3 font-display text-22 font-semibold text-tr-text-primary">
        {title}
      </h2>
      <p className="mt-2 text-13 leading-6 text-tr-text-secondary">{body}</p>
    </a>
  )
}

function LoadingRows() {
  return (
    <div
      aria-label="Loading recent projects"
      className="space-y-3"
      role="status"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-20 rounded-card border border-tr-border bg-tr-surface-raised"
        />
      ))}
    </div>
  )
}

function PathChooser({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-tr-text-primary/40 px-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a project path"
        className="w-full max-w-2xl rounded-card border border-tr-border bg-tr-surface-raised p-6 shadow-lift"
      >
        <div className="flex items-start gap-4">
          <div>
            <p className="text-12 uppercase tracking-wide text-tr-text-muted">
              New project
            </p>
            <h2 className="mt-2 font-display text-22 font-semibold text-tr-text-primary">
              Choose a project path
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close project path chooser"
            className="ml-auto rounded-chip px-2 py-1 text-17 text-tr-text-muted hover:bg-tr-surface-clay hover:text-tr-text-primary"
          >
            x
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <LauncherCard
            href="/projects/new/idea"
            eyebrow="Start"
            title="Start from an idea"
            body="Build the premise, format, and story foundation before any AI step."
          />
          <LauncherCard
            href="/projects/new/import"
            eyebrow="Import"
            title="Import a script"
            body="Upload or paste Fountain or plain text, then confirm before processing."
          />
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-card border border-tr-border bg-tr-surface-raised p-5">
      <h2 className="font-display text-17 font-semibold text-tr-text-primary">
        No projects yet
      </h2>
      <p className="mt-2 text-13 leading-6 text-tr-text-secondary">
        A Table Read project holds the plan, script, and continuity ledger for
        one episode. Start with an idea or bring in a script when you are ready.
      </p>
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-card border border-tr-border bg-tr-surface-raised p-5">
      <h2 className="font-display text-17 font-semibold text-tr-text-primary">
        Could not load projects
      </h2>
      <p className="mt-2 text-13 text-tr-text-secondary">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-card bg-tr-coral px-3 py-1.5 text-13 font-medium text-tr-surface-raised transition hover:bg-tr-coral-hover"
      >
        Retry
      </button>
    </div>
  )
}

export function DashboardScreen() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [search, setSearch] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [isChooserOpen, setIsChooserOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    listProjects()
      .then((projects) => {
        if (!cancelled) setLoadState({ status: 'ready', projects })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Please try again.',
        })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const projects = useMemo(
    () => (loadState.status === 'ready' ? loadState.projects.slice(0, 5) : []),
    [loadState],
  )
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return projects
    return projects.filter((project) =>
      project.title.toLowerCase().includes(query),
    )
  }, [projects, search])

  return (
    <div className="min-h-screen bg-tr-surface-page">
      <header className="flex h-shell-height items-center gap-4 bg-tr-surface-sunken px-6">
        <a
          href="/projects"
          className="font-display text-17 font-semibold text-tr-text-primary"
        >
          Table Read
        </a>
        <div className="ml-auto flex items-center gap-4 text-13 text-tr-text-muted">
          <button
            type="button"
            onClick={() => setIsChooserOpen(true)}
            className="rounded-chip bg-tr-coral px-4 py-2 font-medium text-tr-surface-raised transition hover:bg-tr-coral-hover"
          >
            + New project
          </button>
          <button type="button" className="hover:text-tr-text-secondary">
            Settings
          </button>
          <button
            type="button"
            aria-label="User menu"
            className="h-8 w-8 rounded-chip bg-tr-surface-clay text-tr-text-secondary"
          >
            RN
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        <section className="text-center">
          <p className="text-12 uppercase tracking-wide text-tr-text-muted">
            BEGIN
          </p>
          <h1 className="mt-3 font-display text-28 font-semibold text-tr-text-primary">
            What are we writing?
          </h1>
          <p className="mt-3 text-15 text-tr-text-secondary">
            Shape a new idea, or bring in a script you already have.
          </p>
        </section>

        <section
          className="grid gap-4 md:grid-cols-2"
          aria-label="Create project"
        >
          <LauncherCard
            href="/projects/new/idea"
            eyebrow="Start"
            title="Start from an idea"
            body="Build the premise, format, and story foundation before any AI step."
          />
          <LauncherCard
            href="/projects/new/import"
            eyebrow="Import"
            title="Import a script"
            body="Upload or paste Fountain or plain text, then confirm before processing."
          />
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <p className="text-12 uppercase tracking-wide text-tr-text-muted">
                Continue writing
              </p>
              <h2 className="mt-1 font-display text-22 font-semibold text-tr-text-primary">
                Recent projects
              </h2>
            </div>
            <label className="text-13 text-tr-text-secondary">
              Search projects
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-raised px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky sm:w-64"
                aria-label="Search projects"
              />
            </label>
          </div>

          {loadState.status === 'loading' && <LoadingRows />}
          {loadState.status === 'error' && (
            <ErrorState
              message={loadState.message}
              onRetry={() => {
                setLoadState({ status: 'loading' })
                setReloadKey((key) => key + 1)
              }}
            />
          )}
          {loadState.status === 'ready' && projects.length === 0 && (
            <EmptyState />
          )}
          {loadState.status === 'ready' &&
            projects.length > 0 &&
            filteredProjects.length === 0 && (
              <div className="rounded-card border border-tr-border bg-tr-surface-raised p-5">
                <p className="font-display text-17 font-semibold text-tr-text-primary">
                  No projects match "{search.trim()}"
                </p>
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="mt-3 text-13 text-tr-sky underline"
                >
                  Clear search
                </button>
              </div>
            )}
          {loadState.status === 'ready' && filteredProjects.length > 0 && (
            <ul className="space-y-3">
              {filteredProjects.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </ul>
          )}
        </section>
      </main>
      {isChooserOpen && <PathChooser onClose={() => setIsChooserOpen(false)} />}
    </div>
  )
}
