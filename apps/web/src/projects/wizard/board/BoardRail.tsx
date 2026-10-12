import type { CSSProperties, ReactNode } from 'react'
import type { ShowFormat } from 'contract'
import type { BoardScene, BoardState, BoardThread } from '../importBoard'
import { useEntrance } from './boardMotion'
import { FAILED_READING, plural } from './boardText'

// The board's rail (UI spec §2a): Logline, Format, the cast on the wall, and
// Notes, which hold the focused card, then the threads, then what to look at.

const POLAROID_TILT = [-2.5, 2, -1, 3, -3]

const THREAD_STATUS: Record<
  BoardThread['status'],
  { text: string; className: string }
> = {
  paid_off: { text: 'Paid off', className: 'text-tr-sage' },
  open: { text: 'Open', className: 'text-tr-amber' },
  abandoned: { text: 'Dropped', className: 'text-tr-text-muted' },
}

function Panel({
  title,
  children,
  testId,
}: {
  title: string
  children: ReactNode
  testId?: string
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-[14px] bg-tr-surface-raised px-4 py-3.5 shadow-raised ring-1 ring-tr-border"
    >
      <h4 className="text-11 uppercase tracking-[.12em] text-tr-text-muted">
        {title}
      </h4>
      {children}
    </section>
  )
}

function Logline({ text, animate }: { text: string; animate: boolean }) {
  const enter = useEntrance(animate)
  return (
    <p
      className={`mt-1.5 min-h-[69px] font-ledger-display text-17 leading-[23px] text-tr-text-primary ${enter ? 'animate-[tr-board-fade_400ms_var(--tr-motion-settle)_both]' : ''}`}
    >
      ~ {text}
    </p>
  )
}

function formatLines(format: ShowFormat): [string, string] {
  const genre = format.genre[0].toUpperCase() + format.genre.slice(1)
  return [
    `${genre} · ${format.runtimeMinutes} min`,
    [
      plural(format.actCount, 'act'),
      format.coldOpen ? 'cold open' : 'no cold open',
      ...(format.tag ? ['tag'] : []),
    ].join(' · '),
  ]
}

function Polaroid({
  name,
  sceneCount,
  k,
  animate,
}: {
  name: string
  sceneCount: number
  k: number
  animate: boolean
}) {
  const enter = useEntrance(animate)
  return (
    <li
      data-tilt
      className={`w-[54px] rotate-(--tilt) rounded-[3px] bg-tr-board-paper px-1 pb-[5px] pt-1 shadow-card-board ${enter ? 'animate-[tr-board-drop_500ms_var(--tr-motion-spring)_both]' : ''}`}
      style={
        {
          '--tilt': `${POLAROID_TILT[k % POLAROID_TILT.length]}deg`,
          animationDelay: enter ? `${k * 80}ms` : undefined,
        } as CSSProperties
      }
    >
      <div
        aria-hidden="true"
        className="flex h-10 items-center justify-center rounded-[2px] bg-tr-sky-soft font-ledger-display text-[20px] text-tr-accent-ink"
      >
        {name[0]}
      </div>
      <div className="mt-[3px] overflow-hidden whitespace-nowrap text-center font-script text-[9.5px] text-tr-text-primary">
        {name.toUpperCase()}
      </div>
      <div className="text-center text-[9.5px] text-tr-text-muted">
        {plural(sceneCount, 'scene')}
      </div>
    </li>
  )
}

function ThreadRow({
  thread,
  n,
  animate,
}: {
  thread: BoardThread
  n: number
  animate: boolean
}) {
  const enter = useEntrance(animate)
  const status = THREAD_STATUS[thread.status]
  return (
    <li
      className={`mt-[7px] flex items-center gap-2 text-[12.5px] ${enter ? 'animate-[tr-board-fade_350ms_var(--tr-motion-settle)_both]' : ''}`}
      style={enter ? { animationDelay: `${(n - 1) * 60}ms` } : undefined}
    >
      <span
        aria-hidden="true"
        className="flex size-4 flex-none items-center justify-center rounded-full bg-tr-sky text-[10px] text-tr-surface-raised"
      >
        {n}
      </span>
      <span className="text-tr-text-primary">
        <span className="sr-only">Thread {n}: </span>~ {thread.label}
      </span>
      <span className={`ml-auto flex-none text-11 ${status.className}`}>
        {status.text}
      </span>
    </li>
  )
}

