import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConsistencyFlag, LedgerFact, Project } from 'contract'
import {
  createChangeSet,
  getConsistencyFlags,
  getLedger,
  getProject,
} from '../api/client'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { navigateToReview, stashChangeSet } from '../review/changeSetSession'
import { AppShell } from '../shell/AppShell'
import { Toast } from '../shell/Toast'
import { lockedObjectMessage, staleHeadMessage } from '../shell/toastCopy'
import { Board } from './Board'
import { Inspector } from './Inspector'
import type { PlanSelection } from './SceneCard'
import { StoryLayersPanel } from './StoryLayersPanel'
import { sceneIdsWithOpenFlags } from './flaggedScenes'
import {
  buildBeatPatch,
  buildEpisodePatch,
  buildProjectFieldPatch,
  buildSceneSwapPatch,
  buildScenePatch,
  swapScenesLocally,
  withBeatField,
  withEpisodeField,
  withProjectField,
  withSceneField,
} from './planTree'
import { useProjectPatch } from './useProjectPatch'
import { allScenes, findScene } from '../write/projectTree'

function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

export function PlanScreen() {
  const projectId = requireProjectId()
  const focusSceneId = useUrlParam('scene')
  const activeProjectId = projectId ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [ledger, setLedger] = useState<LedgerFact[]>([])
  const [openFlags, setOpenFlags] = useState<ConsistencyFlag[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState<PlanSelection | undefined>(
    focusSceneId ? { type: 'scene', sceneId: focusSceneId } : undefined,
  )
  const [collapsedActs, setCollapsedActs] = useState<Set<number>>(new Set())
  const [openingReview, setOpeningReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([
      getProject(projectId),
      getLedger(projectId),
      getConsistencyFlags(projectId, 'open'),
    ])
      .then(([loadedProject, loadedLedger, loadedFlags]) => {
        if (cancelled) return
        setProject(loadedProject)
        setLedger(loadedLedger)
        setOpenFlags(loadedFlags)
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

  const effectiveSelection = useMemo<PlanSelection>(() => {
    if (selection !== undefined) return selection
    if (!projectId || !project) return null
    const scenes = allScenes(project)
    const sceneIds = scenes.map((s) => s.id)
    const sceneId = focusSceneId ?? loadResume(projectId, sceneIds).sceneId
    const validScene = sceneId ? findScene(project, sceneId) : null
    const fallbackSceneId = validScene?.id ?? scenes[0]?.id
    return fallbackSceneId ? { type: 'scene', sceneId: fallbackSceneId } : null
  }, [focusSceneId, project, projectId, selection])

  useEffect(() => {
    if (!projectId) return
    const sceneId =
      effectiveSelection?.type === 'scene'
        ? effectiveSelection.sceneId
        : undefined
    saveResume(projectId, { mode: 'Plan', sceneId })
  }, [effectiveSelection, projectId])

  // Deep-link from Review "Go to scene" / consistency flags: scroll + brief
  // highlight once the board mounts (selection already seeded from ?scene=).
  useEffect(() => {
    if (!focusSceneId || !project) return
    const el = document.querySelector(
      `[data-testid="scene-card-${focusSceneId}"]`,
    )
    if (!(el instanceof HTMLElement)) return
    el.scrollIntoView({ block: 'nearest' })
    el.classList.add('outline', 'outline-selected', 'outline-tr-coral')
    const t = window.setTimeout(() => {
      el.classList.remove('outline', 'outline-selected', 'outline-tr-coral')
    }, 2000)
    return () => window.clearTimeout(t)
  }, [focusSceneId, project])

  const mergeNewFlags = useCallback((newFlags: ConsistencyFlag[]) => {
    if (newFlags.length === 0) return
    setOpenFlags((prev) => {
      const byId = new Map(prev.map((f) => [f.id, f]))
      for (const flag of newFlags) byId.set(flag.id, flag)
      return [...byId.values()]
    })
  }, [])

  const patcher = useProjectPatch(
    activeProjectId,
    project,
    setProject,
    mergeNewFlags,
  )

  const flaggedSceneIds = useMemo(
    () =>
      project ? sceneIdsWithOpenFlags(openFlags, project) : new Set<string>(),
    [openFlags, project],
  )

  function toggleActCollapse(act: number) {
    setCollapsedActs((prev) => {
      const next = new Set(prev)
      if (next.has(act)) next.delete(act)
      else next.add(act)
      return next
    })
  }

  function handleReorder(draggedId: string, targetId: string) {
    if (!project) return
    const ops = buildSceneSwapPatch(project, draggedId, targetId)
    if (!ops) return
    void patcher.patch(ops, swapScenesLocally(project, draggedId, targetId))
  }

  function handleToggleSceneLock(sceneId: string, locked: boolean) {
    if (!project) return
    const ops = buildScenePatch(project, sceneId, 'locked', locked)
    if (!ops) return
    void patcher.patch(ops, withSceneField(project, sceneId, 'locked', locked))
  }

  function handleToggleBeatScriptLock(
    sceneId: string,
    beatId: string,
    scriptLocked: boolean,
  ) {
    if (!project) return
    const ops = buildBeatPatch(
      project,
      sceneId,
      beatId,
      'scriptLocked',
      scriptLocked,
    )
    if (!ops) return
    void patcher.patch(
      ops,
      withBeatField(project, sceneId, beatId, 'scriptLocked', scriptLocked),
    )
  }

  function handleSaveSceneField(sceneId: string, field: string, value: string) {
    if (!project) return
    const ops = buildScenePatch(project, sceneId, field, value)
    if (!ops) return
    void patcher.patch(
      ops,
      withSceneField(project, sceneId, field as never, value),
    )
  }

  function handleSaveBeatField(
    sceneId: string,
    beatId: string,
    field: string,
    value: string,
  ) {
    if (!project) return
    const ops = buildBeatPatch(project, sceneId, beatId, field, value)
    if (!ops) return
    void patcher.patch(
      ops,
      withBeatField(project, sceneId, beatId, field as never, value),
    )
  }

  function handleSaveProjectField(field: string, value: string) {
    if (!project) return
    void patcher.patch(
      buildProjectFieldPatch(field, value),
      withProjectField(project, field as never, value),
    )
  }

  function handleSaveEpisodeField(
    episodeId: string,
    field: string,
    value: string,
  ) {
    if (!project) return
    const ops = buildEpisodePatch(project, episodeId, field, value)
    if (!ops) return
    void patcher.patch(
      ops,
      withEpisodeField(project, episodeId, field as never, value),
    )
  }

  async function handleOpenReview(targetObjectId: string, instruction: string) {
    setOpeningReview(true)
    setReviewError(null)
    try {
      const changeSet = await createChangeSet(activeProjectId, {
        targetObjectId,
        instruction,
      })
      stashChangeSet(changeSet)
      navigateToReview(activeProjectId, changeSet.id)
    } catch (err: unknown) {
      setReviewError(
        err instanceof Error ? err.message : 'failed to open Review',
      )
      setOpeningReview(false)
    }
  }

  if (loadError) {
    return (
      <AppShell
        projectTitle="Table Read"
        activeMode="Plan"
        ledgerCount={0}
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-danger">
          Couldn&apos;t load this project: {loadError}
        </p>
      </AppShell>
    )
  }

  if (!projectId) return null

  if (!project) {
    return (
      <AppShell
        projectTitle="Table Read"
        activeMode="Plan"
        ledgerCount={0}
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-text-secondary">Loading…</p>
      </AppShell>
    )
  }

  // MVP: exactly one season, one episode (data contract §1).
  const episode = project.seasons[0]?.episodes[0]
  if (!episode) {
    return (
      <AppShell
        projectTitle={project.title}
        activeMode="Plan"
        ledgerCount={ledger.filter((f) => f.status === 'pending_review').length}
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-text-secondary">
          This project has no episode yet.
        </p>
      </AppShell>
    )
  }

  return (
    <AppShell
      projectTitle={project.title}
      activeMode="Plan"
      ledgerCount={ledger.filter((f) => f.status === 'pending_review').length}
      projectId={projectId}
    >
      {reviewError && (
        <p className="px-6 pt-3 text-13 text-tr-danger" role="alert">
          {reviewError}
        </p>
      )}
      {patcher.error && (
        <Toast tone="danger" onDismiss={patcher.dismissError}>
          {patcher.error.code === 'LOCKED_OBJECT'
            ? lockedObjectMessage
            : patcher.error.code === 'CONFLICT_STALE_HEAD'
              ? staleHeadMessage
              : patcher.error.message}
        </Toast>
      )}
      <div className="flex">
        <StoryLayersPanel
          project={project}
          episode={episode}
          selection={effectiveSelection}
          collapsedActs={collapsedActs}
          onSelectNothing={() => setSelection(null)}
          onSelectScene={(sceneId) => setSelection({ type: 'scene', sceneId })}
          onToggleActCollapse={toggleActCollapse}
        />
        <Board
          project={project}
          episode={episode}
          selection={effectiveSelection}
          collapsedActs={collapsedActs}
          pending={patcher.pending}
          flaggedSceneIds={flaggedSceneIds}
          onSelectScene={(sceneId) => setSelection({ type: 'scene', sceneId })}
          onSelectBeat={(sceneId, beatId) =>
            setSelection({ type: 'beat', sceneId, beatId })
          }
          onReorder={handleReorder}
        />
        <Inspector
          project={project}
          episode={episode}
          ledger={ledger}
          selection={effectiveSelection}
          pending={patcher.pending}
          openingReview={openingReview}
          onToggleSceneLock={handleToggleSceneLock}
          onToggleBeatScriptLock={handleToggleBeatScriptLock}
          onSaveSceneField={handleSaveSceneField}
          onSaveBeatField={handleSaveBeatField}
          onSaveProjectField={handleSaveProjectField}
          onSaveEpisodeField={handleSaveEpisodeField}
          onOpenReview={(targetObjectId, instruction) =>
            void handleOpenReview(targetObjectId, instruction)
          }
        />
      </div>
    </AppShell>
  )
}
