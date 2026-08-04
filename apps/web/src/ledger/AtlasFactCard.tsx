import type { LedgerFact, Project } from 'contract'
import type { CharacterAvatar } from './characterAvatar'
import { characterAvatar } from './characterAvatar'
import { FactCard } from './FactCard'
import { formatSourceSpanChip } from './sourceSpanLabel'

export interface AtlasFactCardProps {
  fact: LedgerFact
  allFacts: LedgerFact[]
  project: Project
  /** Cast-wide avatar map from `assignCharacterAvatars` (collision-safe). */
  avatars: Map<string, CharacterAvatar>
  expanded: boolean
  busy?: boolean
  onToggle: () => void
  onAccept?: (factId: string) => void
  onReject?: (factId: string) => void
  onEdit?: (factId: string, body: { fact: string; knownBy: string[] }) => void
  onSourceSpanClick?: (fact: LedgerFact) => void
}

function ownerCharacter(
  fact: LedgerFact,
  project: Project,
  avatars: Map<string, CharacterAvatar>,
) {
  const id = fact.knownBy[0]
  if (!id) {
    return { name: 'Audience', avatar: characterAvatar('Audience') }
  }
  const found = project.seriesBible.characters.find((c) => c.id === id)
  const name = found?.name ?? id
  return {
    name,
    avatar: avatars.get(name) ?? characterAvatar(name),
  }
}

function knowerPeople(
  fact: LedgerFact,
  project: Project,
  avatars: Map<string, CharacterAvatar>,
) {
  return fact.knownBy.slice(0, 5).map((id) => {
    const found = project.seriesBible.characters.find((c) => c.id === id)
    const name = found?.name ?? id
    return {
      id,
      name,
      avatar: avatars.get(name) ?? characterAvatar(name),
    }
  })
}

/**
 * Atlas browse card — two-column grid cell (Ledger redesign handoff).
 * Collapsed: owner, secret badge, text, scene chip, knower stack.
 * Expanded: full FactCard beneath.
 */
export function AtlasFactCard({
  fact,
  allFacts,
  project,
  avatars,
  expanded,
  busy = false,
  onToggle,
  onAccept,
  onReject,
  onEdit,
  onSourceSpanClick,
}: AtlasFactCardProps) {
  const secret = !fact.audienceKnows
  const { name: ownerName, avatar: ownerAvatar } = ownerCharacter(
    fact,
    project,
    avatars,
  )
  const knowers = knowerPeople(fact, project, avatars)
  const knowerLabel =
    fact.knownBy.length > 1 ? `${fact.knownBy.length} knowers` : 'private'
  const ref = formatSourceSpanChip(fact, project)

  const cardSurface = secret
    ? 'bg-tr-ledger-secret-surface border-tr-ledger-secret-border'
    : 'bg-tr-surface-raised border-tr-border'
  const ringColor = secret
    ? 'var(--tr-ledger-secret-surface)'
    : 'var(--tr-surface-raised)'

  return (
    <li className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid={`atlas-row-${fact.id}`}
        className={`flex flex-col gap-[13px] rounded-ledger-card border px-[19px] py-[17px] text-left shadow-raised transition-[box-shadow,transform] duration-standard ease-standard motion-reduce:transition-none motion-reduce:hover:transform-none hover:-translate-y-0.5 hover:shadow-ledger-card focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral ${cardSurface} ${
          expanded
            ? 'outline outline-selected outline-offset-2 outline-tr-coral'
            : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
            style={{
              background: ownerAvatar.tint,
              color: ownerAvatar.ink,
            }}
            aria-hidden
          >
            {ownerAvatar.initials}
          </span>
          <span className="text-13 font-semibold text-tr-text-primary">
            {ownerName}
          </span>
          {secret && (
            <span
              className="ml-auto rounded-[6px] bg-tr-ledger-secret-badge px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-tr-ledger-secret-ink"
              data-testid={`atlas-secret-${fact.id}`}
            >
              ◆ Secret
            </span>
          )}
        </div>

        <p className="m-0 flex-1 text-pretty text-15 leading-normal text-tr-text-primary">
          {fact.fact}
        </p>

        <div
          className={`flex items-center justify-between gap-3 border-t pt-3 ${
            secret ? 'border-tr-ledger-secret-border' : 'border-tr-border'
          }`}
        >
          <span
            className={`rounded-[6px] border px-2 py-0.5 font-script text-11 text-tr-text-muted ${
              secret
                ? 'border-tr-ledger-secret-border bg-tr-ledger-secret-surface'
                : 'border-tr-border bg-tr-surface-page'
            }`}
            data-testid={`atlas-ref-${fact.id}`}
          >
            {ref}
          </span>
          <div className="flex items-center gap-2">
            <div className="flex">
              {knowers.map((k, i) => (
                <span
                  key={k.id}
                  className="flex h-[21px] w-[21px] items-center justify-center rounded-full text-[8.5px] font-semibold"
                  style={{
                    background: k.avatar.tint,
                    color: k.avatar.ink,
                    boxShadow: `0 0 0 2px ${ringColor}`,
                    marginLeft: i === 0 ? 0 : -6,
                  }}
                  title={k.name}
                  aria-hidden
                >
                  {k.avatar.initials}
                </span>
              ))}
            </div>
            <span className="text-[11.5px] text-tr-text-secondary">
              {knowerLabel}
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="tr-ledger-view-enter">
          <FactCard
            fact={fact}
            allFacts={allFacts}
            project={project}
            queueActions={fact.status === 'pending_review'}
            busy={busy}
            onAccept={onAccept}
            onReject={onReject}
            onEdit={onEdit}
            onSourceSpanClick={onSourceSpanClick}
          />
        </div>
      )}
    </li>
  )
}
