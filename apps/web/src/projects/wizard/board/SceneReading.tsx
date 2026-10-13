import { sceneTypeDotClass } from '../../../write/sceneType'
import type { BoardScene } from '../importBoard'

// A read card's beats (UI spec §2a, T9.17): what happens, then what the
// audience learns and feels. A non-modal panel the board places beside the
// card; the import keeps running underneath it.

export function SceneReading({
  scene,
  onClose,
  onTab,
}: {
  scene: BoardScene
  onClose: () => void
  onTab: () => void
}) {
  return (
    <div
      id="board-reading"
      data-testid="board-reading"
      data-index={scene.index}
      role="dialog"
      aria-label={`Scene ${scene.index + 1}, ${scene.slugline}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        event.preventDefault()
        onTab()
      }}
      className="absolute z-10 max-h-[70vh] w-panel-inspector max-w-full animate-[tr-board-fade_200ms_var(--tr-motion-settle)] overflow-y-auto rounded-[14px] bg-tr-surface-raised px-4 py-3.5 shadow-card-lift outline-none ring-1 ring-tr-border"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="flex min-w-0 items-center gap-[5px] font-script text-12 text-tr-text-secondary">
          <span>{scene.index + 1}</span>
          <span
            aria-hidden="true"
            className={`size-[5px] flex-none rounded-full ${sceneTypeDotClass(scene.intExt)}`}
          />
          <span>{scene.slugline}</span>
        </h4>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close scene ${scene.index + 1}`}
          className="flex-none text-12 text-tr-text-secondary hover:text-tr-text-primary"
        >
          Close
        </button>
      </div>
      <ol aria-label="Beats" className="mt-2 grid gap-3">
        {scene.beats.map((beat, k) => (
          <li key={k}>
            <p className="font-ledger-display text-15 leading-[21px] text-tr-text-primary">
              ~ {beat.whatHappens}
            </p>
            {beat.audienceLearns && (
              <p className="mt-1 text-12 text-tr-text-secondary">
                <span className="text-tr-text-muted">Audience learns · </span>
                {beat.audienceLearns}
              </p>
            )}
            {beat.audienceFeels && (
              <p className="mt-0.5 text-12 text-tr-text-secondary">
                <span className="text-tr-text-muted">Audience feels · </span>
                {beat.audienceFeels}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
