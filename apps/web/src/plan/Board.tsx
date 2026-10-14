import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { plural } from '../projects/wizard/board/boardText'
import { ActHeader } from './ActHeader'
import { BoardCard } from './BoardCard'
import { relationTape, type BoardModel } from './story'

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
  onReorder: (draggedSceneId: string, targetSceneId: string) => void
  /** An empty act took a dropped card (spec §4.3): the Act select's save. */
  onMoveToAct: (sceneId: string, act: number) => void
  onToggleAct: (act: number) => void
  /** Enter on the selected card: focus the panel heading. */
  onEnterPanel: () => void
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

const NO_DRAFTS: ReadonlySet<string> = new Set()

/**
 * The Plan board (redesign spec §4.2–4.3): an act frame per board act with
 * its header, the scenes as index cards, and a drop box in an empty act.
 * Drag is native HTML5 (no dependency): Board holds the drag source, which
 * only a card allowed to drag can set, so a locked or pending card never
 * reaches a swap or an act move. One card is the tab stop (the selected one
 * if rendered, else the last focused, else the first); arrows, Home and End
 * select and focus, Enter on the selected card goes to the panel.
 */
export function Board({
  model,
  episodeLocked,
  selection,
  collapsedActs,
  pending,
  draftSceneIds = NO_DRAFTS,
  onSelectScene,
  onOpenInWrite = () => {},
  onReorder,
  onMoveToAct,
  onToggleAct,
  onEnterPanel,
}: BoardProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropAct, setDropAct] = useState<number | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const selectedId = selection?.sceneId ?? null
  // DOM order of the visible cards.
  const rendered = model.acts
    .filter((a) => !collapsedActs.has(a.act))
    .flatMap((a) => a.scenes.map((s) => s.id))
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
    // Only the card itself; ⌥←/→ is Phase 4's insert move.
    if (event.target !== event.currentTarget) return
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
      className="min-w-0 flex-1 overflow-y-auto p-5"
      aria-label="Plan board"
    >
      <div className="flex flex-col gap-3">
        {model.acts.map((summary) => {
          const { act, scenes } = summary
          const collapsed = collapsedActs.has(act)
          const withNotes = scenes.filter(
            (s) => (model.signals.get(s.id)?.storyNotes.length ?? 0) > 0,
          ).length
          return (
            <section
              key={act}
              data-testid={`act-frame-${act}`}
              className={
                'rounded-frame bg-tr-surface-clay px-3.5 pb-4 pt-2.5' +
                (dropAct === act ? ' inset-ring-2 inset-ring-tr-sky' : '')
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
                    if (!dragSourceId) return
                    e.preventDefault()
                    setDropAct(act)
                  }}
                  onDragLeave={() => setDropAct(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragSourceId) onMoveToAct(dragSourceId, act)
                    clearDrag()
                  }}
                  className="mt-3 rounded-card border border-dashed border-tr-border-strong p-4 text-center text-12 text-tr-text-primary"
                >
                  No scenes yet. Drag a card here, or use the Act control.
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-x-3 gap-y-4">
                  {scenes.map(({ id }) => {
                    const signals = model.signals.get(id)
                    if (!signals) return null
                    const tape = relationTape(model, selectedId, id)
                    return (
                      <BoardCard
                        key={id}
                        signals={signals}
                        locked={signals.scene.locked || episodeLocked}
                        selected={id === selectedId}
                        tabIndex={id === tabStop ? 0 : -1}
                        pending={pending}
                        unsaved={draftSceneIds.has(id)}
                        tape={tape}
                        related={tape !== null}
                        dragging={id === dragSourceId}
                        dropTarget={id === dropTargetId && id !== dragSourceId}
                        onSelect={() => onSelectScene(id)}
                        onOpenInWrite={() => onOpenInWrite(id)}
                        onKeyDown={(e) => handleKey(e, id)}
                        onFocus={() => setFocusedId(id)}
                        onDragStart={() => setDragSourceId(id)}
                        onDragEnd={clearDrag}
                        onDragOver={() => setDropTargetId(id)}
                        onDragLeave={() => setDropTargetId(null)}
                        onDrop={() => {
                          if (dragSourceId && dragSourceId !== id)
                            onReorder(dragSourceId, id)
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
