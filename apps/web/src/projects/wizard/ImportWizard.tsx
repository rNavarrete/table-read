import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import type {
  PdfExtractMethod,
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
import { formatImportCostLine } from './importCostEstimate'
import {
  advanceImportProgress,
  estimateRemainingMs,
  formatElapsed,
  type ImportProgressState,
  initialImportProgressState,
} from './importProgress'
import { analyzeSource } from './importSourceStats'
import { WizardShell } from './WizardShell'
import { clearDraft, loadDraft, saveDraft } from './wizardDraft'

const IMPORT_PATH = '/projects/new/import'

const ACCEPTED_EXTENSIONS = ['.fountain', '.txt', '.pdf']

const STAGE_ORDER: ProjectImportStageName[] = [
  'parsing_scenes',
  'segmenting_beats',
  'extracting_facts',
  'checking_consistency',
  'saving',
]

const STAGE_LABELS: Record<ProjectImportStageName, string> = {
  parsing_scenes: 'Parsing scenes',
  segmenting_beats: 'Segmenting beats',
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
  presetId: FormatPresetId
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
    presetId: 'one-hour-drama',
  }
}

function normalizeDraft(draft: Partial<ImportDraft> | null): ImportDraft {
  return {
    ...initialDraft(),
    ...draft,
    idempotencyKey: draft?.idempotencyKey || newIdempotencyKey(),
  }
}

