import type { Scene } from 'contract'
import { sceneLocationType, sceneTypeDotClass } from './sceneType'

export function formatSceneSlug(scene: Scene): string {
  const location = scene.location.trim()
  const time = scene.time.trim()
  if (
    location &&
    time &&
    !location.toUpperCase().includes(time.toUpperCase())
  ) {
    return `${location} — ${time}`
  }
  return location || time || 'Untitled scene'
}

const SCENE_HEADING =
  /^(?:\d+[A-Z]?\.\s*)?(INT\.|EXT\.|EST\.|I\/E\.|INT\/EXT\.|INT\s|EXT\s)/i

/**
 * One-line story pitch for the outline (UI spec §4).
 * Imports leave scene.whatHappens empty — fall back to the first beat plan,
 * then a short action-line excerpt from script so the rail stays scannable.
 */
export function outlinePitch(scene: Scene): string {
  const scenePitch = scene.whatHappens.trim()
  if (scenePitch) return scenePitch

  for (const beat of scene.beats) {
    const beatPitch = beat.whatHappens.trim()
    if (beatPitch) return beatPitch
  }

  for (const beat of scene.beats) {
    for (const line of beat.scriptText.split('\n')) {
      const t = line.trim()
      if (!t) continue
      if (SCENE_HEADING.test(t)) continue
      // Trailing `-` in the class is already literal — no escape needed.
      if (/^[A-Z0-9 .'-]{1,45}$/.test(t) && !/[a-z]/.test(t)) continue // character cue
      if (t.startsWith('(') && t.endsWith(')')) continue
      return t
    }
  }
  return ''
}

export interface SceneOutlineProps {
  scenes: Scene[]
  activeSceneId: string | null
  onSelect: (sceneId: string) => void
}

/**
 * Left navigator for Write (UI spec §4 / redesign handoff): ON THE PAGE
 * scene list with INT/EXT dots. Navigate-only.
 */
export function SceneOutline({
  scenes,
  activeSceneId,
  onSelect,
}: SceneOutlineProps) {
  return (
    <nav
      className="flex w-panel-write-outline shrink-0 flex-col border-r border-tr-border bg-tr-write-panel"
      aria-label="Scenes"
      data-testid="write-scene-outline"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-tr-border bg-tr-write-panel px-3.5 py-3">
        <p className="font-script text-11 font-medium uppercase tracking-[0.1em] text-tr-text-muted">
          On the page
        </p>
        <p className="font-script text-11 tabular-nums text-tr-text-muted">
          {scenes.length} scene{scenes.length === 1 ? '' : 's'}
        </p>
      </div>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {scenes.map((scene, index) => {
          const active = scene.id === activeSceneId
          const slug = formatSceneSlug(scene)
          const pitch = outlinePitch(scene)
          const title = pitch ? `${slug} — ${pitch}` : slug
          const type = sceneLocationType(scene)
          return (
            <li key={scene.id}>
              <button
                type="button"
                data-testid={`write-outline-${scene.id}`}
                aria-current={active ? 'true' : undefined}
                title={title}
                onClick={() => onSelect(scene.id)}
                className={
                  'flex w-full items-start gap-[11px] rounded-[10px] border-l-2 py-2.5 pl-2.5 pr-2.5 text-left transition-colors duration-standard ease-standard motion-reduce:transition-none ' +
                  (active
                    ? 'border-tr-coral bg-tr-write-selected text-tr-accent-ink'
                    : 'border-transparent text-tr-text-primary hover:bg-tr-surface-clay')
                }
              >
                <span className="w-4 shrink-0 pt-0.5 text-right font-script text-11 tabular-nums text-tr-text-muted">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-[1px] ${sceneTypeDotClass(type)}`}
                      aria-hidden
                    />
                    <span
                      className={
                        'truncate text-[12.5px] font-semibold leading-snug ' +
                        (active ? 'text-tr-accent-ink' : 'text-tr-text-primary')
                      }
                    >
                      {slug}
                    </span>
                  </span>
                  {pitch ? (
                    <span className="mt-0.5 block truncate text-12 leading-snug text-tr-text-muted">
                      {pitch}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
