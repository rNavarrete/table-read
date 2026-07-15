// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CandidateSession } from './candidateReducer'
import { CandidateDock } from './CandidateDock'

afterEach(cleanup)

const idleSession: CandidateSession = {
  phase: 'idle',
  slots: [],
  currentIndex: null,
  connectionError: null,
}

describe('CandidateDock', () => {
  it('uses the tokenized Quiet Tool candidate dock width', () => {
    render(
      <CandidateDock
        session={idleSession}
        quiet={false}
        focusedIndex={null}
        craftLevel="standard"
        onCraftLevelChange={() => {}}
        onNextBeat={() => {}}
        onSkip={() => {}}
        onReplace={() => {}}
        onAccept={() => {}}
        onRetry={() => {}}
        acceptingIndex={null}
        errorByIndex={{}}
        projectId="proj-1"
        sceneId="scene-1"
      />,
    )

    const dock = screen.getByTestId('candidate-dock')
    expect(dock.className).toContain('w-panel-candidate-dock')
  })
})
