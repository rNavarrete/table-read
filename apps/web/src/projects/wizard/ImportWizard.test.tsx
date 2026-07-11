// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportWizard } from './ImportWizard'
import { loadDraft } from './wizardDraft'
import { streamSse } from '../../api/sse'

vi.mock('../../api/sse', () => ({
  streamSse: vi.fn(),
}))

const mockedStreamSse = vi.mocked(streamSse)

const IMPORT_PATH = '/projects/new/import'

afterEach(() => {
  cleanup()
  localStorage.clear()
  mockedStreamSse.mockReset()
  vi.restoreAllMocks()
})

function stubLocationAssign() {
  const assignSpy = vi.fn()
  const original = window.location
  Object.defineProperty(window, 'location', {
    value: {
      ...original,
      href: 'http://localhost/projects/new/import',
      assign: assignSpy,
    },
    writable: true,
  })
  return {
    assignSpy,
    restore: () =>
      Object.defineProperty(window, 'location', {
        value: original,
        writable: true,
      }),
  }
}

async function* framesFrom(events: Array<{ event: string; data: unknown }>) {
  for (const event of events) yield event
}

async function fillSourceAndBasics(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) {
  const file = new File(
    ['INT. BAR - NIGHT\nDan pours a drink.'],
    'ferry.fountain',
    {
      type: 'text/plain',
    },
  )
  await user.upload(screen.getByLabelText('Script file'), file)
  await waitFor(() => expect(screen.getByText(/ferry.fountain/)).not.toBeNull())
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  const titleInput = screen.getByLabelText('Title') as HTMLInputElement
  await user.clear(titleInput)
  await user.type(titleInput, title)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('ImportWizard', () => {
  it('does nothing until Create & analyze script is clicked', async () => {
    const user = userEvent.setup()
    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')

    expect(mockedStreamSse).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    ).not.toBeNull()
  })

  it('prefills the title from an uploaded filename and detects .fountain format', async () => {
    const user = userEvent.setup()
    render(<ImportWizard />)
    const file = new File(['INT. BAR\nx'], 'Harbor Lights.fountain', {
      type: 'text/plain',
    })
    await user.upload(screen.getByLabelText('Script file'), file)
    await waitFor(() =>
      expect(screen.getByText(/detected format: fountain/)).not.toBeNull(),
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Harbor Lights',
    )
  })

  it('rejects an unsupported file extension locally with no AI call', async () => {
    render(<ImportWizard />)
    const file = new File(['%PDF-1.4'], 'script.pdf', {
      type: 'application/pdf',
    })
    const input = screen.getByLabelText('Script file') as HTMLInputElement
    // `userEvent.upload` enforces the input's `accept` filter itself (so a
    // real browser file dialog restricted to .fountain/.txt would never
    // offer a .pdf); dispatch the change event directly to exercise this
    // component's *own* extension guard against a file that slipped through
    // (e.g. "All Files" in the OS picker).
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.change(input)

    expect(screen.getByText('Choose a .fountain or .txt file.')).not.toBeNull()
    expect(mockedStreamSse).not.toHaveBeenCalled()
  })

  it('streams named stages, sends the Idempotency-Key, and opens Plan on success', async () => {
    const user = userEvent.setup()
    const { assignSpy, restore } = stubLocationAssign()
    mockedStreamSse.mockImplementation(() =>
      framesFrom([
        { event: 'stage', data: { type: 'stage', name: 'parsing_scenes' } },
        { event: 'stage', data: { type: 'stage', name: 'segmenting_beats' } },
        { event: 'stage', data: { type: 'stage', name: 'extracting_facts' } },
        {
          event: 'stage',
          data: { type: 'stage', name: 'checking_consistency' },
        },
        { event: 'stage', data: { type: 'stage', name: 'saving' } },
        {
          event: 'complete',
          data: {
            type: 'complete',
            result: {
              project: { id: 'proj-imported' },
              newFacts: [],
              consistencyFlags: [],
            },
          },
        },
      ]),
    )

    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')
    await user.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )

    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith('/plan?project=proj-imported'),
    )

    expect(mockedStreamSse).toHaveBeenCalledTimes(1)
    const [url, body, , headers] = mockedStreamSse.mock.calls[0]
    expect(url).toBe('/api/v1/projects/import')
    expect(body).toEqual({
      title: 'Ferry Crossing',
      format: {
        genre: 'drama',
        runtimeMinutes: 60,
        actCount: 5,
        coldOpen: true,
        tag: true,
        serialization: 0.7,
      },
      source: {
        format: 'fountain',
        content: 'INT. BAR - NIGHT\nDan pours a drink.',
      },
    })
    expect(headers).toEqual({
      'Idempotency-Key': expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    })
    expect(loadDraft(IMPORT_PATH)).toBeNull()

    restore()
  })

  it('on failure preserves the draft, creates no project, and offers recovery actions', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() =>
      framesFrom([
        { event: 'stage', data: { type: 'stage', name: 'parsing_scenes' } },
        {
          event: 'failed',
          data: {
            type: 'failed',
            error: { code: 'VALIDATION', message: 'coverage failed' },
          },
        },
      ]),
    )

    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')
    await user.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )

    await waitFor(() =>
      expect(screen.getByText(/coverage failed/)).not.toBeNull(),
    )
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Edit source' })).not.toBeNull()
    expect(
      screen.getByRole('link', { name: 'Return to dashboard' }),
    ).not.toBeNull()
    expect(loadDraft<{ title: string }>(IMPORT_PATH)?.title).toBe(
      'Ferry Crossing',
    )
  })

  it('"Edit source" returns to the source step without losing the draft', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() =>
      framesFrom([
        {
          event: 'failed',
          data: { type: 'failed', error: { code: 'VALIDATION', message: 'x' } },
        },
      ]),
    )

    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')
    await user.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit source' }),
      ).not.toBeNull(),
    )

    await user.click(screen.getByRole('button', { name: 'Edit source' }))

    expect(
      screen.getByRole('heading', { name: 'Add the script' }),
    ).not.toBeNull()
    expect(screen.getByText(/ferry.fountain/)).not.toBeNull()
  })
})
