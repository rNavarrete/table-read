import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { saveLedgerView } from '../ledger/viewPreference'
import { plural } from '../projects/wizard/board/boardText'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { navigateToReview, stashChangeSet } from '../review/changeSetSession'
import { AppShell } from '../shell/AppShell'
import {
  navigateToLedgerFact,
  navigateToMode,
  navigateToWriteBeat,
  navigateToWriteScene,
} from '../shell/modeNavigation'
import { Toast } from '../shell/Toast'
import { lockedObjectMessage, staleHeadMessage } from '../shell/toastCopy'
import { Board, type PlanSelection } from './Board'
import { EpisodeChart } from './EpisodeChart'
import { GuidedSetup } from './GuidedSetup'
import { HighlightBar } from './HighlightBar'
import { needsGuidedSetup } from './needsGuidedSetup'
import { EpisodeView } from './panel/EpisodeView'
import { LeavePlanDialog } from './panel/LeavePlanDialog'
import { NotesStrip } from './panel/NotesStrip'
import { ScenePanel } from './panel/ScenePanel'
import { useDismissNote } from './panel/useDismissNote'
import { useLeaveGuard } from './panel/useLeaveGuard'
import {
  draftKey,
  PlanDraftsContext,
  usePlanDraftStore,
} from './panel/usePlanDrafts'
import {
  applySceneMove,
  buildBeatPatch,
  buildEpisodePatch,
  buildProjectFieldPatch,
  buildScenePatch,
  withBeatField,
  withEpisodeField,
  withProjectField,
  withSceneField,
  type SceneMove,
} from './planTree'
import {
  boardModel,
  highlightAnnouncement,
  NO_HIGHLIGHT,
  nextMatchId,
  notesForScene,
  predictMove,
  selectionAnnouncement,
  type Highlight,
} from './story'
import { useCollapsedActs } from './useCollapsedActs'
import { usePlanKeys } from './usePlanKeys'
import { useProjectPatch } from './useProjectPatch'
import { useUndoMove } from './useUndoMove'
import { allScenes, findScene } from '../write/projectTree'

