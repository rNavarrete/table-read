import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LedgerFact, Project } from 'contract'
import {
  batchLedgerReview,
  confirmLedgerFact,
  editLedgerFact,
  getLedger,
  getProject,
  rejectLedgerFact,
} from '../api/client'
import { ApiError } from '../api/errors'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { AppShell } from '../shell/AppShell'
import { FactCard } from './FactCard'
import { FilterRail } from './FilterRail'
import {
  DEFAULT_FILTERS,
  filterFacts,
  groupPendingByScene,
  highConfidencePending,
  pendingReviewFacts,
  type LedgerFilters,
} from './filters'

function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

/**
 * Ledger mode (UI spec §6 / build plan T5.1): filter rail · review queue ·
 * fact card grid. Server is source of truth; mutations roll back on 4xx/5xx.
 */
export function LedgerScreen() {
  const projectId = requireProjectId()
  const focusFactId = useUrlParam('fact')
  const activeProjectId = projectId ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [ledger, setLedger] = useState<LedgerFact[]>([])
  const [filters, setFilters] = useState<LedgerFilters>(DEFAULT_FILTERS)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([getProject(projectId), getLedger(projectId)])
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
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    const resume = loadResume(projectId)
    saveResume(projectId, { ...resume, mode: 'Ledger' })
  }, [projectId])

  useEffect(() => {
    if (!focusFactId) return
    const el = document.querySelector(
      `[data-testid="fact-card-${focusFactId}"]`,
    )
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest' })
      el.classList.add('outline', 'outline-selected', 'outline-tr-coral')
      const t = window.setTimeout(() => {
        el.classList.remove('outline', 'outline-selected', 'outline-tr-coral')
      }, 2000)
      return () => window.clearTimeout(t)
    }
  }, [focusFactId, ledger])

  const queue = useMemo(() => pendingReviewFacts(ledger), [ledger])
  const highConf = useMemo(() => highConfidencePending(ledger), [ledger])
  const sceneGroups = useMemo(() => groupPendingByScene(ledger), [ledger])
  const gridFacts = useMemo(() => {
    const filtered = filterFacts(ledger, filters)
    // Pending facts live in the review-queue section; don't duplicate them
    // in the grid unless the writer filtered status to pending_review.
    if (filters.status === 'pending_review') return filtered
    return filtered.filter((f) => f.status !== 'pending_review')
  }, [ledger, filters])
  const pendingCount = queue.length

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
    [ledger],
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
      return getLedger(activeProjectId)
    })
  }

  function handleReject(factId: string) {
    const optimistic = ledger.map((f) =>
      f.id === factId ? { ...f, status: 'rejected' as const } : f,
    )
    void runMutation(factId, optimistic, async () => {
      await rejectLedgerFact(factId, {
        expectedHeadSnapshotId: project?.headSnapshotId,
      })
      return getLedger(activeProjectId)
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
      return getLedger(activeProjectId)
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
      <div className="flex min-h-[calc(100vh-3.5rem)]">
        <FilterRail project={project} filters={filters} onChange={setFilters} />
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          {actionError && (
            <p className="text-13 text-tr-danger" role="alert">
              {actionError}
            </p>
          )}
          {queue.length > 0 && (
            <section
              className="rounded-card border border-tr-border bg-tr-amber-soft p-4"
              aria-label="Review queue"
              data-testid="review-queue"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-15 text-tr-text-primary">
                  {queue.length} fact{queue.length === 1 ? '' : 's'} awaiting
                  review
                </h2>
                {highConf.length > 0 && (
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={handleBatchAcceptHigh}
                    className="rounded-card bg-tr-sage-soft px-3 py-1 text-13 text-tr-text-primary disabled:opacity-50"
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
                      <h3 className="text-13 text-tr-text-secondary">
                        {group.sceneId}
                        <span className="ml-2 text-tr-text-muted">
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
                          className="rounded-card bg-tr-sage-soft px-2 py-0.5 text-12 text-tr-text-primary disabled:opacity-50"
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
                          className="rounded-card px-2 py-0.5 text-12 text-tr-text-muted disabled:opacity-50"
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
          <section aria-label="Ledger facts">
            <div className="grid gap-3 md:grid-cols-2">
              {gridFacts.map((fact) => (
                <FactCard
                  key={fact.id}
                  fact={fact}
                  allFacts={ledger}
                  project={project}
                  queueActions={fact.status === 'pending_review'}
                  busy={busyId !== null}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onEdit={handleEdit}
                  onSourceSpanClick={handleSourceSpanClick}
                />
              ))}
            </div>
            {gridFacts.length === 0 && (
              <p className="text-13 text-tr-text-muted">
                No facts match these filters.
              </p>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  )
}
