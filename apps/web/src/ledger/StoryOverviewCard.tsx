import { useState } from 'react'
import type { Project, StoryOverview } from 'contract'
import { allScenes, findScene, sceneNumber } from '../write/projectTree'
import { beatModuleCue, summaryParagraphs } from './OverviewPanel'

export interface StoryOverviewCardProps {
  project: Project
  overview: StoryOverview | null | undefined
  sceneCount: number
  threadCount: number
  factCount: number
  onJumpToScene: (sceneId: string) => void
}

/** Scene numbers are 1-based story positions (projectTree.sceneNumber). */
function sceneSlug(project: Project, sceneId: string): string {
  const scene = findScene(project, sceneId)
  if (!scene) return sceneId.toUpperCase()
  const location = scene.location?.trim()
  return location
    ? location.toUpperCase()
    : `SCENE ${sceneNumber(project, sceneId)}`
}

function outlineIndex(
  project: Project,
  sceneId: string,
  fallback: number,
): number {
  return sceneNumber(project, sceneId) ?? fallback
}

function beatSceneId(project: Project, beatId: string): string | null {
  for (const season of project.seasons) {
    for (const episode of season.episodes) {
      for (const scene of episode.scenes) {
        if (scene.beats.some((b) => b.id === beatId)) return scene.id
      }
    }
  }
  return null
}

/**
 * Persistent story overview card (Ledger redesign handoff 2): logline always
 * visible; summary + outline expand in-place. Replaces the header teaser /
 * Overview modal entry point.
 */
