import type { Character, LedgerFact, Project } from 'contract'
import { Card } from '../plan/Card'
import {
  motivationsForCharacter,
  resolveCharacterProfile,
} from './resolveCharacterProfile'

export interface CharacterProfileProps {
  character: Character
  project: Project
  facts: LedgerFact[]
}

/**
 * Ledger People profile header (T7.31): name, aliases, summary, bio —
 * above Atlas / Knowledge Web when a person is selected.
 */
export function CharacterProfile({
  character,
  project,
  facts,
}: CharacterProfileProps) {
  const motivations = motivationsForCharacter(project, character.id)
  const profile = resolveCharacterProfile(character, facts, motivations)
  const empty = profile.source === 'empty'

  return (
    <Card
      variant="raised"
      className="flex flex-col gap-3"
      aria-label={`Profile for ${character.name}`}
      data-testid="character-profile"
      data-profile-source={profile.source}
    >
      <div className="flex flex-col gap-1">
        <p className="text-11 uppercase tracking-wide text-tr-text-muted">
          Profile
        </p>
        <h2 className="font-display text-17 text-tr-text-primary">
          {profile.name}
        </h2>
        {profile.aliases.length > 0 && (
          <p
            className="text-13 text-tr-text-secondary"
            data-testid="character-profile-aliases"
          >
            Also known as {profile.aliases.join(', ')}
          </p>
        )}
      </div>

      {empty ? (
        <p
          className="text-13 text-tr-text-secondary"
          data-testid="character-profile-empty"
        >
          No profile yet — facts below are what we know so far.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <section
            className="flex flex-col gap-1"
            data-testid="character-profile-summary"
          >
            <h3 className="text-12 uppercase tracking-wide text-tr-text-muted">
              Summary
            </h3>
            {profile.summary ? (
              <p className="text-15 text-tr-text-primary">{profile.summary}</p>
            ) : (
              <p className="text-13 italic text-tr-text-muted">
                No brief summary yet.
              </p>
            )}
          </section>
          <section
            className="flex flex-col gap-1"
            data-testid="character-profile-bio"
          >
            <h3 className="text-12 uppercase tracking-wide text-tr-text-muted">
              Bio
            </h3>
            {profile.bio ? (
              profile.bio.split(/\n\s*\n/).map((para, i) => (
                <p key={i} className="text-13 text-tr-text-secondary">
                  {para}
                </p>
              ))
            ) : (
              <p className="text-13 italic text-tr-text-muted">No bio yet.</p>
            )}
          </section>
        </div>
      )}
    </Card>
  )
}
