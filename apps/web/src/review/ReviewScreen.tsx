import { useEffect, useMemo, useState } from 'react'
import type { ChangeSet, ConsistencyFlag, Project } from 'contract'
import {
  applyChangeSet,
  discardChangeSet,
  dismissConsistencyFlag,
  flagChangeSet,
  getChangeSet,
  getLedger,
  getProject,
  listChangeSets,
  previewChangeSet,
  undoProject,
} from '../api/client'
import { ApiError } from '../api/errors'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { AppShell } from '../shell/AppShell'
import { ChangeSetPanel } from './ChangeSetPanel'
import {
  clearStashedChangeSet,
  loadStashedChangeSet,
  stashChangeSet,
} from './changeSetSession'
import { selectableIds } from './selectableIds'
import { pendingReviewCount } from './pendingReviewCount'
import { Toast } from '../shell/Toast'
import { lockedObjectMessage } from '../shell/toastCopy'

function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

function openChangeSet(projectId: string, changeSetId: string) {
  const url = new URL(window.location.href)
  url.pathname = '/review'
  url.searchParams.set('project', projectId)
  url.searchParams.set('changeSet', changeSetId)
  window.location.assign(url.toString())
}

/**
 * Review mode screen (UI spec §5 / T4.3). Loads a Change Set via GET when
 * `?changeSet=` is set (sessionStorage is a warm cache). Without that param,
 * lists draft Change Sets for the project (mode-switcher entry path).
 */
