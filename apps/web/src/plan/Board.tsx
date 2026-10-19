import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { Scene } from 'contract'
import { plural } from '../projects/wizard/board/boardText'
import { ActHeader } from './ActHeader'
import { BoardCard } from './BoardCard'
import type { SceneMove } from './planTree'
import {
  HIGHLIGHT_TONE,
  highlightTape,
  lockedMoveText,
  matchesHighlight,
  NO_HIGHLIGHT,
  predictionTape,
  relationTape,
  type BoardModel,
  type CardTape,
  type Highlight,
  type MovePrediction,
  type SceneSignals,
} from './story'

export type PlanSelection =
  | { type: 'scene'; sceneId: string }
  | { type: 'beat'; sceneId: string; beatId: string }
  | null

export interface BoardProps {
  model: BoardModel
  episodeLocked: boolean
  /** A beat selection also marks its scene's card. */
  selection: PlanSelection
  collapsedActs: ReadonlySet<number>
  /** A write is in flight: no card starts a drag (a second write's rollback
   * would erase the first one's change; useProjectPatch also refuses it). */
  pending: boolean
  /** Scenes with unsaved Plan edits (drafts.dirtySceneIds): coral dot. */
  draftSceneIds?: ReadonlySet<string>
  onSelectScene: (sceneId: string) => void
  onOpenInWrite?: (sceneId: string) => void
  /** Every board move: a drop on a card or an empty act, ⌥← / ⌥→. */
  onMove: (move: SceneMove) => void
  onToggleAct: (act: number) => void
  /** Enter on the selected card: focus the panel heading. */
  onEnterPanel: () => void
  /** Matches get a ring and a tape, the rest go quiet (spec §4.5). */
  highlight?: Highlight
  /** Fold the rest: each run of non-matches in an act becomes one stub. */
  fold?: boolean
  /** Scenes the writer opened from a stub: they stay open whatever the
   * selection does to the runs around them. */
  unfolded?: ReadonlySet<string>
  onUnfold?: (sceneIds: string[]) => void
  /** Rendered sticky at the top of the board's scroll area (the highlight bar). */
  header?: ReactNode
  /** story.predictMove on the project: the drop target's tape, bar and
   * whether it takes the drop. Default: every move allowed, no problems. */
  predict?: (move: SceneMove) => MovePrediction
}

type Box = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>

/** The card in the next (dir 1) or previous (-1) visual row whose centre is
 * nearest this one's; null at the edge. Exported for the test. */
export function gridNeighbor(
  boxes: readonly Box[],
  from: number,
  dir: 1 | -1,
): number | null {
  const here = boxes[from]
  if (!here) return null
  const centre = (b: Box) => b.left + b.width / 2
  // ponytail: 4px tolerance for sub-pixel row tops; rows are flex-wrap lines.
  const beyond = boxes
    .map((b, i) => ({ b, i }))
    .filter(({ b }) =>
      dir > 0 ? b.top > here.bottom - 4 : b.bottom < here.top + 4,
    )
  if (beyond.length === 0) return null
  const tops = beyond.map(({ b }) => b.top)
  const rowTop = dir > 0 ? Math.min(...tops) : Math.max(...tops)
  return beyond
    .filter(({ b }) => Math.abs(b.top - rowTop) < 4)
    .reduce((best, c) =>
      Math.abs(centre(c.b) - centre(here)) <
      Math.abs(centre(best.b) - centre(here))
        ? c
        : best,
    ).i
}

const EMPTY: ReadonlySet<string> = new Set()
const NO_PREDICTION = (): MovePrediction => ({ issues: [] })

/** The move would happen: not refused by a lock, not a no-op. */
const allowed = (p: MovePrediction) => p !== null && !('blockedBy' in p)

const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'

type BoardItem =
  | { type: 'card'; scene: Scene }
  | { type: 'stub'; key: string; scenes: Scene[] }

/** Each run of scenes `keep` rejects becomes one stub keyed by its first
 * scene. */
