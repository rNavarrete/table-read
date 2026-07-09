import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import { useState } from 'react'
import type { Scene } from 'contract'
import { BeatCard } from './BeatCard'
import { Card } from './Card'
import { Chip } from './Chip'
import { isBeatEffectivelyLocked } from './planTree'

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

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none${expanded ? ' rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
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
  selection: PlanSelection
  /** A PATCH is in flight (useProjectPatch). Drag initiation is refused
   * while true — starting a second reorder mid-flight would let the first
   * one's rollback (which restores the exact pre-patch doc) silently erase
   * the second one's optimistic change. Same guard LockToggle and the
   * inspector's save button already apply via `disabled`. */
  pending: boolean
  /** True when this scene (or one of its beats) has an open consistency
   * flag — UI spec §5 amber dot on Plan scene cards. */
  hasOpenConsistencyFlag: boolean
  onSelectScene: (sceneId: string) => void
  onSelectBeat: (sceneId: string, beatId: string) => void
  dragging: boolean
  dropTarget: boolean
  onDragStartScene: (sceneId: string) => void
  onDragEndScene: () => void
  onDragOverScene: (sceneId: string) => void
  onDragLeaveScene: () => void
  onDropScene: (targetSceneId: string) => void
}

/**
 * A scene card on the Plan board (UI spec §4). Draggable for reorder unless
 * the scene is locked — brief obligation 3: "do not build UI that lets a
 * user drag a locked scene" — or a mutation is in flight (`pending`; see
 * the prop doc above). Locked scenes are also refused as *drop* targets (a
 * conservative extension beyond the obligation's literal text, flagged in
 * the task report): swapping another scene into a locked scene's slot would
 * still change the locked scene's `index`, and nothing in the brief asked
 * for that risk to be taken on.
 *
 * Keyboard: the card is a focusable button — Enter/Space selects the scene
 * (UI spec §8: full keyboard path). Only when the card itself is focused;
 * keydown bubbling up from the chevron (its own button) is ignored.
 */
export function SceneCard({
  scene,
  episodeLocked,
  selection,
  pending,
  hasOpenConsistencyFlag,
  onSelectScene,
  onSelectBeat,
  dragging,
  dropTarget,
  onDragStartScene,
  onDragEndScene,
  onDragOverScene,
  onDragLeaveScene,
  onDropScene,
}: SceneCardProps) {
  const [expanded, setExpanded] = useState(false)
  const locked = scene.locked || episodeLocked
  const draggable = !locked && !pending
  const selected = selection?.type === 'scene' && selection.sceneId === scene.id

  function handleClick(event: MouseEvent) {
    if (event.altKey) {
      setExpanded((e) => !e)
      return
    }
    onSelectScene(scene.id)
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Only when the card itself is the focused element — Enter on the
    // chevron (a nested button whose keydown bubbles here) must keep its
    // own expand/collapse meaning, not also select the scene.
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
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-testid={`scene-card-${scene.id}`}
      data-locked={locked}
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
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse beats' : 'Expand beats'}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className="ml-auto shrink-0 text-tr-text-muted"
        >
          <Chevron expanded={expanded} />
        </button>
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
      {expanded && scene.beats.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-tr-border pt-3">
          {scene.beats.map((beat) => (
            <BeatCard
              key={beat.id}
              beat={beat}
              selected={
                selection?.type === 'beat' &&
                selection.sceneId === scene.id &&
                selection.beatId === beat.id
              }
              locked={isBeatEffectivelyLocked(episodeLocked, scene, beat)}
              onSelect={() => onSelectBeat(scene.id, beat.id)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
