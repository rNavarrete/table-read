// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project, StructureCheck } from 'contract'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import { StructurePanel } from './StructurePanel'
import { structureErrorMessage } from './structureErrors'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const FORMAT = {
  genre: 'drama',
  runtimeMinutes: 60,
  actCount: 4,
  coldOpen: true,
  tag: false,
  serialization: 0.5,
}

function project(
  over: { format?: unknown; structureChecks?: StructureCheck[] } = {},
): Project {
  return {
    id: 'proj-1',
    format: 'format' in over ? over.format : FORMAT,
    headSnapshotId: 'snap-1',
    seasons: [
      {
        episodes: [
          {
            id: 'ep-1',
            storyOverview: null,
            structureChecks: over.structureChecks ?? [],
            scenes: [
              { id: 'scene-1', act: 0, index: 0, beats: [{ id: 'beat-1-1' }] },
              { id: 'scene-2', act: 1, index: 1, beats: [{ id: 'beat-2-1' }] },
              { id: 'scene-3', act: 2, index: 2, beats: [{ id: 'beat-3-1' }] },
            ],
          },
        ],
      },
    ],
  } as unknown as Project
}

const missing = (stage: string) => ({
  stage,
  status: 'missing',
  beatId: null,
  sceneId: null,
  reason: `No ${stage} beat.`,
  evidenceQuote: null,
})

function storyCircle(over: Partial<StructureCheck> = {}): StructureCheck {
  return {
    lens: 'story_circle',
    applies: true,
    rationale: 'Marta leaves the bar and comes back changed.',
    sourceHash: 'hash-old',
    checkedAt: '2026-10-11T00:00:00Z',
    promptVersion: '0.51.0',
    stages: [
      {
        stage: 'circle_you',
        status: 'hit',
        beatId: 'beat-1-1',
        sceneId: 'scene-1',
        reason: 'Marta at home behind the bar.',
        evidenceQuote: 'Marta pours.',
      },
      {
        stage: 'circle_need',
        status: 'thin',
        beatId: 'beat-2-1',
        sceneId: 'scene-2',
        reason: 'The want is implied only.',
        evidenceQuote: null,
      },
      {
        stage: 'circle_go',
        status: 'unverified',
        beatId: 'beat-3-1',
        sceneId: 'scene-3',
        reason: 'Not verified',
        evidenceQuote: 'She walks out.',
      },
      ...['circle_search', 'circle_find', 'circle_take', 'circle_return'].map(
        missing,
      ),
      missing('circle_change'),
    ],
    ...over,
  } as StructureCheck
}

function renderPanel(
  props: Partial<ComponentProps<typeof StructurePanel>> = {},
) {
  const onCheck = vi.fn()
  const onOpenBeat = vi.fn()
  render(
    <StructurePanel
      project={project()}
      busy={false}
      error={null}
      onCheck={onCheck}
      onOpenBeat={onOpenBeat}
      {...props}
    />,
  )
  return { onCheck, onOpenBeat }
}

const pick = () => screen.getByTestId('structure-pick') as HTMLSelectElement

