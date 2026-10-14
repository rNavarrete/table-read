import { useEffect, useMemo, useRef, useState } from 'react'
import { plural } from '../projects/wizard/board/boardText'
import {
  HIGHLIGHT_TONE,
  matchesHighlight,
  type BoardModel,
  type Highlight,
  type TapeTone,
} from './story'

// The episode chart under the highlight bar (redesign spec §4.4): one block
// per scene in act bands, setup→payoff arcs, open-thread "?" arcs and the
// secret lane. Secondary and quiet: aria-hidden with one sentence beside it
// (the board is the accessible structure), no animation, a click only selects.

export interface ChartBlock {
  sceneId: string
  number: number
  x: number
  w: number
  cx: number
}
export interface ChartBand {
  act: number
  /** The act's label, or its short label when the band is under 72px wide. */
  text: string
  /** The full label, for the band's <title>. */
  title: string
  x0: number
  x1: number
}
export interface ChartLayout {
  width: number
  /** board order */
  blocks: ChartBlock[]
  byId: ReadonlyMap<string, ChartBlock>
  /** acts with scenes only */
  bands: ChartBand[]
}

const ACT_GAP = 12
const GAP = 2
const HEIGHT = 84
const BASE = 48 // block top
const LANE = 74 // secret lane
const FALLBACK_WIDTH = 960

/** Spec §4.4: act gaps of 12, block gaps of 2, a minimum of 6–12px per block
 * (as wide as fits), the rest shared by each scene's share of the script text
 * (equal shares without script). */
export function chartLayout(model: BoardModel, width: number): ChartLayout {
  const acts = model.acts.filter((a) => a.scenes.length > 0)
  const n = model.order.length
  const blocks: ChartBlock[] = []
  const bands: ChartBand[] = []
  if (n > 0) {
    const min = Math.max(
      6,
      Math.min(12, Math.floor((width - (acts.length - 1) * ACT_GAP) / n) - GAP),
    )
    const spare = Math.max(
      0,
      width - (acts.length - 1) * ACT_GAP - (n - acts.length) * GAP - n * min,
    )
    const total = model.order.reduce(
      (t, s) => t + (model.signals.get(s.id)?.scriptLength ?? 0),
      0,
    )
    const share = (id: string) =>
      total > 0 ? (model.signals.get(id)?.scriptLength ?? 0) / total : 1 / n
    let x = 0
    for (const act of acts) {
      const x0 = x
      for (const scene of act.scenes) {
        const w = min + spare * share(scene.id)
        blocks.push({
          sceneId: scene.id,
          number: scene.index + 1,
          x,
          w,
          cx: x + w / 2,
        })
        x += w + GAP
      }
      const x1 = x - GAP
      bands.push({
        act: act.act,
        title: act.label,
        text: x1 - x0 >= 72 ? act.label : act.short,
        x0,
        x1,
      })
      x = x1 + ACT_GAP
    }
  }
  // ponytail: past ~150 scenes at 1,000px the 6px floor overflows the width;
  // scroll the chart if that happens.
  return {
    width,
    blocks,
    byId: new Map(blocks.map((b) => [b.sceneId, b])),
    bands,
  }
}

export interface ChartArc {
  threadId: string
  setupSceneId: string
  /** null = open: never paid off in this episode. */
  payoffSceneId: string | null
  /** The setup block's centre. */
  x1: number
  /** The payoff block's centre, or the open arc's end. */
  x2: number
  /** The payoff plays first (a payoff_first issue). */
  amber: boolean
}
export interface ChartLane {
  secretId: string
  /** set, kept…, out: the scenes the lane touches (bold when one is selected). */
  sceneIds: string[]
  set: number
  kept: number[]
  /** null = never revealed in this episode: the line runs dashed to the right edge. */
  out: number | null
  x0: number
  x1: number
  /** Any order issue on this secret. */
  amber: boolean
}