function presetSummary(presetId: FormatPresetId): string {
  const preset = FORMAT_PRESETS[presetId]
  return `${preset.genre}, ${preset.runtimeMinutes} min, ${preset.actCount} acts`
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

function importCreateBody(draft: ImportDraft): ProjectImportCreateRequest {
  return {
    title: draft.title.trim(),
    format: FORMAT_PRESETS[draft.presetId],
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
  const [jumpTo, setJumpTo] = useState<
    { stepId: string; token: number } | undefined
  >(undefined)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  function validateBasics(): boolean {
    setBasicsTouched(true)
    return Boolean(draft.title.trim())
  }

  async function handleAnalyze() {
    if (session.phase === 'streaming') return
    setNowMs(Date.now())
    setSession({ ...INITIAL_SESSION, phase: 'streaming' })
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
          setSession((current) => ({
            ...current,
            progress: advanceImportProgress(current.progress, data, Date.now()),
          }))
          const result = data.result
          clearDraft(IMPORT_PATH)
          window.location.assign(
            `/plan?project=${encodeURIComponent(result.project.id)}`,
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
  const isEtaStale =
    session.progress.lastProgressAtMs !== null &&
    nowMs - session.progress.lastProgressAtMs > 30_000

  return (
    <WizardShell
      title="Import a script"
      hasEnteredData={hasEnteredData}
      jumpTo={jumpTo}
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
              {sourceTouched && !draft.source.trim() && !sourceError && (
                <p className="text-tr-danger">
                  Add a script before continuing.
                </p>
              )}
            </div>
          ),
        },
        {
          id: 'confirm-source',
          label: 'Confirm source',
          title: 'Confirm source',
          validate: validateSource,
          body: (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2 text-13 text-tr-text-secondary">
                <span>
                  {draft.filename
                    ? `${draft.filename} (${draft.sourceFormat})`
                    : `Pasted text (${draft.sourceFormat})`}
                </span>
                {draft.pdfExtract && (
                  <>
                    <span className="rounded-chip border border-tr-border bg-tr-surface-sunken px-2 py-1 text-12 text-tr-text-muted">
                      {pdfMethodLabel(draft.pdfExtract.method)}
                    </span>
                    <span>{draft.pdfExtract.pageCount} page(s)</span>
                  </>
                )}
              </div>
              {draft.pdfExtract?.warnings.length ? (
                <ul className="grid gap-1 text-13 text-tr-text-secondary">
                  {draft.pdfExtract.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <label className="text-13 font-medium text-tr-text-primary">
                Confirm source
                <textarea
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
              {sourceTouched && !draft.source.trim() && !sourceError && (
                <p className="text-tr-danger">
                  Add a script before continuing.
                </p>
              )}
            </div>
          ),
        },
        {
          id: 'basics',
          label: 'Confirm basics',
          title: 'Confirm basics',
          validate: validateBasics,
          body: (
            <div className="grid gap-4">
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
              <div className="grid gap-3">
                {Object.keys(FORMAT_PRESETS).map((presetId) => (
                  <label
                    key={presetId}
                    className="rounded-card border border-tr-border bg-tr-surface-page p-3 text-13 text-tr-text-primary"
                  >
                    <input
                      type="radio"
                      name="import-format-preset"
                      checked={draft.presetId === presetId}
                      onChange={() =>
                        updateDraft({
                          ...draft,
                          presetId: presetId as FormatPresetId,
                        })
                      }
                      className="mr-2"
                    />
                    {FORMAT_PRESET_LABELS[presetId as FormatPresetId]} ·{' '}
                    {presetSummary(presetId as FormatPresetId)}
                  </label>
                ))}
              </div>
            </div>
          ),
        },
        {
          id: 'review',
          label: 'Review source',
          title: 'Review source',
          body: (
            <div className="grid gap-3">
              <p>
                {draft.filename
                  ? `${draft.filename} (${draft.sourceFormat})`
                  : `Pasted text (${draft.sourceFormat})`}
              </p>
              <p>
                {stats.byteCount} bytes · {stats.charCount} characters ·{' '}
                {stats.lineCount} lines
              </p>
              <p>{formatImportCostLine(stats)}</p>
              <p>
                Estimate uses the classifier model; actual usage may vary.
                Create &amp; analyze script is the only action that sends this
                source to the model. Scenes, beats, pending Ledger facts, and
                consistency flags appear here only after that step.
              </p>
            </div>
          ),
        },
        {
          id: 'analyze',
          label: 'Analyze',
          title: 'Analyze',
          body: (
            <div className="grid gap-4">
              {(session.phase === 'idle' || session.phase === 'failed') &&
                stats.estimatedModelCalls > 0 && (
                  <p>{formatImportCostLine(stats)}</p>
                )}
              <ol aria-label="Import progress" className="grid gap-2">
                {STAGE_ORDER.map((stage) => {
                  const progress = session.progress.stages[stage] ?? {
                    done: 0,
                    total: 0,
                  }
                  const isHeavyStage =
                    stage === 'segmenting_beats' || stage === 'extracting_facts'
                  const isDone =
                    session.progress.completedStages.includes(stage)
                  const isCurrent =
                    session.progress.currentStage === stage && !isDone
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
                        <span className="text-tr-text-secondary">{status}</span>
                      </div>
                      {isHeavyStage && (
                        <div className="grid gap-1">
                          <span className="text-12 text-tr-text-muted">
                            {progress.done} of {progress.total}
                          </span>
                          <div
                            role="progressbar"
                            aria-label={`${STAGE_LABELS[stage]} progress`}
                            aria-valuemin={0}
                            aria-valuemax={progress.total}
                            aria-valuenow={progress.done}
                            className="h-1 overflow-hidden rounded-card bg-tr-surface-sunken"
                          >
                            <div
                              className="h-full bg-tr-coral"
                              style={{
                                width:
                                  progress.total > 0
                                    ? `${Math.min(100, (progress.done / progress.total) * 100)}%`
                                    : '0%',
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
              {session.phase === 'streaming' && (
                <p className="flex flex-wrap gap-2 text-13 text-tr-text-secondary">
                  <span>Elapsed {formatElapsed(elapsedMs)}</span>
                  {etaMs !== null ? (
                    <span>
                      about {Math.max(1, Math.ceil(etaMs / 60_000))} min left
                    </span>
                  ) : isEtaStale ? null : (
                    <span>estimating…</span>
                  )}
                </p>
              )}
              <p role="status" aria-live="polite">
                {session.phase === 'streaming' && session.liveAnnouncement}
              </p>
              {session.phase === 'failed' && session.error && (
                <div className="grid gap-3 rounded-card border border-tr-danger bg-tr-surface-page p-3">
                  <p className="text-tr-danger">
                    Import failed: {session.error.message}
                  </p>
                  <p className="text-13 text-tr-text-secondary">
                    Nothing was created. Your script and settings are still
                    here.
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
                      onClick={() =>
                        setJumpTo((current) => ({
                          stepId: 'source',
                          token: (current?.token ?? 0) + 1,
                        }))
                      }
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
            </div>
          ),
        },
      ]}
    />
  )
}
