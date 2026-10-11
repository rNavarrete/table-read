// @vitest-environment jsdom
import {
  act,
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
import { loadLedgerView } from '../../ledger/viewPreference'
import { extractPdf } from '../../api/client'
import { streamSse } from '../../api/sse'

vi.mock('../../api/client', () => ({
  extractPdf: vi.fn(),
  importCreateUrl: () => '/api/v1/projects/import',
}))

vi.mock('../../api/sse', () => ({
  streamSse: vi.fn(),
}))

const mockedExtractPdf = vi.mocked(extractPdf)
const mockedStreamSse = vi.mocked(streamSse)

const IMPORT_PATH = '/projects/new/import'

afterEach(() => {
  cleanup()
  localStorage.clear()
  mockedExtractPdf.mockReset()
  mockedStreamSse.mockReset()
  vi.restoreAllMocks()
  vi.useRealTimers()
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

async function* timedFramesFrom(
  events: Array<{ delayMs: number; event: string; data: unknown }>,
) {
  for (const event of events) {
    if (event.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, event.delayMs))
    }
    yield { event: event.event, data: event.data }
  }
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

  it('shows the import cost estimate on Review source', async () => {
    const user = userEvent.setup()
    render(<ImportWizard />)

    await user.click(screen.getByRole('tab', { name: 'Paste' }))
    await user.type(
      screen.getByLabelText('Paste script text'),
      [
        'INT. BAR - NIGHT',
        'Dan pours a drink.',
        '',
        'EXT. FERRY - DAY',
        'Marta watches the harbor.',
      ].join('\n'),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const titleInput = screen.getByLabelText('Title') as HTMLInputElement
    await user.type(titleInput, 'Harbor Draft')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText(/model calls/)).not.toBeNull()
    expect(screen.getByText(/Est\. \$/)).not.toBeNull()
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Harbor Lights',
    )
  })

  it('extracts a PDF and fills an editable confirm-source textarea', async () => {
    const user = userEvent.setup()
    mockedExtractPdf.mockResolvedValue({
      text: 'INT. GARAGE - DAY\nMarta studies the map.',
      method: 'text_layer',
      pageCount: 12,
      warnings: [],
    })
    render(<ImportWizard />)
    const file = new File(['%PDF-1.4'], 'Road Draft.pdf', {
      type: 'application/pdf',
    })

    await user.upload(screen.getByLabelText('Script file'), file)

    await waitFor(() => expect(mockedExtractPdf).toHaveBeenCalledWith(file))
    expect(screen.getByText('Text layer')).not.toBeNull()
    expect(screen.getByText(/Road Draft.pdf/)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const textarea = screen.getByLabelText(
      'Confirm source',
    ) as HTMLTextAreaElement
    expect(textarea.value).toBe('INT. GARAGE - DAY\nMarta studies the map.')
    await user.clear(textarea)
    await user.type(textarea, 'INT. GARAGE - NIGHT\nMarta changes the plan.')
    expect(textarea.value).toBe('INT. GARAGE - NIGHT\nMarta changes the plan.')
  })

  it('keeps Continue disabled until the PDF has been extracted', async () => {
    const user = userEvent.setup()
    let finish!: (value: Awaited<ReturnType<typeof extractPdf>>) => void
    mockedExtractPdf.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<ImportWizard />)
    const file = new File(['%PDF-1.4'], 'Road Draft.pdf', {
      type: 'application/pdf',
    })

    await user.upload(screen.getByLabelText('Script file'), file)
    await waitFor(() =>
      expect(screen.getByText('Extracting PDF source...')).not.toBeNull(),
    )
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect((continueButton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('Add a script before continuing.')).toBeNull()

    await act(async () =>
      finish({
        text: 'INT. GARAGE - DAY\nMarta studies the map.',
        method: 'text_layer',
        pageCount: 12,
        warnings: [],
      }),
    )
    expect((continueButton as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends edited PDF source as text when analyzing', async () => {
    const user = userEvent.setup()
    mockedExtractPdf.mockResolvedValue({
      text: 'INT. GARAGE - DAY\nMarta studies the map.',
      method: 'ocr',
      pageCount: 12,
      warnings: ['ocr_used'],
    })
    mockedStreamSse.mockImplementation(() =>
      framesFrom([
        {
          event: 'failed',
          data: { type: 'failed', error: { code: 'VALIDATION', message: 'x' } },
        },
      ]),
    )
    render(<ImportWizard />)
    const file = new File(['%PDF-1.4'], 'Road Draft.pdf', {
      type: 'application/pdf',
    })

    await user.upload(screen.getByLabelText('Script file'), file)
    await waitFor(() => expect(screen.getByText('OCR')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const source = screen.getByLabelText('Confirm source')
    await user.clear(source)
    await user.type(source, 'INT. GARAGE - NIGHT\nMarta changes the plan.')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )

    await waitFor(() => expect(mockedStreamSse).toHaveBeenCalledTimes(1))
    const [, body] = mockedStreamSse.mock.calls[0]
    expect(body).toMatchObject({
      title: 'Road Draft',
      source: {
        format: 'text',
        content: 'INT. GARAGE - NIGHT\nMarta changes the plan.',
      },
    })
  })

  it('rejects an unsupported file extension locally with no AI call', async () => {
    render(<ImportWizard />)
    const file = new File(['body'], 'script.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const input = screen.getByLabelText('Script file') as HTMLInputElement
    // `userEvent.upload` enforces the input's `accept` filter itself (so a
    // real browser file dialog restricted to supported extensions would never
    // offer a .docx); dispatch the change event directly to exercise this
    // component's *own* extension guard against a file that slipped through
    // (e.g. "All Files" in the OS picker).
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.change(input)

    expect(
      screen.getByText('Choose a .fountain, .txt, or .pdf file.'),
    ).not.toBeNull()
    expect(mockedExtractPdf).not.toHaveBeenCalled()
    expect(mockedStreamSse).not.toHaveBeenCalled()
  })

  it('streams named stages, sends the Idempotency-Key, and opens the Ledger Story tab on success', async () => {
    const user = userEvent.setup()
    const { assignSpy, restore } = stubLocationAssign()
    mockedStreamSse.mockImplementation(() =>
      framesFrom([
        { event: 'stage', data: { type: 'stage', name: 'parsing_scenes' } },
        { event: 'stage', data: { type: 'stage', name: 'segmenting_beats' } },
        { event: 'stage', data: { type: 'stage', name: 'inferring_acts' } },
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

    // The writer lands on the Ledger's Story tab: the overview, then the facts
    // waiting for review.
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith('/ledger?project=proj-imported'),
    )
    expect(loadLedgerView('proj-imported')).toBe('story')
    expect(screen.getByText('Inferring act structure')).not.toBeNull()

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

  it('commits terminal stage completion before navigating away', async () => {
    const user = userEvent.setup()
    const { assignSpy, restore } = stubLocationAssign()
    assignSpy.mockImplementation(() => {
      expect(
        screen.getByText('Parsing scenes').closest('li')?.textContent,
      ).toContain('Done')
      expect(
        screen.getByText('Saving project').closest('li')?.textContent,
      ).toContain('Done')
    })
    mockedStreamSse.mockImplementation(() =>
      framesFrom([
        { event: 'stage', data: { type: 'stage', name: 'parsing_scenes' } },
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

    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1))

    restore()
  })

  it('renders truthful streaming counters, elapsed time, ETA, and throttled announcements', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() =>
      timedFramesFrom([
        {
          delayMs: 0,
          event: 'stage',
          data: { type: 'stage', name: 'segmenting_beats' },
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          delayMs: 1_000,
          event: 'progress',
          data: {
            type: 'progress',
            stage: 'segmenting_beats',
            done: index + 1,
            total: 10,
          },
        })),
        {
          delayMs: 60_000,
          event: 'failed',
          data: {
            type: 'failed',
            error: { code: 'CONNECTION_ERROR', message: 'connection lost' },
          },
        },
      ]),
    )

    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')
    vi.useFakeTimers()
    fireEvent.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('Segmenting beats')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Segmenting beats')
    expect(screen.getByRole('status').textContent).not.toContain('1 of 10')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(screen.getByText('5 of 10')).not.toBeNull()
    expect(screen.getByText('Elapsed 0:05')).not.toBeNull()
    expect(screen.getByText('about 1 min left')).not.toBeNull()
    const segmentingProgress = screen.getByRole('progressbar', {
      name: 'Segmenting beats progress',
    })
    expect(segmentingProgress.getAttribute('aria-valuenow')).toBe('50')
    expect(segmentingProgress.getAttribute('aria-valuemax')).toBe('100')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })

    expect(screen.getByText('9 of 10')).not.toBeNull()
    expect(screen.getByRole('status').textContent).not.toContain('9 of 10')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByText('10 of 10')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toContain('10 of 10')
  })

  it('hides estimating before the first progress frame goes stale while elapsed remains', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() =>
      timedFramesFrom([
        {
          delayMs: 0,
          event: 'stage',
          data: { type: 'stage', name: 'segmenting_beats' },
        },
        {
          delayMs: 60_000,
          event: 'failed',
          data: {
            type: 'failed',
            error: { code: 'CONNECTION_ERROR', message: 'connection lost' },
          },
        },
      ]),
    )

    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')
    vi.useFakeTimers()
    fireEvent.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('estimating…')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })

    expect(screen.getByText('Elapsed 0:31')).not.toBeNull()
    expect(screen.queryByText('estimating…')).toBeNull()
    expect(screen.queryByText(/min left/)).toBeNull()
  })

  it('renders an indeterminate progressbar until a stage reports progress', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() =>
      timedFramesFrom([
        {
          delayMs: 0,
          event: 'stage',
          data: { type: 'stage', name: 'segmenting_beats' },
        },
        {
          delayMs: 0,
          event: 'progress',
          data: {
            type: 'progress',
            stage: 'segmenting_beats',
            done: 0,
            total: 0,
          },
        },
        {
          delayMs: 60_000,
          event: 'failed',
          data: {
            type: 'failed',
            error: { code: 'CONNECTION_ERROR', message: 'connection lost' },
          },
        },
      ]),
    )

    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')
    vi.useFakeTimers()
    fireEvent.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const progress = screen.getByRole('progressbar', {
      name: 'Segmenting beats progress',
    })
    expect(progress.getAttribute('aria-valuenow')).toBeNull()
    expect(screen.getByTestId('segmenting_beats-indeterminate')).not.toBeNull()
    expect(screen.getAllByRole('progressbar')).toHaveLength(9)
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
    expect(screen.getByText(/model calls/)).not.toBeNull()
    expect(screen.getByText(/Est\. \$/)).not.toBeNull()
    expect(
      screen.getByText(
        'Retry reuses compatible saved analysis and runs only the unfinished stages.',
      ),
    ).not.toBeNull()
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
