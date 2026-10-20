import type { Project, StoryThread } from 'contract'
import { Card } from '../plan/Card'
import { Chip, type ChipHue } from '../plan/Chip'
import { PHASE_WORD } from '../plan/story'
import { findScene, sceneNumber } from '../write/projectTree'

export interface ThreadsPanelProps {
  project: Project
  threads: StoryThread[]
  onJumpToScene: (sceneId: string) => void
  onClose: () => void
}

type ThreadStatus = StoryThread['status']

const STATUS_ORDER: ThreadStatus[] = ['open', 'paid_off', 'abandoned']

const STATUS_LABELS: Record<ThreadStatus, string> = {
  open: 'Open',
  paid_off: 'Paid off',
  abandoned: 'Abandoned',
}

const STATUS_HUES: Record<ThreadStatus, ChipHue> = {
  open: 'amber',
  paid_off: 'sage',
  abandoned: 'neutral',
}

const CLOSURE_WORDS: Record<
  NonNullable<StoryThread['closureLevel']>,
  string
> = {
  plot: 'closed on screen',
  story: 'closed by consequence',
  thematic: 'closed thematically',
  parametric: 'closed by form',
}

/** T10.3: how far the payoff lands from the setup in story order — "pays off
 * 12 scenes later" — or null when either scene is not in the project. */
function payoffGap(project: Project, thread: StoryThread): string | null {
  const setup = sceneNumber(project, thread.setupSceneId)
  const payoff = thread.payoffSceneId
    ? sceneNumber(project, thread.payoffSceneId)
    : null
  if (setup === null || payoff === null) return null
  const gap = payoff - setup
  if (gap === 0) return 'pays off in the same scene'
  const n = Math.abs(gap)
  return `pays off ${n} scene${n === 1 ? '' : 's'} ${gap > 0 ? 'later' : 'earlier'}`
}

/** T10.3: a paid-off thread's gap and how it is closed ("pays off 12 scenes
 * later · closed thematically"); nothing for any other thread. */
function ClosureLine({
  project,
  thread,
}: {
  project: Project
  thread: StoryThread
}) {
  if (thread.status !== 'paid_off') return null
  const parts = [
    payoffGap(project, thread),
    thread.closureLevel && CLOSURE_WORDS[thread.closureLevel],
  ].filter(Boolean)
  if (parts.length === 0) return null
  return (
    <p
      className="text-12 text-tr-text-secondary"
      data-testid={`thread-closure-${thread.id}`}
    >
      {parts.join(' · ')}
    </p>
  )
}

/** "THE GARAGE" if the scene has a location, else "Scene {n}" (1-based
 * story position). */
function sceneLabel(project: Project, sceneId: string): string {
  const scene = findScene(project, sceneId)
  if (!scene) return sceneId
  return scene.location || `Scene ${sceneNumber(project, sceneId)}`
}

function ownerNames(project: Project, ids: string[]): string[] {
  const characters = project.seriesBible.characters
  return ids.map((id) => characters.find((c) => c.id === id)?.name ?? id)
}

/**
 * Ledger Threads surface (narrative-promises design doc §UI, T7.21):
 * setup → payoff arcs grouped by status, with a scene-jump affordance for
 * each anchor. Read-only — no Plan connector lines (explicit non-goal); the
 * writer reviews threads here and jumps to Write to act on them.
 */