describe('StructurePanel', () => {
  it('opens on TV act structure with every stage missing and no API call', () => {
    const { onCheck } = renderPanel()
    expect(pick().value).toBe('tv_act_structure')
    const rows = screen.getAllByTestId(/^structure-row-/)
    expect(rows).toHaveLength(9)
    expect(rows.every((row) => row.textContent?.includes('Missing'))).toBe(true)
    expect(screen.getByTestId('structure-row-cold-open')).not.toBeNull()
    expect(screen.getByTestId('structure-row-climax')).not.toBeNull()
    expect(screen.queryByTestId('structure-check-button')).toBeNull()
    expect(onCheck).not.toHaveBeenCalled()
  })

  it('says the format is unknown when there is none', () => {
    renderPanel({ project: project({ format: null }) })
    expect(screen.getByText("The show format isn't known yet.")).not.toBeNull()
    expect(screen.queryAllByTestId(/^structure-row-/)).toHaveLength(0)
  })

  it('offers an explicit check with its cost for an unchecked structure', async () => {
    const user = userEvent.setup()
    const { onCheck } = renderPanel()
    await user.selectOptions(pick(), 'story_circle')
    expect(screen.getByText('About 25¢, under a minute.')).not.toBeNull()
    const button = screen.getByTestId('structure-check-button')
    expect(button.textContent).toBe('Check structure')
    await user.click(button)
    expect(onCheck).toHaveBeenCalledWith('story_circle')
  })

  it('disables the check while one runs', async () => {
    const user = userEvent.setup()
    renderPanel({ busy: true })
    await user.selectOptions(pick(), 'story_circle')
    expect(
      (screen.getByTestId('structure-check-button') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('shows the error', () => {
    renderPanel({ error: 'The check failed. Nothing was saved.' })
    expect(
      screen.getByText('The check failed. Nothing was saved.'),
    ).not.toBeNull()
  })

  it('renders a saved check with every status as text', async () => {
    const user = userEvent.setup()
    const { onOpenBeat } = renderPanel({
      project: project({ structureChecks: [storyCircle()] }),
      hashScenes: async () => 'hash-old',
    })
    await user.selectOptions(pick(), 'story_circle')

    expect(screen.getByTestId('structure-panel').textContent).toContain(
      "1 of 8 stages hit · 1 thin · 5 missing · 1 couldn't verify",
    )
    const rows = screen.getAllByTestId(/^structure-row-circle_/)
    expect(rows).toHaveLength(8)

    const you = screen.getByTestId('structure-row-circle_you')
    expect(you.textContent).toContain('You (comfort zone)')
    expect(you.textContent).toContain('Hit')
    expect(you.textContent).toContain('Marta at home behind the bar.')
    expect(you.textContent).toContain('"Marta pours."')

    const need = screen.getByTestId('structure-row-circle_need')
    expect(need.textContent).toContain('Thin')
    expect(need.textContent).toContain('The want is implied only.')
    expect(need.textContent).not.toContain('"')

    const go = screen.getByTestId('structure-row-circle_go')
    expect(go.textContent).toContain("Couldn't verify")
    expect(go.textContent).toContain('Not verified')

    expect(
      screen.getByTestId('structure-row-circle_change').textContent,
    ).toContain('Missing')

    await user.click(you)
    expect(onOpenBeat).toHaveBeenCalledWith('scene-1', 'beat-1-1')
    await user.click(screen.getByTestId('structure-row-circle_change'))
    expect(onOpenBeat).toHaveBeenCalledOnce()
  })

  it('states where each placed Turning Points stage lands, in words', async () => {
    const user = userEvent.setup()
    const placed = (
      stage: string,
      beat: number,
      positionPct: number,
      expectedPct: number,
      windowPct: number,
      placement: string,
    ) => ({
      stage,
      status: 'hit',
      beatId: `beat-${beat}-1`,
      sceneId: `scene-${beat}`,
      reason: `${stage} reason`,
      evidenceQuote: null,
      positionPct,
      expectedPct,
      windowPct,
      placement,
    })
    const check = {
      lens: 'turning_points',
      applies: true,
      rationale: 'Marta’s story.',
      sourceHash: 'hash-old',
      checkedAt: '2026-10-19T00:00:00Z',
      promptVersion: '0.55.0',
      stages: [
        placed('tp_opportunity', 1, 3.6, 11, 7, 'early'),
        placed('tp_change_of_plans', 3, 52.4, 32, 11, 'late'),
        placed('tp_point_of_no_return', 2, 47.6, 51, 12, 'out_of_order'),
        {
          ...placed('tp_major_setback', 3, 70, 74, 8, 'in_window'),
          status: 'unverified',
          placement: null,
        },
        {
          ...missing('tp_climax'),
          positionPct: null,
          expectedPct: 89,
          windowPct: 5,
          placement: null,
        },
      ],
    } as StructureCheck
    renderPanel({
      project: project({ structureChecks: [check] }),
      hashScenes: async () => 'hash-old',
    })
    await user.selectOptions(pick(), 'turning_points')

    const line = (stage: string) =>
      screen.queryByTestId(`structure-placement-${stage}`)?.textContent ?? null
    expect(line('tp_opportunity')).toBe(
      'at 4% · expected 11% ± 7 · earlier than usual',
    )
    expect(line('tp_change_of_plans')).toBe(
      'at 52% · expected 32% ± 11 · later than usual',
    )
    expect(line('tp_point_of_no_return')).toBe(
      'at 48% · expected 51% ± 12 · comes before the change of plans',
    )
    expect(line('tp_major_setback')).toBeNull()
    expect(line('tp_climax')).toBeNull()
    expect(screen.getByTestId('structure-panel').textContent).not.toMatch(
      /score|grade|fail/i,
    )
  })

  it('shows the window alone for an in-window stage', async () => {
    const user = userEvent.setup()
    const stage = {
      ...missing('midpoint'),
      status: 'thin',
      beatId: 'beat-2-1',
      sceneId: 'scene-2',
      positionPct: 48.2,
      expectedPct: 50,
      windowPct: 8,
      placement: 'in_window',
    }
    renderPanel({
      project: project({
        structureChecks: [
          storyCircle({
            lens: 'save_the_cat',
            stages: [stage] as StructureCheck['stages'],
          }),
        ],
      }),
      hashScenes: async () => 'hash-old',
    })
    await user.selectOptions(pick(), 'save_the_cat')
    expect(screen.getByTestId('structure-placement-midpoint').textContent).toBe(
      'at 48% · expected 50% ± 8',
    )
  })

  it('shows no placement for a check saved before windows existed', async () => {
    const user = userEvent.setup()
    renderPanel({
      project: project({ structureChecks: [storyCircle()] }),
      hashScenes: async () => 'hash-old',
    })
    await user.selectOptions(pick(), 'story_circle')
    expect(screen.getAllByTestId(/^structure-row-circle_/)).toHaveLength(8)
    expect(screen.queryAllByTestId(/^structure-placement-/)).toHaveLength(0)
  })

  it('offers a Turning Points check', async () => {
    const user = userEvent.setup()
    const { onCheck } = renderPanel()
    await user.selectOptions(pick(), 'turning_points')
    expect(screen.getByRole('heading').textContent).toBe('Turning Points')
    await user.click(screen.getByTestId('structure-check-button'))
    expect(onCheck).toHaveBeenCalledWith('turning_points')
  })

  it('shows the doesn’t-fit note and switches to TV act structure', async () => {
    const user = userEvent.setup()
    renderPanel({
      project: project({
        structureChecks: [
          {
            lens: 'heros_journey',
            applies: false,
            rationale: 'An ensemble pilot with no single hero.',
            stages: [],
            sourceHash: 'hash-old',
            checkedAt: '2026-10-11T00:00:00Z',
            promptVersion: '0.51.0',
          },
        ],
      }),
      hashScenes: async () => 'hash-old',
    })
    await user.selectOptions(pick(), 'heros_journey')
    const note = screen.getByTestId('structure-doesnt-fit')
    expect(note.textContent).toContain('An ensemble pilot with no single hero.')
    expect(screen.queryAllByTestId(/^structure-row-/)).toHaveLength(0)

    await user.click(
      screen.getByRole('button', { name: 'Check TV act structure instead' }),
    )
    expect(pick().value).toBe('tv_act_structure')
    expect(screen.getByTestId('structure-row-cold-open')).not.toBeNull()
  })

  it('shows the stale line when the script changed since the check', async () => {
    const user = userEvent.setup()
    const { onCheck } = renderPanel({
      project: project({ structureChecks: [storyCircle()] }),
      hashScenes: async () => 'hash-new',
    })
    await user.selectOptions(pick(), 'story_circle')
    const stale = await screen.findByTestId('structure-stale')
    expect(stale.textContent).toContain('The script changed since this check.')
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(onCheck).toHaveBeenCalledWith('story_circle')
  })

  it('shows no stale line when the script is unchanged', async () => {
    const hashScenes = vi.fn(async () => 'hash-old')
    localStorage.setItem('tr.ledger.structure.proj-1', 'story_circle')
    renderPanel({
      project: project({ structureChecks: [storyCircle()] }),
      hashScenes,
    })
    await act(async () => {})
    expect(hashScenes).toHaveBeenCalled()
    expect(screen.getAllByTestId(/^structure-row-circle_/)).toHaveLength(8)
    expect(screen.queryByTestId('structure-stale')).toBeNull()
  })

  it('remembers the pick per project', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.selectOptions(pick(), 'save_the_cat')
    expect(localStorage.getItem('tr.ledger.structure.proj-1')).toBe(
      'save_the_cat',
    )
    cleanup()
    renderPanel()
    expect(pick().value).toBe('save_the_cat')
  })
})

describe('structureErrorMessage', () => {
  const apiError = (code: string) =>
    new ApiError(409, { code, message: 'server text' })

  it('maps each check error to writer copy', () => {
    expect(structureErrorMessage(apiError('CONFLICT_STALE_HEAD'))).toBe(
      'The script changed while checking. Reload and try again.',
    )
    expect(structureErrorMessage(apiError('SCHEMA_INVALID_LLM'))).toBe(
      'The check came back malformed twice. Nothing was saved; try again.',
    )
    expect(structureErrorMessage(apiError('LLM_UNAVAILABLE'))).toBe(
      'The AI service is unavailable right now. Nothing was saved.',
    )
    expect(structureErrorMessage(apiError('STRUCTURE_CHECK_NOT_READY'))).toBe(
      'This script has no beats to check yet.',
    )
    expect(structureErrorMessage(apiError('NOT_FOUND'))).toBe(
      'The check failed. Nothing was saved.',
    )
    expect(structureErrorMessage(new Error('network down'))).toBe(
      'The check failed. Nothing was saved.',
    )
  })
})
