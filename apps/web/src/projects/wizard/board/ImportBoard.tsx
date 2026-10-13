import { useLayoutEffect, useRef, useState } from 'react'
import type { ProjectImportStageName } from 'contract'
import { actGroups, type BoardScene, type BoardState } from '../importBoard'
import {
  etaRange,
  formatElapsed,
  type ImportProgressState,
  initialImportProgressState,
  isImportProgressStale,
  isIndeterminate,
  type StageStatus,
  stageStatus,
} from '../importProgress'
import { usualRange } from '../importTimings'
import { BoardRail } from './BoardRail'
import {
  actBreakFlip,
  countUp,
  deal,
  drawString,
  offsetIn,
} from './boardMotion'
import { plural } from './boardText'
import { IndexCard } from './IndexCard'
import { StepSpine } from './StepSpine'

// "Breaking the Board" (UI spec §2a, prototype 2026-10-12): while the import
// runs, the episode's writers'-room board builds itself from real results.
// Rendering only: the wizard folds the stream into `board` and `progress`.

export type BoardPhase = 'streaming' | 'failed' | 'done'

const HEADLINES: Record<ProjectImportStageName, string> = {
  parsing_scenes: '',
  segmenting_beats: 'Reading your script',
  inferring_acts: 'Finding the act breaks',
  inferring_entities: 'Meeting the cast',
  inferring_promises: 'Tracing the story threads',
  inferring_overview: 'Writing the logline',
  extracting_facts: 'Pulling the facts',
  checking_consistency: 'Checking for continuity',
  saving: 'Saving your board',
}

function titleCase(label: string): string {
  return label.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function minutesRange(lo: number, hi: number): string {
  return lo === hi ? `about ${plural(lo, 'minute')}` : `${lo}–${hi} minutes`
}

/** "usually 10–20 s" / "usually 1–2 min" for a single-call step's clock. */
function usualText(stage: ProjectImportStageName, scenes: number) {
  const range = usualRange(stage, scenes)
  if (range === null) return null
  if (range.highSec < 90) return `${range.lowSec}–${range.highSec} s`
  const lo = Math.max(1, Math.round(range.lowSec / 60))
  const hi = Math.max(lo, Math.round(range.highSec / 60))
  return lo === hi ? `about ${lo} min` : `${lo}–${hi} min`
}

function clockLabel(stage: ProjectImportStageName, beats: number): string {
  if (stage === 'inferring_acts') return 'One read of the whole episode'
  if (stage === 'inferring_promises')
    return beats > 0
      ? `One long read of all ${beats} beats`
      : 'One long read of the whole script'
  if (stage === 'inferring_overview') return 'Writing the logline and overview'
  if (stage === 'checking_consistency')
    return 'Checking the board for continuity'
  return 'Saving your project'
}

function sag(a: { x: number; y: number }, z: { x: number; y: number }) {
  const droop = Math.min(90, Math.hypot(z.x - a.x, z.y - a.y) * 0.28)
  return `M${a.x},${a.y} Q${(a.x + z.x) / 2},${(a.y + z.y) / 2 + droop} ${z.x},${z.y}`
}

function pinCenter(desk: HTMLElement, index: string, thread: string) {
  const pin = desk.querySelector<HTMLElement>(
    `[data-index="${index}"] [data-pin="${thread}"]`,
  )
  if (!pin) return null
  const { x, y } = offsetIn(pin, desk)
  return { x: x + pin.offsetWidth / 2, y: y + pin.offsetHeight / 2 }
}

/** Strings hang from the pins' laid-out positions (lift and tilt ignored). */
function layoutStrings(desk: HTMLElement, svg: SVGSVGElement) {
  svg.querySelectorAll<SVGPathElement>('path[data-thread]').forEach((path) => {
    const { thread = '', from = '', to = '' } = path.dataset
    const a = pinCenter(desk, from, thread)
    const z = pinCenter(desk, to, thread)
    if (a && z) path.setAttribute('d', sag(a, z))
  })
}

/** Each clay act frame spans its tape label down to its last card. */
function layoutFrames(desk: HTMLElement) {
  desk.querySelectorAll<HTMLElement>('[data-frame]').forEach((frame) => {
    const { frame: act = '', last = '' } = frame.dataset
    const head = desk.querySelector<HTMLElement>(`[data-act-head="${act}"]`)
    const card = desk.querySelector<HTMLElement>(`[data-index="${last}"]`)
    if (!head || !card) return
    frame.style.top = `${head.offsetTop}px`
    frame.style.height = `${card.offsetTop + card.offsetHeight - head.offsetTop}px`
  })
}

function cardRects(desk: HTMLElement): Map<number, DOMRect> {
  return new Map(
    [...desk.querySelectorAll<HTMLElement>('[data-card]')].map((card) => [
      Number(card.dataset.index),
      card.getBoundingClientRect(),
    ]),
  )
}

function CountUp({ value, animate }: { value: number; animate: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (animate) return countUp(el, value)
    el.textContent = String(value)
  }, [value, animate])
  return <span ref={ref} />
}