/** Live threads (abandoned skipped, a setup missing from the board skipped, a
 * payoff in its own setup scene skipped) and secrets established on the board. */
export function chartMarks(
  model: BoardModel,
  layout: ChartLayout,
): { arcs: ChartArc[]; lanes: ChartLane[] } {
  const { byId, width } = layout
  const arcs: ChartArc[] = []
  for (const t of model.threads) {
    const setup = byId.get(t.setupSceneId)
    if (
      t.status === 'abandoned' ||
      !setup ||
      t.payoffSceneId === t.setupSceneId
    )
      continue
    const payoff = byId.get(t.payoffSceneId ?? '')
    arcs.push({
      threadId: t.id,
      setupSceneId: t.setupSceneId,
      payoffSceneId: payoff ? payoff.sceneId : null,
      x1: setup.cx,
      x2: payoff ? payoff.cx : Math.min(width - 8, setup.cx + 120),
      amber: model.issues.some(
        (i) => i.kind === 'payoff_first' && i.sourceId === t.id,
      ),
    })
  }
  const lanes: ChartLane[] = []
  for (const secret of model.secrets) {
    const set = byId.get(secret.establishedSceneId)
    if (!set) continue
    const out = byId.get(secret.revealedSceneId ?? '')
    const kept = [...new Set(secret.concealmentSceneIds ?? [])].flatMap(
      (id) => byId.get(id) ?? [],
    )
    const xs = [set, ...kept, ...(out ? [out] : [])].map((b) => b.cx)
    lanes.push({
      secretId: secret.id,
      sceneIds: [set, ...kept, ...(out ? [out] : [])].map((b) => b.sceneId),
      set: set.cx,
      kept: kept.map((b) => b.cx),
      out: out ? out.cx : null,
      x0: Math.min(...xs),
      x1: out ? Math.max(...xs) : width - 4,
      amber: model.issues.some(
        (i) => i.kind !== 'payoff_first' && i.sourceId === secret.id,
      ),
    })
  }
  return { arcs, lanes }
}

/** One sentence beside the aria-hidden SVG. */
export function chartSummary(model: BoardModel): string {
  const layout = chartLayout(model, FALLBACK_WIDTH)
  const { arcs, lanes } = chartMarks(model, layout)
  const open = arcs.filter((a) => a.payoffSceneId === null).length
  const parts = [
    arcs.length
      ? plural(arcs.length, 'setup-payoff thread') +
        (open ? ` (${open} open)` : '')
      : '',
    lanes.length ? plural(lanes.length, 'secret') : '',
    model.issues.length ? plural(model.issues.length, 'order problem') : '',
  ].filter(Boolean)
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
      : parts[0]
  return `Episode chart of ${plural(model.order.length, 'scene')} in ${plural(layout.bands.length, 'act')}${list ? `, with ${list}` : ''}; the board below lists every scene.`
}

// Literal class names: Tailwind only generates whole names it can see.
const TONE_FILL: Record<TapeTone, string> = {
  sky: 'fill-tr-sky',
  amber: 'fill-tr-amber',
  secret: 'fill-tr-ledger-secret-ink',
  accent: 'fill-tr-accent-ink',
}

export interface EpisodeChartProps {
  model: BoardModel
  /** May be a stale id: then nothing is selected. */
  selectedId: string | null
  highlight: Highlight
  draftSceneIds: ReadonlySet<string>
  episodeLocked: boolean
  onSelectScene: (sceneId: string) => void
}

