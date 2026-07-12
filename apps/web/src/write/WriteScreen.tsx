import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BeatCandidate, CraftLevel, Project } from 'contract'
import { getLedger, getProject, patchProject } from '../api/client'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { AppShell } from '../shell/AppShell'
import { Toast } from '../shell/Toast'
import { llmUnavailableMessage } from '../shell/toastCopy'
import { CandidateDock } from './CandidateDock'
import { CommandBar, type CommandBarHandle } from './CommandBar'
import { ScriptCanvas } from './ScriptCanvas'
import { useAcceptBeat } from './useAcceptBeat'
import { useCandidateSession } from './useCandidateSession'
import { useQuietAi } from './useQuietAi'
import { useWriteKeyboard } from './useWriteKeyboard'
import { allScenes, pickDefaultScene } from './projectTree'

function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

export function WriteScreen() {
  const projectId = requireProjectId()
  const requestedSceneId = useUrlParam('scene')
  const highlightBeatId = useUrlParam('highlightBeat')
  const activeProjectId = projectId ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [ledgerCount, setLedgerCount] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [focusedCard, setFocusedCard] = useState(0)
  const [craftLevel, setCraftLevel] = useState<CraftLevel>('standard')
  const commandBarRef = useRef<CommandBarHandle>(null)

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

  const scene =
    projectId && project
      ? (() => {
          const scenes = allScenes(project)
          const resume = loadResume(
            projectId,
            scenes.map((s) => s.id),
          )
          const preferredId = requestedSceneId ?? resume.sceneId
          return pickDefaultScene(project, preferredId)
        })()
      : null

  useEffect(() => {
    if (projectId && scene) {
      saveResume(projectId, { mode: 'Write', sceneId: scene.id })
    }
  }, [projectId, scene])

  const { quiet, canvasHandlers } = useQuietAi()
  const candidateSession = useCandidateSession(activeProjectId, scene?.id ?? '')
  const accept = useAcceptBeat(
    activeProjectId,
    scene?.id ?? '',
    project,
    setProject,
  )

  const slots = candidateSession.session.slots
  const hasCards = slots.length > 0
  const streaming = candidateSession.session.phase === 'streaming'
  const boundedFocusedCard = hasCards
    ? Math.min(focusedCard, slots.length - 1)
    : 0

  const lastBeatId = useCallback((): string | null => {
    if (!scene || scene.beats.length === 0) return null
    return scene.beats[scene.beats.length - 1].id
  }, [scene])

  const handleNextBeat = useCallback(() => {
    candidateSession.generate({
      afterBeatId: lastBeatId(),
      craftLevel,
    })
  }, [candidateSession, lastBeatId, craftLevel])

  function handleCommandBarSubmit(instruction: string) {
    candidateSession.generate({
      afterBeatId: lastBeatId(),
      instruction,
      craftLevel,
    })
  }

  async function handleCraftLevelChange(level: CraftLevel) {
    setCraftLevel(level)
    if (!projectId || !project) return
    const prev = project.defaultCraftLevel ?? 'standard'
    if (prev === level) return
    setProject({ ...project, defaultCraftLevel: level })
    try {
      const result = await patchProject(projectId, [
        {
          op: 'add',
          path: '/defaultCraftLevel',
          value: level,
        },
      ])
      setProject(result.project)
    } catch {
      setCraftLevel(prev)
      setProject(project)
    }
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
        projectId={projectId}
      >
        <p className="p-8 text-15 text-tr-danger">
          Couldn&apos;t load this project: {loadError}
        </p>
      </AppShell>
    )
  }

  if (!projectId) return null

  if (!project || !scene) {
    return (
      <AppShell
        projectTitle="Table Read"
        activeMode="Write"
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
      activeMode="Write"
      ledgerCount={ledgerCount}
      projectId={projectId}
    >
      {llmUnavailableAccept && (
        <Toast
          tone="danger"
          onDismiss={() => accept.dismissError(Number(llmUnavailableAccept[0]))}
        >
          {llmUnavailableMessage}
        </Toast>
      )}
      <div className="flex justify-center gap-6 px-6 py-8 pb-24">
        <ScriptCanvas
          scene={scene}
          canvasHandlers={canvasHandlers}
          highlightBeatId={highlightBeatId}
        />
        <CandidateDock
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
          sceneId={scene.id}
        />
      </div>
      <CommandBar
        ref={commandBarRef}
        onSubmit={handleCommandBarSubmit}
        disabled={streaming}
        hidden={quiet}
        projectId={projectId}
        sceneId={scene.id}
      />
    </AppShell>
  )
}
