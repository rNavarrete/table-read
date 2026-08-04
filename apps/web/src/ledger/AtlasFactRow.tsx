import type { LedgerFact, Project } from 'contract'
import type { AtlasDensity } from './atlasPreference'
import { characterAvatar, type CharacterAvatar } from './characterAvatar'
import { formatSourceSpanLabel } from './sourceSpanLabel'

export interface AtlasFactRowProps {
  fact: LedgerFact
  project: Project
  avatars: Map<string, CharacterAvatar>
  density: AtlasDensity
  selected: boolean
  onSelect: () => void
}

const TYPE_CUE: Record<LedgerFact['factType'], string> = {
  event: 'EVENT',
  state: 'STATE',
  knowledge: 'KNOWS',
  relationship: 'REL',
  world_rule: 'RULE',
}

const TYPE_STYLE: Record<LedgerFact['factType'], string> = {
  event: 'border-tr-sky bg-tr-sky-soft text-tr-sky',
  state: 'border-tr-sage bg-tr-sage-soft text-tr-sage',
  knowledge: 'border-tr-sky bg-tr-sky-soft text-tr-sky',
  relationship: 'border-tr-amber bg-tr-amber-soft text-tr-amber',
  world_rule: 'border-tr-amber bg-tr-amber-soft text-tr-amber',
}

const STATUS_LABEL: Record<LedgerFact['status'], string> = {
  active: 'Active',
  pending_review: 'Needs review',
  superseded: 'Superseded',
  stale: 'Stale',
  rejected: 'Rejected',
}

const STATUS_STYLE: Record<LedgerFact['status'], string> = {
  active: 'bg-tr-overview-ready-ink',
  pending_review: 'bg-tr-amber',
  superseded: 'bg-tr-border-strong',
  stale: 'bg-tr-border-strong',
  rejected: 'bg-tr-danger',
}

function characterName(project: Project, id: string): string {
  return (
    project.seriesBible.characters.find((character) => character.id === id)
      ?.name ?? id
  )
}

function owner(
  fact: LedgerFact,
  project: Project,
  avatars: Map<string, CharacterAvatar>,
) {
  const id = fact.knownBy[0]
  const name = id ? characterName(project, id) : 'Audience'
  return { name, avatar: avatars.get(name) ?? characterAvatar(name) }
}

/** Dense Atlas row: type, status, source and knowers remain scannable at rest. */
export function AtlasFactRow({
  fact,
  project,
  avatars,
  density,
  selected,
  onSelect,
}: AtlasFactRowProps) {
  const secret = !fact.audienceKnows
  const subject = owner(fact, project, avatars)
  const knowers = fact.knownBy.slice(0, 3).map((id) => {
    const name = characterName(project, id)
    return { id, name, avatar: avatars.get(name) ?? characterAvatar(name) }
  })
  const compact = density === 'compact'

  return (
    <li className={compact ? 'h-[34px]' : 'min-h-[58px]'}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={
          'group flex h-full w-full items-center gap-2 rounded-[6px] border-b border-tr-border px-2 text-left focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral ' +
          (compact ? 'py-1' : 'py-2') +
          (selected
            ? ' bg-tr-surface-raised shadow-[inset_2px_0_0_var(--color-tr-sky)]'
            : ' hover:bg-tr-surface-raised') +
          (secret
            ? ' bg-[linear-gradient(90deg,var(--color-tr-ledger-secret-surface),transparent_38%)]'
            : '')
        }
        data-testid={`atlas-row-${fact.id}`}
      >
        <span
          className={`w-[44px] shrink-0 rounded-[5px] border px-1 py-0.5 text-center font-script text-[9px] uppercase tracking-[0.04em] ${TYPE_STYLE[fact.factType]}`}
        >
          {TYPE_CUE[fact.factType]}
        </span>
        <span
          className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-chip text-[7px] font-bold"
          style={{ background: subject.avatar.tint, color: subject.avatar.ink }}
          title={subject.name}
          aria-hidden
        >
          {subject.avatar.initials}
        </span>
        <span
          className={
            'min-w-0 flex-1 text-13 text-tr-text-primary ' +
            (compact ? 'truncate' : 'line-clamp-2 leading-snug')
          }
        >
          {fact.fact}
        </span>
        {secret ? (
          <span
            className="shrink-0 text-11 text-tr-ledger-secret-ink"
            title="Hidden from the audience"
            aria-label="Secret"
          >
            ◆
          </span>
        ) : null}
        <span
          className="hidden shrink-0 items-center sm:flex"
          aria-label={`${fact.knownBy.length} knowers`}
        >
          {knowers.map((knower, index) => (
            <span
              key={knower.id}
              className="flex h-[17px] w-[17px] items-center justify-center rounded-chip text-[7px] font-bold"
              style={{
                background: knower.avatar.tint,
                color: knower.avatar.ink,
                marginLeft: index === 0 ? 0 : -5,
                boxShadow: '0 0 0 1px var(--color-tr-surface-raised)',
              }}
              title={knower.name}
              aria-hidden
            >
              {knower.avatar.initials}
            </span>
          ))}
          <span className="ml-1 font-script text-10 tabular-nums text-tr-text-muted">
            {fact.knownBy.length}
          </span>
        </span>
        <span
          className={`size-[7px] shrink-0 rounded-chip ${STATUS_STYLE[fact.status]}`}
          title={STATUS_LABEL[fact.status]}
          aria-label={STATUS_LABEL[fact.status]}
        />
        <span
          className="hidden w-[108px] shrink-0 truncate text-right font-script text-10 text-tr-text-muted md:block"
          data-testid={`atlas-ref-${fact.id}`}
        >
          {formatSourceSpanLabel(fact, project)}
        </span>
      </button>
    </li>
  )
}
