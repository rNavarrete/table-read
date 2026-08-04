import type { LedgerFact, Project } from 'contract'
import { ConfidenceBar } from './ConfidenceBar'
import { assignCharacterAvatars, characterAvatar } from './characterAvatar'
import { formatSourceSpanLabel } from './sourceSpanLabel'

export interface FactDetailDrawerProps {
  fact: LedgerFact | null
  allFacts: LedgerFact[]
  project: Project
  busy?: boolean
  onAccept?: (factId: string) => void
  onReject?: (factId: string) => void
  onOpenSource?: (fact: LedgerFact) => void
  onClose: () => void
}

const TYPE_LABEL: Record<LedgerFact['factType'], string> = {
  event: 'Event',
  state: 'State',
  knowledge: 'Knowledge',
  relationship: 'Relationship',
  world_rule: 'World rule',
}

const STATUS_LABEL: Record<LedgerFact['status'], string> = {
  active: 'Active',
  pending_review: 'Needs review',
  superseded: 'Superseded',
  stale: 'Stale',
  rejected: 'Rejected',
}

function sceneLocation(project: Project, fact: LedgerFact): string | null {
  const episode = project.seasons
    .flatMap((season) => season.episodes)
    .find((item) => item.id === fact.sourceSpan.episodeId)
  return (
    (
      episode?.scenes.find((scene) => scene.id === fact.sourceSpan.sceneId) as
        | {
            location?: string
          }
        | undefined
    )?.location ?? null
  )
}

function nameFor(project: Project, id: string): string {
  return (
    project.seriesBible.characters.find((character) => character.id === id)
      ?.name ?? id
  )
}

/** Stable inspector for fact evidence. It omits information the API cannot source. */
export function FactDetailDrawer({
  fact,
  allFacts,
  project,
  busy = false,
  onAccept,
  onReject,
  onOpenSource,
  onClose,
}: FactDetailDrawerProps) {
  const avatars = assignCharacterAvatars(
    project.seriesBible.characters.map((character) => character.name),
  )
  const supersedes = fact?.supersedes
    ? (allFacts.find((candidate) => candidate.id === fact.supersedes) ?? null)
    : null
  const supersededBy = fact?.supersededBy
    ? (allFacts.find((candidate) => candidate.id === fact.supersededBy) ?? null)
    : null

  return (
    <aside
      className="sticky top-0 h-fit rounded-card border border-tr-border bg-tr-surface-raised p-4 shadow-raised xl:w-panel-inspector"
      role="complementary"
      aria-label="Fact details"
      data-testid="fact-detail-drawer"
    >
      {fact ? (
        <div data-testid={`fact-card-${fact.id}`} aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <p className="font-ledger-display text-17 leading-snug text-tr-text-primary">
              {fact.fact}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-control px-1.5 py-1 text-12 text-tr-text-muted hover:bg-tr-surface-clay"
              aria-label="Close fact details"
            >
              ×
            </button>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-tr-border py-4 text-12">
            <div>
              <dt className="font-script text-10 uppercase tracking-[0.08em] text-tr-text-muted">
                Type
              </dt>
              <dd className="mt-1 text-tr-text-primary">
                {TYPE_LABEL[fact.factType]}
              </dd>
            </div>
            <div>
              <dt className="font-script text-10 uppercase tracking-[0.08em] text-tr-text-muted">
                Status
              </dt>
              <dd className="mt-1 text-tr-text-primary">
                {STATUS_LABEL[fact.status]}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="font-script text-10 uppercase tracking-[0.08em] text-tr-text-muted">
                Confidence
              </dt>
              <dd className="mt-1">
                <ConfidenceBar confidence={fact.confidence} />
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="font-script text-10 uppercase tracking-[0.08em] text-tr-text-muted">
                First seen
              </dt>
              <dd className="mt-1">
                <button
                  type="button"
                  onClick={() => onOpenSource?.(fact)}
                  className="text-left text-12 text-tr-sky underline-offset-2 hover:underline"
                >
                  {formatSourceSpanLabel(fact, project)}
                </button>
                {sceneLocation(project, fact) ? (
                  <span className="mt-0.5 block font-script text-10 uppercase tracking-[0.05em] text-tr-text-muted">
                    {sceneLocation(project, fact)}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          {fact.knownBy.length > 0 ? (
            <section className="mt-5">
              <h3 className="font-script text-10 uppercase tracking-[0.08em] text-tr-text-muted">
                Known by
              </h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {fact.knownBy.map((id) => {
                  const name = nameFor(project, id)
                  const avatar = avatars.get(name) ?? characterAvatar(name)
                  return (
                    <li
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-chip bg-tr-surface-clay px-2 py-1 text-11 text-tr-text-secondary"
                    >
                      <span
                        className="flex h-4 w-4 items-center justify-center rounded-chip text-[7px] font-bold"
                        style={{ background: avatar.tint, color: avatar.ink }}
                        aria-hidden
                      >
                        {avatar.initials}
                      </span>
                      {name}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : (
            <section className="mt-5">
              <h3 className="font-script text-10 uppercase tracking-[0.08em] text-tr-text-muted">
                Known by
              </h3>
              <p className="mt-1 text-12 text-tr-text-muted">
                No named character knows this yet.
              </p>
            </section>
          )}

          {fact.sourceText ? (
            <section className="mt-5">
              <h3 className="font-script text-10 uppercase tracking-[0.08em] text-tr-text-muted">
                Evidence
              </h3>
              <p className="mt-1 text-12 italic leading-snug text-tr-text-secondary">
                “{fact.sourceText}”
              </p>
            </section>
          ) : null}

          {supersedes || supersededBy ? (
            <section className="mt-5">
              <h3 className="font-script text-10 uppercase tracking-[0.08em] text-tr-text-muted">
                Relationships
              </h3>
              {supersedes ? (
                <p className="mt-1 text-12 text-tr-text-secondary">
                  Supersedes: {supersedes.fact}
                </p>
              ) : null}
              {supersededBy ? (
                <p className="mt-1 text-12 text-tr-text-secondary">
                  Superseded by: {supersededBy.fact}
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2 border-t border-tr-border pt-4">
            {fact.status === 'pending_review' ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAccept?.(fact.id)}
                  className="rounded-control bg-tr-sky px-3 py-1.5 text-12 font-medium text-tr-surface-raised disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onReject?.(fact.id)}
                  className="rounded-control border border-tr-border px-3 py-1.5 text-12 text-tr-text-secondary disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenSource?.(fact)}
              className="rounded-control px-2 py-1.5 text-12 text-tr-sky underline-offset-2 hover:underline"
            >
              View beat in Write →
            </button>
          </div>
        </div>
      ) : (
        <div className="py-8 text-center">
          <p className="font-ledger-display text-17 text-tr-text-primary">
            Select a fact
          </p>
          <p className="mt-1 text-12 text-tr-text-muted">
            Its evidence and story context will stay here while you browse.
          </p>
        </div>
      )}
    </aside>
  )
}
