import type { NarrativeMap, NarrativeMapRun, Project } from 'contract'
import { actLabel } from '../plan/planTree'

export interface NarrativeMapCardProps {
  project: Project
  narrativeMap: NarrativeMap | null | undefined
  narrativeMapRun?: NarrativeMapRun | null
  onJumpToScene: (sceneId: string) => void
  onGenerateNarrativeMap?: () => void
}

const HERO_STAGE_LABELS: Record<string, string> = {
  ordinary_world: 'Ordinary world',
  call_to_adventure: 'Call to adventure',
  refusal: 'Refusal',
  meeting_the_mentor: 'Meeting the mentor',
  crossing_the_threshold: 'Crossing the threshold',
  tests_allies_enemies: 'Tests, allies, enemies',
  approach: 'Approach',
  ordeal: 'Ordeal',
  reward: 'Reward',
  road_back: 'Road back',
  resurrection: 'Resurrection',
  return_with_elixir: 'Return with the elixir',
}

function sceneForBeat(project: Project, beatId: string): string | null {
  for (const season of project.seasons) {
    for (const episode of season.episodes) {
      for (const scene of episode.scenes) {
        if (scene.beats.some((beat) => beat.id === beatId)) return scene.id
      }
    }
  }
  return null
}

function sceneName(project: Project, sceneId: string): string {
  for (const season of project.seasons) {
    for (const episode of season.episodes) {
      const index = episode.scenes.findIndex((scene) => scene.id === sceneId)
      if (index >= 0) {
        const location = episode.scenes[index].location
        return location
          ? `Scene ${index + 1}: ${location}`
          : `Scene ${index + 1}`
      }
    }
  }
  return sceneId
}

function characterName(
  project: Project,
  characterId: string | null,
): string | null {
  if (characterId == null) return null
  return (
    project.seriesBible.characters.find(
      (character) => character.id === characterId,
    )?.name ?? null
  )
}

function threadLabel(project: Project, threadId: string): string {
  for (const season of project.seasons) {
    for (const episode of season.episodes) {
      const thread = episode.threads.find(
        (candidate) => candidate.id === threadId,
      )
      if (thread) return thread.label
    }
  }
  return threadId
}

function isPlaceholderAnalysis(value: string | null | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase()
  return (
    normalized === '' ||
    normalized === 'unknown' ||
    normalized === '<unknown>' ||
    normalized.includes('insufficient source content') ||
    normalized.includes('no textual evidence')
  )
}

function isUsableNarrativeMap(narrativeMap: NarrativeMap): boolean {
  return ![
    narrativeMap.dramaticQuestion,
    narrativeMap.centralConflict,
    narrativeMap.controllingIdea,
    narrativeMap.heroJourney.rationale,
    ...narrativeMap.acts.flatMap((act) => [
      act.dramaticQuestion,
      act.escalation,
    ]),
    ...narrativeMap.sceneTurns.flatMap((turn) => [
      turn.dramaticFunction,
      turn.conflict,
      turn.stakes,
      turn.turn,
    ]),
  ].some(isPlaceholderAnalysis)
}

function runProgressLabel(run: NarrativeMapRun): string {
  switch (run.phase) {
    case 'scene_analysis':
      return `Analyzing screenplay scenes ${run.completedSceneCount} of ${run.sceneCount}`
    case 'readiness':
      return 'Checking saved screenplay evidence'
    case 'synthesis':
      return 'Building the story-wide map'
    case 'verification':
      return 'Verifying claims against the screenplay'
    case 'saving':
      return 'Saving the verified Narrative Map'
    default:
      return 'Preparing Narrative Map analysis'
  }
}