/** A card's reading for the Notes panel (focus, or the latest find). */
function CardNote({ scene }: { scene: BoardScene }) {
  const reading =
    scene.read === 'pending'
      ? 'Not read yet'
      : scene.read === 'failed'
        ? FAILED_READING
        : `${plural(scene.beatCount, 'beat')} · ~ ${scene.whatHappens}`
  return (
    <div className="animate-[tr-board-fade_300ms_var(--tr-motion-settle)]">
      <p className="font-script text-12 text-tr-text-secondary">
        Sc. {scene.index + 1} · {scene.slugline}
      </p>
      <p
        className={
          scene.read === 'failed' ? 'text-tr-amber' : 'text-tr-text-primary'
        }
      >
        {reading}
      </p>
      {scene.factCount !== null && (
        <p>
          {plural(scene.factCount, 'fact')}
          {scene.secretCount > 0 &&
            ` · ◆ ${scene.secretCount} hidden from the audience`}
        </p>
      )}
    </div>
  )
}

function Chip({ count, noun }: { count: number; noun: string }) {
  return (
    <span
      className={`mr-1 mt-0.5 inline-block rounded-chip px-2.5 py-0.5 text-12 ${count > 0 ? 'bg-tr-amber-soft text-tr-amber' : 'bg-tr-surface-sunken text-tr-text-secondary'}`}
    >
      {plural(count, noun)}
    </span>
  )
}

export function BoardRail({
  board,
  focused,
  waiting,
  animate,
}: {
  board: BoardState
  focused: BoardScene | null
  waiting: boolean
  animate: boolean
}) {
  const latest =
    board.latestIndex === null
      ? null
      : (board.scenes.find((s) => s.index === board.latestIndex) ?? null)
  const shownCast = board.cast?.characters ?? []
  const moreCast = (board.cast?.total ?? 0) - shownCast.length

  let notesTitle = 'Notes'
  let notes: ReactNode = null
  if (focused) {
    notes = <CardNote key={focused.index} scene={focused} />
  } else if (board.flags || board.threads) {
    notesTitle = board.flags ? 'To look at' : 'Story threads'
    notes = (
      <>
        {board.flags && (
          <p>
            <Chip count={board.flags.contradictions} noun="contradiction" />
            <Chip count={board.flags.tensions} noun="tension" />
          </p>
        )}
        {board.threads && board.threads.length > 0 && (
          <ol data-testid="board-threads" aria-label="Story threads">
            {board.threads.map((thread, k) => (
              <ThreadRow
                key={`${k}-${thread.label}`}
                thread={thread}
                n={k + 1}
                animate={animate}
              />
            ))}
          </ol>
        )}
      </>
    )
  } else if (waiting) {
    notes = <p>While you wait, every card is open to read.</p>
  } else if (latest && latest.read !== 'pending') {
    notes = <CardNote key={latest.index} scene={latest} />
  }

  return (
    <div className="grid content-start gap-3.5 sm:grid-cols-2">
      <Panel title="Logline" testId="board-logline">
        {board.logline === null ? (
          <div aria-hidden="true" className="mt-1.5 min-h-[69px]">
            {[0, 1, 2].map((k) => (
              <div key={k} className="my-[11px] h-px bg-tr-border" />
            ))}
          </div>
        ) : (
          <Logline text={board.logline} animate={animate} />
        )}
      </Panel>
      <Panel title="Format">
        <p className="mt-1 min-h-[38px] text-13 leading-[19px] text-tr-text-secondary">
          {board.format &&
            formatLines(board.format).map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
        </p>
      </Panel>
      <Panel
        title={
          board.cast
            ? `Cast · ${plural(board.cast.total, 'speaking part')}`
            : 'Cast'
        }
        testId="board-cast"
      >
        <ul className="mt-2.5 flex min-h-[70px] flex-wrap items-center gap-x-2 gap-y-2.5">
          {shownCast.map((c, k) => (
            <Polaroid
              key={c.name}
              name={c.name}
              sceneCount={c.sceneCount}
              k={k}
              animate={animate}
            />
          ))}
          {moreCast > 0 && (
            <li className="text-12 text-tr-text-muted">+{moreCast} more</li>
          )}
        </ul>
      </Panel>
      <Panel title={notesTitle}>
        <div className="mt-1.5 min-h-[58px] text-13 leading-[19px] text-tr-text-secondary">
          {notes}
        </div>
      </Panel>
    </div>
  )
}
