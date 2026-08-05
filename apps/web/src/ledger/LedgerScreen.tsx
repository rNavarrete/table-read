import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LedgerFact,
  NarrativeMapRun,
  Project,
  StoryThread,
} from 'contract'
import {
  batchLedgerReview,
  confirmLedgerFact,
  editLedgerFact,
  generateNarrativeMap,
  getLedger,
  getLatestNarrativeMapRun,
  getNarrativeMapRun,
  getProject,
  rejectLedgerFact,
} from '../api/client'
import { ApiError } from '../api/errors'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { AppShell } from '../shell/AppShell'
import { navigateToWriteScene } from '../shell/modeNavigation'
import { CastPanel } from './CastPanel'
import { CharacterProfile } from './CharacterProfile.tsx'
import { FactCard } from './FactCard'
import type { AtlasFilterChip } from './AtlasControlBar'
import { FilterRail, type AsOfSceneOption } from './FilterRail'
import { KnowledgeWeb } from './KnowledgeWeb'
import { LedgerViewSwitcher } from './LedgerViewSwitcher'
import { NarrativeMapCard } from './NarrativeMapCard'
import { StoryAtlas } from './StoryAtlas'
import { StoryOverviewCard } from './StoryOverviewCard'
import { ThreadsPanel } from './ThreadsPanel'
import {
  DEFAULT_FILTERS,
  filterFacts,
  groupPendingByScene,
  highConfidencePending,
  pendingReviewFacts,
  type LedgerFilters,
} from './filters'
import {
  loadLedgerView,
  saveLedgerView,
  type LedgerViewId,
} from './viewPreference'

function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

function sceneLabel(project: Project, sceneId: string): string {
  for (const season of project.seasons) {
    for (const episode of season.episodes) {
      const scene = episode.scenes.find((candidate) => candidate.id === sceneId)
      const location = (scene as { location?: string } | undefined)?.location
      if (location) return location
    }
  }
  return sceneId
}

/** Episode scenes in doc order for the T7.18 As-of control — location, or
 * `Scene {n}` (1-based) when the scene has no location set yet. */
function episodeSceneOptions(project: Project): AsOfSceneOption[] {
  const options: AsOfSceneOption[] = []
  for (const season of project.seasons) {
    for (const episode of season.episodes) {
      for (const scene of episode.scenes) {
        const location = (scene as { location?: string }).location
        options.push({
          id: scene.id,
          label: location || `Scene ${scene.index + 1}`,
        })
      }
    }
  }
  return options
}

/** Threads live on the first (only) episode — design doc "Narrative Promises"
 * MVP scoping. */
function firstEpisodeThreads(project: Project): StoryThread[] {
  return project.seasons[0]?.episodes[0]?.threads ?? []
}

const FACT_TYPE_LABELS: Record<LedgerFilters['factType'], string> = {
  all: 'All types',
  event: 'Events',
  state: 'States',
  knowledge: 'Knowledge',
  relationship: 'Relationships',
  world_rule: 'World rules',
}

/**
 * Ledger mode (UI spec §6 / build plan T5.1): filter rail · review queue ·
 * Atlas / Knowledge Web. Server is source of truth; mutations roll back on
 * 4xx/5xx.
 */
