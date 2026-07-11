import { useEffect, useMemo, useState } from 'react'
import type { BeatCandidate, Project } from 'contract'
import { getLedger, getProject } from '../api/client'
import { requireProjectId } from '../projects/projectRouting'
import { loadResume, saveResume } from '../projects/resumeContext'
import { AppShell } from '../shell/AppShell'
import { Toast } from '../shell/Toast'
import { llmUnavailableMessage } from '../shell/toastCopy'
import { CandidateDock } from './CandidateDock'
import { CommandBar } from './CommandBar'
import { ScriptCanvas } from './ScriptCanvas'
import { useAcceptBeat } from './useAcceptBeat'
import { useCandidateSession } from './useCandidateSession'
import { useQuietAi } from './useQuietAi'
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

  useEffect(() => {
    if (!projectId) return
    // `project`/`loadError` already start at their reset values (null) from
    // `useState` — no synchronous reset is needed here (there's also no UI
    // yet that changes `projectId` mid-session; the effect fires once, on
    // mount, reading the id straight off the URL).
    let cancelled = false
    Promise.all([getProject(projectId), getLedger(projectId)])
      .then(([loadedProject, ledger]) => {
        if (cancelled) return
        setProject(loadedProject)
        // UI spec §2: Ledger badge = review-queue (pending_review) count.
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

  function lastBeatId(): string | null {
    if (!scene || scene.beats.length === 0) return null
    return scene.beats[scene.beats.length - 1].id
  }

  function handleNextBeat() {
    candidateSession.generate({ afterBeatId: lastBeatId() })
  }

  function handleCommandBarSubmit(instruction: string) {
    candidateSession.generate({ afterBeatId: lastBeatId(), instruction })
  }

  async function handleAccept(index: number, candidate: BeatCandidate) {
    const response = await accept.accept(index, candidate, lastBeatId())
    if (response) {
      candidateSession.skip(index)
      // Badge tracks pending_review only — high-confidence newFacts stay
      // active and don't bump the queue; low-confidence ones do.
      const pendingDelta = response.newFacts.filter(
        (f) => f.status === 'pending_review',
      ).length
      if (pendingDelta > 0) {
        setLedgerCount((count) => count + pendingDelta)
      }
    }
  }

  // Cross-cutting toast for accept 503 (UI spec §3 keeps the inline card
  // error; this is additive visibility). Dismiss clears that card's error.
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
        onSubmit={handleCommandBarSubmit}
        disabled={candidateSession.session.phase === 'streaming'}
        hidden={quiet}
      />
    </AppShell>
  )
}
