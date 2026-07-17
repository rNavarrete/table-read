import { useState } from 'react'
import type { LedgerFact, Project } from 'contract'
import { Card } from '../plan/Card'
import { Chip } from '../plan/Chip'
import { ConfidenceBar } from './ConfidenceBar'
import { supersedeChain } from './filters'
import { formatSourceSpanLabel } from './sourceSpanLabel'

export interface FactCardProps {
  fact: LedgerFact
  allFacts: LedgerFact[]
  project: Project
  /** When true, show Accept / Edit / Reject (review queue). */
  queueActions?: boolean
  busy?: boolean
  onAccept?: (factId: string) => void
  onReject?: (factId: string) => void
  onEdit?: (factId: string, body: { fact: string; knownBy: string[] }) => void
  onSourceSpanClick?: (fact: LedgerFact) => void
}

function characterLabel(project: Project, id: string): string {
  const chars = project.seriesBible.characters
  const found = chars.find((c) => c.id === id)
  if (!found) return id
  const parts = found.name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function characterName(project: Project, id: string): string {
  return project.seriesBible.characters.find((c) => c.id === id)?.name ?? id
}

function provenanceHue(
  provenance: LedgerFact['provenance'],
): 'amber' | 'sage' | 'sky' {
  if (provenance === 'inferred') return 'amber'
  if (provenance === 'writer_confirmed') return 'sage'
  return 'sky'
}

function provenanceLabel(provenance: LedgerFact['provenance']): string {
  if (provenance === 'writer_confirmed') return 'confirmed'
  if (provenance === 'writer_authored') return 'writer-authored'
  return 'inferred'
}

/**
 * `FactCard` — UI spec §6. All fields, source-span link, known-by chips,
 * confidence bar, provenance + status, supersede chain thread.
 */
export function FactCard({
  fact,
  allFacts,
  project,
  queueActions = false,
  busy = false,
  onAccept,
  onReject,
  onEdit,
  onSourceSpanClick,
}: FactCardProps) {
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState(fact.fact)
  const [draftKnownBy, setDraftKnownBy] = useState(fact.knownBy)
  const [chainOpen, setChainOpen] = useState(false)

  const superseded = fact.status === 'superseded'
  const chain =
    fact.supersededBy || fact.supersedes
      ? supersedeChain(
          allFacts,
          // Prefer walking from the oldest: if this fact supersedes X, start at X.
          fact.supersedes ?? fact.id,
        )
      : []

  function startEdit() {
    setDraftText(fact.fact)
    setDraftKnownBy([...fact.knownBy])
    setEditing(true)
  }

  function toggleKnownBy(id: string) {
    setDraftKnownBy((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function saveEdit() {
    onEdit?.(fact.id, {
      fact: draftText,
      knownBy: draftKnownBy,
    })
    setEditing(false)
  }

  return (
    <Card
      variant="raised"
      className="flex flex-col gap-2 border border-tr-border"
      data-testid={`fact-card-${fact.id}`}
    >
      {editing ? (
        <div
          className="flex flex-col gap-2"
          data-testid={`fact-edit-${fact.id}`}
        >
          <label className="flex flex-col gap-1 text-12 text-tr-text-muted">
            Fact
            <textarea
              className="rounded-card border border-tr-border bg-tr-surface-page p-2 text-15 text-tr-text-primary"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={3}
              data-testid={`fact-edit-text-${fact.id}`}
            />
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-12 text-tr-text-muted">Known by</legend>
            <div className="flex flex-wrap gap-1">
              {project.seriesBible.characters.map((c) => {
                const on = draftKnownBy.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleKnownBy(c.id)}
                    className={
                      'rounded-chip px-2 py-0.5 text-12 ' +
                      (on
                        ? 'bg-tr-sky-soft text-tr-text-primary'
                        : 'bg-tr-surface-clay text-tr-text-secondary')
                    }
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !draftText.trim()}
              onClick={saveEdit}
              className="rounded-card bg-tr-sage-soft px-3 py-1 text-13 text-tr-text-primary disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
              className="rounded-card px-3 py-1 text-13 text-tr-text-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p
            className={
              'text-15 text-tr-text-primary' +
              (superseded ? ' line-through text-tr-text-muted' : '')
            }
          >
            {fact.fact}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip hue="sky">{fact.factType}</Chip>
            <button
              type="button"
              className="text-13 text-tr-sky underline-offset-2 hover:underline"
              onClick={() => onSourceSpanClick?.(fact)}
              data-testid={`source-span-${fact.id}`}
            >
              {formatSourceSpanLabel(fact, project)}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-12 text-tr-text-muted">
              {fact.knownByAsOf ? 'Known by (as of this scene)' : 'Known by'}
            </span>
            {(fact.knownByAsOf ?? fact.knownBy).length === 0 ? (
              <span className="text-13 italic text-tr-text-muted">
                audience only
              </span>
            ) : (
              (fact.knownByAsOf ?? fact.knownBy).map((id) => (
                <Chip key={id} hue="neutral">
                  <span title={characterName(project, id)}>
                    {characterLabel(project, id)}
                  </span>
                </Chip>
              ))
            )}
          </div>
          <ConfidenceBar confidence={fact.confidence} muted={superseded} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip hue={provenanceHue(fact.provenance)}>
              {provenanceLabel(fact.provenance)}
            </Chip>
            <Chip hue={fact.status === 'pending_review' ? 'amber' : 'neutral'}>
              {fact.status}
            </Chip>
          </div>
          {fact.supersededBy && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="text-left text-13 text-tr-sky"
                onClick={() => setChainOpen((o) => !o)}
                data-testid={`supersede-link-${fact.id}`}
              >
                superseded by → {fact.supersededBy}
              </button>
              {chainOpen && chain.length > 0 && (
                <ol
                  className="ml-3 flex flex-col gap-1 border-l border-tr-border pl-3"
                  data-testid={`supersede-chain-${fact.id}`}
                >
                  {chain.map((node) => (
                    <li
                      key={node.id}
                      className={
                        'text-13 ' +
                        (node.status === 'superseded'
                          ? 'text-tr-text-muted line-through'
                          : 'text-tr-text-primary')
                      }
                    >
                      {node.id}: {node.fact}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          {queueActions && (
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onAccept?.(fact.id)}
                className="rounded-card bg-tr-sage-soft px-3 py-1 text-13 text-tr-text-primary disabled:opacity-50"
                data-testid={`accept-${fact.id}`}
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={startEdit}
                className="rounded-card border border-tr-border px-3 py-1 text-13 text-tr-text-primary disabled:opacity-50"
                data-testid={`edit-${fact.id}`}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onReject?.(fact.id)}
                className="rounded-card px-3 py-1 text-13 text-tr-text-muted disabled:opacity-50"
                data-testid={`reject-${fact.id}`}
              >
                Reject
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
