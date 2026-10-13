import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type {
  PdfExtractMethod,
  ProjectImportCreateRequest,
  ProjectImportProgressEvent,
} from 'contract'
import { extractPdf, importCreateUrl } from '../../api/client'
import { streamSse } from '../../api/sse'
import { ImportBoard } from './board/ImportBoard'
import {
  applyFound,
  type BoardState,
  emptyBoard,
  reconcileWithResult,
} from './importBoard'
import { formatImportCostLine } from './importCostEstimate'
import {
  advanceImportProgress,
  type ImportProgressState,
  initialImportProgressState,
} from './importProgress'
import { analyzeSource } from './importSourceStats'
import { WizardShell } from './WizardShell'
import { clearDraft, loadDraft, saveDraft } from './wizardDraft'
import { saveLedgerView } from '../../ledger/viewPreference'

const IMPORT_PATH = '/projects/new/import'

const ACCEPTED_EXTENSIONS = ['.fountain', '.txt', '.pdf']

// More `found` frames than this in one animation frame (or any cached one, a
// resume's replay) apply without motion (import board spec).
const MAX_ANIMATED_BATCH = 8

type FoundFrame = Extract<ProjectImportProgressEvent, { type: 'found' }>

interface ImportDraft {
  idempotencyKey: string
  activeTab: 'upload' | 'paste'
  source: string
  sourceFormat: 'fountain' | 'text'
  filename: string | null
  pdfExtract: PdfExtractMetadata | null
  title: string
}

interface PdfExtractMetadata {
  method: PdfExtractMethod
  pageCount: number
  warnings: string[]
}

interface AnalyzeError {
  code: string
  message: string
}

interface AnalyzeSession {
  phase: 'idle' | 'streaming' | 'failed' | 'done'
  progress: ImportProgressState
  board: BoardState
  animate: boolean
  error: AnalyzeError | null
  result: { projectId: string; toReview: number } | null
}

const INITIAL_SESSION: AnalyzeSession = {
  phase: 'idle',
  progress: initialImportProgressState,
  board: emptyBoard(),
  animate: true,
  error: null,
  result: null,
}

function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

function initialDraft(): ImportDraft {
  return {
    idempotencyKey: newIdempotencyKey(),
    activeTab: 'upload',
    source: '',
    sourceFormat: 'fountain',
    filename: null,
    pdfExtract: null,
    title: '',
  }
}

// A draft saved while the wizard still sent a format carries `formatChoice`
// (or the older `presetId`). The request no longer has that format, so its
// Idempotency-Key would hash a different body and the server would answer
// 409 IDEMPOTENCY_CONFLICT for an import it already finished: keep the
// source and title, but mint a fresh key.
type StoredDraft = Partial<ImportDraft> & {
  formatChoice?: unknown
  presetId?: unknown
}

function normalizeDraft(stored: StoredDraft | null): ImportDraft {
  const { formatChoice, presetId, ...draft } = stored ?? {}
  const stale = formatChoice !== undefined || presetId !== undefined
  return {
    ...initialDraft(),
    ...draft,
    idempotencyKey: (!stale && draft.idempotencyKey) || newIdempotencyKey(),
  }
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.(fountain|txt|pdf)$/i, '')
}

function detectedFormat(filename: string): 'fountain' | 'text' {
  return filename.toLowerCase().endsWith('.fountain') ? 'fountain' : 'text'
}

function pdfMethodLabel(method: PdfExtractMethod): string {
  return method === 'ocr' ? 'OCR' : 'Text layer'
}

// No format: the import works it out from the script (owner decision
// 2026-10-11), so the writer is never asked.
function importCreateBody(draft: ImportDraft): ProjectImportCreateRequest {
  return {
    title: draft.title.trim(),
    source: { format: draft.sourceFormat, content: draft.source },
  }
}

