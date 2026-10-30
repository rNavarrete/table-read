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
import { loadDraft, saveDraft } from './wizardDraft'
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

const PROJECT_SCENE = {
  id: 'scene-1',
  index: 0,
  act: 0,
  location: 'INT. BAR - NIGHT',
  time: 'NIGHT',
  whatHappens: 'Dan pours a drink.',
  beats: [
    {
      scriptText: 'INT. BAR - NIGHT',
      whatHappens: 'Dan pours.',
      audienceLearns: '',
      audienceFeels: '',
    },
  ],
}

function completeFrame(projectId = 'proj-imported') {
  return {
    event: 'complete',
    data: {
      type: 'complete',
      result: {
        project: {
          id: projectId,
          format: {
            genre: 'drama',
            runtimeMinutes: 60,
            actCount: 1,
            coldOpen: false,
            tag: false,
            serialization: 0.5,
          },
          seriesBible: { characters: [{ id: 'char-dan' }] },
          seasons: [
            {
              episodes: [
                { scenes: [PROJECT_SCENE], threads: [], storyOverview: null },
              ],
            },
          ],
        },
        newFacts: [
          {
            id: 'fact-01',
            status: 'pending_review',
            sourceSpan: { sceneId: 'scene-1' },
            audienceKnows: true,
          },
        ],
        consistencyFlags: [],
      },
    },
  }
}

function stage(name: string) {
  return { event: 'stage', data: { type: 'stage', name } }
}

function found(stageName: string, data: unknown, cached = false) {
  return {
    event: 'found',
    data: { type: 'found', stage: stageName, cached, data },
  }
}

function scenesFound(count: number) {
  return found('parsing_scenes', {
    kind: 'scenes',
    scenes: Array.from({ length: count }, (_, index) => ({
      index,
      slugline: `INT. ROOM ${index + 1}`,
      lineCount: 3,
      intExt: 'int',
    })),
  })
}

function sceneFound(index: number, cached = false) {
  return found(
    'segmenting_beats',
    {
      kind: 'scene',
      index,
      beatCount: 2,
      whatHappens: `Reading ${index + 1}.`,
      failed: false,
    },
    cached,
  )
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
}

