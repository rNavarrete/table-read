import type { Beat } from 'contract'
import { Card } from './Card'
import { Chip } from './Chip'

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function firstLine(scriptText: string): string {
  const line = scriptText.split('\n').find((l) => l.trim().length > 0)
  return line ?? ''
}

export interface BeatCardProps {
  beat: Beat
  selected: boolean
  locked: boolean
  onSelect: () => void
}

/**
 * Nested beat card (UI spec §4: "Expand... reveals beat cards nested
 * (sunken, script-font first line of scriptText)"). `locked` is the
 * *effectively* locked state (planTree.ts's cascade helper) — a beat can
 * show a lock glyph because its scene or episode is locked, not only its
 * own `locked`/`scriptLocked` flags.
 */
export function BeatCard({ beat, selected, locked, onSelect }: BeatCardProps) {
  const line = firstLine(beat.scriptText)
  return (
    <Card
      variant="sunken"
      selected={selected}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation() // never also select the parent scene card
        onSelect()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      data-testid={`beat-card-${beat.id}`}
      className="cursor-pointer"
    >
      <p
        className={
          'truncate font-script text-12' +
          (line ? ' text-tr-text-primary' : ' text-tr-text-muted italic')
        }
      >
        {line || '(no script yet)'}
      </p>
      {locked && (
        <div className="mt-1.5">
          <Chip hue="amber">
            <LockGlyph /> Locked
          </Chip>
        </div>
      )}
    </Card>
  )
}
