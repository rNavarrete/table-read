// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BeatCandidate } from 'contract'
import type { CandidateSession } from './candidateReducer'
import { CandidateDock } from './CandidateDock'

afterEach(cleanup)

const idleSession: CandidateSession = {
  phase: 'idle',
  slots: [],
  currentIndex: null,
  connectionError: null,
}

const candidate: BeatCandidate = {
  label: 'A',
  beatPlan: {
    whatHappens: 'Phone refusal',
    audienceLearns: '',
    audienceFeels: '',
  },
  scriptText: 'SAM\nNo.',
  continuityConflicts: [],
}

const filledSession: CandidateSession = {
  phase: 'settled',
  slots: [
    { status: 'done', candidate },
    {
      status: 'done',
      candidate: { ...candidate, label: 'B' },
    },
  ],
  currentIndex: null,
  connectionError: null,
}

const dockProps = {
  quiet: false,
  focusedIndex: null as number | null,
  craftLevel: 'standard' as const,
  onCraftLevelChange: () => {},
  onNextBeat: () => {},
  onSkip: () => {},
  onReplace: () => {},
  onAccept: () => {},
  onRetry: () => {},
  acceptingIndex: null as number | null,
  errorByIndex: {},
  projectId: 'proj-1',
  sceneId: 'scene-1',
}

describe('CandidateDock', () => {
  it('uses the tokenized Quiet Tool candidate dock width', () => {
    render(<CandidateDock session={idleSession} {...dockProps} />)

    const dock = screen.getByTestId('candidate-dock')
    expect(dock.className).toContain('w-panel-candidate-dock')
    expect(dock.className).toContain('min-h-0')
  })

  it('scrolls the candidate list when cards exceed the rail height', () => {
    render(<CandidateDock session={filledSession} {...dockProps} />)

    const scroll = screen.getByTestId('candidate-dock-scroll')
    expect(scroll.className).toContain('overflow-y-auto')
    expect(scroll.className).toContain('min-h-0')
    expect(scroll.className).toContain('flex-1')
  })
})
