import type { Scene } from 'contract'
import { whimsy, whimsyPick } from './writeWhimsy'

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
      if (/^[A-Z0-9 .'\-]{1,45}$/.test(t) && !/[a-z]/.test(t)) continue // character cue
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
 * Left navigator for Write script-home (T2.4): episode scene list,
 * navigate-only. Active row uses Plan selection tokens.
 */
export function SceneOutline({
  scenes,
  activeSceneId,
  onSelect,
}: SceneOutlineProps) {
  return (
    <nav
      className={whimsyPick(
        'flex w-panel-story-layers shrink-0 flex-col border-r border-tr-border bg-tr-surface-sunken',
        'flex w-panel-story-layers shrink-0 flex-col border-r border-tr-border bg-tr-amber-soft',
      )}
      aria-label="Scenes"
      data-testid="write-scene-outline"
    >
      <div
        className={whimsyPick(
          'sticky top-0 z-10 border-b border-tr-border bg-tr-surface-sunken px-4 py-3',
          'sticky top-0 z-10 border-b border-tr-border bg-tr-amber-soft px-4 py-3',
        )}
      >
        <p
          className={whimsyPick(
            'text-12 uppercase tracking-wide text-tr-text-muted',
            'font-display text-13 text-tr-text-secondary',
          )}
        >
          {whimsyPick('Scenes', 'On the page')} · {scenes.length}
        </p>
      </div>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {scenes.map((scene, index) => {
          const active = scene.id === activeSceneId
          const slug = formatSceneSlug(scene)
          const pitch = outlinePitch(scene)
          const title = pitch ? `${slug} — ${pitch}` : slug
          return (
            <li key={scene.id}>
              <button
                type="button"
                data-testid={`write-outline-${scene.id}`}
                aria-current={active ? 'true' : undefined}
                title={title}
                onClick={() => onSelect(scene.id)}
                className={whimsy(
                  'w-full rounded-card px-2.5 py-1.5 text-left transition-colors' +
                    (active
                      ? ' bg-tr-coral-soft text-tr-accent-ink'
                      : ' text-tr-text-primary hover:bg-tr-surface-clay'),
                  (active
                    ? 'border-l-2 border-tr-coral pl-2'
                    : 'border-l-2 border-transparent pl-2') +
                    ' duration-standard ease-standard hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:hover:translate-x-0',
                )}
              >
                <span className="block truncate text-13 leading-snug">
                  <span className="text-tr-text-muted">{index + 1}.</span>{' '}
                  {slug}
                </span>
                {pitch ? (
                  <span className="mt-0.5 block truncate text-11 leading-snug text-tr-text-muted">
                    {pitch}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