/** null when the episode has no scenes. */
export function EpisodeChart({
  model,
  selectedId,
  highlight,
  draftSceneIds,
  episodeLocked,
  onSelectScene,
}: EpisodeChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)
  const empty = model.order.length === 0
  // Re-run on `empty`: the wrapper mounts only once there are scenes. Width
  // changes only through the observer; nothing listens to scroll.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width) || FALLBACK_WIDTH),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [empty])
  const layout = useMemo(() => chartLayout(model, width), [model, width])
  const marks = useMemo(() => chartMarks(model, layout), [model, layout])
  const summary = useMemo(() => chartSummary(model), [model])
  // ponytail: re-renders with the board on each keystroke (drafts); memo both
  // if typing lags at 70 scenes.
  if (empty) return null

  const lit = (id: string) =>
    highlight.kind !== 'none' && matchesHighlight(model, id, highlight)
  const litFill =
    highlight.kind === 'none' ? '' : TONE_FILL[HIGHLIGHT_TONE[highlight.kind]]
  const noted = (id: string) => {
    const s = model.signals.get(id)
    return !!(s?.storyNotes.length || s?.orderNotes.length)
  }
  const anyNote = layout.blocks.some((b) => noted(b.sceneId))
  const anyOpen = marks.arcs.some((a) => a.payoffSceneId === null)

  return (
    <div data-testid="episode-chart" ref={ref} className="mt-1.5">
      <svg
        aria-hidden="true"
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="block overflow-visible"
      >
        {layout.bands.map((band) => (
          <g key={band.act}>
            <text
              data-chart-band={band.act}
              x={band.x0}
              y={11}
              className="fill-tr-text-primary text-11 font-semibold tracking-wide"
            >
              <title>{band.title}</title>
              {band.text}
            </text>
            <line
              x1={band.x0}
              x2={band.x1}
              y1={16}
              y2={16}
              className="stroke-tr-border-strong"
            />
          </g>
        ))}

        {marks.arcs.map((arc) => {
          const on =
            !!selectedId &&
            (arc.setupSceneId === selectedId ||
              arc.payoffSceneId === selectedId)
          const strong = on || arc.amber || highlight.kind === 'threads'
          const strokeWidth = on || arc.amber ? 2 : 1.25
          const opacity = strong ? 1 : 0.45
          if (arc.payoffSceneId === null)
            return (
              <g key={arc.threadId} opacity={opacity}>
                <path
                  data-testid={`chart-arc-${arc.threadId}`}
                  data-tone="amber"
                  data-open
                  d={`M${arc.x1} ${BASE - 1} C${arc.x1} ${BASE - 26} ${arc.x2 - 26} ${BASE - 26} ${arc.x2} ${BASE - 26}`}
                  fill="none"
                  strokeDasharray="3 3"
                  strokeWidth={strokeWidth}
                  className="stroke-tr-amber"
                />
                <text
                  x={arc.x2 + 3}
                  y={BASE - 22}
                  className="fill-tr-amber text-11 font-semibold"
                >
                  ?
                </text>
              </g>
            )
          const h = Math.min(28, 6 + Math.abs(arc.x2 - arc.x1) * 0.08)
          const top = BASE - h * 1.3
          return (
            <path
              key={arc.threadId}
              data-testid={`chart-arc-${arc.threadId}`}
              data-tone={arc.amber ? 'amber' : 'sky'}
              d={`M${arc.x1} ${BASE - 1} C${arc.x1} ${top} ${arc.x2} ${top} ${arc.x2} ${BASE - 1}`}
              fill="none"
              strokeWidth={strokeWidth}
              opacity={opacity}
              className={arc.amber ? 'stroke-tr-amber' : 'stroke-tr-sky'}
            />
          )
        })}

        {layout.blocks.map((b) => {
          const s = model.signals.get(b.sceneId)
          const selected = b.sceneId === selectedId
          const match = lit(b.sceneId)
          const note = noted(b.sceneId)
          const draft = draftSceneIds.has(b.sceneId)
          const locked = episodeLocked || !!s?.scene.locked
          return (
            <g
              key={b.sceneId}
              data-testid={`chart-block-${b.sceneId}`}
              data-chart-block
              data-scene-id={b.sceneId}
              data-note={note || undefined}
              data-draft={draft || undefined}
              data-locked={locked || undefined}
              data-match={match || undefined}
              data-selected={selected || undefined}
              className="cursor-pointer"
              onClick={() => onSelectScene(b.sceneId)}
            >
              <title>
                {`${b.number} · ${s?.place ?? ''}${note ? ' — has a note' : ''}${locked ? ' — locked' : ''}`}
              </title>
              <rect
                x={b.x}
                y={BASE}
                width={b.w}
                height={16}
                rx={3}
                strokeWidth={selected ? 0 : 0.6}
                className={
                  selected
                    ? 'fill-tr-coral'
                    : `stroke-tr-border-strong ${match ? 'fill-tr-sky-soft' : 'fill-tr-surface-clay'}`
                }
              />
              {match && !selected && (
                <rect
                  x={b.x}
                  y={BASE + 13.5}
                  width={b.w}
                  height={2.5}
                  className={litFill}
                />
              )}
              {note && (
                <rect
                  x={b.x}
                  y={BASE}
                  width={b.w}
                  height={2.5}
                  rx={1}
                  className="fill-tr-amber"
                />
              )}
              {draft && (
                <circle
                  cx={b.cx}
                  cy={BASE - 4}
                  r={2.5}
                  className="fill-tr-coral"
                />
              )}
              {b.w >= 16 && (
                <text
                  x={b.cx}
                  y={BASE + 12}
                  textAnchor="middle"
                  className={`text-11 font-semibold ${selected ? 'fill-tr-surface-raised' : 'fill-tr-text-primary'}`}
                >
                  {b.number}
                </text>
              )}
              {locked && (
                <rect
                  x={b.x + 2}
                  y={BASE + 17}
                  width={Math.max(0, b.w - 4)}
                  height={1.5}
                  className="fill-tr-amber"
                />
              )}
            </g>
          )
        })}

        {marks.lanes.map((lane) => {
          const on =
            (!!selectedId && lane.sceneIds.includes(selectedId)) ||
            lane.amber ||
            highlight.kind === 'secret'
          const fill = lane.amber
            ? 'fill-tr-amber'
            : 'fill-tr-ledger-secret-ink'
          return (
            <g
              key={lane.secretId}
              data-testid={`chart-lane-${lane.secretId}`}
              data-tone={lane.amber ? 'amber' : 'secret'}
              opacity={on ? 1 : 0.6}
            >
              <line
                x1={lane.x0}
                x2={lane.x1}
                y1={LANE}
                y2={LANE}
                strokeWidth={1.25}
                strokeDasharray={lane.out === null ? '3 3' : undefined}
                className={
                  lane.amber ? 'stroke-tr-amber' : 'stroke-tr-ledger-secret-ink'
                }
              />
              <text
                x={lane.set}
                y={LANE + 4}
                textAnchor="middle"
                className={`text-11 ${fill}`}
              >
                ◆
              </text>
              {lane.kept.map((cx, i) => (
                <circle key={i} cx={cx} cy={LANE} r={2.2} className={fill} />
              ))}
              {lane.out !== null && (
                <text
                  x={lane.out}
                  y={LANE + 4}
                  textAnchor="middle"
                  className={`text-11 ${fill}`}
                >
                  ◇
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <p className="sr-only">{summary}</p>
      {(model.hasThreads || anyOpen || marks.lanes.length > 0 || anyNote) && (
        <div
          aria-hidden="true"
          className="mt-1 flex flex-wrap gap-4 text-11 text-tr-text-primary"
        >
          {model.hasThreads && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-4 border-t-2 border-tr-sky" />
              setup → payoff
            </span>
          )}
          {anyOpen && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-4 border-t-2 border-dashed border-tr-amber" />
              ? open thread
            </span>
          )}
          {marks.lanes.length > 0 && (
            <span className="text-tr-ledger-secret-ink">
              ◆ set · • kept · ◇ out
            </span>
          )}
          {anyNote && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2.5 rounded-sm border-t-2 border-tr-amber bg-tr-surface-clay" />
              has a note
            </span>
          )}
        </div>
      )}
    </div>
  )
}
