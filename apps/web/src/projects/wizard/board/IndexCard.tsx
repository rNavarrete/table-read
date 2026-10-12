import type { CSSProperties } from 'react'
import { sceneTypeDotClass } from '../../../write/sceneType'
import type { BoardScene } from '../importBoard'
import { useEntrance } from './boardMotion'
import { FAILED_READING, plural, readState } from './boardText'

// One scene's index card on the import board (UI spec §2a): ruled paper,
// tilted until read, then squared up with the reading and a pencil tick per
// beat. Status is always text as well as color.

const MAX_TICKS = 12

const RULED: CSSProperties = {
  backgroundImage:
    'linear-gradient(var(--tr-board-rule-top), var(--tr-board-rule-top)), repeating-linear-gradient(to bottom, transparent 0 13px, var(--tr-board-rule) 13px 14px)',
  backgroundSize: '100% 1px, 100% 100%',
  backgroundPosition: '0 21px, 0 22px',
  backgroundRepeat: 'no-repeat',
}

function factsText(scene: BoardScene): string | null {
  if (scene.factsFailed) return 'no facts · flagged'
  if (scene.factCount === null) return null
  return plural(scene.factCount, 'fact') + (scene.secretCount > 0 ? ' ◆' : '')
}

function cardLabel(scene: BoardScene): string {
  const parts = [
    `Scene ${scene.index + 1}`,
    scene.slugline,
    readState(scene).toLowerCase(),
  ]
  if (scene.factsFailed) parts.push("facts couldn't be read")
  else if (scene.factCount !== null)
    parts.push(
      plural(scene.factCount, 'fact') +
        (scene.secretCount > 0
          ? `, ${scene.secretCount} hidden from the audience`
          : ''),
    )
  if (scene.pins.length > 0)
    parts.push(
      `${scene.pins.length === 1 ? 'thread' : 'threads'} ${scene.pins.join(' and ')}`,
    )
  return parts.join(', ')
}

function Pin({
  n,
  offset,
  animate,
}: {
  n: number
  offset: number
  animate: boolean
}) {
  const pop = useEntrance(animate)
  return (
    <span
      data-pin={n}
      className={`absolute -top-1.5 left-1/2 z-[5] flex size-[13px] items-center justify-center rounded-full font-ui text-[8px] font-semibold text-tr-surface-raised shadow-card-board ${pop ? 'animate-[tr-board-pop_350ms_var(--tr-motion-spring)_both]' : ''}`}
      style={{
        marginLeft: `${offset * 15 - 6.5}px`,
        background:
          'radial-gradient(circle at 35% 30%, var(--tr-coral), var(--tr-sky) 60%)',
      }}
    >
      {n}
    </span>
  )
}

export function IndexCard({
  scene,
  compact = false,
  lifted = false,
  animate = true,
  onFocus,
  onBlur,
}: {
  scene: BoardScene
  compact?: boolean
  lifted?: boolean
  animate?: boolean
  onFocus?: (index: number) => void
  onBlur?: () => void
}) {
  const unread = scene.read === 'pending'
  const failed = scene.read === 'failed'
  const facts = factsText(scene)
  const tilt = (((scene.index * 37) % 7) - 3) * 0.45
  const ticks = scene.read === 'read' ? Math.min(MAX_TICKS, scene.beatCount) : 0

  let body
  if (compact) {
    body = (
      <p className="mt-1.5 line-clamp-2 flex-1 overflow-hidden font-script text-[10px] leading-3 text-tr-text-secondary">
        {scene.slugline}
      </p>
    )
  } else if (unread) {
    body = (
      <p className="flex-1 pt-5 font-ui text-[10.5px] text-tr-text-muted">
        Not read yet
      </p>
    )
  } else if (failed) {
    body = (
      <p
        data-body
        className="mt-[7px] flex-1 overflow-hidden font-ui text-[10.5px] leading-[13px] text-tr-amber"
      >
        {FAILED_READING}
      </p>
    )
  } else {
    body = (
      <p
        data-body
        className="mt-[7px] line-clamp-3 flex-1 overflow-hidden font-ledger-display text-[12.5px] leading-[14px] text-tr-text-primary"
      >
        ~ {scene.whatHappens}
      </p>
    )
  }

  return (
    <li
      data-testid={`board-card-${scene.index}`}
      data-state={scene.read}
      data-card
      data-index={scene.index}
      data-size={compact ? 'compact' : 'full'}
      data-tilt={unread ? '' : undefined}
      tabIndex={0}
      aria-label={cardLabel(scene)}
      onFocus={() => onFocus?.(scene.index)}
      onBlur={onBlur}
      className={`relative flex flex-col rounded-[4px] px-2 pb-1.5 pt-[7px] outline-none transition-[rotate,translate,scale,box-shadow] duration-[450ms] ease-spring group-data-[motion=off]/desk:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tr-coral ${compact ? 'h-card-board-compact-h w-card-board-compact-w' : 'h-card-board-h w-card-board-w'} ${failed ? 'bg-tr-amber-soft' : 'bg-tr-board-paper'} ${unread ? 'rotate-(--tilt)' : ''} ${lifted ? 'z-[3] -translate-y-[3px] scale-[1.03] shadow-card-lift' : 'shadow-card-board'}`}
      style={{ ...RULED, '--tilt': `${tilt}deg` } as CSSProperties}
    >
      <div
        aria-hidden="true"
        className="flex h-3.5 items-center gap-[5px] overflow-hidden whitespace-nowrap font-script text-[10.5px] text-tr-text-muted"
      >
        <span className="text-tr-text-secondary">{scene.index + 1}</span>
        <span
          className={`size-[5px] flex-none rounded-full ${sceneTypeDotClass(scene.intExt)}`}
        />
        {!compact && scene.slugline}
      </div>
      {body}
      <div
        aria-hidden="true"
        className="flex h-3 items-center justify-between gap-1"
      >
        <span className="flex gap-0.5 overflow-hidden">
          {Array.from({ length: ticks }, (_, k) => (
            <i
              key={k}
              data-mark
              className="h-0.5 w-[7px] flex-none -rotate-[8deg] rounded-[1px] bg-tr-text-secondary"
            />
          ))}
          {compact && unread && (
            <span className="font-ui text-[9.5px] text-tr-text-muted">
              not read
            </span>
          )}
          {compact && failed && (
            <span className="font-ui text-[9.5px] text-tr-amber">flagged</span>
          )}
        </span>
        <span
          data-stamp
          className={`-rotate-6 whitespace-nowrap font-script text-[10px] transition-[opacity,scale] duration-[350ms] ease-spring group-data-[motion=off]/desk:transition-none ${scene.factsFailed ? 'text-tr-amber' : 'text-tr-sky'} ${facts ? 'scale-100 opacity-100' : 'scale-[1.4] opacity-0'}`}
        >
          {facts}
        </span>
      </div>
      <span
        aria-hidden="true"
        className={`absolute inset-x-2 -bottom-px h-0.5 rounded-sm bg-[linear-gradient(90deg,transparent,var(--tr-board-rule-top),transparent)] transition-opacity duration-[400ms] group-data-[motion=off]/desk:transition-none ${scene.castRead ? 'opacity-100' : 'opacity-0'}`}
      />
      {scene.pins.map((n, k) => (
        <Pin
          key={n}
          n={n}
          offset={k - (scene.pins.length - 1) / 2}
          animate={animate}
        />
      ))}
    </li>
  )
}
