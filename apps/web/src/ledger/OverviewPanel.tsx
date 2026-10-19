import type { Project, StoryOverview } from 'contract'
import { Card } from '../plan/Card'
import { actLabel } from '../plan/planTree'
import { findScene, sceneNumber } from '../write/projectTree'

export interface OverviewPanelProps {
  project: Project
  overview: StoryOverview | null | undefined
  onJumpToScene: (sceneId: string) => void
  onClose: () => void
}

/** "THE GARAGE" if the scene has a location, else "Scene {n}" (1-based
 * story position). */
function sceneLabel(project: Project, sceneId: string): string {
  const scene = findScene(project, sceneId)
  if (!scene) return sceneId
  return scene.location || `Scene ${sceneNumber(project, sceneId)}`
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

/** Collapse double-escaped `\\n` (backslash+n) into real newlines, then split. */
export function summaryParagraphs(summary: string): string[] {
  const normalized = summary
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
  return normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Act/module cue for a beat-sheet row — Tag wins over a numeric last-act label. */
export function beatModuleCue(
  row: { label: string; act: number | null },
  format: Project['format'] | undefined,
): string | null {
  if (format?.tag && /\btag\b/i.test(row.label)) return 'TAG'
  if (row.act != null && format) return actLabel(row.act, format)
  return null
}

/**
 * Ledger Overview surface (T7.29): episode logline, two-paragraph synopsis,
 * scene outline, and named beat sheet with Write jumps. Read-only for v1.
 */
export function OverviewPanel({
  project,
  overview,
  onJumpToScene,
  onClose,
}: OverviewPanelProps) {
  const paragraphs = overview?.summary
    ? summaryParagraphs(overview.summary)
    : []

  return (
    <Card
      variant="raised"
      className="flex flex-col gap-3"
      aria-label="Story overview"
      data-testid="overview-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-15 text-tr-text-primary">Overview</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-card px-2 py-1 text-13 text-tr-text-muted"
          data-testid="overview-panel-close"
        >
          Close
        </button>
      </div>

      {!overview ? (
        <p
          className="text-13 text-tr-text-secondary"
          data-testid="overview-panel-empty"
        >
          Import a script to generate a story overview.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <section
            data-testid="overview-logline"
            className="flex flex-col gap-1"
          >
            <h3 className="text-12 uppercase tracking-wide text-tr-text-muted">
              Logline
            </h3>
            <p className="font-display text-17 text-tr-text-primary">
              {overview.logline}
            </p>
          </section>

          <section
            data-testid="overview-summary"
            className="flex flex-col gap-2"
          >
            <h3 className="text-12 uppercase tracking-wide text-tr-text-muted">
              Summary
            </h3>
            {paragraphs.map((para, i) => (
              <p key={i} className="text-13 text-tr-text-secondary">
                {para}
              </p>
            ))}
          </section>

          <details
            className="flex flex-col gap-2"
            open
            data-testid="overview-outline"
          >
            <summary className="cursor-pointer text-12 uppercase tracking-wide text-tr-text-muted">
              Outline
              <span className="ml-2 normal-case tracking-normal text-tr-text-muted">
                ({overview.outline.length})
              </span>
            </summary>
            {overview.outline.length === 0 ? (
              <p className="text-13 text-tr-text-muted">No outline scenes.</p>
            ) : (
              <ol className="flex list-decimal flex-col gap-2 pl-5">
                {overview.outline.map((row) => (
                  <li
                    key={row.sceneId}
                    className="flex flex-col gap-0.5 text-13 text-tr-text-secondary"
                  >
                    <button
                      type="button"
                      className="text-left text-tr-text-primary underline-offset-2 hover:underline hover:text-tr-sky"
                      onClick={() => onJumpToScene(row.sceneId)}
                      data-testid={`overview-outline-scene-${row.sceneId}`}
                    >
                      {row.summary}
                    </button>
                    <span
                      className="text-12 text-tr-text-muted"
                      data-testid={`overview-outline-location-${row.sceneId}`}
                    >
                      {sceneLabel(project, row.sceneId)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </details>

          <details
            className="flex flex-col gap-2"
            data-testid="overview-beat-sheet"
          >
            <summary className="cursor-pointer text-12 uppercase tracking-wide text-tr-text-muted">
              Beat sheet
              <span className="ml-2 normal-case tracking-normal text-tr-text-muted">
                ({overview.beatSheet.length})
              </span>
            </summary>
            {overview.beatSheet.length === 0 ? (
              <p className="text-13 text-tr-text-muted">No beat sheet rows.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {overview.beatSheet.map((row) => {
                  const jumpScene =
                    row.sceneId ?? beatSceneId(project, row.beatId)
                  const moduleCue = beatModuleCue(row, project.format)
                  return (
                    <li
                      key={row.beatId}
                      className="flex flex-col gap-1 rounded-card border border-tr-border p-3"
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
                            {sceneLabel(project, jumpScene)}
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
            )}
          </details>
        </div>
      )}
    </Card>
  )
}
