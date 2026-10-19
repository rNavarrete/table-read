// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanField, type PlanFieldProps } from './PlanField'
import { WithDrafts } from './testDrafts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function props(overrides: Partial<PlanFieldProps> = {}): PlanFieldProps {
  return {
    label: 'What happens',
    draftKey: 'scene-1:whatHappens',
    sceneId: 'scene-1',
    value: 'Marta walks back in.',
    multiline: true,
    locked: false,
    saving: false,
    onSave: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('PlanField', () => {
  it('a structural field shows the review footer when dirty; Save field only sends the draft', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(<PlanField {...props({ structural: true, onSave })} />, {
      wrapper: WithDrafts,
    })
    expect(screen.queryByText('Structural change — review impact?')).toBeNull()

    const field = screen.getByLabelText('What happens')
    await user.clear(field)
    await user.type(field, 'A rewritten summary.')

    expect(
      screen.getByText('Structural change — review impact?'),
    ).not.toBeNull()
    // No onOpenReview → Open Review stays disabled with today's tooltip.
    const openReview = screen.getByRole('button', {
      name: 'Open Review',
    }) as HTMLButtonElement
    expect(openReview.disabled).toBe(true)
    expect(openReview.title).toBe('Open Review needs a scene or beat target')

    await user.click(screen.getByRole('button', { name: 'Save field only' }))
    expect(onSave).toHaveBeenCalledWith('A rewritten summary.')
  })

  it('Open Review sends the dirty draft', async () => {
    const user = userEvent.setup()
    const onOpenReview = vi.fn()
    render(<PlanField {...props({ structural: true, onOpenReview })} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText('What happens')
    await user.clear(field)
    await user.type(field, 'Marina rewrite.')
    await user.click(screen.getByRole('button', { name: 'Open Review' }))
    expect(onOpenReview).toHaveBeenCalledWith('Marina rewrite.')
  })

  it('Discard in the structural footer restores the server value', async () => {
    const user = userEvent.setup()
    render(<PlanField {...props({ structural: true })} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText('What happens') as HTMLTextAreaElement
    await user.type(field, ' More.')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(field.value).toBe('Marta walks back in.')
    expect(screen.queryByText('Structural change — review impact?')).toBeNull()
  })

  it('a plain field is silent: Save and Discard, never the review footer', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <PlanField
        {...props({
          label: 'Location',
          draftKey: 'scene-1:location',
          value: 'INT. THE LONG POUR - NIGHT',
          multiline: false,
          onSave,
        })}
      />,
      { wrapper: WithDrafts },
    )
    const input = screen.getByLabelText('Location')
    await user.clear(input)
    await user.type(input, 'INT. THE MARINA - DAY')

    expect(screen.queryByText('Structural change — review impact?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save field only' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Discard' })).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('INT. THE MARINA - DAY')
  })

  it('clears the draft only when the save succeeds', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(<PlanField {...props({ label: 'Audience learns', onSave })} />, {
      wrapper: WithDrafts,
    })
    await user.type(screen.getByLabelText('Audience learns'), ' Again.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull(),
    )
  })

  it('a failed save keeps the typed text and stays dirty through the optimistic value and its rollback', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(false)
    const base = props({ label: 'Audience learns', onSave })
    const { rerender } = render(<PlanField {...base} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText(
      'Audience learns',
    ) as HTMLTextAreaElement
    await user.type(field, ' Again.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // PlanScreen's optimistic set, then useProjectPatch's rollback.
    rerender(<PlanField {...base} value="Marta walks back in. Again." />)
    rerender(<PlanField {...base} value="Marta walks back in." />)

    expect(field.value).toBe('Marta walks back in. Again.')
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeNull()
  })

  it('typing back to the saved value is not dirty', async () => {
    const user = userEvent.setup()
    render(<PlanField {...props({ label: 'Audience learns' })} />, {
      wrapper: WithDrafts,
    })
    const field = screen.getByLabelText('Audience learns')
    await user.type(field, '!')
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeNull()
    await user.type(field, '{Backspace}')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('locked: read-only, shows the server value, no Save, Discard, footer or Suggest…', async () => {
    const user = userEvent.setup()
    const base = props({ structural: true, onSuggest: vi.fn() })
    const { rerender } = render(<PlanField {...base} />, {
      wrapper: WithDrafts,
    })
    await user.type(screen.getByLabelText('What happens'), ' Draft.')

    rerender(<PlanField {...base} locked />)
    const field = screen.getByLabelText('What happens') as HTMLTextAreaElement
    expect(field.readOnly).toBe(true)
    expect(field.value).toBe('Marta walks back in.')
    expect(screen.queryByText('Structural change — review impact?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()

    // Unlocking brings the kept draft back.
    rerender(<PlanField {...base} />)
    expect(field.value).toBe('Marta walks back in. Draft.')
  })

  it('disables the control and the buttons while a save is in flight', async () => {
    const user = userEvent.setup()
    const base = props({ label: 'Audience learns' })
    const { rerender } = render(<PlanField {...base} />, {
      wrapper: WithDrafts,
    })
    await user.type(screen.getByLabelText('Audience learns'), '!')
    rerender(<PlanField {...base} saving />)
    expect(
      (screen.getByLabelText('Audience learns') as HTMLTextAreaElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('auto-grows a multiline field to its content height', () => {
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      'scrollHeight',
      'get',
    ).mockReturnValue(120)
    render(<PlanField {...props()} />, { wrapper: WithDrafts })
    expect(
      (screen.getByLabelText('What happens') as HTMLTextAreaElement).style
        .height,
    ).toBe('120px')
  })

  it('waits for a closed <details> to open before sizing', () => {
    render(
      <details>
        <PlanField {...props()} />
      </details>,
      { wrapper: WithDrafts },
    )
    const field = screen.getByLabelText('What happens') as HTMLTextAreaElement
    expect(field.style.height).toBe('auto')
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      'scrollHeight',
      'get',
    ).mockReturnValue(96)
    field.closest('details')?.dispatchEvent(new Event('toggle'))
    expect(field.style.height).toBe('96px')
  })

  describe('Suggest…', () => {
    it('makes no request on render, focus or typing', async () => {
      const user = userEvent.setup()
      const onSuggest = vi.fn().mockResolvedValue([])
      render(<PlanField {...props({ value: '', onSuggest })} />, {
        wrapper: WithDrafts,
      })
      const field = screen.getByLabelText('What happens')
      await user.click(field)
      await user.type(field, 'x')
      await user.clear(field)
      expect(onSuggest).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Suggest…' })).not.toBeNull()
    })

    it('one click asks once; picking a chip fills the draft', async () => {
      const user = userEvent.setup()
      const onSuggest = vi
        .fn()
        .mockResolvedValue(['Dan stalls her at the office door.'])
      render(
        <PlanField {...props({ value: '', structural: true, onSuggest })} />,
        { wrapper: WithDrafts },
      )
      await user.click(screen.getByRole('button', { name: 'Suggest…' }))
      expect(onSuggest).toHaveBeenCalledTimes(1)
      await user.click(
        await screen.findByRole('listitem', {
          name: /Dan stalls her at the office door\./,
        }),
      )
      expect(
        (screen.getByLabelText('What happens') as HTMLTextAreaElement).value,
      ).toBe('Dan stalls her at the office door.')
      expect(screen.queryByTestId('suggestion-chips')).toBeNull()
      expect(
        screen.getByText('Structural change — review impact?'),
      ).not.toBeNull()
    })

    it('is hidden when the field has text or is locked', () => {
      const onSuggest = vi.fn()
      const { rerender } = render(<PlanField {...props({ onSuggest })} />, {
        wrapper: WithDrafts,
      })
      expect(screen.queryByRole('button', { name: 'Suggest…' })).toBeNull()
      rerender(<PlanField {...props({ value: '', locked: true, onSuggest })} />)
      expect(screen.queryByRole('button', { name: 'Suggest…' })).toBeNull()
    })

    it('says so when suggestions fail to load', async () => {
      const user = userEvent.setup()
      const onSuggest = vi.fn().mockRejectedValue(new Error('offline'))
      render(<PlanField {...props({ value: '', onSuggest })} />, {
        wrapper: WithDrafts,
      })
      await user.click(screen.getByRole('button', { name: 'Suggest…' }))
      expect(
        await screen.findByText("Couldn't load suggestions."),
      ).not.toBeNull()
    })

    it('never shows a reply that lands after the field moved to another scene', async () => {
      const user = userEvent.setup()
      const reply = deferred<string[]>()
      const onSuggest = vi.fn().mockReturnValue(reply.promise)
      const { rerender } = render(
        <PlanField {...props({ value: '', onSuggest })} />,
        { wrapper: WithDrafts },
      )
      await user.click(screen.getByRole('button', { name: 'Suggest…' }))
      rerender(
        <PlanField
          {...props({
            value: '',
            onSuggest,
            draftKey: 'scene-2:whatHappens',
            sceneId: 'scene-2',
          })}
        />,
      )
      reply.resolve(['Late idea for scene one.'])
      await act(async () => {
        await reply.promise
      })
      expect(screen.queryByTestId('suggestion-chips')).toBeNull()

      // The reply did land, on scene one's field, where it belongs.
      rerender(<PlanField {...props({ value: '', onSuggest })} />)
      expect(screen.getByTestId('suggestion-chips')).not.toBeNull()
      expect(onSuggest).toHaveBeenCalledTimes(1)
    })

    it("a late reply for one scene leaves another scene's chips alone", async () => {
      const user = userEvent.setup()
      const slow = deferred<string[]>()
      const onSuggest = vi
        .fn()
        .mockReturnValueOnce(slow.promise)
        .mockResolvedValueOnce(['Idea for scene two.'])
      const sceneTwo = {
        value: '',
        onSuggest,
        draftKey: 'scene-2:whatHappens',
        sceneId: 'scene-2',
      }
      const { rerender } = render(
        <PlanField {...props({ value: '', onSuggest })} />,
        { wrapper: WithDrafts },
      )
      await user.click(screen.getByRole('button', { name: 'Suggest…' }))
      rerender(<PlanField {...props(sceneTwo)} />)
      await user.click(screen.getByRole('button', { name: 'Suggest…' }))
      expect(await screen.findByText('Idea for scene two.')).not.toBeNull()

      slow.resolve(['Late idea for scene one.'])
      await act(async () => {
        await slow.promise
      })
      expect(screen.getByText('Idea for scene two.')).not.toBeNull()
    })
  })
})
