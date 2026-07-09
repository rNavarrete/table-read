// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
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
  it('empty scene shows the ghost placeholder, not a beat list', () => {
    render(
      <ScriptCanvas
        scene={scene({ beats: [] })}
        canvasHandlers={noopHandlers}
      />,
    )
    expect(screen.getByText('Write, or press Next Beat')).not.toBeNull()
  })

  it('an unlocked beat is a live, editable textarea', async () => {
    const user = userEvent.setup()
    render(
      <ScriptCanvas
        scene={scene({
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
        })}
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
        scene={scene({
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
        })}
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