// GET /health, which the wizard reads to word the cost line.
function stubLlmMode(llmMode: string) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ status: 'ok', llmMode })),
  )
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

  it('shows the import cost estimate on Check & start', async () => {
    stubLlmMode('real')
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
    const titleInput = screen.getByLabelText('Title') as HTMLInputElement
    await user.type(titleInput, 'Harbor Draft')

    expect(
      await screen.findByText(
        /^This script has 2 scenes\. Importing it will cost about \$\d+\.\d\d on your API key, and at most \$\d+\.\d\d\.$/,
      ),
    ).not.toBeNull()
  })

  it('quotes no cost in demo mode', async () => {
    stubLlmMode('mock')
    const user = userEvent.setup()
    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Harbor Draft')
    expect(
      await screen.findByText('This script has 1 scene. Demo mode — no cost.'),
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

  it('extracts a PDF and fills the editable script text on Check & start', async () => {
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
    await user.click(screen.getByText(/Review the script text/))
    const textarea = screen.getByLabelText('Script text') as HTMLTextAreaElement
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
    await user.click(screen.getByText(/Review the script text/))
    const source = screen.getByLabelText('Script text')
    await user.clear(source)
    await user.type(source, 'INT. GARAGE - NIGHT\nMarta changes the plan.')
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

  it('streams the board, sends the Idempotency-Key, and holds on the finale until Open your story', async () => {
    const user = userEvent.setup()
    const { assignSpy, restore } = stubLocationAssign()
    mockedStreamSse.mockImplementation(() =>
      framesFrom([
        stage('parsing_scenes'),
        scenesFound(1),
        stage('segmenting_beats'),
        sceneFound(0),
        stage('inferring_acts'),
        stage('extracting_facts'),
        stage('checking_consistency'),
        stage('saving'),
        completeFrame(),
      ]),
    )

    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')
    await user.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )

    // The finale holds: nothing navigates on its own (owner decision
    // 2026-10-12).
    await waitFor(() =>
      expect(screen.getByTestId('board-finale')).not.toBeNull(),
    )
    expect(screen.getByTestId('board-headline').textContent).toBe(
      'The board is up.',
    )
    expect(screen.getByTestId('board-card-0').dataset.state).toBe('read')
    expect(screen.getByText('~ Reading 1.')).not.toBeNull()
    expect(screen.getByTestId('board-finale').textContent).toContain(
      '1 fact (1 to review)',
    )
    expect(document.activeElement).toBe(screen.getByTestId('open-your-story'))
    for (const step of screen.getAllByTestId(/^board-step-/))
      expect(step.dataset.status).toBe('done')
    // The finale keeps the board's wide column.
    expect(screen.getByRole('main').className).toContain('max-w-7xl')
    expect(assignSpy).not.toHaveBeenCalled()
    expect(loadDraft(IMPORT_PATH)).toBeNull()

    // The writer lands on the Ledger's Story tab: the overview, then the facts
    // waiting for review.
    await user.click(screen.getByTestId('open-your-story'))
    expect(assignSpy).toHaveBeenCalledWith('/ledger?project=proj-imported')
    expect(loadLedgerView('proj-imported')).toBe('story')

    expect(mockedStreamSse).toHaveBeenCalledTimes(1)
    const [url, body, , headers] = mockedStreamSse.mock.calls[0]
    expect(url).toBe('/api/v1/projects/import')
    expect(body).toEqual({
      title: 'Ferry Crossing',
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

    restore()
  })

  it('See it in Plan opens the project on the Plan board', async () => {
    const user = userEvent.setup()
    const { assignSpy, restore } = stubLocationAssign()
    mockedStreamSse.mockImplementation(() =>
      framesFrom([stage('parsing_scenes'), completeFrame('proj-plan')]),
    )

    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')
    await user.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )
    await user.click(await screen.findByTestId('see-it-in-plan'))

    expect(assignSpy).toHaveBeenCalledWith('/plan?project=proj-plan')
    restore()
  })

  it('fills cards as scenes are read, with elapsed, a typical ETA, and throttled announcements', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() =>
      timedFramesFrom([
        { delayMs: 0, ...stage('parsing_scenes') },
        { delayMs: 0, ...scenesFound(10) },
        { delayMs: 0, ...stage('segmenting_beats') },
        ...Array.from({ length: 10 }, (_, index) => [
          { delayMs: 1_000, ...sceneFound(index) },
          {
            delayMs: 0,
            event: 'progress',
            data: {
              type: 'progress',
              stage: 'segmenting_beats',
              done: index + 1,
              total: 10,
            },
          },
        ]).flat(),
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
      await vi.advanceTimersByTimeAsync(20)
    })

    expect(screen.getByTestId('board-headline').textContent).toBe(
      'Reading your script',
    )
    expect(screen.getByTestId('board-card-0').dataset.state).toBe('pending')
    expect(screen.getByRole('status').textContent).toBe('Reading your script')
    // The running board gets the wide column (narrow is the form's).
    expect(screen.getByRole('main').className).toContain('max-w-7xl')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(screen.getByTestId('board-caption').textContent).toBe(
      'Breaking scenes into beats · 5 of 10',
    )
    expect(screen.getByTestId('board-card-4').dataset.state).toBe('read')
    expect(screen.getByTestId('board-card-5').dataset.state).toBe('pending')
    expect(screen.getByText(/^Elapsed/).textContent).toBe('Elapsed 0:05')
    expect(screen.getByText(/min left$/).textContent).toMatch(
      /^typically about \d+(–\d+)? min left$/,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })
    expect(screen.getByRole('status').textContent).toBe('Reading your script')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByRole('status').textContent).toBe('10 of 10 scenes read')
  })

  it('hides the ETA after 30 s with no news while elapsed remains', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() =>
      timedFramesFrom([
        { delayMs: 0, ...stage('segmenting_beats') },
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
    expect(screen.queryByText(/min left$/)).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })

    expect(screen.getByText(/^Elapsed/).textContent).toBe('Elapsed 0:31')
    expect(screen.queryByText(/min left$/)).toBeNull()
  })

  it('shows single-call steps as indeterminate, never a fake half bar', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() =>
      timedFramesFrom([
        { delayMs: 0, ...stage('inferring_promises') },
        {
          // The server sends threads' "1 of 2" before the call starts.
          delayMs: 0,
          event: 'progress',
          data: {
            type: 'progress',
            stage: 'inferring_promises',
            done: 1,
            total: 2,
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
      await vi.advanceTimersByTimeAsync(8_000)
    })

    expect(
      screen.getByTestId('inferring_promises-indeterminate'),
    ).not.toBeNull()
    expect(screen.queryByText(/1 of 2/)).toBeNull()
    expect(screen.getByTestId('board-caption').textContent).toContain(
      '0:08 on this step',
    )
    expect(
      screen.getByTestId('board-step-inferring_promises').dataset.status,
    ).toBe('now')

    // A failed step freezes: Stopped, no sweep, no clock.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    const step = screen.getByTestId('board-step-inferring_promises')
    expect(step.dataset.status).toBe('stopped')
    expect(step.textContent).toContain('Stopped')
    expect(screen.queryByTestId('inferring_promises-indeterminate')).toBeNull()
    const frozen = screen.getByTestId('board-caption').textContent
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.getByTestId('board-caption').textContent).toBe(frozen)
  })

  it('lands a burst of cached frames without motion', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() =>
      timedFramesFrom([
        { delayMs: 0, ...stage('parsing_scenes') },
        { delayMs: 0, ...scenesFound(3) },
        { delayMs: 0, ...stage('segmenting_beats') },
        { delayMs: 0, ...sceneFound(0, true) },
        { delayMs: 0, ...sceneFound(1, true) },
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
      await vi.advanceTimersByTimeAsync(20)
    })

    expect(screen.getByTestId('board-card-1').dataset.state).toBe('read')
    expect(
      screen.getByTestId('import-board').querySelector('[data-motion]'),
    ).toHaveProperty('dataset.motion', 'off')
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
    expect(screen.getByText(/Importing it will cost about \$/)).not.toBeNull()
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
    // The board stays, frozen where it got to, in the form's narrow column.
    expect(screen.getByTestId('board-step-parsing_scenes').dataset.status).toBe(
      'stopped',
    )
    expect(screen.getByRole('main').className).toContain('max-w-3xl')
  })

  it('Retry starts the steps over on the same board and keeps the clock', async () => {
    const user = userEvent.setup()
    async function* stalled(events: Array<{ event: string; data: unknown }>) {
      yield* events
      await new Promise(() => {})
    }
    mockedStreamSse
      .mockImplementationOnce(() =>
        framesFrom([
          stage('parsing_scenes'),
          scenesFound(2),
          stage('segmenting_beats'),
          sceneFound(0),
          {
            event: 'failed',
            data: {
              type: 'failed',
              error: { code: 'LLM_UNAVAILABLE', message: 'unavailable' },
            },
          },
        ]),
      )
      .mockImplementationOnce(() =>
        stalled([stage('parsing_scenes'), scenesFound(2), sceneFound(0, true)]),
      )

    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')
    await user.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )
    await waitFor(() =>
      expect(
        screen.getByTestId('board-step-segmenting_beats').dataset.status,
      ).toBe('stopped'),
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(screen.getByTestId('board-card-0').dataset.state).toBe('read'),
    )
    expect(screen.getByTestId('board-step-parsing_scenes').dataset.status).toBe(
      'now',
    )
    expect(
      screen.getByTestId('board-step-segmenting_beats').dataset.status,
    ).toBe('waiting')
    expect(mockedStreamSse).toHaveBeenCalledTimes(2)
    // Same key: the server resumes from saved work.
    expect(mockedStreamSse.mock.calls[1][3]).toEqual(
      mockedStreamSse.mock.calls[0][3],
    )
  })

  it('"Edit source" opens the script text in place without losing the draft', async () => {
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

    const scriptText = screen.getByLabelText(
      'Script text',
    ) as HTMLTextAreaElement
    expect(scriptText.closest('details')?.open).toBe(true)
    expect(document.activeElement).toBe(scriptText)
    expect(scriptText.value).toBe('INT. BAR - NIGHT\nDan pours a drink.')
  })

  it('never asks for a format and sends none', async () => {
    const user = userEvent.setup()
    mockedStreamSse.mockImplementation(() => framesFrom([]))
    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')

    // The import works the format out from the script (owner decision
    // 2026-10-11).
    expect(screen.queryByText('Format')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    await user.click(
      screen.getByRole('button', { name: 'Create & analyze script' }),
    )
    await waitFor(() => expect(mockedStreamSse).toHaveBeenCalledTimes(1))
    expect(mockedStreamSse.mock.calls[0][1]).not.toHaveProperty('format')
  })

  it.each(['formatChoice', 'presetId'])(
    're-keys a draft that carries %s from when the wizard sent a format',
    async (formatKey) => {
      const user = userEvent.setup()
      mockedStreamSse.mockImplementation(() => framesFrom([]))
      const oldKey = '00000000-0000-4000-8000-000000000001'
      saveDraft(IMPORT_PATH, {
        idempotencyKey: oldKey,
        activeTab: 'paste',
        source: 'INT. BAR - NIGHT\nDan pours a drink.',
        sourceFormat: 'text',
        filename: null,
        pdfExtract: null,
        title: 'Pilot',
        [formatKey]: 'one-hour-drama',
      })
      render(<ImportWizard />)

      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await user.click(
        screen.getByRole('button', { name: 'Create & analyze script' }),
      )

      await waitFor(() => expect(mockedStreamSse).toHaveBeenCalledTimes(1))
      const [, body, , headers] = mockedStreamSse.mock.calls[0]
      // The old key was sent with a format; this body has none (409
      // IDEMPOTENCY_CONFLICT on the server).
      const newKey = (headers as Record<string, string>)['Idempotency-Key']
      expect(newKey).not.toBe(oldKey)
      expect(body).toEqual({
        title: 'Pilot',
        source: {
          format: 'text',
          content: 'INT. BAR - NIGHT\nDan pours a drink.',
        },
      })
      // Saved at once, so a reload mid-import sends the same new key.
      expect(loadDraft(IMPORT_PATH)).toMatchObject({ idempotencyKey: newKey })
      expect(loadDraft(IMPORT_PATH)).not.toHaveProperty(formatKey)
    },
  )

  it('shows the board only once the import has started', async () => {
    const user = userEvent.setup()
    render(<ImportWizard />)
    await fillSourceAndBasics(user, 'Ferry Crossing')

    // A board of "Not read yet" before anything runs would read as stuck.
    expect(screen.queryByTestId('import-board')).toBeNull()
    expect(screen.getByRole('main').className).toContain('max-w-3xl')
  })
})
