// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChangeSet, ImpactedObject } from 'contract'
import { ChangeSetPanel } from './ChangeSetPanel'

afterEach(cleanup)

function impacted(overrides: Partial<ImpactedObject> = {}): ImpactedObject {
  return {
    objectType: 'scene',
    objectId: 'scene-2',
    applyMode: 'regenerate',
    reason: 'Premise changes.',
    confidence: 'high',
    locked: false,
    before: 'Bar',
    after: null,
    continuityFlags: [],
    approved: false,
    ...overrides,
  }
}

function changeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: 'cs-1',
    projectId: 'proj-longpour',
    instruction: 'Dan hides the money at the marina instead of the bar',
    targetObjectId: 'scene-2',
    impacted: [
      impacted(),
      impacted({
        objectType: 'beat',
        objectId: 'beat-4-2',
        reason: 'Marta searches the bar.',
      }),
      impacted({
        objectType: 'beat',
        objectId: 'beat-1-2',
        locked: true,
        reason: 'Locked beat.',
      }),
      impacted({
        objectType: 'ledgerFact',
        objectId: 'fact-02',
        applyMode: 'flag_only',
        reason: 'Ice machine fact.',
      }),
    ],
    preview: null,
    status: 'draft',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ChangeSetPanel>> = {},
) {
  return render(
    <ChangeSetPanel
      changeSet={changeSet()}
      selectedIds={new Set(['scene-2', 'beat-4-2'])}
      previewing={false}
      applying={false}
      hasPreview={false}
      craftLevel="standard"
      onCraftLevelChange={vi.fn()}
      onToggleSelected={vi.fn()}
      onPreview={vi.fn()}
      onApply={vi.fn()}
      onFlagOnly={vi.fn()}
      onDiscard={vi.fn()}
      {...overrides}
    />,
  )
}

describe('ChangeSetPanel', () => {
  it('shows instruction, target chip, selected count excluding locked and flag_only', () => {
    renderPanel()
    expect(screen.getByText(/Dan hides the money at the marina/)).not.toBeNull()
    expect(screen.getByTestId('change-set-row-scene-2')).not.toBeNull()
    expect(screen.getByText('2 of 2 selected')).not.toBeNull()
    expect(screen.getByLabelText('Locked')).not.toBeNull()
    expect(screen.getByLabelText('Flag only')).not.toBeNull()
  })

  it('uses quiet Review chrome copy around header and footer actions', () => {
    renderPanel({ selectedIds: new Set(['scene-2']) })

    expect(screen.getByText('Review proposed impact')).not.toBeNull()
    expect(
      screen.getByText('Nothing changes until you confirm.'),
    ).not.toBeNull()
  })

  it('shows craft level picker before preview', () => {
    renderPanel({ selectedIds: new Set(['scene-2']) })
    expect(screen.getByTestId('craft-level-picker')).not.toBeNull()
  })

  it('disables Apply selected until hasPreview', () => {
    renderPanel({ selectedIds: new Set(['scene-2']) })
    expect(
      (
        screen.getByRole('button', {
          name: 'Apply selected',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'Preview selected',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })

  it('Create branch is disabled with v2 tooltip', () => {
    renderPanel({ selectedIds: new Set() })
    const branch = screen.getByRole('button', {
      name: 'Create branch',
    }) as HTMLButtonElement
    expect(branch.disabled).toBe(true)
    expect(branch.title).toBe('v2')
  })

  it('applied state shows sage summary and post-apply flags', () => {
    renderPanel({
      changeSet: changeSet({ status: 'applied' }),
      selectedIds: new Set(['scene-2']),
      hasPreview: true,
      postApplyFlags: [
        {
          id: 'flag-1',
          objectType: 'scene',
          objectId: 'scene-5',
          factId: null,
          explanation: 'Scene 5 still stages the argument around the bar.',
          severity: 'tension',
          status: 'open',
          sourceChange: 'cs-1',
        },
      ],
      onGoToScene: vi.fn(),
      onDismissFlag: vi.fn(),
    })
    expect(screen.getByTestId('applied-summary')).not.toBeNull()
    expect(screen.getByText(/Scene 5 still stages the argument/)).not.toBeNull()
  })

  it('Preview selected calls onPreview', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    renderPanel({
      selectedIds: new Set(['scene-2']),
      onPreview,
    })
    await user.click(screen.getByRole('button', { name: 'Preview selected' }))
    expect(onPreview).toHaveBeenCalled()
  })
})
