import { useState } from 'react'
import type { LedgerFact, Project } from 'contract'
import { Chip } from '../plan/Chip'
import { FactCard } from './FactCard'
import { groupFactsIntoChapters } from './factChapters'
import { formatSourceSpanLabel } from './sourceSpanLabel'

export interface StoryAtlasProps {
  facts: LedgerFact[]
  allFacts: LedgerFact[]
  project: Project
  busy?: boolean
  onAccept?: (factId: string) => void
  onReject?: (factId: string) => void
  onEdit?: (factId: string, body: { fact: string; knownBy: string[] }) => void
  onSourceSpanClick?: (fact: LedgerFact) => void
  expandedFactId?: string | null
  onExpandedFactIdChange?: (factId: string | null) => void
  emptyMessage?: string
}

const TYPE_CUE: Record<LedgerFact['factType'], string> = {
  event: 'EVENT',
  state: 'STATE',
  knowledge: 'KNOWS',
  relationship: 'REL',
  world_rule: 'RULE',
}

function characterLabel(project: Project, id: string): string {
  const found = project.seriesBible.characters.find((c) => c.id === id)
  if (!found) return id.slice(0, 2).toUpperCase()
  const parts = found.name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function knownBySummary(fact: LedgerFact, project: Project): string {
  if (fact.knownBy.length === 0) return 'audience'
  return fact.knownBy.map((id) => characterLabel(project, id)).join(' · ')
}

/**
 * Story Atlas — chaptered expandable fact rows (dual-view spec §5).
 */
export function StoryAtlas({
  facts,
  allFacts,
  project,
  busy = false,
  onAccept,
  onReject,
  onEdit,
  onSourceSpanClick,
  expandedFactId,
  onExpandedFactIdChange,
  emptyMessage = 'No facts match.',
}: StoryAtlasProps) {
  const [uncontrolledExpandedId, setUncontrolledExpandedId] = useState<
    string | null
  >(null)
  const expandedId =
    expandedFactId === undefined ? uncontrolledExpandedId : expandedFactId
  const chapters = groupFactsIntoChapters(facts)

  if (facts.length === 0) {
    return (
      <div data-testid="story-atlas">
        <p className="text-13 text-tr-text-muted">{emptyMessage}</p>
      </div>
    )
  }

  function toggleExpanded(factId: string) {
    const nextId = expandedId === factId ? null : factId
    if (expandedFactId === undefined) setUncontrolledExpandedId(nextId)
    onExpandedFactIdChange?.(nextId)
  }

  return (
    <div data-testid="story-atlas" className="flex flex-col gap-6">
      {chapters.map((chapter) => (
        <section
          key={chapter.id}
          data-testid={`fact-chapter-${chapter.id}`}
          className="flex flex-col gap-2"
        >
          <header className="flex items-baseline gap-2">
            <h3 className="font-display text-15 text-tr-text-secondary">
              {chapter.title}
            </h3>
            <span className="text-13 text-tr-text-muted">
              ({chapter.facts.length})
            </span>
          </header>
          <ul className="flex flex-col gap-1">
            {chapter.facts.map((fact) => {
              const expanded = expandedId === fact.id
              if (expanded) {
                return (
                  <li key={fact.id} className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(fact.id)}
                      className="flex w-full items-start gap-2 rounded-card border border-tr-border bg-tr-surface-raised px-3 py-2 text-left"
                      data-testid={`atlas-row-${fact.id}`}
                      aria-expanded
                    >
                      <CollapsedRowContent fact={fact} project={project} />
                    </button>
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
                  </li>
                )
              }

              return (
                <li key={fact.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(fact.id)}
                    className="flex w-full items-start gap-2 rounded-card border border-tr-border bg-tr-surface-raised px-3 py-2 text-left hover:bg-tr-surface-clay"
                    data-testid={`atlas-row-${fact.id}`}
                    aria-expanded={false}
                  >
                    <CollapsedRowContent fact={fact} project={project} />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function CollapsedRowContent({
  fact,
  project,
}: {
  fact: LedgerFact
  project: Project
}) {
  return (
    <>
      <Chip hue="neutral">{TYPE_CUE[fact.factType]}</Chip>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-15 text-tr-text-primary">
          {fact.fact}
        </span>
        <span className="mt-0.5 block text-12 text-tr-text-muted">
          {knownBySummary(fact, project)} ·{' '}
          {formatSourceSpanLabel(fact, project)}
        </span>
      </span>
    </>
  )
}
