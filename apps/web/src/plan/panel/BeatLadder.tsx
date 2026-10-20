import type {
  Beat,
  Character,
  Scene,
  StoryOverviewBeatItem,
  TimelineAnchor,
} from 'contract'
import { Chip } from '../Chip'
import { LockToggle } from '../LockToggle'
import { characterName, isBeatEffectivelyLocked } from '../planTree'
import type { PlanNote } from '../story'
import { PlanField, type BeatTextField } from './PlanField'
import { draftKey } from './usePlanDrafts'

// Moved from BeatCard.tsx (deleted in T3.3).
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

/** ⚑ (amber) when the beat has a story note, ⚐ when it has only import notes;
 * the meaning is in words for screen readers, not in colour alone. */
function NoteMarker({ notes }: { notes: PlanNote[] }) {
  if (notes.length === 0) return null
  const story = notes.some((note) => note.kind !== 'import')
  return (
    <span className={story ? 'text-tr-amber' : 'text-tr-text-secondary'}>
      <span aria-hidden="true">{story ? '⚑' : '⚐'}</span>
      <span className="sr-only">{story ? 'Story note' : 'Import note'}</span>
    </span>
  )
}

/** T10.1: the import's reading of the beat from the character's side —
 * "Marta probes Dan → he deflects". Missing parts are left out; no line at
 * all without a verb. Read-only; the fields default in the contract but can
 * be missing from a raw PATCH doc, hence the falsy checks. */
function ActionLine({
  beat,
  characters,
}: {
  beat: Beat
  characters: Character[]
}) {
  if (!beat.actionVerb) return null
  const who = [
    beat.actorCharacterId && characterName(characters, beat.actorCharacterId),
    beat.actionVerb,
    beat.targetCharacterId && characterName(characters, beat.targetCharacterId),
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <p className="text-13 text-tr-text-primary">
      {who}
      {beat.reaction && (
        <>
          <span aria-hidden="true"> → </span>
          <span className="sr-only">, </span>
          {beat.reaction}
        </>
      )}
    </p>
  )
}

/** T10.9: the import's kernel / choice-under-pressure readings — a muted
 * tag on the row, a sentence when it opens. Nothing for null (not read) or
 * false. */
const READINGS = [
  {
    key: 'kernel',
    tag: 'kernel',
    sentence: 'Load-bearing: the story breaks without it.',
  },
  {
    key: 'pressureChoice',
    tag: 'choice',
    sentence: 'A choice under pressure.',
  },
] as const

const PLAN_FIELDS: { field: BeatTextField; label: string }[] = [
  { field: 'whatHappens', label: 'What happens' },
  { field: 'audienceLearns', label: 'Audience learns' },
  { field: 'audienceFeels', label: 'Audience feels' },
]

export interface BeatLadderProps {
  scene: Scene
  /** seriesBible.characters: names for each beat's action line. */
  characters: Character[]
  episodeLocked: boolean
  /** The one expanded row (driven by PlanSelection). */
  selectedBeatId: string | null
  /** story.notesForScene: the ⚑ / ⚐ marker per beat. */
  notes: PlanNote[]
  /** story.landmarksForScene: a tag on the matching beat row. */
  landmarks: StoryOverviewBeatItem[]
  /** The anchor whose afterSceneId is this scene: a divider after the last beat. */
  timeJump: TimelineAnchor | null
  pending: boolean
  /** null = collapse (back to the scene selection). */
  onSelectBeat: (beatId: string | null) => void
  onToggleBeatLock: (beatId: string, locked: boolean) => void
  onToggleBeatScriptLock: (beatId: string, scriptLocked: boolean) => void
  onSaveBeatField: (
    beatId: string,
    field: BeatTextField,
    value: string,
  ) => Promise<boolean>
  onOpenBeatInWrite: (beatId: string) => void
}

/**
 * Section 4 (spec §4.6): the scene's beats as a ladder. Rows show the beat's
 * plan (`whatHappens`), not its first script line, and carry the note
 * marker, the cascaded lock, the beat-sheet landmark, the kernel / choice
 * tags (T10.9) and "lands" on the last beat. Opening a row shows the beat's
 * action line (T10.1) and a sentence per reading, then edits the beat in
 * place: plan fields, the Beat lock (`beat.locked`, new), the Script lock and
 * the script behind a disclosure.
 * Fields are read-only when the beat is effectively locked; the lock
 * toggles stay live (lock fields are server-exempt) and only wait for a
 * save in flight.
 */
