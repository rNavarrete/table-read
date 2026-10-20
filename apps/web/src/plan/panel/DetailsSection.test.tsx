// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Scene } from 'contract'
import { DetailsSection, type DetailsSectionProps } from './DetailsSection'
import { WithDrafts } from './testDrafts'

afterEach(cleanup)

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    act: 0,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - NIGHT',
    time: 'Night, closing time',
    socialSituation: 'Nearly empty bar; Dan closing alone.',
    whatHappens: 'Marta walks back in.',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats: [],
    ...overrides,
  }
}

function renderDetails(overrides: Partial<DetailsSectionProps> = {}) {
  const props: DetailsSectionProps = {
    scene: scene(),
    storylines: [],
    locked: false,
    saving: false,
    onSaveField: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
  render(<DetailsSection {...props} />, { wrapper: WithDrafts })
  return props
}

describe('DetailsSection', () => {
  it('shows Location and Time on one line and Social situation as a growing text area', () => {
    renderDetails()
    expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe(
      'INT. THE LONG POUR - NIGHT',
    )
    expect(screen.getByLabelText('Time').tagName).toBe('INPUT')
    expect(screen.getByLabelText('Social situation').tagName).toBe('TEXTAREA')
  })

  it('hides Storyline while the episode has no storylines, and shows it disabled otherwise', () => {
    renderDetails()
    expect(screen.queryByLabelText('Storyline')).toBeNull()
    cleanup()

    renderDetails({
      storylines: [{ id: 'A', summary: 'Marta.', characterIds: [] }],
    })
    expect(
      (screen.getByLabelText('Storyline') as HTMLSelectElement).disabled,
    ).toBe(true)
  })

  it("shows the scene's storyline letter and that storyline's summary (T10.2)", () => {
    renderDetails({
      scene: scene({ storyline: 'D' }),
      storylines: [
        { id: 'A', summary: 'Marta pulls the thread.', characterIds: [] },
        { id: 'D', summary: 'Reyes keeps dropping by.', characterIds: [] },
      ],
    })
    const select = screen.getByLabelText('Storyline') as HTMLSelectElement
    expect(select.value).toBe('D')
    const describedBy = select.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Reyes keeps dropping by.',
    )
    expect(screen.queryByText('Marta pulls the thread.')).toBeNull()
  })

  it('shows the letter alone when its storyline has no entry', () => {
    // A scene in no inferred storyline stays A, even when import kept only B.
    renderDetails({
      storylines: [
        { id: 'B', summary: 'Dan hides the money.', characterIds: [] },
      ],
    })
    const select = screen.getByLabelText('Storyline') as HTMLSelectElement
    expect(select.value).toBe('A')
    expect(select.getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByText('Dan hides the money.')).toBeNull()
  })

  it('editing location is silent: a plain Save, no structural footer (port from Inspector.test)', async () => {
    const user = userEvent.setup()
    const props = renderDetails()
    const input = screen.getByLabelText('Location')
    await user.clear(input)
    await user.type(input, 'INT. MARINA - DAY')

    expect(screen.queryByText('Structural change — review impact?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save field only' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSaveField).toHaveBeenCalledWith(
      'location',
      'INT. MARINA - DAY',
    )
  })

  it('a locked scene makes every detail read-only, with no Save', () => {
    renderDetails({ locked: true })
    expect(
      (screen.getByLabelText('Location') as HTMLInputElement).readOnly,
    ).toBe(true)
    expect(
      (screen.getByLabelText('Social situation') as HTMLTextAreaElement)
        .readOnly,
    ).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
