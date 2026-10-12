import type { Scene, ShowFormat, StructureStageStatus } from 'contract'
import { actLabel, groupScenesByAct } from '../../plan/planTree'

const TICK: Record<StructureStageStatus, string> = {
  hit: 'bg-tr-sage',
  thin: 'bg-tr-amber',
  unverified: 'bg-tr-sky',
  missing: 'bg-tr-border-strong',
}

export interface StructureStripProps {
  scenes: Scene[]
  format: ShowFormat | null | undefined
  marks: {
    key: string
    label: string
    sceneId: string | null
    status: StructureStageStatus
  }[]
}

/** One tick per cited stage, placed by its scene's position in the episode,
 * with act boundaries — so stages that land out of order show at a glance. */
export function StructureStrip({ scenes, format, marks }: StructureStripProps) {
  const acts = [...groupScenesByAct(scenes)].sort(([a], [b]) => a - b)
  const ordered = acts.flatMap(([, group]) => group)
  if (ordered.length === 0) return null
  const span = Math.max(ordered.length - 1, 1)
  const at = (index: number) => (index / span) * 100
  const position = new Map(ordered.map((scene, index) => [scene.id, at(index)]))

  const segments: { act: number; left: number; width: number }[] = []
  let first = 0
  for (const [act, group] of acts) {
    const last = first + group.length - 1
    const left = first === 0 ? 0 : at(first - 0.5)
    const right = last === ordered.length - 1 ? 100 : at(last + 0.5)
    segments.push({ act, left, width: right - left })
    first = last + 1
  }

  return (
    <div aria-hidden="true" data-testid="structure-strip">
      <div className="rounded-control bg-tr-surface-sunken px-2">
        <div className="relative h-8">
          {segments.slice(1).map((segment) => (
            <span
              key={segment.act}
              className="absolute inset-y-1 w-px bg-tr-border-strong"
              style={{ left: `${segment.left}%` }}
            />
          ))}
          {marks.map((mark) => {
            const left = mark.sceneId ? position.get(mark.sceneId) : undefined
            if (left === undefined) return null
            return (
              <span
                key={mark.key}
                title={mark.label}
                className={`absolute inset-y-2 w-1.5 -translate-x-1/2 rounded-chip ${TICK[mark.status]}`}
                style={{ left: `${left}%` }}
              />
            )
          })}
        </div>
      </div>
      <div className="relative mx-2 mt-1 h-4">
        {segments.map((segment) => (
          <span
            key={segment.act}
            className="absolute truncate font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted"
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
          >
            {format ? actLabel(segment.act, format) : `ACT ${segment.act}`}
          </span>
        ))}
      </div>
    </div>
  )
}