function runProgressPercent(run: NarrativeMapRun): number {
  const sceneRatio =
    run.sceneCount > 0 ? run.completedSceneCount / run.sceneCount : 0
  switch (run.phase) {
    case 'readiness':
      return 4
    case 'scene_analysis':
      return Math.round(5 + sceneRatio * 75)
    case 'synthesis':
      return 84
    case 'verification':
      return 94
    case 'saving':
      return 98
    case 'complete':
      return 100
    case 'failed':
      return run.completedSceneCount >= run.sceneCount
        ? 80
        : Math.round(5 + sceneRatio * 75)
    default:
      return 2
  }
}

function lastActivityLabel(updatedAt: string): string {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000),
  )
  if (elapsedSeconds < 10) return 'Active now'
  if (elapsedSeconds < 60) return `Last activity ${elapsedSeconds}s ago`
  const minutes = Math.floor(elapsedSeconds / 60)
  return `Last activity ${minutes}m ago`
}

function NarrativeMapProgress({ run }: { run: NarrativeMapRun }) {
  const progress = runProgressPercent(run)
  const isActive = run.status === 'queued' || run.status === 'running'
  const scenesComplete =
    run.sceneCount > 0 && run.completedSceneCount >= run.sceneCount
  const phaseHint =
    run.phase === 'synthesis' && isActive
      ? 'Story-wide synthesis is running. This high-effort step can take several minutes.'
      : run.phase === 'verification' && isActive
        ? 'The completed map is being checked against the saved screenplay.'
        : run.status === 'failed' && scenesComplete
          ? 'All completed analysis is saved. Resume will continue from the next unfinished phase.'
          : null

  return (
    <div
      className="mt-4 rounded-card border border-tr-border bg-tr-surface-clay px-4 py-3"
      data-testid="narrative-map-progress"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-13 font-medium text-tr-text-primary">
          {isActive ? runProgressLabel(run) : 'Saved analysis progress'}
        </p>
        <p className="shrink-0 font-script text-11 tabular-nums text-tr-text-muted">
          {progress}%
        </p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-tr-surface-raised"
        role="progressbar"
        aria-label="Narrative Map progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className={`h-full rounded-full bg-tr-coral transition-[width] duration-700 ${
            isActive ? 'animate-pulse' : ''
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-11 text-tr-text-muted">
        <span>
          {run.completedSceneCount} of {run.sceneCount} scenes checkpointed
        </span>
        <span>{lastActivityLabel(run.updatedAt)}</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 font-script text-10 uppercase tracking-[0.06em] text-tr-text-muted">
        <span className={run.completedSceneCount > 0 ? 'text-tr-sky' : ''}>
          Scenes
        </span>
        <span
          className={
            run.phase === 'synthesis' ||
            run.phase === 'verification' ||
            run.phase === 'saving' ||
            run.phase === 'complete'
              ? 'text-tr-sky'
              : ''
          }
        >
          Synthesis
        </span>
        <span
          className={
            run.phase === 'verification' ||
            run.phase === 'saving' ||
            run.phase === 'complete'
              ? 'text-tr-sky'
              : ''
          }
        >
          Verify
        </span>
        <span
          className={
            run.phase === 'saving' || run.phase === 'complete'
              ? 'text-tr-sky'
              : ''
          }
        >
          Save
        </span>
      </div>
      {phaseHint ? (
        <p className="mt-3 text-12 text-tr-text-secondary">{phaseHint}</p>
      ) : null}
    </div>
  )
}

function inactiveRunLabel(run: NarrativeMapRun): string {
  const message =
    run.errorMessage ?? 'No changes were applied to the saved screenplay.'
  if (run.errorCode !== 'WORKER_INTERRUPTED') return message
  return `${message} ${run.completedSceneCount} of ${run.sceneCount} scene checkpoints are saved.`
}

function BeatEvidence({
  project,
  beatId,
  quote,
  onJumpToScene,
}: {
  project: Project
  beatId: string
  quote: string
  onJumpToScene: (sceneId: string) => void
}) {
  const sceneId = sceneForBeat(project, beatId)
  return (
    <div className="mt-2 flex flex-wrap items-start gap-x-2 gap-y-1 text-12 text-tr-text-muted">
      <span className="max-w-full italic">&quot;{quote}&quot;</span>
      {sceneId ? (
        <button
          type="button"
          className="shrink-0 text-tr-sky underline-offset-2 hover:underline"
          onClick={() => onJumpToScene(sceneId)}
          data-testid={`narrative-evidence-${beatId}`}
        >
          View beat
        </button>
      ) : null}
    </div>
  )
}

