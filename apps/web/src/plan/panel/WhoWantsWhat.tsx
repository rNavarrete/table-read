import type { Character, Motivation } from 'contract'
import { Chip } from '../Chip'
import { characterName } from '../planTree'

export interface WhoWantsWhatProps {
  motivations: Motivation[]
  characters: Character[]
  /** story.castFromDialogue minus the characters with a recorded want. */
  alsoInScene: Character[]
}

/**
 * Panel section 2 (spec §4.6): one read-only card per recorded want. "Says"
 * is `statedObjective`, shown only when it differs from the real want;
 * `concealed` adds the Hidden agenda chip. Both default in the contract but
 * can be missing from a raw PATCH doc, so they are read with fallbacks.
 * Empty fields leave no empty rows. Names, term labels and wants are
 * identifying text: --tr-text-primary (AA, spec §4.10); secondary is meta only.
 */
export function WhoWantsWhat({
  motivations,
  characters,
  alsoInScene,
}: WhoWantsWhatProps) {
  return (
    <div className="flex flex-col gap-2">
      {motivations.length === 0 ? (
        <p className="text-13 text-tr-text-secondary">
          No wants recorded for this scene.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {motivations.map((m) => {
            const says = m.statedObjective ?? ''
            const rows = [
              ['Wants', m.objective],
              ['Says', says === m.objective ? '' : says],
              ['Up against', m.obstacle],
              ['At stake', m.stakes],
            ].filter(([, text]) => text)
            return (
              <li
                key={m.characterId}
                className="rounded-card border border-tr-border bg-tr-surface-raised p-3"
              >
                <p className="flex items-center gap-2 text-13 font-semibold text-tr-text-primary">
                  {characterName(characters, m.characterId)}
                  {(m.concealed ?? false) && (
                    <Chip hue="amber">
                      <span aria-hidden="true">◆</span>Hidden agenda
                    </Chip>
                  )}
                </p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-13">
                  {rows.map(([term, text]) => (
                    <div key={term} className="contents">
                      <dt className="text-12 text-tr-text-primary">{term}</dt>
                      <dd
                        className={
                          term === 'Says'
                            ? 'italic text-tr-text-primary'
                            : 'text-tr-text-primary'
                        }
                      >
                        {text}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            )
          })}
        </ul>
      )}
      {alsoInScene.length > 0 && (
        <p className="text-13 text-tr-text-primary">
          Also in the scene: {alsoInScene.map((c) => c.name).join(', ')}{' '}
          <span className="text-tr-text-secondary">· from dialogue cues</span>
        </p>
      )}
    </div>
  )
}