export function LedgerScreen() {
  const projectId = requireProjectId()
  const focusFactId = useUrlParam('fact')
  const activeProjectId = projectId ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [ledger, setLedger] = useState<LedgerFact[]>([])
  const [filters, setFilters] = useState<LedgerFilters>(DEFAULT_FILTERS)
  const [view, setView] = useState<LedgerViewId>(() =>
    focusFactId ? 'atlas' : projectId ? loadLedgerView(projectId) : 'atlas',
  )
  const [expandedFactId, setExpandedFactId] = useState<string | null>(
    () => focusFactId,
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [narrativeMapRun, setNarrativeMapRun] =
    useState<NarrativeMapRun | null>(null)
  const narrativeMapRunId = narrativeMapRun?.id
  const narrativeMapRunStatus = narrativeMapRun?.status
  const narrativeMapRunErrorCode = narrativeMapRun?.errorCode
  const narrativeMapRunRetryAllowed = narrativeMapRun?.retryAllowed
  const [castPanelOpen, setCastPanelOpen] = useState(false)
  // Session-only (design spec §UI): no persistence, resets on reload.
  const [asOfScene, setAsOfScene] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([
      getProject(projectId),
      getLedger(projectId, asOfScene ? { asOfScene } : undefined),
    ])
      .then(([loadedProject, loadedLedger]) => {
        if (cancelled) return
        setProject(loadedProject)
        setLedger(loadedLedger)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(
          err instanceof Error ? err.message : 'failed to load project',
        )
      })
    return () => {
      cancelled = true
    }
  }, [projectId, asOfScene])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    getLatestNarrativeMapRun(projectId)
      .then((latestRun) => {
        if (cancelled) return
        setNarrativeMapRun(latestRun)
        if (
          latestRun?.status === 'rejected' ||
          latestRun?.status === 'failed' ||
          latestRun?.status === 'stale'
        ) {
          setActionError(
            latestRun.errorMessage ??
              'Narrative Map analysis did not complete.',
          )
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setActionError(
          err instanceof Error
            ? err.message
            : 'could not restore Narrative Map progress',
        )
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!activeProjectId || !narrativeMapRunId) return
    const isActive =
      narrativeMapRunStatus === 'queued' || narrativeMapRunStatus === 'running'
    const isWaitingForSafeRetry =
      narrativeMapRunStatus === 'failed' &&
      (narrativeMapRunErrorCode === 'LLM_TIMEOUT' ||
        narrativeMapRunErrorCode === 'WORKER_INTERRUPTED') &&
      !narrativeMapRunRetryAllowed
    if (!isActive && !isWaitingForSafeRetry) {
      return
    }

    let cancelled = false
    const refreshRun = async () => {
      try {
        const nextRun = await getNarrativeMapRun(
          activeProjectId,
          narrativeMapRunId,
        )
        if (cancelled) return
        setNarrativeMapRun(nextRun)
        if (nextRun.status === 'completed') {
          setProject(await getProject(activeProjectId))
        } else if (
          nextRun.status === 'rejected' ||
          nextRun.status === 'failed' ||
          nextRun.status === 'stale'
        ) {
          setActionError(
            nextRun.errorMessage ?? 'Narrative Map analysis did not complete.',
          )
        }
      } catch (err) {
        if (cancelled) return
        setActionError(
          err instanceof Error
            ? err.message
            : 'could not check Narrative Map progress',
        )
      }
    }

    void refreshRun()
    const interval = window.setInterval(
      () => void refreshRun(),
      isActive ? 1500 : 10_000,
    )
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [
    activeProjectId,
    narrativeMapRunErrorCode,
    narrativeMapRunId,
    narrativeMapRunRetryAllowed,
    narrativeMapRunStatus,
  ])

  useEffect(() => {
    if (!projectId) return
    const resume = loadResume(projectId)
    saveResume(projectId, { ...resume, mode: 'Ledger' })
  }, [projectId])

  useEffect(() => {
    if (!focusFactId || !projectId) return
    saveLedgerView(projectId, 'atlas')
  }, [focusFactId, projectId])

  useEffect(() => {
    if (!focusFactId) return
    const timer = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-testid="atlas-row-${focusFactId}"], [data-testid="fact-card-${focusFactId}"]`,
      )
      if (!(el instanceof HTMLElement)) return
      el.scrollIntoView?.({ block: 'nearest' })
      el.classList.add('outline', 'outline-selected', 'outline-tr-coral')
      window.setTimeout(() => {
        el.classList.remove('outline', 'outline-selected', 'outline-tr-coral')
      }, 2000)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [expandedFactId, focusFactId, ledger, view])

  const sceneOptions = useMemo(
    () => (project ? episodeSceneOptions(project) : []),
    [project],
  )
  const threads = useMemo(
    () => (project ? firstEpisodeThreads(project) : []),
    [project],
  )

  const storyOverview = project?.seasons[0]?.episodes[0]?.storyOverview ?? null
  const narrativeMap = project?.seasons[0]?.episodes[0]?.narrativeMap ?? null
  const episodeSceneCount = useMemo(
    () => (project ? episodeSceneOptions(project).length : 0),
    [project],
  )
  const queue = useMemo(() => pendingReviewFacts(ledger), [ledger])
  const highConf = useMemo(() => highConfidencePending(ledger), [ledger])
  const sceneGroups = useMemo(() => groupPendingByScene(ledger), [ledger])
  const selectedCharacter = useMemo(() => {
    if (!project || filters.characterId == null) return null
    return (
      project.seriesBible.characters.find(
        (c) => c.id === filters.characterId,
      ) ?? null
    )
  }, [project, filters.characterId])
  const visibleFacts = useMemo(() => {
    const filtered = filterFacts(ledger, filters)
    const focused = ledger.find((fact) => fact.id === focusFactId)
    return focused && !filtered.some((fact) => fact.id === focused.id)
      ? [...filtered, focused]
      : filtered
  }, [ledger, filters, focusFactId])
  const pendingCount = queue.length
  const atlasFilterChips = useMemo<AtlasFilterChip[]>(() => {
    const chips: AtlasFilterChip[] = []
    if (filters.characterId) {
      chips.push({
        kind: 'character',
        label: selectedCharacter?.name ?? 'Character',
        onClear: () =>
          setFilters((current) => ({ ...current, characterId: null })),
      })
    }
    if (filters.status !== 'all') {
      chips.push({
        kind: 'status',
        label: filters.status.replace('_', ' '),
        onClear: () => setFilters((current) => ({ ...current, status: 'all' })),
      })
    }
    if (filters.factType !== 'all') {
      chips.push({
        kind: 'type',
        label: FACT_TYPE_LABELS[filters.factType],
        onClear: () =>
          setFilters((current) => ({ ...current, factType: 'all' })),
      })
    }
    if (filters.secretsOnly) {
      chips.push({
        kind: 'secrets',
        label: 'Secrets only',
        tone: 'secret',
        onClear: () =>
          setFilters((current) => ({ ...current, secretsOnly: false })),
      })
    }
    if (filters.hideSuperseded) {
      chips.push({
        kind: 'history',
        label: 'Superseded hidden',
        onClear: () =>
          setFilters((current) => ({ ...current, hideSuperseded: false })),
      })
    }
    if (asOfScene) {
      chips.push({
        kind: 'as-of',
        label: `As of ${sceneOptions.find((scene) => scene.id === asOfScene)?.label ?? 'selected scene'}`,
        onClear: () => setAsOfScene(null),
      })
    }
    return chips
  }, [asOfScene, filters, sceneOptions, selectedCharacter?.name])

  const runMutation = useCallback(
    async (
      factId: string | null,
      optimistic: LedgerFact[],
      mutate: () => Promise<LedgerFact[]>,
    ) => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      const before = ledger
      setActionError(null)
      setBusyId(factId)
      setLedger(optimistic)
      try {
        const next = await mutate()
        setLedger(next)
        // Ledger mutations mint a new snapshot; refresh head so the next
        // If-Match is not stale (scene-batch / accept-all are sequential).
        // Refresh failure must not roll back an already-applied mutation.
        if (activeProjectId) {
          try {
            setProject(await getProject(activeProjectId))
          } catch {
            /* next mutation may 409; writer can reload */
          }
        }
      } catch (err) {
        setLedger(before)
        setActionError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'ledger action failed',
        )
      } finally {
        setBusyId(null)
        inFlightRef.current = false
      }
    },
    [activeProjectId, ledger],
  )

  function handleAccept(factId: string) {
    const proposal = ledger.find((f) => f.id === factId)
    const targetId = proposal?.supersedes ?? null
    const optimistic = ledger.map((f) => {
      if (f.id === factId) {
        return {
          ...f,
          status: 'active' as const,
          provenance: 'writer_confirmed' as const,
        }
      }
      if (targetId && f.id === targetId) {
        return { ...f, status: 'superseded' as const, supersededBy: factId }
      }
      return f
    })
    void runMutation(factId, optimistic, async () => {
      await confirmLedgerFact(factId, {
        expectedHeadSnapshotId: project?.headSnapshotId,
      })
      // Refetch so supersede-target updates land (confirm may touch two facts).
      return getLedger(activeProjectId, asOfScene ? { asOfScene } : undefined)
    })
  }

  async function handleGenerateNarrativeMap() {
    if (
      !project ||
      narrativeMapRun?.status === 'queued' ||
      narrativeMapRun?.status === 'running'
    ) {
      return
    }
    setActionError(null)
    try {
      setNarrativeMapRun(
        await generateNarrativeMap(project.id, {
          expectedHeadSnapshotId: project.headSnapshotId,
        }),
      )
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'could not generate the narrative map',
      )
    }
  }

  function handleReject(factId: string) {
    const optimistic = ledger.map((f) =>
      f.id === factId ? { ...f, status: 'rejected' as const } : f,
    )
    void runMutation(factId, optimistic, async () => {
      await rejectLedgerFact(factId, {
        expectedHeadSnapshotId: project?.headSnapshotId,
      })
      return getLedger(activeProjectId, asOfScene ? { asOfScene } : undefined)
    })
  }

  function handleEdit(
    factId: string,
    body: { fact: string; knownBy: string[] },
  ) {
    const optimistic = ledger.map((f) =>
      f.id === factId
        ? {
            ...f,
            fact: body.fact,
            knownBy: body.knownBy,
            provenance: 'writer_authored' as const,
            status:
              f.status === 'pending_review' ? ('active' as const) : f.status,
          }
        : f,
    )
    void runMutation(factId, optimistic, async () => {
      await editLedgerFact(
        factId,
        {
          fact: body.fact,
          knownBy: body.knownBy,
        },
        { expectedHeadSnapshotId: project?.headSnapshotId },
      )
      return getLedger(activeProjectId, asOfScene ? { asOfScene } : undefined)
    })
  }

  function handleBatchAcceptHigh() {
    const ids = highConf.map((f) => f.id)
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const optimistic = ledger.map((f) =>
      idSet.has(f.id)
        ? {
            ...f,
            status: 'active' as const,
            provenance: 'writer_confirmed' as const,
          }
        : f,
    )
    void runMutation(null, optimistic, async () => {
      const { ledger: next } = await batchLedgerReview(
        activeProjectId,
        {
          confirmIds: ids,
          rejectIds: [],
        },
        { expectedHeadSnapshotId: project?.headSnapshotId },
      )
      return next
    })
  }

  function handleSceneBatch(sceneId: string, action: 'accept' | 'reject') {
    const group = groupPendingByScene(ledger).find((g) => g.sceneId === sceneId)
    if (!group || group.facts.length === 0) return
    const ids = group.facts.map((f) => f.id)
    const idSet = new Set(ids)
    const optimistic = ledger.map((f) => {
      if (!idSet.has(f.id)) return f
      if (action === 'accept') {
        return {
          ...f,
          status: 'active' as const,
          provenance: 'writer_confirmed' as const,
        }
      }
      return { ...f, status: 'rejected' as const }
    })
    void runMutation(null, optimistic, async () => {
      const { ledger: next } = await batchLedgerReview(
        activeProjectId,
        {
          confirmIds: action === 'accept' ? ids : [],
          rejectIds: action === 'reject' ? ids : [],
        },
        { expectedHeadSnapshotId: project?.headSnapshotId },
      )
      return next
    })
  }

  function handleSourceSpanClick(fact: LedgerFact) {
    const url = new URL(window.location.href)
    url.pathname = '/'
    url.searchParams.set('project', activeProjectId)
    url.searchParams.set('scene', fact.sourceSpan.sceneId)
    url.searchParams.set('highlightBeat', fact.sourceSpan.beatId)
    window.location.assign(url.toString())
  }

  function handleJumpToScene(sceneId: string) {
    if (projectId) saveResume(projectId, { mode: 'Write', sceneId })
    navigateToWriteScene(sceneId)
  }

  function handleOpenInAtlas(factId: string) {
    setView('atlas')
    saveLedgerView(activeProjectId, 'atlas')
    setExpandedFactId(factId)
  }

  function handleBrowseInAtlas() {
    setView('atlas')
    saveLedgerView(activeProjectId, 'atlas')
  }

  function scrollToReviewQueue() {
    setView('story')
    saveLedgerView(activeProjectId, 'story')
    window.requestAnimationFrame(() => {
      document
        .querySelector('[data-testid="review-queue"]')
        ?.scrollIntoView?.({ block: 'nearest' })
    })
  }

  if (!projectId) return null

  if (loadError) {
    return (
      <AppShell
        projectTitle="Table Read"
        activeMode="Ledger"
        ledgerCount={0}
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-danger">
          Couldn&apos;t load this project: {loadError}
        </p>
      </AppShell>
    )
  }

  if (!project) {
    return (
      <AppShell
        projectTitle="Table Read"
        activeMode="Ledger"
        ledgerCount={0}
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-text-secondary">Loading…</p>
      </AppShell>
    )
  }

  return (
    <AppShell
      projectTitle={project.title}
      activeMode="Ledger"
      ledgerCount={pendingCount}
      projectId={projectId}
    >
      <div className="flex h-[calc(100vh-3.5rem)] min-h-0 overflow-hidden bg-tr-surface-raised">
        <FilterRail
          project={project}
          filters={filters}
          onChange={setFilters}
          onManageCast={() => setCastPanelOpen(true)}
          sceneOptions={sceneOptions}
          asOfScene={asOfScene}
          onAsOfSceneChange={setAsOfScene}
          facts={ledger}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-tr-ledger-content px-5 py-6 pb-16 lg:px-7 lg:py-8">
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-6">
              <div className="flex min-w-0 flex-col gap-1.5">
                <h1 className="font-ledger-display text-30 font-medium text-tr-text-primary">
                  What&apos;s true in this story
                </h1>
                <p className="max-w-[600px] text-pretty text-[14.5px] text-tr-text-secondary">
                  {selectedCharacter
                    ? `Showing what ${selectedCharacter.name} knows, and facts they appear in.`
                    : 'Your story bible — browse truths, or focus who knows what.'}
                </p>
              </div>
              <div className="flex flex-none flex-wrap items-center gap-2.5 pt-1">
                <LedgerViewSwitcher
                  projectId={projectId}
                  value={view}
                  onChange={setView}
                  threadCount={threads.length}
                />
                {pendingCount > 0 && (
                  <button
                    type="button"
                    onClick={scrollToReviewQueue}
                    className="rounded-control bg-tr-amber-soft px-2.5 py-1.5 text-13 text-tr-amber shadow-raised transition-[box-shadow,background-color] duration-standard ease-standard hover:shadow-lift focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
                  >
                    {pendingCount} to review
                  </button>
                )}
              </div>
            </header>
            {actionError && (
              <p className="text-13 text-tr-danger" role="alert">
                {actionError}
              </p>
            )}
            {castPanelOpen && (
              <CastPanel
                project={project}
                ledger={ledger}
                onProjectChange={setProject}
                onLedgerChange={setLedger}
                onClose={() => setCastPanelOpen(false)}
              />
            )}
            {view === 'story' && (
              <>
                <StoryOverviewCard
                  project={project}
                  overview={storyOverview}
                  sceneCount={episodeSceneCount}
                  threadCount={threads.length}
                  factCount={ledger.length}
                  onJumpToScene={handleJumpToScene}
                />
                <NarrativeMapCard
                  project={project}
                  narrativeMap={narrativeMap}
                  onJumpToScene={handleJumpToScene}
                  onGenerateNarrativeMap={handleGenerateNarrativeMap}
                  narrativeMapRun={narrativeMapRun}
                />
                {queue.length > 0 && (
                  <section
                    className="rounded-card border border-tr-border border-l-2 border-l-tr-amber bg-tr-amber-soft p-5 shadow-raised"
                    aria-label="Review queue"
                    data-testid="review-queue"
                  >
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-display text-17 text-tr-text-primary">
                        {queue.length} fact{queue.length === 1 ? '' : 's'}{' '}
                        awaiting review
                      </h2>
                      {highConf.length > 0 && (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={handleBatchAcceptHigh}
                          className="rounded-card bg-tr-sage-soft px-3 py-1.5 text-13 text-tr-text-primary transition-colors duration-standard ease-standard hover:shadow-lift focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral disabled:opacity-50 motion-reduce:transition-none"
                          data-testid="batch-accept-high"
                        >
                          Accept all high-confidence ({highConf.length})
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-4">
                      {sceneGroups.map((group) => (
                        <div
                          key={group.sceneId}
                          data-testid={`review-queue-scene-${group.sceneId}`}
                          className="flex flex-col gap-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-13 font-medium text-tr-text-primary">
                              {sceneLabel(project, group.sceneId)}
                              <span className="ml-2 font-normal text-tr-text-muted">
                                ({group.facts.length})
                              </span>
                            </h3>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={busyId !== null}
                                onClick={() =>
                                  handleSceneBatch(group.sceneId, 'accept')
                                }
                                className="rounded-card bg-tr-sage-soft px-2.5 py-1 text-12 text-tr-text-primary transition-colors duration-standard ease-standard focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral disabled:opacity-50 motion-reduce:transition-none"
                                data-testid={`scene-accept-${group.sceneId}`}
                              >
                                Accept scene
                              </button>
                              <button
                                type="button"
                                disabled={busyId !== null}
                                onClick={() =>
                                  handleSceneBatch(group.sceneId, 'reject')
                                }
                                className="rounded-card px-2.5 py-1 text-12 text-tr-text-muted transition-colors duration-standard ease-standard hover:bg-tr-surface-raised focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral disabled:opacity-50 motion-reduce:transition-none"
                                data-testid={`scene-reject-${group.sceneId}`}
                              >
                                Reject scene
                              </button>
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            {group.facts.map((fact) => (
                              <FactCard
                                key={`queue-${fact.id}`}
                                fact={fact}
                                allFacts={ledger}
                                project={project}
                                queueActions
                                busy={busyId !== null}
                                onAccept={handleAccept}
                                onReject={handleReject}
                                onEdit={handleEdit}
                                onSourceSpanClick={handleSourceSpanClick}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
            {/* Outside the story-view block on purpose: selecting a person is
                what the CAST rail is for, and the rail is present in every
                view. Gated to Story, picking someone in Atlas or Web changed
                the fact list but showed nothing about the person. */}
            {selectedCharacter && (
              <CharacterProfile
                character={selectedCharacter}
                project={project}
                facts={ledger}
                onOpenScene={navigateToWriteScene}
              />
            )}
            <section
              key={view}
              aria-label="Ledger facts"
              className="tr-ledger-view-enter min-h-0 flex-1"
              data-testid="ledger-view-body"
            >
              {view === 'atlas' ? (
                <StoryAtlas
                  facts={visibleFacts}
                  allFacts={ledger}
                  project={project}
                  busy={busyId !== null}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onSourceSpanClick={handleSourceSpanClick}
                  expandedFactId={expandedFactId}
                  onExpandedFactIdChange={setExpandedFactId}
                  filterChips={atlasFilterChips}
                  emptyMessage={
                    ledger.length === 0
                      ? asOfScene
                        ? 'No facts are in force as of this scene yet.'
                        : "Facts appear as you write. Table Read tracks what's true so you don't have to."
                      : 'No facts match.'
                  }
                />
              ) : view === 'web' ? (
                <KnowledgeWeb
                  facts={visibleFacts}
                  allFacts={ledger}
                  project={project}
                  busy={busyId !== null}
                  characterId={filters.characterId}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onEdit={handleEdit}
                  onSourceSpanClick={handleSourceSpanClick}
                  onOpenInAtlas={handleOpenInAtlas}
                  onBrowseInAtlas={handleBrowseInAtlas}
                />
              ) : view === 'threads' ? (
                <ThreadsPanel
                  project={project}
                  threads={threads}
                  onJumpToScene={handleJumpToScene}
                  onClose={handleBrowseInAtlas}
                />
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