export function ImportWizard() {
  const [draft, setDraft] = useState<ImportDraft>(() => {
    const stored = loadDraft<StoredDraft>(IMPORT_PATH)
    const restored = normalizeDraft(stored)
    // Save a re-keyed draft at once, so a reload mid-import reuses its key.
    if (stored && restored.idempotencyKey !== stored.idempotencyKey) {
      saveDraft(IMPORT_PATH, restored)
    }
    return restored
  })
  const [sourceTouched, setSourceTouched] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [isExtractingPdf, setIsExtractingPdf] = useState(false)
  const [basicsTouched, setBasicsTouched] = useState(false)
  const [titleTouched, setTitleTouched] = useState(false)
  const [session, setSession] = useState<AnalyzeSession>(INITIAL_SESSION)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [textOpen, setTextOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const scriptTextRef = useRef<HTMLTextAreaElement | null>(null)
  const foundQueue = useRef<FoundFrame[]>([])
  const foundFlush = useRef<number | null>(null)

  useEffect(() => {
    if (session.phase !== 'streaming') return
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(intervalId)
  }, [session.phase])

  function updateDraft(nextDraft: ImportDraft) {
    setDraft(nextDraft)
    saveDraft(IMPORT_PATH, nextDraft)
  }

  async function handleFile(file: File) {
    const lowerName = file.name.toLowerCase()
    if (!ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      setSourceError('Choose a .fountain, .txt, or .pdf file.')
      return
    }
    if (lowerName.endsWith('.pdf')) {
      setSourceError(null)
      setIsExtractingPdf(true)
      try {
        const result = await extractPdf(file)
        if (!result.text) {
          setSourceError('That PDF produced no text. Choose another file.')
          return
        }
        updateDraft({
          ...draft,
          source: result.text,
          sourceFormat: 'text',
          filename: file.name,
          pdfExtract: {
            method: result.method,
            pageCount: result.pageCount,
            warnings: result.warnings,
          },
          title: titleTouched ? draft.title : titleFromFilename(file.name),
        })
      } catch (caught) {
        setSourceError(
          caught instanceof Error
            ? caught.message
            : 'Could not extract that PDF. Try again.',
        )
      } finally {
        setIsExtractingPdf(false)
      }
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : ''
      if (!content) {
        setSourceError('That file is empty. Choose a script with content.')
        return
      }
      setSourceError(null)
      updateDraft({
        ...draft,
        source: content,
        sourceFormat: detectedFormat(file.name),
        filename: file.name,
        pdfExtract: null,
        title: titleTouched ? draft.title : titleFromFilename(file.name),
      })
    }
    reader.onerror = () =>
      setSourceError('Could not read that file. Try again.')
    reader.readAsText(file)
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void handleFile(file)
  }

  function validateSource(): boolean {
    setSourceTouched(true)
    return (
      Boolean(draft.source.trim()) && sourceError === null && !isExtractingPdf
    )
  }

  function validateReview(): boolean {
    setBasicsTouched(true)
    setSourceTouched(true)
    return Boolean(draft.title.trim()) && Boolean(draft.source.trim())
  }

  function openScriptText() {
    flushSync(() => setTextOpen(true))
    scriptTextRef.current?.focus()
  }

  // `found` frames pile up between animation frames and land in one render;
  // the stream loop never waits for the board.
  function flushFound() {
    if (foundFlush.current !== null) cancelAnimationFrame(foundFlush.current)
    foundFlush.current = null
    const batch = foundQueue.current
    if (batch.length === 0) return
    foundQueue.current = []
    const animate =
      batch.length <= MAX_ANIMATED_BATCH && !batch.some((f) => f.cached)
    setSession((current) => ({
      ...current,
      animate,
      board: batch.reduce(
        (board, f) => applyFound(board, f.data),
        current.board,
      ),
    }))
  }

  function queueFound(frame: FoundFrame) {
    foundQueue.current.push(frame)
    foundFlush.current ??= requestAnimationFrame(flushFound)
  }

  function failSession(error: AnalyzeError) {
    flushFound()
    const now = Date.now()
    setSession((current) => ({
      ...current,
      phase: 'failed',
      error,
      progress: advanceImportProgress(
        current.progress,
        { type: 'failed' },
        now,
      ),
    }))
  }

  async function handleAnalyze() {
    if (session.phase === 'streaming' || session.phase === 'done') return
    const now = Date.now()
    setNowMs(now)
    // A retry starts the steps over but keeps the clock running (spec:
    // elapsed survives a resume in the same page). The board stays until the
    // new parse replaces it.
    setSession((current) => ({
      ...INITIAL_SESSION,
      phase: 'streaming',
      board: current.board,
      progress: {
        ...initialImportProgressState,
        startedAtMs: current.progress.startedAtMs,
        lastProgressAtMs: current.progress.startedAtMs === null ? null : now,
      },
    }))
    let settled = false
    try {
      const frames = streamSse(
        importCreateUrl(),
        importCreateBody(draft),
        undefined,
        { 'Idempotency-Key': draft.idempotencyKey },
      )
      for await (const raw of frames) {
        const data = raw.data as ProjectImportProgressEvent
        if (data.type === 'found') {
          queueFound(data)
        } else if (data.type === 'stage' || data.type === 'progress') {
          const at = Date.now()
          setSession((current) => ({
            ...current,
            progress: advanceImportProgress(current.progress, data, at),
          }))
        } else if (data.type === 'complete') {
          settled = true
          flushFound()
          const { result } = data
          const at = Date.now()
          setNowMs(at)
          setSession((current) => ({
            ...current,
            phase: 'done',
            animate: false,
            progress: advanceImportProgress(current.progress, data, at),
            board: reconcileWithResult(current.board, result),
            result: {
              projectId: result.project.id,
              toReview: result.newFacts.filter(
                (fact) => fact.status === 'pending_review',
              ).length,
            },
          }))
          clearDraft(IMPORT_PATH)
          return
        } else if (data.type === 'failed') {
          settled = true
          failSession((data as { error: AnalyzeError }).error)
        }
      }
      if (!settled) {
        failSession({ code: 'CONNECTION_ERROR', message: 'connection lost' })
      }
    } catch (caught) {
      failSession({
        code: 'CONNECTION_ERROR',
        message: caught instanceof Error ? caught.message : 'connection lost',
      })
    }
  }

  // The finale holds; the writer chooses where to go (owner decision
  // 2026-10-12). The Story tab first: the overview and the facts to review
  // (owner decision 2026-10-11).
  function openYourStory() {
    if (!session.result) return
    saveLedgerView(session.result.projectId, 'story')
    window.location.assign(
      `/ledger?project=${encodeURIComponent(session.result.projectId)}`,
    )
  }

  function seeItInPlan() {
    if (!session.result) return
    window.location.assign(
      `/plan?project=${encodeURIComponent(session.result.projectId)}`,
    )
  }

  const stats = analyzeSource(draft.source)
  const hasEnteredData = Boolean(draft.source || draft.title)
  const isRunning = session.phase === 'streaming' || session.phase === 'done'

  return (
    <WizardShell
      title="Import a script"
      hasEnteredData={hasEnteredData}
      finalActionLabel={
        session.phase === 'streaming'
          ? 'Analyzing...'
          : 'Create & analyze script'
      }
      isFinalActionDisabled={isRunning}
      wide={isRunning}
      onFinalAction={handleAnalyze}
      steps={[
        {
          id: 'source',
          label: 'Add script',
          title: 'Add the script',
          validate: validateSource,
          isContinueDisabled: isExtractingPdf,
          body: (
            <div className="grid gap-4">
              <div
                className="flex gap-2"
                role="tablist"
                aria-label="Source input method"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={draft.activeTab === 'upload'}
                  onClick={() => updateDraft({ ...draft, activeTab: 'upload' })}
                  className={
                    draft.activeTab === 'upload'
                      ? 'rounded-chip bg-tr-coral-soft px-3 py-2 text-13 font-medium text-tr-accent-ink'
                      : 'rounded-chip bg-tr-surface-raised px-3 py-2 text-13 text-tr-text-secondary'
                  }
                >
                  Upload
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draft.activeTab === 'paste'}
                  onClick={() => updateDraft({ ...draft, activeTab: 'paste' })}
                  className={
                    draft.activeTab === 'paste'
                      ? 'rounded-chip bg-tr-coral-soft px-3 py-2 text-13 font-medium text-tr-accent-ink'
                      : 'rounded-chip bg-tr-surface-raised px-3 py-2 text-13 text-tr-text-secondary'
                  }
                >
                  Paste
                </button>
              </div>

              {draft.activeTab === 'upload' ? (
                <div className="grid gap-2">
                  <label className="text-13 font-medium text-tr-text-primary">
                    Script file
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".fountain,.txt,.pdf"
                      aria-invalid={sourceTouched && !draft.source.trim()}
                      onChange={handleFileInputChange}
                      className="mt-1 block w-full text-13 text-tr-text-primary"
                    />
                  </label>
                  {draft.filename && (
                    <div className="flex flex-wrap items-center gap-2 text-13 text-tr-text-secondary">
                      <span>
                        {draft.filename} · detected format: {draft.sourceFormat}
                      </span>
                      {draft.pdfExtract && (
                        <span className="rounded-chip border border-tr-border bg-tr-surface-sunken px-2 py-1 text-12 text-tr-text-muted">
                          {pdfMethodLabel(draft.pdfExtract.method)}
                        </span>
                      )}
                    </div>
                  )}
                  {isExtractingPdf && (
                    <p role="status" className="text-13 text-tr-text-secondary">
                      Extracting PDF source...
                    </p>
                  )}
                </div>
              ) : (
                <label className="text-13 font-medium text-tr-text-primary">
                  Paste script text
                  <textarea
                    value={draft.source}
                    aria-invalid={sourceTouched && !draft.source.trim()}
                    onChange={(event) =>
                      updateDraft({
                        ...draft,
                        source: event.target.value,
                        sourceFormat: 'text',
                        filename: null,
                        pdfExtract: null,
                      })
                    }
                    className="mt-1 block min-h-40 w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                  />
                </label>
              )}
              {sourceError && <p className="text-tr-danger">{sourceError}</p>}
              {sourceTouched &&
                !draft.source.trim() &&
                !sourceError &&
                !isExtractingPdf && (
                  <p className="text-tr-danger">
                    Add a script before continuing.
                  </p>
                )}
            </div>
          ),
        },
        {
          id: 'review',
          label: 'Check & start',
          title: 'Check & start',
          validate: validateReview,
          body: (
            <div className="grid gap-5">
              {session.phase === 'failed' && session.error && (
                <div className="grid gap-3 rounded-card border border-tr-danger bg-tr-surface-page p-3">
                  <p className="text-tr-danger">
                    Import failed: {session.error.message}
                  </p>
                  <p className="text-13 text-tr-text-secondary">
                    Nothing was created. Your script and settings are still
                    here.
                  </p>
                  <p className="text-12 text-tr-text-muted">
                    Retry reuses compatible saved analysis and runs only the
                    unfinished stages.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleAnalyze}
                      className="rounded-card bg-tr-coral px-3 py-2 text-13 font-medium text-tr-surface-raised"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={openScriptText}
                      className="rounded-card border border-tr-border px-3 py-2 text-13 font-medium text-tr-text-secondary"
                    >
                      Edit source
                    </button>
                    <a
                      href="/projects"
                      className="rounded-card border border-tr-border px-3 py-2 text-13 font-medium text-tr-text-secondary"
                    >
                      Return to dashboard
                    </a>
                  </div>
                </div>
              )}
              {!isRunning && (
                <>
                  <label className="text-13 font-medium text-tr-text-primary">
                    Title
                    <input
                      value={draft.title}
                      aria-invalid={basicsTouched && !draft.title.trim()}
                      onChange={(event) => {
                        setTitleTouched(true)
                        updateDraft({ ...draft, title: event.target.value })
                      }}
                      className="mt-1 block w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                    />
                  </label>
                  <p className="text-13 text-tr-text-secondary">
                    {draft.filename ?? 'Pasted text'} ·{' '}
                    {formatImportCostLine(stats)}
                  </p>
                  <details
                    open={textOpen}
                    onToggle={(event) => setTextOpen(event.currentTarget.open)}
                    className="rounded-card border border-tr-border bg-tr-surface-page p-3"
                  >
                    <summary className="cursor-pointer text-13 font-medium text-tr-text-primary">
                      Review the script text{' '}
                      {draft.pdfExtract && (
                        <span className="ml-2 rounded-chip border border-tr-border bg-tr-surface-sunken px-2 py-1 text-12 text-tr-text-muted">
                          {pdfMethodLabel(draft.pdfExtract.method)}
                        </span>
                      )}
                    </summary>
                    <div className="mt-3 grid gap-2">
                      {draft.pdfExtract && (
                        <p className="text-13 text-tr-text-secondary">
                          {draft.pdfExtract.pageCount} page(s) read from the
                          PDF. Fix any OCR mistakes here before analyzing.
                        </p>
                      )}
                      {draft.pdfExtract?.warnings.length ? (
                        <ul className="grid gap-1 text-13 text-tr-text-secondary">
                          {draft.pdfExtract.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                      <label className="text-13 font-medium text-tr-text-primary">
                        Script text
                        <textarea
                          ref={scriptTextRef}
                          value={draft.source}
                          aria-invalid={sourceTouched && !draft.source.trim()}
                          onChange={(event) =>
                            updateDraft({
                              ...draft,
                              source: event.target.value,
                            })
                          }
                          className="mt-1 block min-h-72 w-full rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13 text-tr-text-primary outline-none focus:border-tr-sky"
                        />
                      </label>
                    </div>
                  </details>
                  <p className="text-12 text-tr-text-muted">
                    Create &amp; analyze script is the only action that sends
                    this script to the model. The Narrative Map is a separate
                    step you start afterwards.
                  </p>
                </>
              )}
              {session.phase !== 'idle' && (
                <ImportBoard
                  title={draft.title}
                  board={session.board}
                  progress={session.progress}
                  phase={session.phase}
                  animate={session.animate}
                  nowMs={nowMs}
                  approxSceneCount={stats.detectedSceneCount}
                  toReview={session.result?.toReview ?? null}
                  onOpenStory={openYourStory}
                  onSeeInPlan={seeItInPlan}
                />
              )}
            </div>
          ),
        },
      ]}
    />
  )
}