function foldRuns(
  scenes: readonly Scene[],
  keep: (sceneId: string) => boolean,
): BoardItem[] {
  const items: BoardItem[] = []
  let run: Scene[] = []
  const flush = () => {
    if (run.length === 0) return
    items.push({ type: 'stub', key: run[0].id, scenes: run })
    run = []
  }
  for (const scene of scenes) {
    if (keep(scene.id)) {
      flush()
      items.push({ type: 'card', scene })
    } else run.push(scene)
  }
  flush()
  return items
}

/**
 * The Plan board (redesign spec §4.2–4.3): an act frame per board act with
 * its header, the scenes as index cards, and a drop box in an empty act.
 * Drag is native HTML5 (no dependency): Board holds the drag source, which
 * only a card allowed to drag can set, so a locked or pending card never
 * moves by drag. A drop inserts the card before or after the target (the
 * pointer's half, a coral bar on that side); `predict` decides whether a
 * target takes it, so a locked card takes only a drop that leaves it in
 * place, and a refused one tapes the reason. One card is the tab stop (the
 * selected one if rendered, else the last focused, else the first); arrows,
 * Home and End select and focus, ⌥← / ⌥→ step the card one slot, Enter on
 * the selected card goes to the panel.
 */
export function Board({
  model,
  episodeLocked,
  selection,
  collapsedActs,
  pending,
  draftSceneIds = EMPTY,
  onSelectScene,
  onOpenInWrite = () => {},
  onMove,
  onToggleAct,
  onEnterPanel,
  highlight = NO_HIGHLIGHT,
  fold = false,
  unfolded = EMPTY,
  onUnfold = () => {},
  header,
  predict = NO_PREDICTION,
}: BoardProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const hasHeader = !!header
  // The sticky header's height (the bar wraps, the chart's legend too) is the
  // board's scroll padding, so a card focus or a scroll brings in lands below
  // it. Written to the DOM, not state: a ?scene= link scrolls in PlanScreen's
  // effect, which would run before a re-render with the new height.
  useLayoutEffect(() => {
    const root = rootRef.current
    const el = headerRef.current
    if (!root || !el) return
    const measure = () =>
      root.style.setProperty(
        '--board-header-h',
        `${el.getBoundingClientRect().height}px`,
      )
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasHeader])
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropAfter, setDropAfter] = useState(false)
  const [dropAct, setDropAct] = useState<number | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const selectedId = selection?.sceneId ?? null
  const keep = (id: string) =>
    !fold ||
    id === selectedId ||
    unfolded.has(id) ||
    matchesHighlight(model, id, highlight)
  const itemsByAct = new Map(
    model.acts.map((a) => [
      a.act,
      collapsedActs.has(a.act) ? [] : foldRuns(a.scenes, keep),
    ]),
  )
  // DOM order of the visible cards (folded scenes are not in it).
  const rendered = [...itemsByAct.values()].flatMap((items) =>
    items.flatMap((item) => (item.type === 'card' ? [item.scene.id] : [])),
  )
  // The prediction runs only while a dragged card is over a target; dragover
  // re-sets the same state, which React skips, and asks predict whether the
  // target takes the drop, so no memo.
  const dragged = dragSourceId ? model.signals.get(dragSourceId) : undefined
  /** The insert a drop here would make; null with no drag or over itself. */
  const insertAt = (id: string, after: boolean): SceneMove | null =>
    dragged && id !== dragged.scene.id
      ? { type: 'insert', sceneId: dragged.scene.id, targetSceneId: id, after }
      : null
  const overMove = dropTargetId ? insertAt(dropTargetId, dropAfter) : null
  const prediction = overMove ? predict(overMove) : null
  /** The refusal, else the problems the move adds, else `fallback` (sky). */
  function dropTape(
    from: SceneSignals,
    p: NonNullable<MovePrediction>,
    fallback: string,
  ): CardTape {
    if ('blockedBy' in p)
      return {
        text: lockedMoveText(model, from.scene.id, p),
        tone: 'amber',
      }
    return predictionTape(model, p.issues) ?? { text: fallback, tone: 'sky' }
  }
  const tabStop =
    [selectedId, focusedId].find(
      (id) => id !== null && rendered.includes(id),
    ) ??
    rendered[0] ??
    null

  function clearDrag() {
    setDragSourceId(null)
    setDropTargetId(null)
    setDropAct(null)
  }

  function cardEls() {
    return [
      ...(rootRef.current?.querySelectorAll<HTMLElement>('[data-scene-card]') ??
        []),
    ]
  }

  function moveTo(event: KeyboardEvent, to: string | null | undefined) {
    if (!to) return
    event.preventDefault()
    onSelectScene(to)
    cardEls()
      .find((el) => el.dataset.sceneId === to)
      ?.focus()
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>, id: string) {
    // Only the card itself.
    if (event.target !== event.currentTarget) return
    if (
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      event.preventDefault()
      if (!pending)
        onMove({
          type: 'step',
          sceneId: id,
          dir: event.key === 'ArrowRight' ? 1 : -1,
        })
      return
    }
    if (event.altKey || event.metaKey || event.ctrlKey) return
    const at = rendered.indexOf(id)
    switch (event.key) {
      case 'ArrowRight':
        return moveTo(event, rendered[at + 1])
      case 'ArrowLeft':
        return moveTo(event, rendered[at - 1])
      case 'Home':
        return moveTo(event, rendered[0])
      case 'End':
        return moveTo(event, rendered.at(-1))
      case 'ArrowDown':
      case 'ArrowUp': {
        const els = cardEls()
        const to = gridNeighbor(
          els.map((el) => el.getBoundingClientRect()),
          at,
          event.key === 'ArrowDown' ? 1 : -1,
        )
        return moveTo(event, to === null ? null : els[to]?.dataset.sceneId)
      }
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (selectedId === id) onEnterPanel()
        else onSelectScene(id)
    }
  }

  return (
    <div
      ref={rootRef}
      // The header's measured height plus room for a card's tape.
      className="min-w-0 flex-1 scroll-pt-[calc(var(--board-header-h,0px)+--spacing(4))] overflow-y-auto p-5"
      aria-label="Plan board"
    >
      {header && (
        // Sticky insets count from inside the board's p-5: -top-5 pins the
        // header flush with the board's top, where -mt-5 puts it (top-0 left
        // a strip above it that cards scrolled through).
        <div
          ref={headerRef}
          className="sticky -top-5 z-10 -mx-5 -mt-5 mb-4 bg-tr-surface-page px-5 py-2"
        >
          {header}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {model.acts.map((summary) => {
          const { act, scenes } = summary
          const collapsed = collapsedActs.has(act)
          const withNotes = scenes.filter((s) => {
            const signals = model.signals.get(s.id)
            return (
              !!signals &&
              signals.storyNotes.length + signals.orderNotes.length > 0
            )
          }).length
          // A card over this empty act: the act move's prediction.
          const actMove: SceneMove | null = dragged
            ? { type: 'act', sceneId: dragged.scene.id, act }
            : null
          const actPrediction =
            dropAct === act && actMove ? predict(actMove) : null
          const actTape =
            dragged && actPrediction
              ? dropTape(
                  dragged,
                  actPrediction,
                  `Move scene ${dragged.number} here`,
                )
              : null
          const actAmber = actTape?.tone === 'amber'
          return (
            <section
              key={act}
              data-testid={`act-frame-${act}`}
              className={
                'rounded-frame bg-tr-surface-clay px-3.5 pb-4 pt-2.5' +
                (actTape
                  ? ` inset-ring-2 ${actAmber ? 'inset-ring-tr-amber' : 'inset-ring-tr-sky'}`
                  : '')
              }
            >
              <ActHeader
                summary={summary}
                actCount={model.acts.length}
                showThreads={model.hasThreads}
                collapsed={collapsed}
                onToggle={() => onToggleAct(act)}
                onSelectScene={onSelectScene}
              />
              {collapsed ? (
                <p className="mt-2.5 text-12 text-tr-text-primary">
                  {plural(scenes.length, 'scene')} hidden
                  {withNotes > 0 && ` · ${withNotes} with notes`}
                </p>
              ) : scenes.length === 0 ? (
                <p
                  onDragOver={(e) => {
                    if (!actMove) return
                    setDropAct(act)
                    if (allowed(predict(actMove))) e.preventDefault()
                  }}
                  onDragLeave={() => setDropAct(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (actMove && allowed(predict(actMove))) onMove(actMove)
                    clearDrag()
                  }}
                  className={`mt-3 rounded-card border border-dashed border-tr-border-strong p-4 text-center text-12 ${actAmber ? 'font-semibold text-tr-amber' : 'text-tr-text-primary'}`}
                >
                  {actTape?.text ??
                    'No scenes yet. Drag a card here, or use the Act control.'}
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-x-3 gap-y-4">
                  {(itemsByAct.get(act) ?? []).map((item) => {
                    if (item.type === 'stub') {
                      const first = item.scenes[0].index + 1
                      const last = item.scenes[item.scenes.length - 1].index + 1
                      const n = item.scenes.length
                      return (
                        <button
                          key={`stub-${item.key}`}
                          type="button"
                          aria-label={`Show ${plural(n, 'folded scene')}, ${n > 1 ? `${first} to ${last}` : first}`}
                          onClick={() => {
                            onUnfold(item.scenes.map((s) => s.id))
                            // The stub is gone: focus its first card.
                            requestAnimationFrame(() =>
                              cardEls()
                                .find((el) => el.dataset.sceneId === item.key)
                                ?.focus(),
                            )
                          }}
                          className={`flex h-card-board-h w-10 shrink-0 items-center justify-center rounded-[4px] border border-dashed border-tr-border-strong p-1 text-11 text-tr-text-primary hover:bg-tr-surface-sunken ${FOCUS}`}
                        >
                          <b className="rotate-180 font-semibold tabular-nums [writing-mode:vertical-rl]">
                            {n > 1 ? `${first}–${last}` : first}
                          </b>
                        </button>
                      )
                    }
                    const { id } = item.scene
                    const signals = model.signals.get(id)
                    if (!signals) return null
                    const relation = relationTape(model, selectedId, id)
                    const match = highlightTape(model, id, highlight)
                    const over = id === dropTargetId && prediction !== null
                    return (
                      <BoardCard
                        key={id}
                        signals={signals}
                        locked={signals.scene.locked || episodeLocked}
                        selected={id === selectedId}
                        tabIndex={id === tabStop ? 0 : -1}
                        pending={pending}
                        unsaved={draftSceneIds.has(id)}
                        tape={
                          over && dragged
                            ? dropTape(
                                dragged,
                                prediction,
                                `Move ${dragged.number} here`,
                              )
                            : (relation ?? match)
                        }
                        related={!over && relation !== null}
                        ring={
                          match && highlight.kind !== 'none'
                            ? HIGHLIGHT_TONE[highlight.kind]
                            : null
                        }
                        quiet={
                          highlight.kind !== 'none' &&
                          !match &&
                          id !== selectedId
                        }
                        dragging={id === dragSourceId}
                        dropTarget={over}
                        insert={
                          over && allowed(prediction)
                            ? dropAfter
                              ? 'after'
                              : 'before'
                            : null
                        }
                        onSelect={() => onSelectScene(id)}
                        onOpenInWrite={() => onOpenInWrite(id)}
                        onKeyDown={(e) => handleKey(e, id)}
                        onFocus={() => setFocusedId(id)}
                        onDragStart={() => setDragSourceId(id)}
                        onDragEnd={clearDrag}
                        onDragOver={(after) => {
                          const move = insertAt(id, after)
                          if (!move) return false
                          setDropTargetId(id)
                          setDropAfter(after)
                          return allowed(predict(move))
                        }}
                        onDragLeave={() => setDropTargetId(null)}
                        onDrop={(after) => {
                          const move = insertAt(id, after)
                          if (move && allowed(predict(move))) onMove(move)
                          clearDrag()
                        }}
                      />
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
