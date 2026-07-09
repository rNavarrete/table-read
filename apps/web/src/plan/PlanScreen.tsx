import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConsistencyFlag, LedgerFact, Project } from 'contract'
import {
  createChangeSet,
  getConsistencyFlags,
  getLedger,
  getProject,
} from '../api/client'
import { navigateToReview, stashChangeSet } from '../review/changeSetSession'
import { AppShell } from '../shell/AppShell'
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

// Same URL-param convention as write/WriteScreen.tsx (no router yet, no
// project picker built anywhere in the app): `?project=<id>`, defaulting to
// the seeded fixture.
const DEFAULT_PROJECT_ID = 'proj-longpour'

function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

export function PlanScreen() {
  const projectId = useUrlParam('project') ?? DEFAULT_PROJECT_ID
  const focusSceneId = useUrlParam('scene')

  const [project, setProject] = useState<Project | null>(null)
  const [ledger, setLedger] = useState<LedgerFact[]>([])
  const [openFlags, setOpenFlags] = useState<ConsistencyFlag[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState<PlanSelection>(
    focusSceneId ? { type: 'scene', sceneId: focusSceneId } : null,
  )
  const [collapsedActs, setCollapsedActs] = useState<Set<number>>(new Set())
  const [openingReview, setOpeningReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  useEffect(() => {
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

  const patcher = useProjectPatch(projectId, project, setProject, mergeNewFlags)

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
      const changeSet = await createChangeSet(projectId, {
        targetObjectId,
        instruction,
      })
      stashChangeSet(changeSet)
      navigateToReview(projectId, changeSet.id)
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
      <div className="flex">
        <StoryLayersPanel
          project={project}
          episode={episode}
          selection={selection}
          collapsedActs={collapsedActs}
          onSelectNothing={() => setSelection(null)}
          onSelectScene={(sceneId) => setSelection({ type: 'scene', sceneId })}
          onToggleActCollapse={toggleActCollapse}
        />
        <Board
          project={project}
          episode={episode}
          selection={selection}
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
          selection={selection}
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
