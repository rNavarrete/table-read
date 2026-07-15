// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Scene } from 'contract'
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
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...overrides,
  }
}

describe('ScriptCanvas', () => {
  it('uses the Quiet Tool raised script sheet chrome', () => {
    render(
      <ScriptCanvas scenes={[scene({ beats: [] })]} canvasHandlers={noopHandlers} />,
    )
    const sheet = screen.getByTestId('script-canvas')
    expect(sheet.className).toContain('max-w-script-col')
    expect(sheet.className).toContain('bg-tr-surface-raised')
    expect(sheet.className).toContain('shadow-raised')
  })

  it('empty scene shows a clear empty state, not a blank sheet', () => {
    render(
      <ScriptCanvas scenes={[scene({ beats: [] })]} canvasHandlers={noopHandlers} />,
    )
    expect(screen.getByText('No beats in this scene yet.')).not.toBeNull()
    expect(screen.getByTestId('script-scene-slug-scene-1').textContent).toContain(
      'THE LONG POUR',
    )
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
    expect(screen.getByTestId('script-scene-slug-scene-2').textContent).toContain(
      "JOSH'S OFFICE",
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
    await user.click(screen.getByTestId('beat-beat-2'))
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
    expect(screen.getByTestId('script-scene-slug-scene-1').textContent).toContain(
      "INT. RODNEY'S APARTMENT",
    )
    expect(screen.getByTestId('script-scene-pitch-scene-1').textContent).toContain(
      'anonymous envelope',
    )
    expect(screen.getByTestId('beat-plan-beat-1').textContent).toContain(
      'identical morning routine',
    )
    expect(screen.getByTestId('beat-plan-beat-1').textContent).toContain(
      'Audience learns',
    )
    const textarea = screen.getByTestId('beat-beat-1') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('an unlocked beat is a live, editable textarea', async () => {
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
                whatHappens: '',
                audienceLearns: '',
                audienceFeels: '',
                scriptText: 'Marta slides a note.',
              },
            ],
          }),
        ]}
        canvasHandlers={noopHandlers}
      />,
    )
    const textarea = screen.getByTestId('beat-beat-3-1') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(false)
    await user.type(textarea, ' More.')
    expect(textarea.value).toBe('Marta slides a note. More.')
  })

  it('a locked (or scriptLocked) beat renders read-only with a lock glyph and a focus hint, never editable', async () => {
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
    const textarea = screen.getByTestId('beat-beat-1-2') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)

    // Hint text exists in the DOM (its focus-only visibility is a CSS
    // peer-focus trick — e2e/write.spec.ts exercises the actual visibility).
    expect(screen.getByText('Locked — click the lock to edit')).not.toBeNull()

    await user.click(textarea)
    await user.keyboard('xyz')
    expect(textarea.value).toBe("Dan doesn't know yet.") // unchanged — readOnly holds
  })
})