export function StoryOverviewCard({
  project,
  overview,
  sceneCount,
  threadCount,
  factCount,
  onJumpToScene,
}: StoryOverviewCardProps) {
  const [open, setOpen] = useState(false)
  const ready = Boolean(overview)
  const paragraphs = overview?.summary
    ? summaryParagraphs(overview.summary)
    : []
  // The outline was written in import order; show it in today's story order
  // (rows for a scene no longer in the project keep their place at the end).
  const position = new Map(allScenes(project).map((s, i) => [s.id, i]))
  const outline = [...(overview?.outline ?? [])].sort(
    (a, b) =>
      (position.get(a.sceneId) ?? Infinity) -
      (position.get(b.sceneId) ?? Infinity),
  )

  return (
    <section
      className="mb-7 overflow-hidden rounded-2xl border border-tr-border bg-tr-surface-raised shadow-overview-card"
      aria-label="Story overview"
      data-testid="story-overview-card"
    >
      <div className="flex gap-4 px-[22px] py-5">
        <div
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-tr-overview-icon-bg text-17 text-tr-coral"
          aria-hidden
        >
          ❦
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-script text-11 font-medium uppercase tracking-[0.1em] text-tr-text-muted">
              Story overview
            </span>
            {ready ? (
              <span
                className="rounded-[10px] bg-tr-overview-ready-bg px-2 py-0.5 text-11 text-tr-overview-ready-ink"
                data-testid="overview-status-ready"
              >
                ● ready
              </span>
            ) : (
              <span
                className="rounded-[10px] bg-tr-surface-clay px-2 py-0.5 text-11 text-tr-text-muted"
                data-testid="overview-status-empty"
              >
                ● not yet
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-1.5">
              <span className="rounded-chip bg-tr-surface-clay px-2.5 py-0.5 text-[11.5px] tabular-nums text-tr-text-secondary">
                {sceneCount} scene{sceneCount === 1 ? '' : 's'}
              </span>
              <span className="rounded-chip bg-tr-surface-clay px-2.5 py-0.5 text-[11.5px] tabular-nums text-tr-text-secondary">
                {threadCount} thread{threadCount === 1 ? '' : 's'}
              </span>
              <span className="rounded-chip bg-tr-surface-clay px-2.5 py-0.5 text-[11.5px] tabular-nums text-tr-text-secondary">
                {factCount} fact{factCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {overview?.logline ? (
            <p
              className="font-ledger-display text-pretty text-[19px] font-medium leading-normal text-tr-text-primary"
              data-testid="overview-logline"
            >
              {overview.logline}
            </p>
          ) : (
            <p
              className="text-13 text-tr-text-secondary"
              data-testid="overview-panel-empty"
            >
              Import a script to generate a story overview.
            </p>
          )}

          {ready && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-3 inline-flex items-center gap-1.5 text-13 font-medium text-tr-sky transition-colors hover:text-tr-coral focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral"
              aria-expanded={open}
              data-testid="overview-expand-toggle"
            >
              {open ? 'Hide summary & outline' : 'Read summary & outline'}
              <span
                className={
                  'inline-block text-11 transition-transform duration-[180ms] ease-standard motion-reduce:transition-none ' +
                  (open ? 'rotate-180' : '')
                }
                aria-hidden
              >
                ▼
              </span>
            </button>
          )}
        </div>
      </div>

      {ready && open && overview && (
        <div
          className="border-t border-tr-border bg-tr-overview-expand-bg py-6 pl-[72px] pr-[22px]"
          data-testid="overview-expanded"
        >
          <div className="grid grid-cols-1 gap-7 md:grid-cols-2 md:gap-x-10">
            <section data-testid="overview-summary">
              <h3 className="mb-2.5 font-script text-11 font-medium uppercase tracking-[0.1em] text-tr-text-muted">
                Summary
              </h3>
              <div className="flex flex-col gap-3">
                {paragraphs.map((para, i) => (
                  <p
                    key={i}
                    className="text-pretty text-[13.5px] leading-relaxed text-tr-text-secondary"
                  >
                    {para}
                  </p>
                ))}
              </div>
            </section>

            <section data-testid="overview-outline">
              <h3 className="mb-2.5 font-script text-11 font-medium uppercase tracking-[0.1em] text-tr-text-muted">
                Outline
                <span className="ml-2 normal-case tracking-normal text-tr-text-muted">
                  ({overview.outline.length})
                </span>
              </h3>
              {overview.outline.length === 0 ? (
                <p className="text-13 text-tr-text-muted">No outline scenes.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {outline.map((row, i) => (
                    <li
                      key={row.sceneId}
                      className="border-b border-tr-border last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => onJumpToScene(row.sceneId)}
                        className="flex w-full items-start gap-2.5 px-1 py-2.5 text-left transition-colors duration-standard ease-standard hover:bg-tr-surface-clay focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
                        data-testid={`overview-outline-scene-${row.sceneId}`}
                      >
                        <span className="w-[18px] shrink-0 pt-0.5 text-right font-script text-11 tabular-nums text-tr-text-muted">
                          {outlineIndex(project, row.sceneId, i + 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-13 text-tr-text-primary">
                            {row.summary}
                          </span>
                          <span
                            className="mt-0.5 block font-script text-[10.5px] uppercase tracking-wide text-tr-text-muted"
                            data-testid={`overview-outline-location-${row.sceneId}`}
                          >
                            {sceneSlug(project, row.sceneId)}
                          </span>
                        </span>
                        <span
                          className="shrink-0 pt-0.5 text-13 text-tr-sky opacity-55"
                          aria-hidden
                        >
                          →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {overview.beatSheet.length > 0 && (
            <details className="mt-6" data-testid="overview-beat-sheet">
              <summary className="cursor-pointer font-script text-11 font-medium uppercase tracking-[0.1em] text-tr-text-muted">
                Beat sheet
                <span className="ml-2 normal-case tracking-normal">
                  ({overview.beatSheet.length})
                </span>
              </summary>
              <ul className="mt-3 flex flex-col gap-2">
                {overview.beatSheet.map((row) => {
                  const jumpScene =
                    row.sceneId ?? beatSceneId(project, row.beatId)
                  const moduleCue = beatModuleCue(row, project.format)
                  return (
                    <li
                      key={row.beatId}
                      className="flex flex-col gap-1 rounded-card border border-tr-border bg-tr-surface-raised p-3"
                      data-testid={`overview-beat-${row.beatId}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {row.label && (
                          <span className="text-13 text-tr-text-primary">
                            {row.label}
                          </span>
                        )}
                        {moduleCue ? (
                          <span
                            className="text-12 text-tr-text-muted"
                            data-testid={`overview-beat-act-${row.beatId}`}
                          >
                            {moduleCue}
                          </span>
                        ) : null}
                        {jumpScene ? (
                          <button
                            type="button"
                            className="text-13 text-tr-sky underline-offset-2 hover:underline"
                            onClick={() => onJumpToScene(jumpScene)}
                            data-testid={`overview-beat-scene-${row.beatId}`}
                          >
                            {sceneSlug(project, jumpScene)}
                          </button>
                        ) : null}
                      </div>
                      <p className="text-13 text-tr-text-secondary">
                        {row.summary}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
