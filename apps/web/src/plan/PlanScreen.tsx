import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Beat,
  ConsistencyFlag,
  LedgerFact,
  Project,
  Scene,
} from 'contract'
import {
  createChangeSet,
  getConsistencyFlags,
  getLedger,
  getProject,
  suggestInstructions,
} from '../api/client'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { navigateToReview, stashChangeSet } from '../review/changeSetSession'
import { AppShell } from '../shell/AppShell'
import {
  navigateToMode,
  navigateToWriteBeat,
  navigateToWriteScene,
} from '../shell/modeNavigation'
import { Toast } from '../shell/Toast'
import { lockedObjectMessage, staleHeadMessage } from '../shell/toastCopy'
import { Board } from './Board'
import { GuidedSetup } from './GuidedSetup'
import { needsGuidedSetup } from './needsGuidedSetup'
import { EpisodePanel } from './panel/EpisodePanel'
import { ScenePanel } from './panel/ScenePanel'
import { PlanDraftsContext, usePlanDraftStore } from './panel/usePlanDrafts'
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
  const [skippedGuidedSetup, setSkippedGuidedSetup] = useState(false)
  const [ledger, setLedger] = useState<LedgerFact[]>([])
  const [openFlags, setOpenFlags] = useState<ConsistencyFlag[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState<PlanSelection | undefined>(
    focusSceneId ? { type: 'scene', sceneId: focusSceneId } : undefined,
  )
  const [collapsedActs, setCollapsedActs] = useState<Set<number>>(new Set())
  const [openingReview, setOpeningReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  // One draft per field for the whole screen (spec §4.9): survives scene
  // switches and failed saves. In memory only.
  const drafts = usePlanDraftStore()

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
    if (!projectId || !project) return
    const sceneId = effectiveSelection?.sceneId
    saveResume(projectId, { mode: 'Plan', sceneId })
  }, [effectiveSelection, project, projectId])

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

  // Every Plan save and lock flip is one direct-edit PATCH and one snapshot
  // (rule 4). Each resolves `true` only when the server accepted it, so a
  // field drops its draft only then.
  function saveSceneField<K extends keyof Scene>(
    sceneId: string,
    field: K,
    value: Scene[K],
  ): Promise<boolean> {
    if (!project) return Promise.resolve(false)
    const ops = buildScenePatch(project, sceneId, field, value)
    if (!ops) return Promise.resolve(false)
    return patcher.patch(ops, withSceneField(project, sceneId, field, value))
  }

  function saveBeatField<K extends keyof Beat>(
    sceneId: string,
    beatId: string,
    field: K,
    value: Beat[K],
  ): Promise<boolean> {
    if (!project) return Promise.resolve(false)
    const ops = buildBeatPatch(project, sceneId, beatId, field, value)
    if (!ops) return Promise.resolve(false)
    return patcher.patch(
      ops,
      withBeatField(project, sceneId, beatId, field, value),
    )
  }

  function saveEpisodePremise(
    episodeId: string,
    value: string,
  ): Promise<boolean> {
    if (!project) return Promise.resolve(false)
    const ops = buildEpisodePatch(project, episodeId, 'premise', value)
    if (!ops) return Promise.resolve(false)
    return patcher.patch(
      ops,
      withEpisodeField(project, episodeId, 'premise', value),
    )
  }

  function saveSeriesPremise(value: string): Promise<boolean> {
    if (!project) return Promise.resolve(false)
    return patcher.patch(
      buildProjectFieldPatch('premise', value),
      withProjectField(project, 'premise', value),
    )
  }

  function openInWrite(sceneId: string, beatId?: string) {
    saveResume(activeProjectId, { mode: 'Write', sceneId })
    if (beatId) navigateToWriteBeat(sceneId, beatId)
    else navigateToWriteScene(sceneId)
  }

  /** Ledger deep link to one fact (moved from the old inspector's
   * AffectedFacts; T3.4 swaps it for navigateToLedgerFact). */
  function openFact(factId: string) {
    const url = new URL(window.location.href)
    url.pathname = '/ledger'
    url.searchParams.set('fact', factId)
    window.location.assign(url.toString())
  }

  /** A4 chips for an empty What happens — only on the writer's explicit
   * Suggest… click (rule 8, owner decision 5), never on focus. */
  function suggest(sceneId: string): Promise<string[]> {
    return suggestInstructions(activeProjectId, {
      context: 'scene',
      targetId: sceneId,
      surface: 'scene_premise',
      draftScript: null,
    }).then((result) => result.suggestions)
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
        projectId={projectId ?? undefined}
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

  // Guided Plan setup (design spec §6/§9.4): shown while the project has no
  // usable scene skeleton (no season/episode yet, or an episode with no
  // scene containing a beat) — before the (otherwise empty) board. Skip is
  // local only: the writer can leave and build by hand without a server write.
  if (needsGuidedSetup(project) && !skippedGuidedSetup) {
    const characters = project.seriesBible.characters.map((c) => ({
      id: c.id,
      name: c.name,
    }))
    return (
      <AppShell
        projectTitle={project.title}
        activeMode="Plan"
        ledgerCount={ledger.filter((f) => f.status === 'pending_review').length}
        projectId={projectId}
      >
        <GuidedSetup
          projectId={activeProjectId}
          premise={project.premise}
          theme={project.seriesBible.existentialQuestion.text}
          characters={characters}
          onSkip={() => setSkippedGuidedSetup(true)}
        />
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

  const selectScene = (sceneId: string) =>
    setSelection({ type: 'scene', sceneId })
  // A stale ?scene= id resolves to no scene: show the episode view.
  const selectedScene = effectiveSelection
    ? findScene(project, effectiveSelection.sceneId)
    : null

  return (
    <PlanDraftsContext.Provider value={drafts}>
      <AppShell
        projectTitle={project.title}
        activeMode="Plan"
        ledgerCount={ledger.filter((f) => f.status === 'pending_review').length}
        projectId={projectId}
      >
        {/* Fills the shell's main (whatever renders above it, e.g. the demo
            banner); the board and both panels scroll on their own. */}
        <div className="flex h-full flex-col">
          {reviewError && (
            <Toast tone="danger" onDismiss={() => setReviewError(null)}>
              {reviewError}
            </Toast>
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
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <StoryLayersPanel
              project={project}
              episode={episode}
              selection={effectiveSelection}
              collapsedActs={collapsedActs}
              onSelectNothing={() => setSelection(null)}
              onSelectScene={selectScene}
              onToggleActCollapse={toggleActCollapse}
            />
            <Board
              project={project}
              episode={episode}
              selection={effectiveSelection}
              collapsedActs={collapsedActs}
              pending={patcher.pending}
              flaggedSceneIds={flaggedSceneIds}
              onSelectScene={selectScene}
              onOpenInWrite={(sceneId) => openInWrite(sceneId)}
              onReorder={handleReorder}
            />
            {selectedScene ? (
              <ScenePanel
                project={project}
                episode={episode}
                scene={selectedScene}
                selectedBeatId={
                  effectiveSelection?.type === 'beat'
                    ? effectiveSelection.beatId
                    : null
                }
                ledger={ledger}
                flags={openFlags}
                pending={patcher.pending}
                openingReview={openingReview}
                onBack={() => setSelection(null)}
                onSelectScene={selectScene}
                onSelectBeat={(sceneId, beatId) =>
                  setSelection(
                    beatId
                      ? { type: 'beat', sceneId, beatId }
                      : { type: 'scene', sceneId },
                  )
                }
                onToggleSceneLock={(sceneId, locked) =>
                  void saveSceneField(sceneId, 'locked', locked)
                }
                onToggleBeatLock={(sceneId, beatId, locked) =>
                  void saveBeatField(sceneId, beatId, 'locked', locked)
                }
                onToggleBeatScriptLock={(sceneId, beatId, scriptLocked) =>
                  void saveBeatField(
                    sceneId,
                    beatId,
                    'scriptLocked',
                    scriptLocked,
                  )
                }
                onSaveSceneField={saveSceneField}
                onSaveBeatField={(sceneId, beatId, field, value) =>
                  saveBeatField(sceneId, beatId, field, value)
                }
                onOpenReview={(sceneId, instruction) =>
                  void handleOpenReview(sceneId, instruction)
                }
                onSuggest={suggest}
                onOpenInWrite={(sceneId) => openInWrite(sceneId)}
                onOpenBeatInWrite={openInWrite}
                onOpenFact={openFact}
                onOpenLedger={() => navigateToMode('Ledger')}
              />
            ) : (
              <EpisodePanel
                project={project}
                episode={episode}
                pending={patcher.pending}
                openingReview={openingReview}
                onSaveEpisodePremise={(value) =>
                  saveEpisodePremise(episode.id, value)
                }
                onSaveSeriesPremise={saveSeriesPremise}
              />
            )}
          </div>
        </div>
      </AppShell>
    </PlanDraftsContext.Provider>
  )
}
