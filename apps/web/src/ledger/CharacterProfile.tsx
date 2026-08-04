import type { Character, LedgerFact, Project, Secret } from 'contract'
import { Card } from '../plan/Card'
import {
  characterNames,
  motivationsForCharacter,
  resolveCharacterProfile,
  secretsForCharacter,
  ulteriorMotives,
} from './resolveCharacterProfile'

export interface CharacterProfileProps {
  character: Character
  project: Project
  facts: LedgerFact[]
  /** Jump to the scene in Write mode. Omitted in tests that don't navigate. */
  onOpenScene?: (sceneId: string) => void
}

function SecretRow({
  secret,
  project,
  counterpartIds,
  counterpartLabel,
  onOpenScene,
}: {
  secret: Secret
  project: Project
  counterpartIds: string[]
  counterpartLabel: string
  onOpenScene?: (sceneId: string) => void
}) {
  const names = characterNames(project, counterpartIds)
  // Still concealed at the end of the episode is the state a writer most
  // wants flagged — it is an unpaid promise, the same way an open thread is.
  const open = secret.revealedSceneId === null
  return (
    <li
      className="flex flex-col gap-1 rounded-ledger-card border border-tr-ledger-secret-border bg-tr-ledger-secret-surface p-3"
      data-testid="character-secret"
    >
      <p className="text-13 text-tr-text-primary">{secret.summary}</p>
      <div className="flex flex-wrap items-center gap-2">
        {names.length > 0 && (
          <span className="text-11 text-tr-ledger-secret-ink">
            {counterpartLabel} {names.join(', ')}
          </span>
        )}
        <span
          className="rounded-chip bg-tr-ledger-secret-badge px-2 py-0.5 text-11 text-tr-ledger-secret-ink"
          data-testid="character-secret-status"
        >
          {open ? 'Still concealed' : 'Revealed'}
        </span>
        {secret.concealmentSceneIds.length > 0 && (
          <span className="text-11 text-tr-text-muted">
            kept up in {secret.concealmentSceneIds.length}{' '}
            {secret.concealmentSceneIds.length === 1 ? 'scene' : 'scenes'}
          </span>
        )}
      </div>
      {onOpenScene && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="text-11 text-tr-sky underline underline-offset-2"
            onClick={() => onOpenScene(secret.establishedSceneId)}
          >
            Go to where it starts
          </button>
          {secret.revealedSceneId && (
            <button
              type="button"
              className="text-11 text-tr-sky underline underline-offset-2"
              onClick={() => onOpenScene(secret.revealedSceneId as string)}
            >
              Go to the reveal
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Ledger People profile header (T7.31): name, aliases, summary, bio —
 * above Atlas / Knowledge Web when a person is selected.
 */
export function CharacterProfile({
  character,
  project,
  facts,
  onOpenScene,
}: CharacterProfileProps) {
  const motivations = motivationsForCharacter(project, character.id)
  const profile = resolveCharacterProfile(character, facts, motivations)
  const { holding, keptFrom } = secretsForCharacter(project, character.id)
  const ulterior = ulteriorMotives(motivations)
  // The craft sections stand on their own even when there is no prose yet —
  // an imported script often has secrets and motives before it has a bio.
  const empty =
    profile.source === 'empty' &&
    holding.length === 0 &&
    keptFrom.length === 0 &&
    ulterior.length === 0

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

          {ulterior.length > 0 && (
            <section
              className="flex flex-col gap-2"
              data-testid="character-profile-motives"
            >
              <h3 className="text-12 uppercase tracking-wide text-tr-text-muted">
                Says vs wants
              </h3>
              <ul className="flex flex-col gap-2">
                {ulterior.map((m, i) => (
                  <li key={i} className="flex flex-col gap-0.5">
                    <p className="text-13 text-tr-text-secondary">
                      <span className="text-tr-text-muted">Says: </span>
                      {m.statedObjective}
                    </p>
                    <p className="text-13 text-tr-text-primary">
                      <span className="text-tr-text-muted">Wants: </span>
                      {m.objective}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {holding.length > 0 && (
            <section
              className="flex flex-col gap-2"
              data-testid="character-profile-hiding"
            >
              <h3 className="text-12 uppercase tracking-wide text-tr-text-muted">
                Hiding
              </h3>
              <ul className="flex flex-col gap-2">
                {holding.map((s) => (
                  <SecretRow
                    key={s.id}
                    secret={s}
                    project={project}
                    counterpartIds={s.concealedFromCharacterIds}
                    counterpartLabel="from"
                    onOpenScene={onOpenScene}
                  />
                ))}
              </ul>
            </section>
          )}

          {keptFrom.length > 0 && (
            <section
              className="flex flex-col gap-2"
              data-testid="character-profile-kept-from"
            >
              <h3 className="text-12 uppercase tracking-wide text-tr-text-muted">
                Kept from them
              </h3>
              <ul className="flex flex-col gap-2">
                {keptFrom.map((s) => (
                  <SecretRow
                    key={s.id}
                    secret={s}
                    project={project}
                    counterpartIds={s.holderCharacterIds}
                    counterpartLabel="by"
                    onOpenScene={onOpenScene}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Card>
  )
}
