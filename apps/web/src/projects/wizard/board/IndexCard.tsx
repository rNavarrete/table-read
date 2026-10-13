import type { CSSProperties } from 'react'
import { sceneTypeDotClass } from '../../../write/sceneType'
import { type BoardScene, isReadable } from '../importBoard'
import { useEntrance } from './boardMotion'
import { FAILED_READING, plural, readState } from './boardText'

// One scene's index card on the import board (UI spec §2a): ruled paper,
// tilted until read, then squared up with the reading and a pencil tick per
// beat. Status is always text as well as color. A read card is also a button
// that opens its beats (T9.17).

const MAX_TICKS = 12

// The body sets 13px type on a 15px line from y=28, so its baselines fall near
// 40, 55, 70, 85: the faint rules sit one pixel under each, never through the
// letters (a 14px pitch started at 22px used to strike through the text).
const RULED: CSSProperties = {
  backgroundImage:
    'linear-gradient(var(--tr-board-rule-top), var(--tr-board-rule-top)), repeating-linear-gradient(to bottom, transparent 0 14px, var(--tr-board-rule) 14px 15px)',
  backgroundSize: '100% 1px, 100% 100%',
  backgroundPosition: '0 21px, 0 27px',
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

// The full heading and reading on hover: the card truncates both.
function cardTitle(scene: BoardScene): string {
  const heading = `${scene.index + 1}. ${scene.slugline}`
  if (scene.read === 'failed') return `${heading}\n${FAILED_READING}`
  return scene.read === 'read' && scene.whatHappens
    ? `${heading}\n${scene.whatHappens}`
    : heading
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
  lifted = false,
  animate = true,
  reading = false,
  onFocus,
  onBlur,
  onRead,
}: {
  scene: BoardScene
  lifted?: boolean
  animate?: boolean
  /** Its reading view is open. */
  reading?: boolean
  onFocus?: (index: number) => void
  onBlur?: () => void
  onRead?: (index: number) => void
}) {
  const unread = scene.read === 'pending'
  const failed = scene.read === 'failed'
  const readable = onRead !== undefined && isReadable(scene)
  const facts = factsText(scene)
  const tilt = (((scene.index * 37) % 7) - 3) * 0.45
  const ticks = scene.read === 'read' ? Math.min(MAX_TICKS, scene.beatCount) : 0

  let body
  if (unread) {
    body = (
      <p className="mt-[7px] flex-1 font-ui text-[11px] leading-[15px] text-tr-text-muted">
        Not read yet
      </p>
    )
  } else if (failed) {
    body = (
      <p
        data-body
        className="mt-[7px] line-clamp-4 flex-1 overflow-hidden font-ui text-[11px] leading-[15px] text-tr-amber"
      >
        {FAILED_READING}
      </p>
    )
  } else {
    body = (
      <p
        data-body
        className="mt-[7px] line-clamp-4 flex-1 overflow-hidden font-ledger-display text-[13px] leading-[15px] text-tr-text-primary"
      >
        ~ {scene.whatHappens}
      </p>
    )
  }

  return (
    <li
      id={`board-card-${scene.index}`}
      data-testid={`board-card-${scene.index}`}
      data-state={scene.read}
      data-card
      data-index={scene.index}
      data-tilt={unread ? '' : undefined}
      // A readable card's button takes the tab stop; -1 keeps a card focused
      // when it turns readable under the writer's focus.
      tabIndex={readable ? -1 : 0}
      aria-label={cardLabel(scene)}
      title={cardTitle(scene)}
      onFocus={() => onFocus?.(scene.index)}
      onBlur={onBlur}
      className={`relative flex flex-col rounded-[4px] px-2 pb-1.5 pt-[7px] transition-[rotate,translate,scale,box-shadow] duration-[450ms] ease-spring group-data-[motion=off]/desk:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tr-coral h-card-board-h w-card-board-w ${failed ? 'bg-tr-amber-soft' : 'bg-tr-board-paper'} ${unread ? 'rotate-(--tilt)' : ''} ${lifted ? 'z-[3] -translate-y-[3px] scale-[1.03] shadow-card-lift' : 'shadow-card-board'}`}
      style={{ ...RULED, '--tilt': `${tilt}deg` } as CSSProperties}
    >
      {/* The act break's lift: a shadow layer whose opacity animates. */}
      <span
        aria-hidden="true"
        data-lift
        className="pointer-events-none absolute inset-0 rounded-[4px] opacity-0 shadow-card-lift"
      />
      <div
        aria-hidden="true"
        className="flex h-3.5 items-center gap-[5px] overflow-hidden whitespace-nowrap font-script text-[11px] text-tr-text-muted"
      >
        <span className="text-tr-text-secondary">{scene.index + 1}</span>
        <span
          className={`size-[5px] flex-none rounded-full ${sceneTypeDotClass(scene.intExt)}`}
        />
        <span className="truncate">{scene.slugline}</span>
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
      {readable && (
        <button
          type="button"
          data-read-card
          aria-label={`Read scene ${scene.index + 1}`}
          // The card's own label: slugline, state and counts.
          aria-describedby={`board-card-${scene.index}`}
          aria-expanded={reading}
          aria-controls={reading ? 'board-reading' : undefined}
          onClick={() => onRead?.(scene.index)}
          className={`absolute inset-0 cursor-pointer rounded-[4px] outline-offset-2 outline-tr-coral focus-visible:outline-2 ${reading ? 'outline-selected' : ''}`}
        />
      )}
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