export function ThreadsPanel({
  project,
  threads,
  onJumpToScene,
  onClose,
}: ThreadsPanelProps) {
  const groups = STATUS_ORDER.map((status) => ({
    status,
    threads: threads.filter((t) => t.status === status),
  }))

  return (
    <Card
      variant="raised"
      className="flex flex-col gap-3"
      aria-label="Story threads"
      data-testid="threads-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-15 text-tr-text-primary">Threads</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-card px-2 py-1 text-13 text-tr-text-muted"
          data-testid="threads-panel-close"
        >
          Close
        </button>
      </div>

      {threads.length === 0 ? (
        <p
          className="text-13 text-tr-text-secondary"
          data-testid="threads-panel-empty"
        >
          No threads yet. Import a script to surface setups and payoffs.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(
            (group) =>
              group.threads.length > 0 && (
                <section
                  key={group.status}
                  data-testid={`threads-group-${group.status}`}
                  className="flex flex-col gap-2"
                >
                  <h3 className="text-12 uppercase tracking-wide text-tr-text-muted">
                    {STATUS_LABELS[group.status]}
                    <span className="ml-2 text-tr-text-muted">
                      ({group.threads.length})
                    </span>
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {group.threads.map((thread) => (
                      <li
                        key={thread.id}
                        className="flex flex-col gap-2 rounded-card border border-tr-border p-3"
                        data-testid={`thread-row-${thread.id}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-15 text-tr-text-primary">
                              {thread.label}
                            </span>
                            {thread.locked && <Chip hue="amber">locked</Chip>}
                          </div>
                          <Chip
                            hue={STATUS_HUES[thread.status]}
                            data-testid={`thread-status-${thread.id}`}
                          >
                            {thread.status}
                          </Chip>
                        </div>
                        <p className="text-13 text-tr-text-secondary">
                          {thread.summary}
                        </p>
                        {thread.ownerCharacterIds.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-12 text-tr-text-muted">
                              Owners
                            </span>
                            {ownerNames(project, thread.ownerCharacterIds).map(
                              (name, i) => (
                                <Chip
                                  key={`${thread.id}-owner-${i}`}
                                  hue="neutral"
                                >
                                  {name}
                                </Chip>
                              ),
                            )}
                          </div>
                        )}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-12 text-tr-text-muted">
                              Setup
                            </span>
                            <button
                              type="button"
                              className="text-13 text-tr-sky underline-offset-2 hover:underline"
                              onClick={() => onJumpToScene(thread.setupSceneId)}
                              data-testid={`thread-setup-scene-${thread.id}`}
                            >
                              {sceneLabel(project, thread.setupSceneId)}
                            </button>
                            {thread.setupQuote && (
                              <span className="text-12 italic text-tr-text-muted">
                                “{thread.setupQuote}”
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-12 text-tr-text-muted">
                              Payoff
                            </span>
                            {thread.payoffSceneId ? (
                              <>
                                <button
                                  type="button"
                                  className="text-13 text-tr-sky underline-offset-2 hover:underline"
                                  onClick={() =>
                                    onJumpToScene(thread.payoffSceneId!)
                                  }
                                  data-testid={`thread-payoff-scene-${thread.id}`}
                                >
                                  {sceneLabel(project, thread.payoffSceneId)}
                                </button>
                                {thread.payoffQuote && (
                                  <span className="text-12 italic text-tr-text-muted">
                                    “{thread.payoffQuote}”
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-13 italic text-tr-text-muted">
                                {thread.status === 'abandoned'
                                  ? 'never paid off'
                                  : 'not yet paid off'}
                              </span>
                            )}
                          </div>
                          <ClosureLine project={project} thread={thread} />
                        </div>
                        {thread.secondJob && (
                          <p
                            className="text-13 text-tr-text-secondary"
                            data-testid={`thread-second-job-${thread.id}`}
                          >
                            <span className="text-12 text-tr-text-muted">
                              Second job
                            </span>{' '}
                            {thread.secondJob}
                          </p>
                        )}
                        {(thread.movements ?? []).length > 0 && (
                          <div className="flex flex-col gap-1">
                            <span className="text-12 text-tr-text-muted">
                              Moves
                            </span>
                            <ol
                              className="flex flex-col gap-1"
                              data-testid={`thread-movements-${thread.id}`}
                            >
                              {thread.movements.map((movement, i) => (
                                <li
                                  key={`${movement.sceneId}:${movement.phase}:${i}`}
                                  className="flex flex-wrap items-baseline gap-1.5 text-13 text-tr-text-secondary"
                                >
                                  <button
                                    type="button"
                                    className="text-13 text-tr-sky underline-offset-2 hover:underline"
                                    onClick={() =>
                                      onJumpToScene(movement.sceneId)
                                    }
                                  >
                                    {`Scene ${sceneNumber(project, movement.sceneId) ?? '?'}`}
                                  </button>
                                  <span className="text-tr-text-primary">
                                    {PHASE_WORD[movement.phase]}
                                  </span>
                                  {movement.summary && (
                                    <span>— {movement.summary}</span>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ),
          )}
        </div>
      )}
    </Card>
  )
}
