// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NarrativeMap, NarrativeMapRun, Project } from 'contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NarrativeMapCard } from './NarrativeMapCard'

afterEach(cleanup)

function project(): Project {
  return {
    id: 'proj-1',
    format: {
      genre: 'drama',
      runtimeMinutes: 60,
      actCount: 2,
      coldOpen: false,
      tag: false,
      serialization: 0.5,
    },
    seriesBible: {
      characters: [{ id: 'char-nora', name: 'Nora', aliases: [] }],
    },
    seasons: [
      {
        episodes: [
          {
            id: 'ep-1',
            threads: [{ id: 'thread-letter', label: 'The unsent letter' }],
            scenes: [
              { id: 'scene-1', act: 0, beats: [{ id: 'beat-1-1' }] },
              { id: 'scene-2', act: 1, beats: [{ id: 'beat-2-1' }] },
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

function narrativeMap(): NarrativeMap {
  return {
    dramaticQuestion: 'Can Nora uncover the letter before Cass destroys it?',
    centralConflict: 'Nora wants the truth while Cass protects the secret.',
    controllingIdea: 'Love becomes destructive when it hides the truth.',
    themes: [
      {
        label: 'Truth and protection',
        statement: 'Secrecy turns care into control.',
        evidence: [{ beatId: 'beat-1-1', quote: 'Nora finds the letter.' }],
      },
    ],
    acts: [
      {
        act: 0,
        dramaticQuestion: 'What did Nora find?',
        escalation: 'The letter opens the mystery.',
        escalationEvidence: [],
        turnBeatId: 'beat-1-1',
        evidenceQuote: 'Nora finds the letter.',
      },
      {
        act: 1,
        dramaticQuestion: 'Will Cass let Nora learn the truth?',
        escalation: 'Cass burns the evidence.',
        escalationEvidence: [],
        turnBeatId: 'beat-2-1',
        evidenceQuote: 'Cass burns the letter.',
      },
    ],
    heroJourney: {
      applies: true,
      protagonistCharacterId: 'char-nora',
      rationale: 'Nora is called into a search for truth.',
      stages: [
        {
          stage: 'call_to_adventure',
          beatId: 'beat-1-1',
          summary: "The letter disrupts Nora's ordinary world.",
          evidenceQuote: 'Nora finds the letter.',
        },
      ],
    },
    characterArcs: [
      {
        characterId: 'char-nora',
        want: 'Read the letter.',
        need: 'Face the truth about Cass.',
        internalConflict: 'She fears losing Cass.',
        externalPressure: 'Cass controls the evidence.',
        arcSummary: 'Nora chooses truth over comfort.',
        turningPoints: [
          {
            beatId: 'beat-1-1',
            change: 'Curiosity becomes a pursuit.',
            quote: 'Nora finds the letter.',
          },
        ],
      },
    ],
    sceneTurns: [
      {
        sceneId: 'scene-1',
        focalCharacterId: 'char-nora',
        dramaticFunction: 'Plant the mystery.',
        conflict: 'Nora meets the secret.',
        stakes: 'Trust is at risk.',
        turnBeatId: 'beat-1-1',
        turn: 'Nora commits to finding out what the letter means.',
        evidenceQuote: 'Nora finds the letter.',
      },
      {
        sceneId: 'scene-2',
        focalCharacterId: null,
        dramaticFunction: 'Escalate the cover-up.',
        conflict: 'Cass chooses secrecy.',
        stakes: 'The relationship may break.',
        turnBeatId: 'beat-2-1',
        turn: 'The secret becomes an active betrayal.',
        evidenceQuote: 'Cass burns the letter.',
      },
    ],
    threadMovements: [
      {
        threadId: 'thread-letter',
        beatId: 'beat-2-1',
        phase: 'escalation',
        summary: 'Cass makes the letter unrecoverable.',
        evidenceQuote: 'Cass burns the letter.',
      },
    ],
    unanalyzedSceneIds: [],
    provenance: 'inferred',
    locked: false,
  }
}

function completedRun(retryAllowed: boolean): NarrativeMapRun {
  return {
    id: 'nmap-1',
    projectId: 'proj-1',
    sourceSnapshotId: 'snap-1',
    sourceHash: 'source-hash',
    analysisVersion: '3.6',
    status: 'completed',
    phase: 'complete',
    sceneCount: 2,
    completedSceneCount: 1,
    attemptCount: 1,
    retryAllowed,
    estimatedCostUsd: null,
    actualInputTokens: null,
    actualOutputTokens: null,
    resultSnapshotId: 'snap-2',
    errorCode: null,
    errorMessage: null,
    rejectionDiagnostics: [],
    removedClaims: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function mapWithSceneTwoUnanalyzed(): NarrativeMap {
  const map = narrativeMap()
  return {
    ...map,
    sceneTurns: map.sceneTurns.filter((turn) => turn.sceneId === 'scene-1'),
    unanalyzedSceneIds: ['scene-2'],
  }
}

describe('NarrativeMapCard', () => {
  it('shows an empty state before a map exists', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        onJumpToScene={vi.fn()}
      />,
    )
    expect(screen.getByTestId('narrative-map-empty')).not.toBeNull()
  })

  it('makes the expensive map generation an explicit action', async () => {
    const user = userEvent.setup()
    const onGenerateNarrativeMap = vi.fn()
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={onGenerateNarrativeMap}
      />,
    )

    await user.click(screen.getByTestId('generate-narrative-map'))

    expect(onGenerateNarrativeMap).toHaveBeenCalledOnce()
    expect(screen.getByText(/bounded Opus scene passes/i)).not.toBeNull()
  })

  it('shows scene-by-scene run progress and prevents duplicate starts', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '2.0',
          status: 'running',
          phase: 'scene_analysis',
          sceneCount: 8,
          completedSceneCount: 3,
          attemptCount: 1,
          retryAllowed: false,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: null,
          errorCode: null,
          errorMessage: null,
          rejectionDiagnostics: [],
          removedClaims: [],
          createdAt: '2026-07-24T00:00:00Z',
          updatedAt: '2026-07-24T00:00:01Z',
        }}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    expect(
      screen.getByTestId('narrative-map-run-status').textContent,
    ).toContain('3 of 8')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '33',
    )
    expect(screen.getByText(/3 of 8 scenes checkpointed/i)).not.toBeNull()
    expect(screen.queryByTestId('generate-narrative-map')).toBeNull()
  })

  it('shows synthesis as a distinct long-running phase', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '2.5',
          status: 'running',
          phase: 'synthesis',
          sceneCount: 29,
          completedSceneCount: 29,
          attemptCount: 1,
          retryAllowed: false,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: null,
          errorCode: null,
          errorMessage: null,
          rejectionDiagnostics: [],
          removedClaims: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '84',
    )
    expect(screen.getByText(/29 of 29 scenes checkpointed/i)).not.toBeNull()
    expect(screen.getByText(/can take several minutes/i)).not.toBeNull()
  })

  it('keeps timed-out checkpoints visible and enables safe resume', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '2.5',
          status: 'failed',
          phase: 'failed',
          sceneCount: 29,
          completedSceneCount: 29,
          attemptCount: 1,
          retryAllowed: true,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: null,
          errorCode: 'LLM_TIMEOUT',
          errorMessage: 'Analysis did not finish in time.',
          rejectionDiagnostics: [],
          removedClaims: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/continue from the next unfinished phase/i),
    ).not.toBeNull()
    const button = screen.getByTestId('generate-narrative-map')
    expect(button.textContent).toContain('Resume saved map run')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('offers one corrected verifier call after a malformed verifier response', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '2.5',
          status: 'failed',
          phase: 'failed',
          sceneCount: 29,
          completedSceneCount: 29,
          attemptCount: 4,
          retryAllowed: true,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: null,
          errorCode: 'SCHEMA_INVALID_LLM',
          errorMessage:
            'A corrected strict verifier is available. Only one verification call remains.',
          rejectionDiagnostics: [],
          removedClaims: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    const button = screen.getByTestId('generate-narrative-map')
    expect(button.textContent).toContain('Run corrected verifier')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  function failedRun(
    errorCode: string,
    errorMessage: string,
    retryAllowed: boolean,
  ): NarrativeMapRun {
    return {
      id: 'nmap-1',
      projectId: 'proj-1',
      sourceSnapshotId: 'snap-1',
      sourceHash: 'source-hash',
      analysisVersion: '3.8',
      status: 'failed',
      phase: 'failed',
      sceneCount: 29,
      completedSceneCount: 29,
      attemptCount: 1,
      retryAllowed,
      estimatedCostUsd: null,
      actualInputTokens: null,
      actualOutputTokens: null,
      resultSnapshotId: null,
      errorCode,
      errorMessage,
      rejectionDiagnostics: [],
      removedClaims: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  it('offers a synthesis schema failure as a resume, not a verifier call', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={failedRun(
          'SCHEMA_INVALID_LLM',
          'The story-wide synthesis came back in an invalid shape. Every analysed scene is saved, so resuming re-runs only the synthesis, then verification.',
          true,
        )}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    const button = screen.getByTestId('generate-narrative-map')
    expect(button.textContent).toContain('Resume saved map run')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('does not call a refused request a temporary pause', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={failedRun(
          'LLM_REQUEST_REFUSED',
          'The model provider refused the request (HTTP 400).',
          false,
        )}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    const button = screen.getByTestId('generate-narrative-map')
    expect(button.textContent).toContain('Retry unavailable')
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('labels cached evidence pruning as a no-cost local finish', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '2.5',
          status: 'rejected',
          phase: 'failed',
          sceneCount: 29,
          completedSceneCount: 29,
          attemptCount: 5,
          retryAllowed: true,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: null,
          errorCode: 'EVIDENCE_REJECTED',
          errorMessage:
            'A no-cost local evidence repair is available. No model call will run.',
          rejectionDiagnostics: [],
          removedClaims: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    const button = screen.getByTestId('generate-narrative-map')
    expect(button.textContent).toContain(
      'Finish from saved analysis (no model call)',
    )
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('offers a compact re-verification after repairing a saved scene packet', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '2.6',
          status: 'rejected',
          phase: 'failed',
          sceneCount: 29,
          completedSceneCount: 29,
          attemptCount: 2,
          retryAllowed: true,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: null,
          errorCode: 'EVIDENCE_REJECTED',
          errorMessage:
            'A saved scene-packet repair is available. Only one compact verification call remains.',
          rejectionDiagnostics: [],
          removedClaims: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    const button = screen.getByTestId('generate-narrative-map')
    expect(button.textContent).toContain('Repair saved map & verify')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('blocks same-version evidence retries to prevent repeat charges', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '2.3',
          status: 'rejected',
          phase: 'failed',
          sceneCount: 29,
          completedSceneCount: 6,
          attemptCount: 2,
          retryAllowed: false,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: null,
          errorCode: 'EVIDENCE_REJECTED',
          errorMessage:
            'The evidence gate rejected this analysis. No Narrative Map was saved.',
          rejectionDiagnostics: [],
          removedClaims: [],
          createdAt: '2026-07-24T00:00:00Z',
          updatedAt: '2026-07-24T00:00:01Z',
        }}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    const button = screen.getByTestId('generate-narrative-map')
    expect(button.textContent).toContain(
      'Retry blocked to prevent another charge',
    )
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('does not present a placeholder map as usable analysis', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={{ ...narrativeMap(), dramaticQuestion: '<UNKNOWN>' }}
        onJumpToScene={vi.fn()}
      />,
    )

    expect(screen.getByTestId('narrative-map-empty').textContent).toContain(
      'did not meet the evidence standard',
    )
  })

  it('shows an honest coverage notice instead of inventing character arcs', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={{ ...narrativeMap(), characterArcs: [] }}
        onJumpToScene={vi.fn()}
      />,
    )

    expect(
      screen.getByTestId('narrative-character-coverage').textContent,
    ).toContain('did not produce evidence-supported character arc profiles')
  })

  it('renders macro, character, thread, and source-jump analysis', async () => {
    const user = userEvent.setup()
    const onJumpToScene = vi.fn()
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={narrativeMap()}
        onJumpToScene={onJumpToScene}
      />,
    )

    expect(screen.getByTestId('narrative-map-card').textContent).toContain(
      'Can Nora',
    )
    expect(screen.getByTestId('narrative-themes').textContent).toContain(
      'Truth and protection',
    )
    expect(screen.getByTestId('narrative-hero-journey').textContent).toContain(
      'Call to adventure',
    )
    expect(screen.getByText('Nora')).not.toBeNull()
    expect(screen.getByText('The unsent letter')).not.toBeNull()

    await user.click(screen.getAllByTestId('narrative-evidence-beat-1-1')[0]!)
    expect(onJumpToScene).toHaveBeenCalledWith('scene-1')
  })

  it('tells the writer why the verifier rejected each claim, not just where', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={null}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '2.8',
          status: 'rejected',
          phase: 'failed',
          sceneCount: 27,
          completedSceneCount: 27,
          attemptCount: 1,
          retryAllowed: false,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: null,
          errorCode: 'EVIDENCE_REJECTED',
          errorMessage: 'The evidence gate rejected this analysis.',
          rejectionDiagnostics: [
            {
              code: 'verifier_rejected',
              path: 'acts[2].turnBeatId',
              reason:
                'beat-12-6 is Leo/Josh dialogue about Mandy, not the turn.',
            },
            // Recorded before the verifier had a reason field to fill.
            {
              code: 'verifier_rejected',
              path: 'themes[0].evidence',
              reason: '',
            },
          ],
          removedClaims: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    const panel = screen.getByTestId('narrative-map-rejections')
    expect(panel.textContent).toContain('acts[2].turnBeatId')
    expect(panel.textContent).toContain(
      'beat-12-6 is Leo/Josh dialogue about Mandy, not the turn.',
    )
    // A diagnostic with no reason still shows its path rather than a blank row.
    expect(panel.textContent).toContain('themes[0].evidence')
  })

  it('tells the writer what the evidence check removed from a published map', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={narrativeMap()}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '3.3',
          status: 'completed',
          phase: 'complete',
          sceneCount: 2,
          completedSceneCount: 2,
          attemptCount: 1,
          retryAllowed: false,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: 'snap-2',
          errorCode: null,
          errorMessage: null,
          rejectionDiagnostics: [],
          removedClaims: [
            {
              action: 'remove_character_arc',
              path: 'characterArcs[Cass]',
              subject: "Cass's character arc",
              reason:
                'No cited beat shows Cass wanting anything across the episode.',
            },
            {
              action: 'clear_act_escalation',
              path: 'acts[1].escalation',
              subject: 'Act 1 escalation',
              reason: '',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
        onJumpToScene={vi.fn()}
      />,
    )

    const panel = screen.getByTestId('narrative-map-removals')
    expect(panel.textContent).toContain('Removed before publishing')
    expect(panel.textContent).toContain("Cass's character arc")
    expect(panel.textContent).toContain(
      'No cited beat shows Cass wanting anything across the episode.',
    )
    // A removal with no reason still names what was removed.
    expect(panel.textContent).toContain('Act 1 escalation')
    // The map itself still renders beneath the notice.
    expect(screen.getByTestId('narrative-themes')).not.toBeNull()
  })

  it('shows no removals panel when the gate pruned nothing', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={narrativeMap()}
        narrativeMapRun={{
          id: 'nmap-1',
          projectId: 'proj-1',
          sourceSnapshotId: 'snap-1',
          sourceHash: 'source-hash',
          analysisVersion: '3.3',
          status: 'completed',
          phase: 'complete',
          sceneCount: 2,
          completedSceneCount: 2,
          attemptCount: 1,
          retryAllowed: false,
          estimatedCostUsd: null,
          actualInputTokens: null,
          actualOutputTokens: null,
          resultSnapshotId: 'snap-2',
          errorCode: null,
          errorMessage: null,
          rejectionDiagnostics: [],
          removedClaims: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
        onJumpToScene={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('narrative-map-removals')).toBeNull()
  })

  it('lists unanalysed scenes plainly and offers to analyse them', async () => {
    const user = userEvent.setup()
    const onGenerateNarrativeMap = vi.fn()
    const onJumpToScene = vi.fn()
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={mapWithSceneTwoUnanalyzed()}
        narrativeMapRun={completedRun(true)}
        onJumpToScene={onJumpToScene}
        onGenerateNarrativeMap={onGenerateNarrativeMap}
      />,
    )

    // The map is still shown; the unanalysed scene is listed, not hidden.
    expect(screen.getByTestId('narrative-map-card')).not.toBeNull()
    const panel = screen.getByTestId('narrative-map-unanalyzed')
    expect(panel.textContent).toContain('Not analyzed (1)')
    expect(panel.textContent).toContain('model calls')
    await user.click(screen.getByRole('button', { name: 'Scene 2' }))
    expect(onJumpToScene).toHaveBeenCalledWith('scene-2')
    await user.click(screen.getByTestId('analyze-unanalyzed-scenes'))
    expect(onGenerateNarrativeMap).toHaveBeenCalledOnce()
  })

  it('numbers a listed scene by story position, not array position', () => {
    const moved = project()
    const episode = moved.seasons[0].episodes[0]
    // A Plan move left the array alone: scene-2 (act 1) is still 2nd.
    episode.scenes = [...episode.scenes].reverse()
    render(
      <NarrativeMapCard
        project={moved}
        narrativeMap={mapWithSceneTwoUnanalyzed()}
        onJumpToScene={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Scene 2' })).toBeTruthy()
  })

  it('does not offer analysis the latest run cannot start', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={mapWithSceneTwoUnanalyzed()}
        narrativeMapRun={completedRun(false)}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    expect(
      (screen.getByTestId('analyze-unanalyzed-scenes') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('renders a map saved before unanalysed scenes were recorded', () => {
    // Stored docs reach the card unparsed, so the Zod default never runs.
    const stored: Partial<NarrativeMap> = narrativeMap()
    delete stored.unanalyzedSceneIds
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={stored as NarrativeMap}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    expect(screen.getByTestId('narrative-map-card')).not.toBeNull()
    expect(screen.queryByTestId('narrative-map-unanalyzed')).toBeNull()
  })

  it('does not offer to analyse scenes of a locked map', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={{ ...mapWithSceneTwoUnanalyzed(), locked: true }}
        narrativeMapRun={completedRun(true)}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    expect(screen.getByTestId('narrative-map-unanalyzed')).not.toBeNull()
    expect(screen.queryByTestId('analyze-unanalyzed-scenes')).toBeNull()
  })

  it('shows no unanalysed panel when every scene was analysed', () => {
    render(
      <NarrativeMapCard
        project={project()}
        narrativeMap={narrativeMap()}
        onJumpToScene={vi.fn()}
        onGenerateNarrativeMap={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('narrative-map-unanalyzed')).toBeNull()
  })
})
