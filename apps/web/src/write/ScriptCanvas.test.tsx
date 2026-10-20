// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Beat, Scene } from 'contract'
import { ScriptCanvas } from './ScriptCanvas'

// No @testing-library/jest-dom in this project (see useQuietAi.test.tsx) —
// assertions read plain DOM properties instead of jest-dom matchers.
afterEach(cleanup)

const noopHandlers = { onFocus: () => {}, onBlur: () => {} }

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 1,
    storyline: 'A',
    locked: false,
    location: 'THE LONG POUR',
    time: 'DAY',
    socialSituation: '',
    valueAtStake: '',
    chargeIn: null,
    chargeOut: null,
    whyNow: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...overrides,
  }
}

describe('ScriptCanvas', () => {
  it('uses the Write redesign page sheet chrome', () => {
    render(
      <ScriptCanvas
        scenes={[scene({ beats: [] })]}
        canvasHandlers={noopHandlers}
      />,
    )
    const sheet = screen.getByTestId('script-canvas')
    expect(sheet.className).toContain('max-w-script-page')
    expect(sheet.className).toContain('bg-tr-surface-raised')
    expect(sheet.className).toContain('shadow-write-page')
  })

  it('empty scene shows a clear empty state, not a blank sheet', () => {
    render(
      <ScriptCanvas
        scenes={[scene({ beats: [] })]}
        canvasHandlers={noopHandlers}
      />,
    )
    expect(screen.getByText('No beats in this scene yet.')).not.toBeNull()
    expect(
      screen.getByTestId('script-scene-slug-scene-1').textContent,
    ).toContain('THE LONG POUR')
  })

  it('stacks multiple scenes for continuous episode reading', () => {
    render(
      <ScriptCanvas
        scenes={[
          scene({ id: 'scene-1', location: 'OVAL OFFICE', time: 'DAY' }),
          scene({
            id: 'scene-2',
            location: "JOSH'S OFFICE",
            time: 'DAY',
            whatHappens: 'Donna waits',
          }),
        ]}
        canvasHandlers={noopHandlers}
      />,
    )
    expect(screen.getByTestId('write-scene-scene-1')).not.toBeNull()
    expect(screen.getByTestId('write-scene-scene-2')).not.toBeNull()
    expect(screen.getByTestId('script-scene-number-scene-1').textContent).toBe(
      '1',
    )
    expect(screen.getByTestId('script-scene-number-scene-2').textContent).toBe(
      '2',
    )
    expect(
      screen.getByTestId('script-scene-slug-scene-2').textContent,
    ).toContain("JOSH'S OFFICE")
  })

  it('scene-number badges follow outline document order, not beat gutters', () => {
    render(
      <ScriptCanvas
        scenes={[
          scene({ id: 'scene-a', location: 'COLD OPEN' }),
          scene({ id: 'scene-b', location: 'EXT. STREET' }),
          scene({ id: 'scene-c', location: 'INT. BEDROOM' }),
        ]}
        activeSceneId="scene-c"
        canvasHandlers={noopHandlers}
      />,
    )
    expect(screen.getByTestId('script-scene-number-scene-c').textContent).toBe(
      '3',
    )
    expect(
      screen.getByTestId('script-scene-number-scene-c').className,
    ).toContain('bg-tr-coral-soft')
  })

  it('does not duplicate a slugline already present in the beat script', () => {
    render(
      <ScriptCanvas
        scenes={[
          scene({
            id: 'scene-12',
            location: "INT. JOSH'S OFFICE",
            time: 'DAY',
            whatHappens: '',
            beats: [
              {
                id: 'beat-12',
                index: 0,
                locked: false,
                scriptLocked: false,
                actorCharacterId: null,
                actionVerb: '',
                targetCharacterId: null,
                reaction: '',
                whatHappens: '',
                audienceLearns: '',
                audienceFeels: '',
                scriptText: "INT. JOSH'S OFFICE - DAY\n\nJosh is at his desk.",
              },
            ],
          }),
        ]}
        canvasHandlers={noopHandlers}
      />,
    )
    expect(screen.queryByTestId('script-scene-slug-scene-12')).toBeNull()
    expect(screen.getByTestId('formatted-script').textContent).toContain(
      "INT. JOSH'S OFFICE",
    )
  })

  it('focusing a beat reports the owning scene', async () => {
    const user = userEvent.setup()
    const onSceneFocus = vi.fn()
    render(
      <ScriptCanvas
        scenes={[
          scene({
            id: 'scene-1',
            beats: [
              {
                id: 'beat-1',
                index: 0,
                locked: false,
                scriptLocked: false,
                actorCharacterId: null,
                actionVerb: '',
                targetCharacterId: null,
                reaction: '',
                whatHappens: '',
                audienceLearns: '',
                audienceFeels: '',
                scriptText: 'First scene.',
              },
            ],
          }),
          scene({
            id: 'scene-2',
            location: 'HALL',
            beats: [
              {
                id: 'beat-2',
                index: 0,
                locked: false,
                scriptLocked: false,
                actorCharacterId: null,
                actionVerb: '',
                targetCharacterId: null,
                reaction: '',
                whatHappens: '',
                audienceLearns: '',
                audienceFeels: '',
                scriptText: 'Second scene.',
              },
            ],
          }),
        ]}
        canvasHandlers={noopHandlers}
        onSceneFocus={onSceneFocus}
      />,
    )
    const scene2 = screen.getByTestId('write-scene-scene-2')
    await user.click(scene2.querySelector('[data-testid="formatted-script"]')!)
    expect(onSceneFocus).toHaveBeenCalledWith('scene-2')
  })

  it('planned beats with empty script show solid plan copy, not a blank row', () => {
    render(
      <ScriptCanvas
        scenes={[
          scene({
            location: "INT. RODNEY'S APARTMENT - EARLY MORNING",
            time: 'EARLY MORNING',
            whatHappens: 'Rodney finds an anonymous envelope.',
            beats: [
              {
                id: 'beat-1',
                index: 0,
                locked: false,
                scriptLocked: false,
                actorCharacterId: null,
                actionVerb: '',
                targetCharacterId: null,
                reaction: '',
                whatHappens: 'Rodney executes an identical morning routine.',
                audienceLearns: 'His control is brittle.',
                audienceFeels: 'Unease.',
                scriptText: '',
              },
            ],
          }),
        ]}
        canvasHandlers={noopHandlers}
      />,
    )
    expect(
      screen.getByTestId('script-scene-slug-scene-1').textContent,
    ).toContain("INT. RODNEY'S APARTMENT")
    expect(
      screen.getByTestId('script-scene-pitch-scene-1').textContent,
    ).toContain('anonymous envelope')
    expect(screen.getByTestId('beat-plan-beat-1').textContent).toContain(
      'identical morning routine',
    )
    expect(screen.getByTestId('beat-plan-beat-1').textContent).toContain(
      'Audience learns',
    )
    const textarea = screen.getByTestId('beat-beat-1') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('renders Fountain teleplay layout, then edits as plain text on click', async () => {
    const user = userEvent.setup()
    render(
      <ScriptCanvas
        scenes={[
          scene({
            beats: [
              {
                id: 'beat-3-1',
                index: 0,
                locked: false,
                scriptLocked: false,
                actorCharacterId: null,
                actionVerb: '',
                targetCharacterId: null,
                reaction: '',
                whatHappens: '',
                audienceLearns: '',
                audienceFeels: '',
                scriptText: 'DAN\nWe are closed.',
              },
            ],
          }),
        ]}
        canvasHandlers={noopHandlers}
      />,
    )
    expect(screen.getByTestId('formatted-script')).not.toBeNull()
    expect(screen.getByText('DAN').className).toContain('pl-[22%]')
    expect(screen.getByText('We are closed.').className).toContain('pl-[22%]')

    await user.click(screen.getByTestId('formatted-script'))
    const textarea = screen.getByTestId('beat-beat-3-1') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(false)
    await user.type(textarea, ' More.')
    expect(textarea.value).toBe('DAN\nWe are closed. More.')
  })

  it('reports each edit and asks for a save on blur (autosave hooks)', async () => {
    const user = userEvent.setup()
    const onBeatEdit = vi.fn()
    const onBeatBlur = vi.fn()
    render(
      <ScriptCanvas
        scenes={[
          scene({
            beats: [
              {
                id: 'beat-3-1',
                index: 0,
                locked: false,
                scriptLocked: false,
                actorCharacterId: null,
                actionVerb: '',
                targetCharacterId: null,
                reaction: '',
                whatHappens: '',
                audienceLearns: '',
                audienceFeels: '',
                scriptText: 'DAN\nWe are closed.',
              },
            ],
          }),
        ]}
        canvasHandlers={noopHandlers}
        onBeatEdit={onBeatEdit}
        onBeatBlur={onBeatBlur}
      />,
    )
    await user.click(screen.getByTestId('formatted-script'))
    await user.type(screen.getByTestId('beat-beat-3-1'), '!')
    expect(onBeatEdit).toHaveBeenLastCalledWith(
      'scene-1',
      'beat-3-1',
      'DAN\nWe are closed.!',
    )
    expect(onBeatBlur).not.toHaveBeenCalled()
    await user.tab()
    expect(onBeatBlur).toHaveBeenCalledOnce()
    // The typed text stays on the page after blur.
    expect(screen.getByTestId('formatted-script').textContent).toContain(
      'We are closed.!',
    )
  })

  function beat(id: string, scriptText: string): Beat {
    return {
      id,
      index: 0,
      locked: false,
      scriptLocked: false,
      actorCharacterId: null,
      actionVerb: '',
      targetCharacterId: null,
      reaction: '',
      whatHappens: '',
      audienceLearns: '',
      audienceFeels: '',
      scriptText,
    }
  }

  it('the optimistic Accept placeholder is read-only (it re-keys when the accept lands)', async () => {
    const user = userEvent.setup()
    render(
      <ScriptCanvas
        scenes={[
          scene({ beats: [beat('optimistic-pending-accept', 'Accepted.')] }),
        ]}
        canvasHandlers={noopHandlers}
      />,
    )
    await user.click(screen.getByTestId('formatted-script'))
    expect(screen.queryByTestId('beat-optimistic-pending-accept')).toBeNull()
    expect(screen.queryByText('Locked — click the lock to edit')).toBeNull()
  })

  it('beats in a locked scene or a locked episode are read-only (effective locks)', async () => {
    const user = userEvent.setup()
    render(
      <ScriptCanvas
        scenes={[
          scene({ id: 'scene-1', locked: true, beats: [beat('b-1', 'One.')] }),
          scene({ id: 'scene-2', beats: [beat('b-2', 'Two.')] }),
        ]}
        lockedEpisodeSceneIds={new Set(['scene-2'])}
        canvasHandlers={noopHandlers}
      />,
    )
    for (const el of screen.getAllByTestId('formatted-script')) {
      await user.click(el)
    }
    expect(screen.queryByTestId('beat-b-1')).toBeNull()
    expect(screen.queryByTestId('beat-b-2')).toBeNull()
    expect(screen.getAllByText('Locked — click the lock to edit')).toHaveLength(
      2,
    )
  })

  it("picks up the server's text after a refetch, unless the row holds its own", async () => {
    const user = userEvent.setup()
    const scenes = (a: string, b: string) => [
      scene({ beats: [beat('b-1', a), { ...beat('b-2', b), index: 1 }] }),
    ]
    const { rerender } = render(
      <ScriptCanvas
        scenes={scenes('One.', 'Two.')}
        canvasHandlers={noopHandlers}
      />,
    )
    // The writer types into b-2 (unsaved / dropped text of its own).
    await user.click(screen.getAllByTestId('formatted-script')[1])
    await user.type(screen.getByTestId('beat-b-2'), ' Mine.')
    await user.tab()

    rerender(
      <ScriptCanvas
        scenes={scenes('One, newer.', 'Two, newer.')}
        canvasHandlers={noopHandlers}
      />,
    )
    expect(screen.getByTestId('beat-row-b-1').textContent).toContain(
      'One, newer.',
    )
    expect(screen.getByTestId('beat-row-b-2').textContent).toContain(
      'Two. Mine.',
    )
  })

  it('a locked beat stays formatted and is not editable', async () => {
    const user = userEvent.setup()
    render(
      <ScriptCanvas
        scenes={[
          scene({
            beats: [
              {
                id: 'beat-1-2',
                index: 1,
                locked: true,
                scriptLocked: true,
                actorCharacterId: null,
                actionVerb: '',
                targetCharacterId: null,
                reaction: '',
                whatHappens: '',
                audienceLearns: '',
                audienceFeels: '',
                scriptText: "Dan doesn't know yet.",
              },
            ],
          }),
        ]}
        canvasHandlers={noopHandlers}
      />,
    )
    expect(screen.getByTestId('formatted-script').textContent).toContain(
      "Dan doesn't know yet.",
    )
    // UI spec §4: caret placement reveals the hint (CSS peer-focus), so the
    // locked block must take focus without becoming an editor.
    await user.click(screen.getByTestId('formatted-script'))
    expect(document.activeElement).toBe(screen.getByTestId('formatted-script'))
    expect(screen.getByText('Locked — click the lock to edit')).not.toBeNull()
    expect(screen.queryByTestId('beat-beat-1-2')).toBeNull()
  })
})