export function ImportBoard({
  title,
  board,
  progress,
  phase,
  animate,
  nowMs,
  approxSceneCount,
  toReview = null,
  onOpenStory,
  onSeeInPlan,
}: {
  title: string
  board: BoardState
  progress: ImportProgressState
  phase: BoardPhase
  /** False for a burst (more than 8 frames at once, or cached): no motion. */
  animate: boolean
  nowMs: number
  /** The client's slugline count, shown until the server's split lands. */
  approxSceneCount: number
  toReview?: number | null
  onOpenStory: () => void
  onSeeInPlan: () => void
}) {
  const deskRef = useRef<HTMLDivElement>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  const lampRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dealt = useRef(0)
  const firstRects = useRef<Map<number, DOMRect> | null>(null)
  const drawn = useRef(false)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  const { scenes } = board
  const sceneCount = scenes.length || approxSceneCount
  const stage = progress.currentStage
  const groups = actGroups(board)
  const beats = scenes.reduce((sum, s) => sum + s.beatCount, 0)
  const readCount = scenes.filter((s) => s.read !== 'pending').length
  const factsCount = scenes.filter(
    (s) => s.factCount !== null || s.factsFailed,
  ).length
  const indeterminate =
    phase !== 'done' && stage !== null && isIndeterminate(stage)
  const stopped =
    phase === 'failed'
      ? (progress.stoppedStage ?? stage ?? 'parsing_scenes')
      : null
  const statusOf = (s: ProjectImportStageName): StageStatus =>
    phase === 'done'
      ? 'done'
      : s === stopped
        ? 'stopped'
        : stageStatus(progress, s)
  const elapsedMs =
    progress.startedAtMs === null
      ? 0
      : Math.max(0, nowMs - progress.startedAtMs)
  const eta =
    phase === 'streaming' && !isImportProgressStale(progress, nowMs, sceneCount)
      ? etaRange(progress, sceneCount, nowMs)
      : null
  const actSummary = groups
    .map(
      (g) => `${titleCase(g.label)}: ${plural(g.sceneIndexes.length, 'scene')}`,
    )
    .join(' · ')

  let headline: string
  if (phase === 'done') headline = 'The board is up.'
  else if (stage === null || stage === 'parsing_scenes')
    headline = scenes.length
      ? `${plural(scenes.length, 'scene')} found in your pages`
      : `About ${plural(approxSceneCount, 'scene')} found in your pages`
  else if (stage === 'inferring_acts' && board.actsKnown)
    headline = 'The breaks go up'
  else headline = HEADLINES[stage]

  // A single model call shows its result once it lands, its clock until then.
  let result: string | null = null
  if (stage === 'inferring_acts' && board.actsKnown) result = actSummary
  if (stage === 'inferring_promises' && board.threads)
    result = `${plural(board.threads.length, 'thread')} traced`
  if (stage === 'inferring_overview' && board.logline !== null)
    result = 'Logline written'
  if (stage === 'checking_consistency' && board.flags)
    result = `${plural(board.flags.contradictions, 'contradiction')} · ${plural(board.flags.tensions, 'tension')}`

  let caption: string
  if (phase === 'done') {
    caption = `Read in ${formatElapsed(elapsedMs)}. Every card is a scene; open your story to start working.`
  } else if (stage === null || stage === 'parsing_scenes') {
    const usual = etaRange(initialImportProgressState, sceneCount)
    caption = usual
      ? `Usually ${minutesRange(usual.lowMin, usual.highMin)} for a script this size. Keep this tab open.`
      : 'Keep this tab open.'
  } else if (stage === 'segmenting_beats') {
    caption = `Breaking scenes into beats · ${readCount} of ${sceneCount}`
  } else if (stage === 'extracting_facts') {
    caption = `Pulling facts · ${factsCount} of ${plural(sceneCount, 'scene')}`
  } else if (stage === 'inferring_entities') {
    const chunks = progress.stages.inferring_entities
    caption =
      chunks && chunks.total > 0
        ? `Meeting the cast · part ${chunks.done} of ${chunks.total}`
        : 'Reading who speaks in each scene'
  } else if (result !== null) {
    caption = result
  } else {
    const startedAt = progress.stageStartedAtMs[stage]
    const usual = usualText(stage, sceneCount)
    caption = [
      clockLabel(stage, beats),
      `${formatElapsed(startedAt === undefined ? 0 : nowMs - startedAt)} on this step`,
      ...(usual ? [`usually ${usual}`] : []),
    ].join(' · ')
  }
  if (phase === 'failed') caption += ' · Stopped'
  const sweeping =
    phase === 'streaming' && indeterminate && result === null && stage !== null

  // Throttled for screen readers: stage starts, the act result, and every
  // 10th scene. The text only changes at those moments.
  let announcement = headline
  if (phase === 'failed') announcement = ''
  else if (stage === 'segmenting_beats' && readCount >= 10)
    announcement = `${Math.floor(readCount / 10) * 10} of ${plural(sceneCount, 'scene')} read`
  else if (stage === 'extracting_facts' && factsCount >= 10)
    announcement = `${Math.floor(factsCount / 10) * 10} of ${plural(sceneCount, 'scene')} checked for facts`
  else if (stage === 'inferring_acts' && board.actsKnown)
    announcement = actSummary

  const liveStage = stage === 'segmenting_beats' || stage === 'extracting_facts'
  const lampState =
    phase !== 'streaming' || board.latestIndex === null
      ? 'off'
      : liveStage
        ? 'on'
        : 'idle'
  const focused = scenes.find((s) => s.index === focusedIndex) ?? null

  // The deck deals the cards when the server's split lands.
  useLayoutEffect(() => {
    const before = dealt.current
    dealt.current = scenes.length
    const desk = deskRef.current
    const deck = deckRef.current
    if (before > 0 || scenes.length === 0 || !animate || !desk || !deck) return
    deal([...desk.querySelectorAll<HTMLElement>('[data-card]')], deck, desk)
  }, [scenes.length, animate])

  // The act break flies every card from where it was (FLIP): remember where
  // the cards sit until the acts land.
  useLayoutEffect(() => {
    const desk = deskRef.current
    if (!desk) return
    if (!board.actsKnown) {
      firstRects.current = cardRects(desk)
      return
    }
    const first = firstRects.current
    firstRects.current = null
    if (first && animate) actBreakFlip(desk, first)
  })

  // The lamp glides to the newest card.
  useLayoutEffect(() => {
    const desk = deskRef.current
    const lamp = lampRef.current
    if (!desk || !lamp || board.latestIndex === null) return
    const card = desk.querySelector<HTMLElement>(
      `[data-index="${board.latestIndex}"]`,
    )
    if (!card) return
    const { x, y } = offsetIn(card, desk)
    lamp.style.transform = `translate(${x + card.offsetWidth / 2 - 150}px, ${y + card.offsetHeight / 2 - 110}px)`
  }, [board.latestIndex])

  useLayoutEffect(() => {
    const desk = deskRef.current
    const svg = svgRef.current
    if (!desk || !svg) return
    const draw = () => {
      layoutFrames(desk)
      layoutStrings(desk, svg)
    }
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  })

  useLayoutEffect(() => {
    if (!board.threads || drawn.current) return
    drawn.current = true
    const paths = svgRef.current?.querySelectorAll<SVGPathElement>('path')
    if (!animate || !paths) return
    const gap = Math.min(380, 1500 / Math.max(1, paths.length))
    paths.forEach((path, k) => drawString(path, k * gap))
  }, [board.threads, animate])

  const gridClass =
    'relative grid justify-center gap-2.5 p-3.5 grid-cols-[repeat(auto-fill,var(--tr-card-board-w))]'
  const card = (scene: BoardScene) => (
    <IndexCard
      key={scene.index}
      scene={scene}
      lifted={
        phase === 'streaming' && liveStage && scene.index === board.latestIndex
      }
      animate={animate}
      onFocus={setFocusedIndex}
      onBlur={() => setFocusedIndex(null)}
    />
  )
  const byIndex = new Map(scenes.map((s) => [s.index, s]))

  const summary = [
    plural(scenes.length, 'scene'),
    plural(beats, 'beat'),
    board.format && plural(board.format.actCount, 'act'),
    board.cast && plural(board.cast.total, 'character'),
    board.threads && plural(board.threads.length, 'thread'),
    plural(board.factTotal, 'fact') +
      (toReview ? ` (${toReview} to review)` : ''),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section
      data-testid="import-board"
      aria-label="Import board"
      className="tr-board grid gap-5"
    >
      <header className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="text-11 uppercase tracking-[.12em] text-tr-text-muted">
            {phase === 'done' ? 'Your board' : 'Importing'} · {title}
          </p>
          <h3
            key={headline}
            data-testid="board-headline"
            className="mb-1 mt-1.5 animate-[tr-board-fade_280ms_var(--tr-motion-settle)] font-ledger-display text-[40px] font-medium leading-[46px] tracking-[-.01em] text-tr-text-primary"
          >
            {headline}
          </h3>
          <p
            data-testid="board-caption"
            className="min-h-5 text-13 leading-5 text-tr-text-secondary tabular-nums"
          >
            {caption}
            {sweeping && (
              <span
                data-testid={`${stage}-indeterminate`}
                aria-hidden="true"
                className="ml-2.5 inline-block h-0.5 w-[90px] overflow-hidden rounded-sm bg-tr-border align-middle motion-reduce:hidden"
              >
                <i className="block h-full w-[35%] animate-[tr-board-sweep_1.5s_linear_infinite] bg-tr-coral" />
              </span>
            )}
          </p>
        </div>
        <div className="flex-none text-right text-13 leading-5 text-tr-text-secondary tabular-nums">
          <p>
            Elapsed{' '}
            <b className="font-medium text-tr-text-primary">
              {formatElapsed(elapsedMs)}
            </b>
          </p>
          {eta && (
            <p>
              typically about{' '}
              {eta.lowMin === eta.highMin
                ? eta.lowMin
                : `${eta.lowMin}–${eta.highMin}`}{' '}
              min left
            </p>
          )}
          {phase !== 'done' && board.factTotal > 0 && (
            <p>
              <CountUp value={board.factTotal} animate={animate} /> facts so far
            </p>
          )}
        </div>
      </header>

      <StepSpine statusOf={statusOf} />

      <div
        ref={deskRef}
        data-motion={animate ? 'on' : 'off'}
        className="group/desk relative min-h-[320px] overflow-hidden rounded-[18px] bg-tr-write-desk p-[26px] ring-1 ring-inset ring-tr-border"
      >
        <div
          ref={lampRef}
          aria-hidden="true"
          data-state={lampState}
          className="pointer-events-none absolute left-0 top-0 h-[220px] w-[300px] rounded-full opacity-0 transition-[transform,opacity] duration-500 ease-settle data-[state=idle]:animate-[tr-board-breathe_2.6s_ease-in-out_infinite] data-[state=idle]:opacity-100 data-[state=on]:opacity-100 motion-reduce:hidden"
          style={{
            background:
              'radial-gradient(closest-side, var(--tr-surface-raised), transparent)',
          }}
        />
        <div
          ref={deckRef}
          aria-hidden="true"
          className={`absolute left-[26px] top-[26px] z-[2] h-card-board-h w-card-board-w transition-opacity duration-300 ${scenes.length ? 'opacity-0' : ''}`}
        >
          {[0, 1, 2, 3].map((k) => (
            <div
              key={k}
              className="absolute inset-0 rounded-[4px] bg-tr-board-paper shadow-card-board"
              style={{
                transform: `translate(${k * 2}px, ${-k * 2}px) rotate(${k - 1.5}deg)`,
              }}
            />
          ))}
        </div>
        {scenes.length === 0 && (
          <p className="absolute left-[160px] top-12 z-[2] font-script text-13 text-tr-text-secondary">
            About {plural(approxSceneCount, 'index card')}
          </p>
        )}
        {/* One list, one keyed node per card, before and after the act
            break: a card keeps its focus and its DOM node (the FLIP flies the
            same node). The clay frames are measured behind the cards. */}
        <div className="relative z-[1]">
          {groups.map((group) => (
            <div
              key={group.act}
              aria-hidden="true"
              data-frame={group.act}
              data-last={group.sceneIndexes.at(-1)}
              className="absolute inset-x-0 -mt-3.5 box-content rounded-[14px] bg-tr-surface-clay py-3.5"
            />
          ))}
          {scenes.length > 0 && (
            <ol
              aria-label={
                groups.length > 0 ? 'Scenes by act' : 'In script order'
              }
              className={gridClass}
            >
              {groups.length > 0
                ? groups.flatMap((group) => [
                    <li
                      key={`act-${group.act}`}
                      role="presentation"
                      data-act-head={group.act}
                      data-testid={`board-act-${group.act}`}
                      className="relative col-span-full h-[22px] not-first:mt-9"
                    >
                      <span
                        data-tape
                        className="absolute -left-1 -top-1 -rotate-[1.5deg] border-x border-dashed border-tr-border bg-tr-board-paper px-3 pb-0.5 pt-[3px] font-script text-12 tracking-[.06em] text-tr-accent-ink shadow-raised"
                      >
                        {group.label}
                      </span>
                      <span className="absolute right-0 top-0.5 text-11 leading-4 text-tr-text-secondary">
                        {plural(group.sceneIndexes.length, 'scene')} ·{' '}
                        {plural(
                          group.sceneIndexes.reduce(
                            (sum, i) => sum + (byIndex.get(i)?.beatCount ?? 0),
                            0,
                          ),
                          'beat',
                        )}
                      </span>
                    </li>,
                    ...group.sceneIndexes.flatMap((i) => {
                      const scene = byIndex.get(i)
                      return scene ? [card(scene)] : []
                    }),
                  ])
                : [
                    <li
                      key="order"
                      role="presentation"
                      className="relative col-span-full h-[22px]"
                    >
                      <span className="absolute right-0 top-0.5 text-11 leading-4 text-tr-text-secondary">
                        In script order
                      </span>
                    </li>,
                    ...scenes.map(card),
                  ]}
            </ol>
          )}
        </div>
        <svg
          ref={svgRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[4] size-full overflow-visible"
        >
          {(board.threads ?? []).map((thread, k) =>
            thread.setupSceneIndex !== null &&
            thread.payoffSceneIndex !== null &&
            thread.setupSceneIndex !== thread.payoffSceneIndex ? (
              <path
                key={k}
                data-testid={`board-string-${k + 1}`}
                data-thread={k + 1}
                data-from={thread.setupSceneIndex}
                data-to={thread.payoffSceneIndex}
                pathLength={1}
                fill="none"
                strokeLinecap="round"
                strokeWidth={k === 0 ? 1.8 : 1.1}
                opacity={k === 0 ? 0.9 : 0.38}
                className="stroke-tr-sky"
              />
            ) : null,
          )}
        </svg>
      </div>

      {phase === 'streaming' && (
        <p className="-mt-2 text-12 text-tr-text-muted">
          Keep this tab open. Leaving pauses the import; finished work is saved.
        </p>
      )}

      <BoardRail
        board={board}
        focused={focused}
        waiting={phase === 'streaming' && indeterminate}
        animate={animate}
      />

      {phase === 'done' && (
        <div
          data-testid="board-finale"
          className="flex animate-[tr-board-fade_450ms_var(--tr-motion-settle)_both] flex-wrap items-center justify-between gap-3"
        >
          <p className="text-[14px] text-tr-text-secondary tabular-nums">
            {summary}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="see-it-in-plan"
              onClick={onSeeInPlan}
              className="rounded-[10px] px-4 py-2.5 text-13 font-medium text-tr-accent-ink hover:bg-tr-surface-sunken"
            >
              See it in Plan
            </button>
            <button
              type="button"
              data-testid="open-your-story"
              // The one next step: focused so Enter opens the story.
              autoFocus
              onClick={onOpenStory}
              className="rounded-[10px] bg-tr-coral px-4 py-2.5 text-13 font-medium text-tr-surface-raised shadow-write-cta hover:bg-tr-coral-hover"
            >
              Open your story
            </button>
          </div>
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  )
}
