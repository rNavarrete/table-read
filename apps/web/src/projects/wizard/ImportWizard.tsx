import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type {
  PdfExtractMethod,
  ShowFormat,
  ProjectImportCreateRequest,
  ProjectImportProgressEvent,
  ProjectImportStageName,
} from 'contract'
import { extractPdf, importCreateUrl } from '../../api/client'
import { streamSse } from '../../api/sse'
import {
  FORMAT_PRESET_LABELS,
  FORMAT_PRESETS,
  type FormatPresetId,
} from './FormatPresets'
import { detectFormat } from './detectFormat'
import { formatImportCostLine } from './importCostEstimate'
import {
  advanceImportProgress,
  estimateRemainingMs,
  formatElapsed,
  isImportProgressStale,
  type ImportProgressState,
  initialImportProgressState,
} from './importProgress'
import { analyzeSource } from './importSourceStats'
import { WizardShell } from './WizardShell'
import { clearDraft, loadDraft, saveDraft } from './wizardDraft'
import { saveLedgerView } from '../../ledger/viewPreference'

const IMPORT_PATH = '/projects/new/import'

const ACCEPTED_EXTENSIONS = ['.fountain', '.txt', '.pdf']

const STAGE_ORDER: ProjectImportStageName[] = [
  'parsing_scenes',
  'segmenting_beats',
  'inferring_acts',
  'inferring_entities',
  'inferring_promises',
  'inferring_overview',
  'extracting_facts',
  'checking_consistency',
  'saving',
]

const STAGE_LABELS: Record<ProjectImportStageName, string> = {
  parsing_scenes: 'Parsing scenes',
  segmenting_beats: 'Segmenting beats',
  inferring_acts: 'Inferring act structure',
  inferring_entities: 'Identifying characters & world',
  inferring_promises: 'Finding story threads & world rules',
  inferring_overview: 'Writing story overview',
  extracting_facts: 'Extracting facts',
  checking_consistency: 'Checking consistency',
  saving: 'Saving project',
}

interface ImportDraft {
  idempotencyKey: string
  activeTab: 'upload' | 'paste'
  source: string
  sourceFormat: 'fountain' | 'text'
  filename: string | null
  pdfExtract: PdfExtractMetadata | null
  title: string
  // 'script' follows what the script prints (detectFormat); a preset id is
  // the writer's explicit choice. Not named `presetId`: drafts saved before
  // 2026-10-11 stored that field with a one-hour-drama default, which must
  // not override what the script prints.
  formatChoice: FormatPresetId | 'script'
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
  phase: 'idle' | 'streaming' | 'failed'
  progress: ImportProgressState
  liveAnnouncement: string
  error: AnalyzeError | null
}

const INITIAL_SESSION: AnalyzeSession = {
  phase: 'idle',
  progress: initialImportProgressState,
  liveAnnouncement: '',
  error: null,
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
    formatChoice: 'script',
  }
}

function normalizeDraft(draft: Partial<ImportDraft> | null): ImportDraft {
  return {
    ...initialDraft(),
    ...draft,
    idempotencyKey: draft?.idempotencyKey || newIdempotencyKey(),
  }
}

