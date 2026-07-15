import type { Scene } from 'contract'

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
      className="flex w-panel-story-layers shrink-0 flex-col border-r border-tr-border bg-tr-surface-sunken"
      aria-label="Scenes"
      data-testid="write-scene-outline"
    >
      <p className="sticky top-0 z-10 border-b border-tr-border bg-tr-surface-sunken px-4 py-3 text-12 uppercase tracking-wide text-tr-text-muted">
        Scenes · {scenes.length}
      </p>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {scenes.map((scene, index) => {
          const active = scene.id === activeSceneId
          const slug = formatSceneSlug(scene)
          return (
            <li key={scene.id}>
              <button
                type="button"
                data-testid={`write-outline-${scene.id}`}
                aria-current={active ? 'true' : undefined}
                title={slug}
                onClick={() => onSelect(scene.id)}
                className={
                  'w-full rounded-card px-2.5 py-1.5 text-left transition-colors' +
                  (active
                    ? ' bg-tr-coral-soft text-tr-accent-ink'
                    : ' text-tr-text-primary hover:bg-tr-surface-clay')
                }
              >
                <span className="block truncate text-13 leading-snug">
                  <span className="text-tr-text-muted">{index + 1}.</span>{' '}
                  {slug}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