export function BeatLadder({
  scene,
  characters,
  episodeLocked,
  selectedBeatId,
  notes,
  landmarks,
  timeJump,
  pending,
  onSelectBeat,
  onToggleBeatLock,
  onToggleBeatScriptLock,
  onSaveBeatField,
  onOpenBeatInWrite,
}: BeatLadderProps) {
  const beats = [...scene.beats].sort((a, b) => a.index - b.index)
  const lastBeatId = beats.at(-1)?.id

  return (
    <div>
      {beats.length === 0 ? (
        <p className="text-13 text-tr-text-secondary">No beats yet.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {beats.map((beat) => {
            const number = `${scene.index + 1}.${beat.index + 1}`
            const expanded = beat.id === selectedBeatId
            const locked = isBeatEffectivelyLocked(episodeLocked, scene, beat)
            const landmark = landmarks.find((item) => item.beatId === beat.id)
            const fieldProps = (field: BeatTextField, label: string) => ({
              label,
              ariaLabel: `Beat ${number}: ${label}`,
              draftKey: draftKey(beat.id, field),
              sceneId: scene.id,
              value: beat[field],
              multiline: true,
              locked,
              saving: pending,
              onSave: (value: string) => onSaveBeatField(beat.id, field, value),
            })
            return (
              <li
                key={beat.id}
                className={
                  expanded ? 'rounded-card bg-tr-surface-sunken' : undefined
                }
              >
                <button
                  type="button"
                  data-testid={`beat-card-${beat.id}`}
                  aria-expanded={expanded}
                  onClick={() => onSelectBeat(expanded ? null : beat.id)}
                  className="flex w-full items-start gap-2 rounded-card p-2 text-left hover:bg-tr-surface-clay focus-visible:outline focus-visible:outline-selected focus-visible:-outline-offset-2 focus-visible:outline-tr-sky"
                >
                  <span className="shrink-0 text-12 font-semibold text-tr-text-primary">
                    {number}
                  </span>
                  <span
                    className={
                      'min-w-0 flex-1 text-13' +
                      (beat.whatHappens
                        ? ' text-tr-text-primary'
                        : ' italic text-tr-text-secondary')
                    }
                  >
                    {beat.whatHappens || '(no plan yet)'}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <NoteMarker
                      notes={notes.filter((note) => note.beat?.id === beat.id)}
                    />
                    {locked && (
                      <Chip hue="amber">
                        <LockGlyph /> Locked
                      </Chip>
                    )}
                    {landmark && <Chip hue="sky">{landmark.label}</Chip>}
                    {READINGS.map(
                      ({ key, tag }) =>
                        beat[key] && (
                          <span
                            key={key}
                            className="text-11 text-tr-text-secondary"
                          >
                            {tag}
                          </span>
                        ),
                    )}
                    {beat.id === lastBeatId && (
                      <span className="text-11 text-tr-text-primary">
                        lands
                      </span>
                    )}
                  </span>
                </button>
                {expanded && (
                  <div className="flex flex-col gap-3 px-2 pb-3 pt-1">
                    <ActionLine beat={beat} characters={characters} />
                    {READINGS.map(
                      ({ key, sentence }) =>
                        beat[key] && (
                          <p key={key} className="text-13 text-tr-text-primary">
                            {sentence}
                          </p>
                        ),
                    )}
                    {PLAN_FIELDS.map(({ field, label }) => (
                      <PlanField key={field} {...fieldProps(field, label)} />
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <LockToggle
                        label="Beat"
                        locked={beat.locked}
                        disabled={pending}
                        testId={`beat-lock-toggle-${beat.id}`}
                        onChange={(next) => onToggleBeatLock(beat.id, next)}
                      />
                      <LockToggle
                        label="Script"
                        locked={beat.scriptLocked}
                        disabled={pending}
                        testId={`script-lock-toggle-${beat.id}`}
                        onChange={(next) =>
                          onToggleBeatScriptLock(beat.id, next)
                        }
                      />
                    </div>
                    <details>
                      <summary className="cursor-pointer text-13 text-tr-text-primary">
                        Script text
                      </summary>
                      {/* PlanField has no font prop; preflight's `font: inherit` carries Courier in. */}
                      <div className="mt-2 font-script">
                        <PlanField {...fieldProps('scriptText', 'Script')} />
                      </div>
                    </details>
                    <button
                      type="button"
                      onClick={() => onOpenBeatInWrite(beat.id)}
                      className="self-start text-13 text-tr-text-primary underline focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky"
                    >
                      Open beat in Write ↗
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {timeJump && (
        <p className="mt-2 border-t border-dashed border-tr-border pt-2 text-12 text-tr-text-primary">
          ↷ Then a time jump: {timeJump.label}
        </p>
      )}
    </div>
  )
}
