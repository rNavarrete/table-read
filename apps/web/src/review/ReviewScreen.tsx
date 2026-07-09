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
  previewChangeSet,
} from '../api/client'
import { ApiError } from '../api/errors'
import { AppShell } from '../shell/AppShell'
import { ChangeSetPanel } from './ChangeSetPanel'
import {
  clearStashedChangeSet,
  loadStashedChangeSet,
  stashChangeSet,
} from './changeSetSession'
import { selectableIds } from './selectableIds'
import { pendingReviewCount } from './pendingReviewCount'
import { Toast } from './Toast'

const DEFAULT_PROJECT_ID = 'proj-longpour'

function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

/**
 * Review mode screen (UI spec §5 / T4.3). Loads a Change Set via GET when
 * available, with sessionStorage as a warm cache after create (user ruling 3).
 * Classifying is the create-in-flight state owned by Plan's Open Review; this
 * screen shows skeleton only while the project / Change Set fetch is in flight.
 */
export function ReviewScreen() {
  const projectId = useUrlParam('project') ?? DEFAULT_PROJECT_ID
  const changeSetId = useUrlParam('changeSet')

  const [project, setProject] = useState<Project | null>(null)
  const [ledgerCount, setLedgerCount] = useState(0)
  const [changeSet, setChangeSet] = useState<ChangeSet | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [hasPreview, setHasPreview] = useState(false)
  const [postApplyFlags, setPostApplyFlags] = useState<ConsistencyFlag[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(
    changeSetId
      ? null
      : 'No Change Set loaded — open Review from a structural edit in Plan.',
  )
  // Ready immediately when there is no id to fetch; otherwise wait for GET/cache.
  const [changeSetReady, setChangeSetReady] = useState(!changeSetId)

  useEffect(() => {
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
    if (!changeSetId) return
    let cancelled = false

    async function load() {
      // Prefer GET (source of truth). Fall back to session cache when GET is
      // not yet on the API branch (404/network) so create→Review still works.
      try {
        const fromApi = await getChangeSet(changeSetId!)
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
      const stashed = loadStashedChangeSet(changeSetId!)
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

    void load()
    return () => {
      cancelled = true
    }
  }, [changeSetId])

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
            ? 'A locked element was included — nothing was changed'
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
      const result = await applyChangeSet(changeSet.id, { approvedObjectIds })
      setChangeSet(result.changeSet)
      stashChangeSet(result.changeSet)
      setProject(result.project)
      setPostApplyFlags(result.consistencyFlags)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setToast('A locked element was included — nothing was changed')
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

  async function handleDismissFlag(flagId: string) {
    try {
      await dismissConsistencyFlag(flagId)
      setPostApplyFlags((prev) => prev.filter((f) => f.id !== flagId))
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Dismiss failed')
    }
  }

  function handleGoToScene(sceneId: string) {
    const url = new URL(window.location.href)
    url.pathname = '/plan'
    url.searchParams.delete('changeSet')
    url.searchParams.set('scene', sceneId)
    window.location.assign(url.toString())
  }

  function handleContinuityFlag(factId: string) {
    const url = new URL(window.location.href)
    url.pathname = '/ledger'
    url.searchParams.set('project', projectId)
    url.searchParams.set('fact', factId)
    window.location.assign(url.toString())
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
        onDismissFlag={(id) => void handleDismissFlag(id)}
        onGoToScene={handleGoToScene}
        onContinuityFlagClick={handleContinuityFlag}
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
