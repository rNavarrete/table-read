import { useEffect, useMemo, useState } from 'react'
import type { BeatCandidate, Project } from 'contract'
import { getLedger, getProject } from '../api/client'
import { AppShell } from '../shell/AppShell'
import { CandidateDock } from './CandidateDock'
import { CommandBar } from './CommandBar'
import { ScriptCanvas } from './ScriptCanvas'
import { useAcceptBeat } from './useAcceptBeat'
import { useCandidateSession } from './useCandidateSession'
import { useQuietAi } from './useQuietAi'
import { allScenes, findScene } from './projectTree'

// No project/scene picker exists yet (Plan mode's board, which owns scene
// selection, is T3.1 — build plan). Until then, Write mode reads both ids
// from the URL: `?project=<id>` (default: the seeded fixture, "The Long
// Pour") and `?scene=<id>` (default: the project's first scene) — enough
// for the T2.3 e2e to target fixture scene-3 or scene-1 directly, without
// building UI this task doesn't own.
const DEFAULT_PROJECT_ID = 'proj-longpour'

function useUrlParam(name: string): string | null {
  return useMemo(
    () => new URLSearchParams(window.location.search).get(name),
    [name],
  )
}

export function WriteScreen() {
  const projectId = useUrlParam('project') ?? DEFAULT_PROJECT_ID
  const requestedSceneId = useUrlParam('scene')
  const highlightBeatId = useUrlParam('highlightBeat')

  const [project, setProject] = useState<Project | null>(null)
  const [ledgerCount, setLedgerCount] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
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

  const scene = project
    ? ((requestedSceneId ? findScene(project, requestedSceneId) : null) ??
      allScenes(project)[0])
    : null

  const { quiet, canvasHandlers } = useQuietAi()
  const candidateSession = useCandidateSession(projectId, scene?.id ?? '')
  const accept = useAcceptBeat(projectId, scene?.id ?? '', project, setProject)

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
