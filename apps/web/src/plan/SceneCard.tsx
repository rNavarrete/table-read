import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import type { Scene } from 'contract'
import { Card } from './Card'
import { Chip } from './Chip'

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export type PlanSelection =
  | { type: 'scene'; sceneId: string }
  | { type: 'beat'; sceneId: string; beatId: string }
  | null

export interface SceneCardProps {
  scene: Scene
  episodeLocked: boolean
  /** A beat selection also marks its scene's card: the panel is showing
   * that scene, with the beat open in its ladder. */
  selection: PlanSelection
  /** A PATCH is in flight (useProjectPatch). Drag initiation is refused
   * while true — starting a second reorder mid-flight would let the first
   * one's rollback (which restores the exact pre-patch doc) silently erase
   * the second one's optimistic change. Same guard LockToggle and the
   * panel's save buttons already apply via `disabled`. */
  pending: boolean
  /** True when this scene (or one of its beats) has an open consistency
   * flag — UI spec §5 amber dot on Plan scene cards. */
  hasOpenConsistencyFlag: boolean
  onSelectScene: (sceneId: string) => void
  /** Double-click opens Write on this scene (script-home deep link). */
  onOpenInWrite: (sceneId: string) => void
  dragging: boolean
  dropTarget: boolean
  onDragStartScene: (sceneId: string) => void
  onDragEndScene: () => void
  onDragOverScene: (sceneId: string) => void
  onDragLeaveScene: () => void
  onDropScene: (targetSceneId: string) => void
}

/**
 * A scene card on the Plan board (UI spec §5). Draggable for reorder unless
 * the scene is locked — brief obligation 3: "do not build UI that lets a
 * user drag a locked scene" — or a mutation is in flight (`pending`; see
 * the prop doc above). Locked scenes are also refused as *drop* targets:
 * swapping another scene into a locked scene's slot would still change the
 * locked scene's `index`.
 *
 * Beats are not on the board: they live in the scene panel's beat ladder
 * (T3.3, plan redesign spec §4.6). Keyboard: the card is a focusable button
 * — Enter/Space selects the scene (UI spec §8). Double-click opens Write on
 * this scene (UI spec §5).
 */
export function SceneCard({
  scene,
  episodeLocked,
  selection,
  pending,
  hasOpenConsistencyFlag,
  onSelectScene,
  onOpenInWrite,
  dragging,
  dropTarget,
  onDragStartScene,
  onDragEndScene,
  onDragOverScene,
  onDragLeaveScene,
  onDropScene,
}: SceneCardProps) {
  const locked = scene.locked || episodeLocked
  const draggable = !locked && !pending
  const selected = selection?.sceneId === scene.id

  function handleDoubleClick(event: MouseEvent) {
    event.preventDefault()
    onOpenInWrite(scene.id)
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Only when the card itself is focused, not a control nested inside it.
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectScene(scene.id)
    }
  }

  function handleDragStart(event: DragEvent) {
    if (!draggable) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData('text/plain', scene.id)
    event.dataTransfer.effectAllowed = 'move'
    onDragStartScene(scene.id)
  }

  function handleDragOver(event: DragEvent) {
    if (locked) return // no preventDefault: browser shows "not allowed", drop never fires
    event.preventDefault()
    onDragOverScene(scene.id)
  }

  function handleDrop(event: DragEvent) {
    if (locked) return
    event.preventDefault()
    onDropScene(scene.id)
  }

  return (
    <Card
      variant="raised"
      selected={selected}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={onDragEndScene}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeaveScene}
      onDrop={handleDrop}
      onClick={() => onSelectScene(scene.id)}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      data-testid={`scene-card-${scene.id}`}
      data-locked={locked}
      title="Double-click to open in Write"
      className={
        'w-card-scene shrink-0 cursor-pointer select-none transition-shadow motion-reduce:transition-none' +
        (dragging ? ' shadow-lift opacity-60' : '') +
        (dropTarget ? ' bg-tr-surface-clay' : '')
      }
    >
      <div className="flex items-center gap-2">
        <p className="text-13 font-semibold text-tr-text-primary">
          {scene.index + 1} · {scene.location}
        </p>
        {hasOpenConsistencyFlag && (
          <span
            data-testid="consistency-flag-badge"
            aria-label="Open consistency flag"
            title="Open consistency flag"
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-tr-amber"
          />
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-13 text-tr-text-secondary">
        {scene.whatHappens}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip hue="neutral">
          {scene.beats.length} beat{scene.beats.length === 1 ? '' : 's'}
        </Chip>
        {locked && (
          <Chip hue="amber">
            <LockGlyph /> Locked
          </Chip>
        )}
      </div>
    </Card>
  )
}