function formatSummary(format: ShowFormat): string {
  const acts = `${format.actCount} act${format.actCount === 1 ? '' : 's'}`
  const extras = [
    format.coldOpen ? 'cold open' : null,
    format.tag ? 'tag' : null,
  ]
    .filter(Boolean)
    .map((part) => `, ${part}`)
    .join('')
  return `${format.genre}, ${format.runtimeMinutes} min, ${acts}${extras}`
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

function importCreateBody(
  draft: ImportDraft,
  format: ShowFormat,
): ProjectImportCreateRequest {
  return {
    title: draft.title.trim(),
    format,
    source: { format: draft.sourceFormat, content: draft.source },
  }
}

function shouldAnnounceProgress(
  previous: ImportProgressState,
  next: ImportProgressState,
  event: ProjectImportProgressEvent,
): boolean {
  if (event.type !== 'progress') return false
  const before = previous.stages[event.stage]?.done ?? 0
  const after = next.stages[event.stage]?.done ?? 0
  return after > before && after % 10 === 0
}

function liveAnnouncementFor(
  progress: ImportProgressState,
  event: ProjectImportProgressEvent,
): string | null {
  if (event.type === 'stage') {
    return `${STAGE_LABELS[event.name]}…`
  }
  if (event.type === 'progress') {
    const stage = progress.stages[event.stage]
    if (stage === undefined) return null
    return `${STAGE_LABELS[event.stage]} ${stage.done} of ${stage.total}`
  }
  return null
}

export function ImportWizard() {
  const [draft, setDraft] = useState<ImportDraft>(() =>
    normalizeDraft(loadDraft<Partial<ImportDraft>>(IMPORT_PATH)),
  )
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
  const detected = detectFormat(draft.source)
  const resolvedFormat =
    draft.formatChoice === 'script'
      ? detected.format
      : FORMAT_PRESETS[draft.formatChoice]
  // The script's own structure appears as an option only when no preset
  // matches it; a matching preset is simply pre-selected.
  const selectedFormat =
    draft.formatChoice === 'script'
      ? (detected.presetId ?? 'script')
      : draft.formatChoice

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

  async function handleAnalyze() {
    if (session.phase === 'streaming') return
    setNowMs(Date.now())
    setSession({ ...INITIAL_SESSION, phase: 'streaming' })
    let settled = false
    try {
      const frames = streamSse(
        importCreateUrl(),
        importCreateBody(draft, resolvedFormat),
        undefined,
        { 'Idempotency-Key': draft.idempotencyKey },
      )
      for await (const raw of frames) {
        const data = raw.data as ProjectImportProgressEvent
        if (data.type === 'stage') {
          setSession((current) => ({
            ...current,
            progress: advanceImportProgress(current.progress, data, Date.now()),
            liveAnnouncement: liveAnnouncementFor(current.progress, data) ?? '',
          }))
        } else if (data.type === 'progress') {
          setSession((current) => {
            const progress = advanceImportProgress(
              current.progress,
              data,
              Date.now(),
            )
            const announcement = shouldAnnounceProgress(
              current.progress,
              progress,
              data,
            )
              ? liveAnnouncementFor(progress, data)
              : current.liveAnnouncement
            return {
              ...current,
              progress,
              liveAnnouncement: announcement ?? current.liveAnnouncement,
            }
          })
        } else if (data.type === 'complete') {
          settled = true
          flushSync(() => {
            setSession((current) => ({
              ...current,
              progress: advanceImportProgress(
                current.progress,
                data,
                Date.now(),
              ),
            }))
          })
          const result = data.result
          clearDraft(IMPORT_PATH)
          // Land on the Ledger's Story tab: the overview and the facts to
          // review come first after an import (owner decision 2026-10-11).
          saveLedgerView(result.project.id, 'story')
          window.location.assign(
            `/ledger?project=${encodeURIComponent(result.project.id)}`,
          )
          return
        } else if (data.type === 'failed') {
          settled = true
          const { error } = data as { error: AnalyzeError }
          setSession((current) => ({ ...current, phase: 'failed', error }))
        }
      }
      if (!settled) {
        setSession((current) => ({
          ...current,
          phase: 'failed',
          error: { code: 'CONNECTION_ERROR', message: 'connection lost' },
        }))
      }
    } catch (caught) {
      setSession((current) => ({
        ...current,
        phase: 'failed',
        error: {
          code: 'CONNECTION_ERROR',
          message: caught instanceof Error ? caught.message : 'connection lost',
        },
      }))
    }
  }

  const stats = analyzeSource(draft.source)
  const hasEnteredData = Boolean(draft.source || draft.title)
  const elapsedMs =
    session.progress.startedAtMs === null
      ? 0
      : Math.max(0, nowMs - session.progress.startedAtMs)
  const etaMs = estimateRemainingMs(session.progress, nowMs)
  const isProgressStale = isImportProgressStale(session.progress, nowMs)

  return (
    <WizardShell
      title="Import a script"
      hasEnteredData={hasEnteredData}
      finalActionLabel={
        session.phase === 'streaming'
          ? 'Analyzing...'
          : 'Create & analyze script'
      }
      isFinalActionDisabled={session.phase === 'streaming'}
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
              {session.phase === 'streaming' ? (
                <p className="text-13 text-tr-text-secondary">
                  {draft.title} · {formatSummary(resolvedFormat)}
                </p>
              ) : (
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
                  <fieldset className="grid gap-2">
                    <legend className="text-13 font-medium text-tr-text-primary">
                      Format
                    </legend>
                    <p className="text-13 text-tr-text-secondary">
                      Read from the script: {detected.reason}.
                    </p>
                    {detected.presetId === null && (
                      <label className="rounded-card border border-tr-border bg-tr-surface-page p-3 text-13 text-tr-text-primary">
                        <input
                          type="radio"
                          name="import-format-preset"
                          checked={selectedFormat === 'script'}
                          onChange={() =>
                            updateDraft({ ...draft, formatChoice: 'script' })
                          }
                          className="mr-2"
                        />
                        As printed in the script ·{' '}
                        {formatSummary(detected.format)}
                      </label>
                    )}
                    {(Object.keys(FORMAT_PRESETS) as FormatPresetId[]).map(
                      (presetId) => (
                        <label
                          key={presetId}
                          className="rounded-card border border-tr-border bg-tr-surface-page p-3 text-13 text-tr-text-primary"
                        >
                          <input
                            type="radio"
                            name="import-format-preset"
                            checked={selectedFormat === presetId}
                            onChange={() =>
                              updateDraft({ ...draft, formatChoice: presetId })
                            }
                            className="mr-2"
                          />
                          {FORMAT_PRESET_LABELS[presetId]} ·{' '}
                          {formatSummary(FORMAT_PRESETS[presetId])}
                        </label>
                      ),
                    )}
                  </fieldset>
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
                <>
                  <ol aria-label="Import progress" className="grid gap-2">
                    {STAGE_ORDER.map((stage) => {
                      const progress = session.progress.stages[stage] ?? {
                        done: 0,
                        total: 0,
                      }
                      const isDone =
                        session.progress.completedStages.includes(stage)
                      const isCurrent =
                        session.progress.currentStage === stage && !isDone
                      const isIndeterminate = isCurrent && progress.done === 0
                      const visualPercent = isDone
                        ? 100
                        : progress.total > 0
                          ? Math.min(
                              100,
                              (progress.done / progress.total) * 100,
                            )
                          : 0
                      const status =
                        session.phase === 'idle'
                          ? 'Pending'
                          : isDone
                            ? 'Done'
                            : isCurrent
                              ? 'In progress'
                              : 'Pending'
                      return (
                        <li
                          key={stage}
                          aria-current={isCurrent ? 'step' : undefined}
                          className="grid gap-2 rounded-card border border-tr-border bg-tr-surface-page px-3 py-2 text-13"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span>{STAGE_LABELS[stage]}</span>
                            <span className="text-tr-text-secondary">
                              {status}
                            </span>
                          </div>
                          <div className="grid gap-1">
                            {progress.total > 1 && (
                              <span className="text-12 text-tr-text-muted">
                                {progress.done} of {progress.total}
                              </span>
                            )}
                            <div
                              role="progressbar"
                              aria-label={`${STAGE_LABELS[stage]} progress`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={
                                isIndeterminate ? undefined : visualPercent
                              }
                              aria-valuetext={
                                isIndeterminate
                                  ? `${STAGE_LABELS[stage]} in progress`
                                  : progress.total > 1
                                    ? `${progress.done} of ${progress.total}`
                                    : status
                              }
                              className="h-1 overflow-hidden rounded-card bg-tr-surface-sunken"
                            >
                              {isIndeterminate ? (
                                <div
                                  className="tr-import-progress-indeterminate h-full bg-tr-coral"
                                  data-testid={`${stage}-indeterminate`}
                                />
                              ) : (
                                <div
                                  className="h-full bg-tr-coral transition-[width]"
                                  style={{ width: `${visualPercent}%` }}
                                />
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                  {session.phase === 'streaming' && (
                    <p className="flex flex-wrap gap-2 text-13 text-tr-text-secondary">
                      <span>Elapsed {formatElapsed(elapsedMs)}</span>
                      {etaMs !== null ? (
                        <span>
                          about {Math.max(1, Math.ceil(etaMs / 60_000))} min
                          left
                        </span>
                      ) : isProgressStale ? null : (
                        <span>estimating…</span>
                      )}
                    </p>
                  )}
                </>
              )}
              <p role="status" aria-live="polite">
                {session.phase === 'streaming' && session.liveAnnouncement}
              </p>
            </div>
          ),
        },
      ]}
    />
  )
}
