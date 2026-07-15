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
      className="flex w-panel-story-layers shrink-0 flex-col overflow-y-auto border-r border-tr-border bg-tr-surface-sunken p-3"
      aria-label="Scenes"
      data-testid="write-scene-outline"
    >
      <p className="mb-2 px-2 text-12 uppercase tracking-wide text-tr-text-muted">
        Scenes · {scenes.length}
      </p>
      <ul className="flex flex-col gap-0.5">
        {scenes.map((scene, index) => {
          const active = scene.id === activeSceneId
          const pitch = scene.whatHappens.trim()
          return (
            <li key={scene.id}>
              <button
                type="button"
                data-testid={`write-outline-${scene.id}`}
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(scene.id)}
                className={
                  'w-full rounded-card px-2 py-1.5 text-left transition-colors' +
                  (active
                    ? ' bg-tr-coral-soft text-tr-accent-ink'
                    : ' text-tr-text-primary hover:bg-tr-surface-clay')
                }
              >
                <span className="block text-13 font-medium leading-snug">
                  {index + 1}. {formatSceneSlug(scene)}
                </span>
                {pitch ? (
                  <span className="mt-0.5 line-clamp-2 block text-12 text-tr-text-secondary">
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