/** Evidence-first macro and micro story analysis for imported scripts. */
export function NarrativeMapCard({
  project,
  narrativeMap,
  narrativeMapRun = null,
  onJumpToScene,
  onGenerateNarrativeMap,
}: NarrativeMapCardProps) {
  const mapNeedsReplacement =
    narrativeMap != null && !isUsableNarrativeMap(narrativeMap)
  // Maps saved before T9.3 arrive unparsed, without the key.
  const unanalyzedSceneIds = narrativeMap?.unanalyzedSceneIds ?? []
  const runIsActive =
    narrativeMapRun?.status === 'queued' ||
    narrativeMapRun?.status === 'running'
  const runCannotRetryYet =
    narrativeMapRun?.status === 'failed' && !narrativeMapRun.retryAllowed
  const runRetryIsBlocked =
    narrativeMapRun?.status === 'rejected' && !narrativeMapRun.retryAllowed
  const correctedAnalysisIsAvailable =
    narrativeMapRun?.status === 'rejected' && narrativeMapRun.retryAllowed
  const noCostLocalRepairIsAvailable =
    correctedAnalysisIsAvailable &&
    narrativeMapRun.errorMessage?.toLowerCase().includes('no model call')
  const savedPacketRepairIsAvailable =
    correctedAnalysisIsAvailable &&
    narrativeMapRun.errorMessage
      ?.toLowerCase()
      .includes('saved scene-packet repair')
  const correctedVerifierIsAvailable =
    narrativeMapRun?.status === 'failed' &&
    narrativeMapRun.errorCode === 'SCHEMA_INVALID_LLM' &&
    narrativeMapRun.retryAllowed

  if (!narrativeMap || mapNeedsReplacement) {
    return (
      <section
        className="rounded-card border border-tr-border bg-tr-surface-raised p-5"
        data-testid="narrative-map-empty"
      >
        <p className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
          Narrative map
        </p>
        <p className="mt-2 text-13 text-tr-text-secondary">
          {mapNeedsReplacement
            ? 'The saved Narrative Map did not meet the evidence standard and is not being treated as reliable.'
            : 'Generate a detailed, evidence-grounded read of themes, character arcs, scene turns, and story structure when you are ready.'}
        </p>
        <p className="mt-2 text-12 text-tr-text-muted">
          Analysis reads the saved screenplay in bounded Opus 5 scene passes,
          then independently verifies the final map before it is published.
        </p>
        {narrativeMapRun ? (
          <p
            className="mt-3 text-12 text-tr-text-secondary"
            data-testid="narrative-map-run-status"
          >
            {runIsActive
              ? runProgressLabel(narrativeMapRun)
              : inactiveRunLabel(narrativeMapRun)}
          </p>
        ) : null}
        {narrativeMapRun &&
        (runIsActive ||
          narrativeMapRun.errorCode === 'LLM_TIMEOUT' ||
          narrativeMapRun.errorCode === 'WORKER_INTERRUPTED') ? (
          <NarrativeMapProgress run={narrativeMapRun} />
        ) : null}
        {narrativeMapRun?.rejectionDiagnostics?.length ? (
          <div className="mt-3" data-testid="narrative-map-rejections">
            <p className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
              What the verifier could not support
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {narrativeMapRun.rejectionDiagnostics.map((d) => (
                <li
                  key={d.path}
                  className="text-12 leading-snug text-tr-text-secondary"
                >
                  <span className="font-mono text-11 text-tr-text-muted">
                    {d.path}
                  </span>
                  {d.reason ? <span className="block">{d.reason}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {onGenerateNarrativeMap && !runIsActive ? (
          <button
            type="button"
            onClick={onGenerateNarrativeMap}
            disabled={runCannotRetryYet || runRetryIsBlocked}
            className="mt-4 rounded-card bg-tr-coral px-3 py-2 text-13 font-medium text-tr-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="generate-narrative-map"
          >
            {runRetryIsBlocked
              ? 'Retry blocked to prevent another charge'
              : correctedVerifierIsAvailable
                ? 'Run corrected verifier'
                : savedPacketRepairIsAvailable
                  ? 'Repair saved map & verify'
                  : noCostLocalRepairIsAvailable
                    ? 'Finish from saved analysis (no model call)'
                    : correctedAnalysisIsAvailable
                      ? 'Run corrected analysis'
                      : runCannotRetryYet
                        ? 'Retry is temporarily paused'
                        : narrativeMapRun?.status === 'failed'
                          ? 'Resume saved map run'
                          : 'Generate narrative map'}
          </button>
        ) : null}
      </section>
    )
  }

  const protagonist = characterName(
    project,
    narrativeMap.heroJourney.protagonistCharacterId,
  )

  return (
    <section
      className="rounded-card border border-tr-border bg-tr-surface-raised shadow-raised"
      data-testid="narrative-map-card"
    >
      <div className="border-b border-tr-border px-5 py-4">
        <p className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
          Narrative map
        </p>
        <h2 className="mt-1 font-ledger-display text-20 text-tr-text-primary">
          {narrativeMap.dramaticQuestion}
        </h2>
        <p className="mt-2 text-13 leading-relaxed text-tr-text-secondary">
          {narrativeMap.centralConflict}
        </p>
      </div>

      <div className="px-5 py-5">
        {narrativeMapRun?.status === 'completed' &&
        narrativeMapRun.removedClaims?.length ? (
          <section
            className="mb-5 rounded-card border border-tr-border bg-tr-surface-clay p-4"
            data-testid="narrative-map-removals"
          >
            <h3 className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
              Removed before publishing
            </h3>
            <p className="mt-1 text-12 text-tr-text-secondary">
              The evidence check could not find support in the script for these,
              so they were taken out of the map rather than shown as fact.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {narrativeMapRun.removedClaims.map((claim) => (
                <li
                  key={claim.path}
                  className="text-12 leading-snug text-tr-text-secondary"
                >
                  <span className="font-medium text-tr-text-primary">
                    {claim.subject}
                  </span>
                  {claim.reason ? (
                    <span className="block">{claim.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {unanalyzedSceneIds.length > 0 ? (
          <section
            className="mb-5 rounded-card border border-tr-border bg-tr-surface-clay p-4"
            data-testid="narrative-map-unanalyzed"
          >
            <h3 className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
              Not analyzed ({unanalyzedSceneIds.length})
            </h3>
            <p className="mt-1 text-12 text-tr-text-secondary">
              The analysis could not read these scenes, so the map says nothing
              about them. Nothing was written in their place.
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {unanalyzedSceneIds.map((sceneId) => (
                <li key={sceneId}>
                  <button
                    type="button"
                    className="text-12 text-tr-sky underline-offset-2 hover:underline"
                    onClick={() => onJumpToScene(sceneId)}
                  >
                    {sceneName(project, sceneId)}
                  </button>
                </li>
              ))}
            </ul>
            {onGenerateNarrativeMap && !narrativeMap.locked ? (
              <>
                <p className="mt-3 text-12 text-tr-text-muted">
                  Analyzing them makes new model calls for these scenes, then
                  rebuilds and re-verifies the story-wide map. Scenes already
                  analyzed are reused.
                </p>
                <button
                  type="button"
                  onClick={onGenerateNarrativeMap}
                  disabled={narrativeMapRun?.retryAllowed === false}
                  className="mt-2 rounded-card bg-tr-coral px-3 py-2 text-13 font-medium text-tr-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="analyze-unanalyzed-scenes"
                >
                  Analyze {unanalyzedSceneIds.length} unanalyzed{' '}
                  {unanalyzedSceneIds.length === 1 ? 'scene' : 'scenes'}
                </button>
              </>
            ) : null}
            {narrativeMapRun && runIsActive ? (
              <NarrativeMapProgress run={narrativeMapRun} />
            ) : null}
          </section>
        ) : null}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section>
            <h3 className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
              Theme and idea
            </h3>
            <p className="mt-2 text-13 text-tr-text-primary">
              {narrativeMap.controllingIdea}
            </p>
          </section>

          <section data-testid="narrative-hero-journey">
            <h3 className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
              Hero&apos;s Journey lens
            </h3>
            <p className="mt-2 text-13 text-tr-text-secondary">
              {narrativeMap.heroJourney.applies
                ? `${protagonist ?? 'The protagonist'}: ${narrativeMap.heroJourney.rationale}`
                : narrativeMap.heroJourney.rationale}
            </p>
            {narrativeMap.heroJourney.applies ? (
              <ol className="mt-3 flex flex-col gap-2">
                {narrativeMap.heroJourney.stages.map((stage) => (
                  <li
                    key={`${stage.stage}-${stage.beatId}`}
                    className="rounded-card bg-tr-surface-clay p-3"
                  >
                    <p className="text-13 font-medium text-tr-text-primary">
                      {HERO_STAGE_LABELS[stage.stage] ?? stage.stage}
                    </p>
                    <p className="mt-1 text-13 text-tr-text-secondary">
                      {stage.summary}
                    </p>
                    <BeatEvidence
                      project={project}
                      beatId={stage.beatId}
                      quote={stage.evidenceQuote}
                      onJumpToScene={onJumpToScene}
                    />
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        </div>

        <section
          className="mt-5 border-t border-tr-border pt-5"
          data-testid="narrative-themes"
        >
          <h3 className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
            Theme evidence ({narrativeMap.themes.length})
          </h3>
          <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {narrativeMap.themes.map((theme) => (
              <li
                key={theme.label}
                className="rounded-card bg-tr-surface-clay p-3"
              >
                <p className="text-13 font-medium text-tr-text-primary">
                  {theme.label}
                </p>
                <p className="mt-1 text-13 text-tr-text-secondary">
                  {theme.statement}
                </p>
                {theme.evidence.map((evidence) => (
                  <BeatEvidence
                    key={`${theme.label}-${evidence.beatId}`}
                    project={project}
                    beatId={evidence.beatId}
                    quote={evidence.quote}
                    onJumpToScene={onJumpToScene}
                  />
                ))}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <details className="border-t border-tr-border px-5 py-4">
        <summary className="cursor-pointer font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
          Act structure ({narrativeMap.acts.length})
        </summary>
        <ol className="mt-3 grid gap-3 md:grid-cols-2">
          {narrativeMap.acts.map((act) => (
            <li
              key={act.act}
              className="rounded-card border border-tr-border p-3"
            >
              <p className="text-12 font-medium text-tr-sky">
                {actLabel(act.act, project.format)}
              </p>
              <p className="mt-1 text-13 text-tr-text-primary">
                {act.dramaticQuestion}
              </p>
              <p className="mt-1 text-13 text-tr-text-secondary">
                {act.escalation}
              </p>
              <BeatEvidence
                project={project}
                beatId={act.turnBeatId}
                quote={act.evidenceQuote}
                onJumpToScene={onJumpToScene}
              />
            </li>
          ))}
        </ol>
      </details>

      {narrativeMap.characterArcs.length > 0 ? (
        <details className="border-t border-tr-border px-5 py-4">
          <summary className="cursor-pointer font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
            Character perspectives ({narrativeMap.characterArcs.length})
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {narrativeMap.characterArcs.map((arc) => (
              <article
                key={arc.characterId}
                className="rounded-card border border-tr-border p-3"
              >
                <h4 className="text-13 font-medium text-tr-text-primary">
                  {characterName(project, arc.characterId) ?? arc.characterId}
                </h4>
                <dl className="mt-2 grid gap-1 text-13 text-tr-text-secondary">
                  <div>
                    <dt className="inline font-medium text-tr-text-primary">
                      Want:{' '}
                    </dt>
                    <dd className="inline">{arc.want}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-tr-text-primary">
                      Need:{' '}
                    </dt>
                    <dd className="inline">{arc.need}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-tr-text-primary">
                      Inner conflict:{' '}
                    </dt>
                    <dd className="inline">{arc.internalConflict}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-tr-text-primary">
                      Pressure:{' '}
                    </dt>
                    <dd className="inline">{arc.externalPressure}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-13 text-tr-text-secondary">
                  {arc.arcSummary}
                </p>
                {arc.turningPoints.map((turn) => (
                  <div
                    key={`${arc.characterId}-${turn.beatId}`}
                    className="mt-2"
                  >
                    <p className="text-12 text-tr-text-primary">
                      {turn.change}
                    </p>
                    <BeatEvidence
                      project={project}
                      beatId={turn.beatId}
                      quote={turn.quote}
                      onJumpToScene={onJumpToScene}
                    />
                  </div>
                ))}
              </article>
            ))}
          </div>
        </details>
      ) : (
        <div
          className="border-t border-tr-border px-5 py-4"
          data-testid="narrative-character-coverage"
        >
          <p className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
            Character perspectives
          </p>
          <p className="mt-2 text-13 text-tr-text-secondary">
            This pass did not produce evidence-supported character arc profiles.
            The app is leaving this section visibly incomplete rather than
            inventing motivations or transformations that were not verified.
          </p>
        </div>
      )}

      <details className="border-t border-tr-border px-5 py-4">
        <summary className="cursor-pointer font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
          Scene turns ({narrativeMap.sceneTurns.length})
        </summary>
        <ol className="mt-3 flex flex-col gap-2">
          {narrativeMap.sceneTurns.map((turn) => (
            <li
              key={turn.sceneId}
              className="rounded-card border border-tr-border p-3"
            >
              <p className="text-13 font-medium text-tr-text-primary">
                {turn.dramaticFunction}
              </p>
              <p className="mt-1 text-13 text-tr-text-secondary">{turn.turn}</p>
              <p className="mt-1 text-12 text-tr-text-muted">
                Conflict: {turn.conflict} Stakes: {turn.stakes}
              </p>
              {characterName(project, turn.focalCharacterId) ? (
                <p className="mt-1 text-12 text-tr-text-muted">
                  Perspective: {characterName(project, turn.focalCharacterId)}
                </p>
              ) : null}
              <BeatEvidence
                project={project}
                beatId={turn.turnBeatId}
                quote={turn.evidenceQuote}
                onJumpToScene={onJumpToScene}
              />
            </li>
          ))}
        </ol>
      </details>

      {narrativeMap.threadMovements.length > 0 ? (
        <details className="border-t border-tr-border px-5 py-4">
          <summary className="cursor-pointer font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
            Thread movements ({narrativeMap.threadMovements.length})
          </summary>
          <ol className="mt-3 flex flex-col gap-2">
            {narrativeMap.threadMovements.map((movement) => (
              <li
                key={`${movement.threadId}-${movement.beatId}-${movement.phase}`}
                className="rounded-card border border-tr-border p-3"
              >
                <p className="text-13 font-medium text-tr-text-primary">
                  {threadLabel(project, movement.threadId)}
                  <span className="ml-2 text-12 font-normal capitalize text-tr-text-muted">
                    {movement.phase}
                  </span>
                </p>
                <p className="mt-1 text-13 text-tr-text-secondary">
                  {movement.summary}
                </p>
                <BeatEvidence
                  project={project}
                  beatId={movement.beatId}
                  quote={movement.evidenceQuote}
                  onJumpToScene={onJumpToScene}
                />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  )
}