export function ReviewScreen() {
  const projectId = requireProjectId()
  const changeSetId = useUrlParam('changeSet')
  const activeProjectId = projectId ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [ledgerCount, setLedgerCount] = useState(0)
  const [changeSet, setChangeSet] = useState<ChangeSet | null>(null)
  const [drafts, setDrafts] = useState<ChangeSet[] | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [hasPreview, setHasPreview] = useState(false)
  const [postApplyFlags, setPostApplyFlags] = useState<ConsistencyFlag[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // False until the draft list or the targeted Change Set finishes loading.
  const [changeSetReady, setChangeSetReady] = useState(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([getProject(projectId), getLedger(projectId)])
      .then(([loadedProject, ledger]) => {
        if (cancelled) return
        setProject(loadedProject)
        setLedgerCount(pendingReviewCount(ledger))
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
    saveResume(projectId, { ...resume, mode: 'Review' })
  }, [projectId])

  // Mode-switcher entry: no ?changeSet= → list drafts (UI spec §5).
  // With ?changeSet= → GET (sessionStorage warm cache on failure).
  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    async function loadDraftList() {
      try {
        // Open picker: draft + previewing (preview flips status away from
        // draft; writers must still re-enter to Apply — UI spec §5).
        const rows = await listChangeSets(projectId, 'draft,previewing')
        if (cancelled) return
        // Single open Change Set: open it directly.
        if (rows.length === 1) {
          openChangeSet(projectId, rows[0].id)
          return
        }
        setDrafts(rows)
        setChangeSetReady(true)
      } catch (err: unknown) {
        if (cancelled) return
        setLoadError(
          err instanceof Error ? err.message : 'failed to load Change Sets',
        )
        setDrafts([])
        setChangeSetReady(true)
      }
    }

    async function loadOne(id: string) {
      // Prefer GET (source of truth). Fall back to session cache when GET is
      // not yet on the API branch (404/network) so create→Review still works.
      try {
        const fromApi = await getChangeSet(id)
        if (cancelled) return
        setChangeSet(fromApi)
        stashChangeSet(fromApi)
        setSelectedIds(new Set(selectableIds(fromApi)))
        setHasPreview(fromApi.preview != null)
        setChangeSetReady(true)
        return
      } catch {
        // TODO: remove cache-only path once GET /change-sets/{cid} is always
        // available on the merged API branch (user ruling 3).
      }
      if (cancelled) return
      const stashed = loadStashedChangeSet(id)
      if (!stashed) {
        setLoadError(
          'No Change Set loaded — open Review from a structural edit in Plan.',
        )
        setChangeSetReady(true)
        return
      }
      setChangeSet(stashed)
      setSelectedIds(new Set(selectableIds(stashed)))
      setHasPreview(stashed.preview != null)
      setChangeSetReady(true)
    }

    if (changeSetId) {
      void loadOne(changeSetId)
    } else {
      void loadDraftList()
    }
    return () => {
      cancelled = true
    }
  }, [projectId, changeSetId])

  function toggleSelected(objectId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(objectId)) next.delete(objectId)
      else next.add(objectId)
      return next
    })
    // Changing selection after a preview invalidates apply until re-preview.
    setHasPreview(false)
  }

  async function handlePreview() {
    if (!changeSet) return
    const approvedObjectIds = [...selectedIds]
    setPreviewing(true)
    try {
      const updated = await previewChangeSet(changeSet.id, {
        approvedObjectIds,
      })
      setChangeSet(updated)
      stashChangeSet(updated)
      setHasPreview(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setToast(
          err.code === 'LOCKED_OBJECT' ||
            err.message.toLowerCase().includes('lock')
            ? lockedObjectMessage
            : err.message,
        )
      } else {
        setToast(err instanceof Error ? err.message : 'Preview failed')
      }
    } finally {
      setPreviewing(false)
    }
  }

  async function handleApply() {
    if (!changeSet) return
    const approvedObjectIds = [...selectedIds]
    setApplying(true)
    try {
      const result = await applyChangeSet(
        changeSet.id,
        { approvedObjectIds },
        { expectedHeadSnapshotId: project?.headSnapshotId },
      )
      setChangeSet(result.changeSet)
      stashChangeSet(result.changeSet)
      setProject(result.project)
      setPostApplyFlags(result.consistencyFlags)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setToast(
          err.code === 'LOCKED_OBJECT' ? lockedObjectMessage : err.message,
        )
      } else {
        setToast(err instanceof Error ? err.message : 'Apply failed')
      }
    } finally {
      setApplying(false)
    }
  }

  async function handleFlagOnly() {
    if (!changeSet) return
    try {
      const updated = await flagChangeSet(changeSet.id)
      setChangeSet(updated)
      clearStashedChangeSet(updated)
      stashChangeSet(updated)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Flag failed')
    }
  }

  async function handleDiscard() {
    if (!changeSet) return
    try {
      const updated = await discardChangeSet(changeSet.id)
      clearStashedChangeSet(updated)
      const url = new URL(window.location.href)
      url.pathname = '/plan'
      url.searchParams.delete('changeSet')
      window.location.assign(url.toString())
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Discard failed')
    }
  }

  async function handleUndoAll() {
    try {
      await undoProject(activeProjectId, {
        expectedHeadSnapshotId: project?.headSnapshotId,
      })
      // Full reload so Plan/Write pick up the restored head and this screen
      // leaves the applied summary (Change Set row stays `applied` in storage).
      window.location.reload()
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Undo failed')
    }
  }

  async function handleDismissFlag(flagId: string) {
    try {
      await dismissConsistencyFlag(flagId, {
        expectedHeadSnapshotId: project?.headSnapshotId,
      })
      setPostApplyFlags((prev) => prev.filter((f) => f.id !== flagId))
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Dismiss failed')
    }
  }

  function handleGoToScene(sceneId: string) {
    const url = new URL(window.location.href)
    url.pathname = '/plan'
    url.searchParams.delete('changeSet')
    url.searchParams.set('project', activeProjectId)
    url.searchParams.set('scene', sceneId)
    window.location.assign(url.toString())
  }

  function handleContinuityFlag(factId: string) {
    const url = new URL(window.location.href)
    url.pathname = '/ledger'
    url.searchParams.set('project', activeProjectId)
    url.searchParams.set('fact', factId)
    window.location.assign(url.toString())
  }

  if (!projectId) return null

  // Draft picker (no ?changeSet= and not auto-redirecting a single draft).
  if (!changeSetId && changeSetReady && drafts !== null) {
    return (
      <AppShell
        projectTitle={project?.title ?? 'Table Read'}
        activeMode="Review"
        ledgerCount={ledgerCount}
        projectId={projectId}
      >
        <div
          className="flex flex-col gap-4 p-6"
          data-testid="draft-change-sets"
        >
          <div className="flex flex-col gap-1">
            <p className="text-12 uppercase tracking-wide text-tr-text-muted">
              Review mode
            </p>
            <h2 className="font-display text-17 font-semibold text-tr-text-primary">
              Open Change Sets
            </h2>
          </div>
          {drafts.length === 0 ? (
            <p className="text-15 text-tr-text-secondary">
              No open Change Sets. Open Review from a structural edit in Plan.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {drafts.map((cs) => (
                <li key={cs.id}>
                  <button
                    type="button"
                    onClick={() => openChangeSet(projectId, cs.id)}
                    className="w-full rounded-card border border-tr-border bg-tr-surface-raised px-4 py-3 text-left shadow-raised transition hover:border-tr-coral hover:shadow-lift"
                  >
                    <p className="font-display text-15 font-medium text-tr-text-primary">
                      &ldquo;{cs.instruction}&rdquo;
                    </p>
                    <p className="mt-1 text-13 text-tr-text-muted">
                      {cs.status} · {cs.targetObjectId} · {cs.impacted.length}{' '}
                      impacted
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {loadError && (
          <Toast tone="danger" onDismiss={() => setLoadError(null)}>
            {loadError}
          </Toast>
        )}
      </AppShell>
    )
  }

  if (loadError && !changeSet && changeSetReady) {
    return (
      <AppShell
        projectTitle="Table Read"
        activeMode="Review"
        ledgerCount={0}
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-danger">{loadError}</p>
      </AppShell>
    )
  }

  if (!project || !changeSet || !changeSetReady) {
    return (
      <AppShell
        projectTitle={project?.title ?? 'Table Read'}
        activeMode="Review"
        ledgerCount={ledgerCount}
        projectId={projectId}
      >
        <div className="flex flex-col gap-3 p-6" data-testid="classifying">
          <p className="text-15 text-tr-text-secondary">Mapping impact…</p>
          <div className="h-12 animate-pulse rounded-card bg-tr-surface-clay" />
          <div className="h-12 animate-pulse rounded-card bg-tr-surface-clay" />
          <div className="h-12 animate-pulse rounded-card bg-tr-surface-clay" />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      projectTitle={project.title}
      activeMode="Review"
      ledgerCount={ledgerCount}
      projectId={projectId}
      onUndo={
        changeSet.status === 'applied' ? () => void handleUndoAll() : undefined
      }
    >
      <ChangeSetPanel
        changeSet={changeSet}
        selectedIds={selectedIds}
        previewing={previewing}
        applying={applying}
        hasPreview={hasPreview}
        postApplyFlags={postApplyFlags}
        onToggleSelected={toggleSelected}
        onPreview={() => void handlePreview()}
        onApply={() => void handleApply()}
        onFlagOnly={() => void handleFlagOnly()}
        onDiscard={() => void handleDiscard()}
        onUndoAll={
          changeSet.status === 'applied'
            ? () => void handleUndoAll()
            : undefined
        }
        onDismissFlag={(id) => void handleDismissFlag(id)}
        onGoToScene={handleGoToScene}
        onContinuityFlagClick={handleContinuityFlag}
        characters={project.seriesBible.characters.map((c) => ({
          id: c.id,
          name: c.name,
        }))}
      />
      {toast && (
        <Toast tone="danger" onDismiss={() => setToast(null)}>
          {toast}
        </Toast>
      )}
      {loadError && (
        <Toast tone="danger" onDismiss={() => setLoadError(null)}>
          {loadError}
        </Toast>
      )}
    </AppShell>
  )
}
