import { useState } from 'react'
import type { Episode, Project, Scene } from 'contract'
import type { PlanSelection } from './SceneCard'
import { SceneCard } from './SceneCard'
import {
  actLabel,
  actNumbersForBoard,
  allScenes,
  groupScenesByAct,
} from './planTree'

interface ActFrameProps {
  act: number
  label: string
  scenes: Scene[]
  collapsed: boolean
  episodeLocked: boolean
  selection: PlanSelection
  pending: boolean
  flaggedSceneIds: Set<string>
  dragSourceId: string | null
  dropTargetId: string | null
  onSelectScene: (sceneId: string) => void
  onOpenInWrite: (sceneId: string) => void
  onDragStartScene: (sceneId: string) => void
  onDragEndScene: () => void
  onDragOverScene: (sceneId: string) => void
  onDragLeaveScene: () => void
  onDropScene: (targetSceneId: string) => void
}

function ActFrame({
  act,
  label,
  scenes,
  collapsed,
  episodeLocked,
  selection,
  pending,
  flaggedSceneIds,
  dragSourceId,
  dropTargetId,
  onSelectScene,
  onOpenInWrite,
  onDragStartScene,
  onDragEndScene,
  onDragOverScene,
  onDragLeaveScene,
  onDropScene,
}: ActFrameProps) {
  return (
    <section
      data-testid={`act-frame-${act}`}
      className="rounded-frame bg-tr-surface-clay p-4"
    >
      <h2 className="font-display text-17 text-tr-text-primary">{label}</h2>
      {collapsed ? (
        <p className="mt-2 text-13 text-tr-text-muted">
          {scenes.length} scene{scenes.length === 1 ? '' : 's'} hidden
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-4">
          {scenes.length === 0 ? (
            <p className="text-13 text-tr-text-muted">No scenes</p>
          ) : (
            scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                episodeLocked={episodeLocked}
                selection={selection}
                pending={pending}
                hasOpenConsistencyFlag={flaggedSceneIds.has(scene.id)}
                onSelectScene={onSelectScene}
                onOpenInWrite={onOpenInWrite}
                dragging={scene.id === dragSourceId}
                dropTarget={
                  scene.id === dropTargetId && scene.id !== dragSourceId
                }
                onDragStartScene={onDragStartScene}
                onDragEndScene={onDragEndScene}
                onDragOverScene={onDragOverScene}
                onDragLeaveScene={onDragLeaveScene}
                onDropScene={onDropScene}
              />
            ))
          )}
        </div>
      )}
    </section>
  )
}

export interface BoardProps {
  project: Project
  episode: Episode
  selection: PlanSelection
  collapsedActs: Set<number>
  /** A PATCH is in flight — drag initiation is disabled on every card
   * (see SceneCardProps.pending for the rollback-race rationale). */
  pending: boolean
  /** Scene ids with at least one open consistency flag (UI spec §5 amber
   * badge). Built by PlanScreen from `GET .../consistency-flags?status=open`. */
  flaggedSceneIds: Set<string>
  onSelectScene: (sceneId: string) => void
  onOpenInWrite?: (sceneId: string) => void
  onReorder: (draggedSceneId: string, targetSceneId: string) => void
}

/**
 * The center board (UI spec §4): act frames in `--tr-surface-clay`, each
 * containing its scenes' cards. Drag state (which card is being dragged,
 * which is currently hovered as a drop target) is lifted here — both
 * halves of a drag involve two different `SceneCard`s, so it can't live on
 * either card alone. Native HTML5 drag-and-drop (no new dependency, per
 * CLAUDE.md rule 10): `dataTransfer` carries the dragged scene id too (for
 * standards compliance), but `onReorder` is always driven off this
 * component's own `dragSourceId` state, not a `dataTransfer` read, since
 * some browsers restrict reading custom payloads before `drop`.
 */
export function Board({
  project,
  episode,
  selection,
  collapsedActs,
  pending,
  flaggedSceneIds,
  onSelectScene,
  onOpenInWrite = () => {},
  onReorder,
}: BoardProps) {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const scenes = allScenes(project)
  const acts = actNumbersForBoard(project.format, scenes)
  const groups = groupScenesByAct(scenes)

  function handleDrop(targetSceneId: string) {
    if (dragSourceId && dragSourceId !== targetSceneId) {
      onReorder(dragSourceId, targetSceneId)
    }
    setDragSourceId(null)
    setDropTargetId(null)
  }

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-6" aria-label="Plan board">
      <div className="flex flex-col gap-6">
        {acts.map((act) => (
          <ActFrame
            key={act}
            act={act}
            label={actLabel(act, project.format)}
            scenes={groups.get(act) ?? []}
            collapsed={collapsedActs.has(act)}
            episodeLocked={episode.locked}
            selection={selection}
            pending={pending}
            flaggedSceneIds={flaggedSceneIds}
            dragSourceId={dragSourceId}
            dropTargetId={dropTargetId}
            onSelectScene={onSelectScene}
            onOpenInWrite={onOpenInWrite}
            onDragStartScene={setDragSourceId}
            onDragEndScene={() => {
              setDragSourceId(null)
              setDropTargetId(null)
            }}
            onDragOverScene={setDropTargetId}
            onDragLeaveScene={() => setDropTargetId(null)}
            onDropScene={handleDrop}
          />
        ))}
      </div>
    </div>
  )
}