const NO_IDS: ReadonlySet<string> = new Set()

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
  const acts = useCollapsedActs(activeProjectId)
  const expandAct = acts.expand
  // Highlight and Fold the rest last for the visit (plan defaults 5).
  const [highlight, setHighlight] = useState<Highlight>(NO_HIGHLIGHT)
  const [fold, setFold] = useState(false)
  // Scenes opened from fold stubs; cleared on every highlight or fold change.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
  const [openingReview, setOpeningReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  // The board's live region (plan-live): empty until the writer selects.
  const [live, setLive] = useState('')
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
        // A deep link into a collapsed act opens it in the same render, so
        // the deep-link effect below finds the card.
        const linked = focusSceneId
          ? findScene(loadedProject, focusSceneId)
          : null
        if (linked) expandAct(linked.act)
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
  }, [projectId, focusSceneId, expandAct])

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
  const dismissal = useDismissNote({
    projectId: activeProjectId,
    headSnapshotId: project?.headSnapshotId ?? null,
    onProject: setProject,
    onFlags: setOpenFlags,
  })
  const undoMove = useUndoMove({
    projectId: activeProjectId,
    headSnapshotId: project?.headSnapshotId ?? null,
    onProject: setProject,
  })
  const leave = useLeaveGuard(drafts)
  // One "a write is in flight" flag for every control: a field save, a lock,
  // a move or its undo, a dismiss or its undo, and an Open Review (no draft
  // may appear while it runs, or it would block the way to Review).
  const busy =
    patcher.pending || dismissal.busy || undoMove.busy || openingReview
  // Dismiss and its Undo unmount the focused button (the note, the strip,
  // the toast): once they finish, focus goes to the strip's Show/Hide, else
  // the toast's Undo — never <body>.
  const refocusNotes = useRef(false)
  const undoDismissRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (dismissal.busy || !refocusNotes.current) return
    refocusNotes.current = false
    if (document.activeElement && document.activeElement !== document.body)
      return
    const toggle = document.querySelector<HTMLElement>(
      '#plan-section-notes button[aria-expanded]',
    )
    ;(toggle ?? undoDismissRef.current)?.focus()
  }, [dismissal.busy])

  // MVP: exactly one season, one episode (data contract §1).
  const episode = project?.seasons[0]?.episodes[0]
  const model = useMemo(
    () => (project && episode ? boardModel(project, episode, openFlags) : null),
    [project, episode, openFlags],
  )
  // Keys and their handlers act only while the board is on screen (not on
  // Loading, an error or guided setup).
  const board =
    project && !(needsGuidedSetup(project) && !skippedGuidedSetup)
      ? model
      : null
  const selectedId = effectiveSelection?.sceneId ?? null

  const announce = (message: string) => setLive(message)
  const cardEl = (sceneId: string) =>
    document.querySelector<HTMLElement>(`[data-testid="scene-card-${sceneId}"]`)
  // Selecting a scene inside a collapsed act opens it (and saves that).
  const selectScene = (sceneId: string) => {
    const signals = model?.signals.get(sceneId)
    const focused = document.activeElement
    // The Episode view unmounts under the control that chose the scene.
    const fromEpisode =
      !model?.signals.has(selectedId ?? '') &&
      focused?.closest('[data-testid="inspector"]')
    if (signals) acts.expand(signals.scene.act)
    setSelection({ type: 'scene', sceneId })
    // A focused card already speaks its scene (its name has the same words).
    if (signals && !focused?.closest('[data-scene-card]'))
      announce(
        selectionAnnouncement(
          signals,
          signals.scene.locked || !!episode?.locked,
        ),
      )
    if (fromEpisode)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[data-testid="inspector"] h2')
          ?.focus(),
      )
  }
  /** Select by keyboard and bring the card into view; a card that had focus
   * hands it to the new card. */
  const selectFromKeys = (sceneId: string) => {
    const fromCard = document.activeElement?.closest('[data-scene-card]')
    selectScene(sceneId)
    requestAnimationFrame(() => {
      const card = cardEl(sceneId)
      card?.scrollIntoView({ block: 'nearest' })
      if (fromCard) card?.focus()
    })
  }
  function changeHighlight(next: Highlight) {
    if (!board) return
    setHighlight(next)
    setUnfolded(new Set())
    announce(highlightAnnouncement(board, next))
  }
  function toggleFold() {
    if (!board) return
    setFold(!fold)
    setUnfolded(new Set())
    announce(fold ? 'Unfolded.' : "Folded the scenes that don't match.")
  }
  function next(dir: 1 | -1) {
    if (!board) return
    const id = nextMatchId(board, selectedId, dir, highlight)
    if (id) selectFromKeys(id)
    else
      announce(
        highlight.kind === 'none'
          ? 'No story notes left.'
          : 'Nothing else matches.',
      )
  }
  function step(dir: 1 | -1) {
    if (!board?.order.length) return
    const { order } = board
    const at = order.findIndex((s) => s.id === selectedId)
    const to =
      at < 0
        ? dir === 1
          ? 0
          : order.length - 1
        : Math.min(Math.max(at + dir, 0), order.length - 1)
    selectFromKeys(order[to].id)
  }
  function showEpisode() {
    if (!board) return
    const fromPanel = document.activeElement?.closest(
      '[data-testid="inspector"]',
    )
    const fromCard = document.activeElement?.closest('[data-scene-card]')
    setSelection(null)
    announce('Episode view')
    if (fromPanel)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[data-testid="inspector"] h2')
          ?.focus(),
      )
    // Under Fold the rest the deselected card can fold away: keep focus on
    // the board.
    if (fromCard)
      requestAnimationFrame(() => {
        if (!fromCard.isConnected)
          document
            .querySelector<HTMLElement>('[data-scene-card][tabindex="0"]')
            ?.focus()
      })
  }
  usePlanKeys({
    onStep: step,
    onNext: next,
    onEpisodeView: showEpisode,
    onOpenInWrite: () => {
      if (board && selectedId && board.signals.has(selectedId))
        openInWrite(selectedId)
    },
  })

  /** A chart block selects its scene and brings the card into view; focus
   * stays where it was. */
  const selectFromChart = (sceneId: string) => {
    selectScene(sceneId)
    requestAnimationFrame(() =>
      cardEl(sceneId)?.scrollIntoView({ block: 'nearest' }),
    )
  }

  /** A swap or an act change: one PATCH, one snapshot (rule 4). The problems
   * it adds show at once from the optimistic doc; Undo the move is offered
   * once the server has made this move the head. */
  function applyMove(move: SceneMove): Promise<boolean> {
    if (!project) return Promise.resolve(false)
    const applied = applySceneMove(project, move)
    if (!applied) return Promise.resolve(false)
    const fresh = predictMove(project, move)
    undoMove.setMove({ issueIds: fresh.map((i) => i.id), head: null })
    if (fresh.length)
      announce(`Moved. ${plural(fresh.length, 'new order problem')}.`)
    return patcher
      .patch(applied.ops, applied.next, (saved) =>
        undoMove.setMove((m) => m && { ...m, head: saved.headSnapshotId }),
      )
      .then((ok) => {
        if (!ok) undoMove.setMove(null)
        return ok
      })
  }

  /** Undo the move unmounts its own button (the note clears): focus goes to
   * the strip's Show/Hide, else the panel heading. */
  function undoTheMove() {
    void undoMove.undo().then((ok) => {
      if (!ok) return
      announce('Move undone.')
      requestAnimationFrame(() =>
        (
          document.querySelector<HTMLElement>(
            '#plan-section-notes button[aria-expanded]',
          ) ??
          document.querySelector<HTMLElement>('[data-testid="inspector"] h2')
        )?.focus(),
      )
    })
  }

  // Every Plan save and lock flip is one direct-edit PATCH and one snapshot
  // (rule 4). Each resolves `true` only when the server accepted it, so a
  // field drops its draft only then.
  function saveSceneField<K extends keyof Scene>(
    sceneId: string,
    field: K,
    value: Scene[K],
  ): Promise<boolean> {
    if (field === 'act')
      return applyMove({ type: 'act', sceneId, act: Number(value) })
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

  // Ask before saving the Write resume point, so "Stay in Plan" leaves
  // Plan's resume untouched; the navigation then passes the (now empty) guard.
  function openInWrite(sceneId: string, beatId?: string) {
    void leave.confirmLeave().then((ok) => {
      if (!ok) return
      saveResume(activeProjectId, { mode: 'Write', sceneId })
      if (beatId) navigateToWriteBeat(sceneId, beatId)
      else navigateToWriteScene(sceneId)
    })
  }

  // Same order as openInWrite: ask, then save the Ledger view, then go
  // (navigateToMode passes the now-empty guard).
  function openLedgerThreads() {
    void leave.confirmLeave().then((ok) => {
      if (!ok) return
      saveLedgerView(activeProjectId, 'threads')
      navigateToMode('Ledger')
    })
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
    // The field being sent travels in the Change Set; any other draft would
    // be lost on the way to Review, so ask first.
    const key = draftKey(targetObjectId, 'whatHappens')
    const others = drafts.size - (drafts.get(key) !== undefined ? 1 : 0)
    if (others > 0) {
      if (!(await leave.confirmLeave())) return
      // Discard cleared it too: keep the text being sent on screen.
      drafts.set(key, targetObjectId, instruction)
    }
    setOpeningReview(true)
    setReviewError(null)
    try {
      const changeSet = await createChangeSet(activeProjectId, {
        targetObjectId,
        instruction,
      })
      stashChangeSet(changeSet)
      // Its text now lives in the Change Set: clear it so beforeunload does
      // not stop the navigation.
      drafts.clear(key)
      navigateToReview(activeProjectId, changeSet.id)
    } catch (err: unknown) {
      // Nothing left Plan: give back what "Discard and leave" cleared.
      leave.undoDiscard()
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

  if (!episode || !model) {
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

  // A stale ?scene= id resolves to no scene: show the episode view.
  const selectedScene = effectiveSelection
    ? findScene(project, effectiveSelection.sceneId)
    : null
  const sceneNotes = selectedScene
    ? notesForScene(openFlags, selectedScene)
    : []
  const orderNotes = selectedScene
    ? (model.signals.get(selectedScene.id)?.orderNotes ?? [])
    : []
  // The last move's new problems on this scene open the strip: the key
  // remounts it open (and again on a return while that move is the last).
  const fresh = undoMove.move?.issueIds ?? []
  const freshHere = orderNotes
    .filter((n) => fresh.includes(n.issue.id))
    .map((n) => n.issue.id)

  return (
    <PlanDraftsContext.Provider value={drafts}>
      <AppShell
        projectTitle={project.title}
        activeMode="Plan"
        ledgerCount={ledger.filter((f) => f.status === 'pending_review').length}
        projectId={projectId}
        // The shell's Undo sends no If-Match: hold it while a Plan write is
        // in flight, or it could revert that write's predecessor.
        canUndo={!busy}
        runHistoryChange={(request) =>
          leave.confirmLeave().then((ok) =>
            ok
              ? request().then(
                  () => true,
                  (err: unknown) => {
                    leave.undoDiscard()
                    throw err
                  },
                )
              : false,
          )
        }
      >
        {/* Fills the shell's main (whatever renders above it, e.g. the demo
            banner); the board and the panel scroll on their own. */}
        <div className="flex h-full flex-col">
          <p
            role="status"
            aria-live="polite"
            data-testid="plan-live"
            className="sr-only"
          >
            {live}
          </p>
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
          {dismissal.error && (
            <Toast tone="danger" onDismiss={dismissal.clearError}>
              {dismissal.error}
            </Toast>
          )}
          {undoMove.error && (
            <Toast tone="danger" onDismiss={undoMove.clearError}>
              {undoMove.error}
            </Toast>
          )}
          {dismissal.undoable && !dismissal.error && !patcher.error && (
            <Toast onDismiss={dismissal.clearUndo}>
              Note dismissed.{' '}
              <button
                ref={undoDismissRef}
                type="button"
                disabled={busy}
                onClick={() => {
                  refocusNotes.current = true
                  void dismissal.undo()
                }}
                className="font-medium text-tr-sky underline disabled:opacity-50"
              >
                Undo
              </button>
            </Toast>
          )}
          <LeavePlanDialog {...leave.dialog} />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Board
              model={model}
              episodeLocked={episode.locked}
              selection={effectiveSelection}
              collapsedActs={acts.collapsed}
              pending={busy}
              draftSceneIds={drafts.dirtySceneIds}
              onSelectScene={selectScene}
              onOpenInWrite={(sceneId) => openInWrite(sceneId)}
              onReorder={(sceneId, targetSceneId) =>
                void applyMove({ type: 'swap', sceneId, targetSceneId })
              }
              onMoveToAct={(sceneId, act) =>
                void saveSceneField(sceneId, 'act', act)
              }
              onToggleAct={acts.toggle}
              onEnterPanel={() =>
                document
                  .querySelector<HTMLElement>('[data-testid="inspector"] h2')
                  ?.focus()
              }
              predict={(move) => predictMove(project, move)}
              header={
                <>
                  <HighlightBar
                    model={model}
                    highlight={highlight}
                    fold={fold}
                    onHighlight={changeHighlight}
                    onToggleFold={toggleFold}
                    onNext={() => next(1)}
                  />
                  <EpisodeChart
                    model={model}
                    selectedId={selectedId}
                    highlight={highlight}
                    draftSceneIds={drafts.dirtySceneIds}
                    episodeLocked={episode.locked}
                    onSelectScene={selectFromChart}
                  />
                </>
              }
              highlight={highlight}
              fold={fold}
              unfolded={unfolded}
              onUnfold={(ids) =>
                setUnfolded((prev) => new Set([...prev, ...ids]))
              }
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
                pending={busy}
                openingReview={openingReview}
                onBack={showEpisode}
                onEscape={() => {
                  // Its act may be collapsed: open it to reach the card.
                  acts.expand(selectedScene.act)
                  requestAnimationFrame(() => cardEl(selectedScene.id)?.focus())
                }}
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
                onOpenFact={navigateToLedgerFact}
                noteCount={sceneNotes.length + orderNotes.length}
                notes={(showBeat) => (
                  <NotesStrip
                    key={`${selectedScene.id}:${freshHere.join(' ')}`}
                    defaultExpanded={freshHere.length > 0}
                    scene={selectedScene}
                    notes={sceneNotes}
                    orderNotes={orderNotes}
                    undoableIssueIds={
                      undoMove.undoable ? new Set(fresh) : NO_IDS
                    }
                    onUndoMove={undoTheMove}
                    scenes={episode.scenes}
                    ledger={ledger}
                    busy={busy}
                    actLocked={episode.locked || selectedScene.locked || busy}
                    onSelectScene={selectScene}
                    onShowBeat={showBeat}
                    onOpenInWrite={(beatId) =>
                      openInWrite(selectedScene.id, beatId ?? undefined)
                    }
                    onOpenFact={navigateToLedgerFact}
                    onDismiss={(flagId) => {
                      refocusNotes.current = true
                      void dismissal.dismiss(flagId)
                    }}
                    onChangeAct={() => {
                      // Centred, or focus would scroll it under the sticky
                      // panel header.
                      const select = document.getElementById('plan-act-select')
                      select?.scrollIntoView({ block: 'center' })
                      select?.focus({ preventScroll: true })
                    }}
                  />
                )}
                onOpenLedger={() => navigateToMode('Ledger')}
              />
            ) : (
              <EpisodeView
                project={project}
                episode={episode}
                model={model}
                pending={busy}
                openingReview={openingReview}
                onSelectScene={selectScene}
                onHighlight={changeHighlight}
                onOpenLedgerThreads={openLedgerThreads}
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
