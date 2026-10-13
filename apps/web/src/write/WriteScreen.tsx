import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BeatCandidate, CraftLevel, Scene } from 'contract'
import { getLedger, getProject, patchProject } from '../api/client'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { AppShell } from '../shell/AppShell'
import { Toast } from '../shell/Toast'
import { llmUnavailableMessage } from '../shell/toastCopy'
import { CandidateDock } from './CandidateDock'
import { CommandBar, type CommandBarHandle } from './CommandBar'
import { SceneOutline } from './SceneOutline'
import { ScriptCanvas } from './ScriptCanvas'
import { useAcceptBeat } from './useAcceptBeat'
import { useCandidateSession } from './useCandidateSession'
import { useQuietAi } from './useQuietAi'
import { useWriteKeyboard } from './useWriteKeyboard'
import { useWriteQueue } from './useWriteQueue'
import { allScenes, findScene, pickDefaultScene } from './projectTree'
import { isEditingInScrollport, pickTopIntersectingSceneId } from './scrollSpy'
function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

function replaceSceneQuery(sceneId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('scene', sceneId)
  window.history.replaceState({}, '', `${url.pathname}${url.search}`)
}

export function WriteScreen() {
  const projectId = requireProjectId()
  const requestedSceneId = useUrlParam('scene')
  const highlightBeatId = useUrlParam('highlightBeat')
  const activeProjectId = projectId ?? ''

  // Project state + the one serial queue for Write's head-CAS mutations
  // (autosave, Accept, craft default) — see useWriteQueue.ts.
  const queue = useWriteQueue(activeProjectId)
  const { project, setProject } = queue
  const [ledgerCount, setLedgerCount] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [focusedCard, setFocusedCard] = useState(0)
  const [craftLevel, setCraftLevel] = useState<CraftLevel>('standard')
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const commandBarRef = useRef<CommandBarHandle>(null)
  const scrollportRef = useRef<HTMLDivElement>(null)
  const suppressSpyUntilRef = useRef(0)
  const activeSceneIdRef = useRef<string | null>(null)
  /** After `?scene=` / resume land, scroll once the episode canvas mounts. */
  const pendingScrollSceneIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([getProject(projectId), getLedger(projectId)])
      .then(([loadedProject, ledger]) => {
        if (cancelled) return
        setProject(loadedProject)
        setCraftLevel(loadedProject.defaultCraftLevel ?? 'standard')
        setLedgerCount(
          ledger.filter((f) => f.status === 'pending_review').length,
        )
        const scenes = allScenes(loadedProject)
        const resume = loadResume(
          projectId,
          scenes.map((s) => s.id),
        )
        const preferredId = requestedSceneId ?? resume.sceneId
        const initial = pickDefaultScene(loadedProject, preferredId)
        if (initial) {
          setActiveSceneId(initial.id)
          // Deep link / Plan jump: keep spy quiet until we scroll the target
          // into view — otherwise the topmost scene steals active.
          if (preferredId && findScene(loadedProject, preferredId)) {
            pendingScrollSceneIdRef.current = preferredId
            suppressSpyUntilRef.current = Date.now() + 2000
          }
        }
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
  }, [projectId, requestedSceneId, setProject])

  const scenes: Scene[] = project ? allScenes(project) : []
  const lockedEpisodeSceneIds = new Set(
    (project?.seasons ?? [])
      .flatMap((season) => season.episodes)
      .filter((episode) => episode.locked)
      .flatMap((episode) => episode.scenes.map((scene) => scene.id)),
  )
  const activeScene =
    activeSceneId && project ? findScene(project, activeSceneId) : null

  useEffect(() => {
    activeSceneIdRef.current = activeSceneId
  }, [activeSceneId])

  // Changing the active scene saves any pending edit right away.
  const { flush } = queue
  useEffect(() => {
    void flush()
  }, [activeSceneId, flush])

  useEffect(() => {
    if (projectId && activeSceneId) {
      saveResume(projectId, { mode: 'Write', sceneId: activeSceneId })
    }
  }, [projectId, activeSceneId])

  const selectScene = useCallback(
    (sceneId: string, { scroll = true }: { scroll?: boolean } = {}) => {
      activeSceneIdRef.current = sceneId
      setActiveSceneId(sceneId)
      replaceSceneQuery(sceneId)
      if (scroll) {
        suppressSpyUntilRef.current = Date.now() + 1500
        requestAnimationFrame(() => {
          const el = document.querySelector(
            `[data-testid="write-scene-${sceneId}"]`,
          )
          if (el instanceof HTMLElement) {
            el.scrollIntoView({ block: 'start' })
          }
        })
      }
    },
    [],
  )

  // Scroll the deep-linked / resume scene into view once sections exist.
  useEffect(() => {
    const sceneId = pendingScrollSceneIdRef.current
    if (!sceneId || scenes.length === 0) return
    const el = document.querySelector(`[data-testid="write-scene-${sceneId}"]`)
    if (!(el instanceof HTMLElement)) return
    pendingScrollSceneIdRef.current = null
    suppressSpyUntilRef.current = Date.now() + 1500
    setActiveSceneId(sceneId)
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'start' })
      const outlineRow = document.querySelector(
        `[data-testid="write-outline-${sceneId}"]`,
      )
      if (outlineRow instanceof HTMLElement) {
        outlineRow.scrollIntoView({ block: 'nearest' })
      }
    })
  }, [scenes, project?.id])

  // Scroll spy: topmost visible scene updates outline. IO callbacks only
  // include *changed* entries, so we accumulate the latest entry per section.
  // Caret in a beat wins; outline/keyboard jumps suppress briefly.
  useEffect(() => {
    const root = scrollportRef.current
    if (!root || scenes.length === 0) return
    if (typeof IntersectionObserver === 'undefined') return
    const sections = scenes
      .map((s) => root.querySelector(`[data-testid="write-scene-${s.id}"]`))
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
    if (sections.length === 0) return

    const byTarget = new Map<Element, IntersectionObserverEntry>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) byTarget.set(entry.target, entry)
        if (Date.now() < suppressSpyUntilRef.current) return
        if (isEditingInScrollport(root)) return
        const id = pickTopIntersectingSceneId(byTarget.values())
        if (!id || id === activeSceneIdRef.current) return
        activeSceneIdRef.current = id
        setActiveSceneId(id)
        replaceSceneQuery(id)
        requestAnimationFrame(() => {
          const outlineRow = document.querySelector(
            `[data-testid="write-outline-${id}"]`,
          )
          if (outlineRow instanceof HTMLElement) {
            outlineRow.scrollIntoView({ block: 'nearest' })
          }
        })
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: [0, 0.1, 0.25, 0.5] },
    )
    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [scenes, project?.headSnapshotId])

  // Ledger / deep-link: scroll highlighted beat into view once.
  useEffect(() => {
    if (!highlightBeatId) return
    const t = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-testid="beat-row-${highlightBeatId}"]`,
      )
      if (el instanceof HTMLElement) {
        suppressSpyUntilRef.current = Date.now() + 500
        el.scrollIntoView({ block: 'center' })
      }
    }, 50)
    return () => window.clearTimeout(t)
  }, [highlightBeatId, scenes.length])

  const { quiet, canvasHandlers } = useQuietAi()
  const wrappedCanvasHandlers = canvasHandlers

  const candidateSession = useCandidateSession(
    activeProjectId,
    activeSceneId ?? '',
    flush,
  )
  const accept = useAcceptBeat(
    activeProjectId,
    activeSceneId ?? '',
    queue.run,
    setProject,
  )

  const slots = candidateSession.session.slots
  const hasCards = slots.length > 0
  const streaming = candidateSession.session.phase === 'streaming'
  const boundedFocusedCard = hasCards
    ? Math.min(focusedCard, slots.length - 1)
    : 0

  const lastBeatId = useCallback((): string | null => {
    if (!activeScene || activeScene.beats.length === 0) return null
    return activeScene.beats[activeScene.beats.length - 1].id
  }, [activeScene])

  // Generation anchors on the queue's head as it is *after* the flush (an
  // Accept or a refetch may just have landed), not on this render's project.
  const { getHead } = queue
  const anchorAtHead = useCallback((): string | null => {
    const head = getHead()
    if (!head || !activeSceneId) return null
    const beats = findScene(head, activeSceneId)?.beats ?? []
    return beats[beats.length - 1]?.id ?? null
  }, [getHead, activeSceneId])

  const handleNextBeat = useCallback(() => {
    if (!activeSceneId) return
    candidateSession.generate(() => ({
      afterBeatId: anchorAtHead(),
      craftLevel,
    }))
  }, [candidateSession, anchorAtHead, craftLevel, activeSceneId])

  function handleCommandBarSubmit(instruction: string) {
    if (!activeSceneId) return
    candidateSession.generate(() => ({
      afterBeatId: anchorAtHead(),
      instruction,
      craftLevel,
    }))
  }

  function handleCraftLevelChange(level: CraftLevel) {
    if (level === craftLevel) return
    setCraftLevel(level)
    if (!projectId) return
    // A single-field add can't clobber anything, so no If-Match — but it
    // stays on the queue so the head it returns lands in order.
    void queue.run(async (head) => {
      try {
        const result = await patchProject(projectId, [
          { op: 'add', path: '/defaultCraftLevel', value: level },
        ])
        setProject(result.project)
      } catch {
        setCraftLevel(head.defaultCraftLevel ?? 'standard') // server's value
      }
    })
  }

  const handleAccept = useCallback(
    async (index: number, candidate: BeatCandidate) => {
      const response = await accept.accept(index, candidate, lastBeatId())
      if (response) {
        candidateSession.skip(index)
        const pendingDelta = response.newFacts.filter(
          (f) => f.status === 'pending_review',
        ).length
        if (pendingDelta > 0) {
          setLedgerCount((count) => count + pendingDelta)
        }
      }
    },
    [accept, candidateSession, lastBeatId],
  )

  const acceptFocused = useCallback(() => {
    const slot = slots[boundedFocusedCard]
    if (!slot || slot.status !== 'done') return
    if (slot.candidate.continuityConflicts.length > 0) return
    void handleAccept(boundedFocusedCard, slot.candidate)
  }, [slots, boundedFocusedCard, handleAccept])

  const stepScene = useCallback(
    (delta: -1 | 1) => {
      if (scenes.length === 0 || !activeSceneId) return
      const i = scenes.findIndex((s) => s.id === activeSceneId)
      if (i < 0) return
      const next = scenes[i + delta]
      if (next) selectScene(next.id)
    },
    [scenes, activeSceneId, selectScene],
  )

  useWriteKeyboard({
    quiet,
    streaming,
    hasCards,
    onGenerate: handleNextBeat,
    onFocusCommandBar: () => commandBarRef.current?.focus(),
    onCycleFocus: (delta) => {
      if (!hasCards) return
      setFocusedCard((i) => (i + delta + slots.length) % slots.length)
    },
    onAcceptFocused: acceptFocused,
    onDismissDock: () => candidateSession.reset(),
    onSelectCard: (index) => {
      if (index >= 0 && index < slots.length) setFocusedCard(index)
    },
    onPrevScene: () => stepScene(-1),
    onNextScene: () => stepScene(1),
  })

  const llmUnavailableAccept = Object.entries(accept.errorByIndex).find(
    ([, err]) => err.code === 'LLM_UNAVAILABLE',
  )

  if (loadError) {
    return (
      <AppShell
        projectTitle="Table Read"
        activeMode="Write"
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

  if (!project || scenes.length === 0) {
    return (
      <AppShell
        projectTitle={project?.title ?? 'Table Read'}
        activeMode="Write"
        ledgerCount={ledgerCount}
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-text-secondary">
          {project ? 'No scenes in this episode yet.' : 'Loading…'}
        </p>
      </AppShell>
    )
  }

  return (
    <AppShell
      projectTitle={project.title}
      activeMode="Write"
      ledgerCount={ledgerCount}
      projectId={projectId}
      runHistoryChange={queue.runAfterSaves}
    >
      {llmUnavailableAccept && (
        <Toast
          tone="danger"
          onDismiss={() => accept.dismissError(Number(llmUnavailableAccept[0]))}
        >
          {llmUnavailableMessage}
        </Toast>
      )}
      <div className="flex h-[calc(100vh-var(--tr-shell-height))] min-h-0 overflow-hidden bg-tr-surface-raised">
        <SceneOutline
          scenes={scenes}
          activeSceneId={activeSceneId}
          onSelect={(id) => selectScene(id)}
        />
        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            ref={scrollportRef}
            data-testid="write-scrollport"
            className="h-full min-h-0 overflow-y-auto bg-tr-write-desk px-6 pb-28"
          >
            {(queue.saveFailed || queue.notice) && (
              // Pinned to the top of the editor column (zero-height sticky
              // row, so the sheet never shifts): visible wherever the writer
              // has scrolled, and in the desk margin above the sheet.
              // Retryable failures offer Retry; saves that can never succeed
              // (locked / removed / changed elsewhere) say why, once.
              <div className="sticky top-0 z-10 flex h-0 items-start justify-center">
                <p
                  role="status"
                  data-testid="write-save-failed"
                  className="mt-2 flex items-center gap-2 rounded-chip border border-tr-border bg-tr-surface-raised px-3 py-1 text-12 text-tr-danger shadow-write-card"
                >
                  {queue.saveFailed
                    ? "Couldn't save your last edit."
                    : queue.notice}
                  <button
                    type="button"
                    onClick={
                      queue.saveFailed
                        ? () => void flush()
                        : queue.dismissNotice
                    }
                    className="font-medium underline"
                  >
                    {queue.saveFailed ? 'Retry' : 'Dismiss'}
                  </button>
                </p>
              </div>
            )}
            <ScriptCanvas
              scenes={scenes}
              canvasHandlers={wrappedCanvasHandlers}
              highlightBeatId={highlightBeatId}
              activeSceneId={activeSceneId}
              onSceneFocus={(id) => selectScene(id, { scroll: false })}
              lockedEpisodeSceneIds={lockedEpisodeSceneIds}
              onBeatEdit={queue.editBeat}
              onBeatBlur={() => void flush()}
            />
          </div>
          <CommandBar
            ref={commandBarRef}
            onSubmit={handleCommandBarSubmit}
            disabled={streaming || candidateSession.saving || !activeSceneId}
            hidden={quiet}
            projectId={projectId}
            sceneId={activeSceneId ?? ''}
          />
        </div>
        <div
          className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-tr-border"
          data-testid="write-candidate-rail"
        >
          <CandidateDock
            key={activeSceneId ?? 'none'}
            session={candidateSession.session}
            quiet={quiet}
            focusedIndex={hasCards ? boundedFocusedCard : null}
            craftLevel={craftLevel}
            onCraftLevelChange={(level) => void handleCraftLevelChange(level)}
            onNextBeat={handleNextBeat}
            onSkip={candidateSession.skip}
            onReplace={(index, candidate) =>
              candidateSession.replaceSlot(index, { status: 'done', candidate })
            }
            onAccept={handleAccept}
            onRetry={candidateSession.retry}
            acceptingIndex={accept.acceptingIndex}
            errorByIndex={accept.errorByIndex}
            projectId={projectId}
            sceneId={activeSceneId ?? ''}
            beforeGenerate={flush}
            saving={candidateSession.saving}
          />
        </div>
      </div>
    </AppShell>
  )
}
