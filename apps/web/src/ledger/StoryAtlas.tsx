import { useState } from 'react'
import type { LedgerFact, Project } from 'contract'
import { Chip } from '../plan/Chip'
import {
  atlasCollapsedCue,
  groupChapterFactsByKnower,
} from './atlasRowCue'
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

function knownBySummary(fact: LedgerFact, project: Project): string | null {
  // Audience / Secret / knower count already live on the cue chip — only
  // echo multi-knower initials when the chip says "N knowers" / Secret.
  if (fact.knownBy.length === 0) return null
  if (fact.knownBy.length === 1 && fact.audienceKnows) return null
  return fact.knownBy
    .map((id) => {
      const found = project.seriesBible.characters.find((c) => c.id === id)
      if (!found) return id.slice(0, 2).toUpperCase()
      const parts = found.name.trim().split(/\s+/)
      if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
      return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
    })
    .join(' · ')
}

/**
 * Story Atlas — chaptered expandable fact rows (dual-view spec §5;
 * browse clarity: knower/irony cues, knower subheads).
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

  function renderFactRow(fact: LedgerFact) {
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
  }

  return (
    <div data-testid="story-atlas" className="flex flex-col gap-6">
      {chapters.map((chapter) => {
        const groups = groupChapterFactsByKnower(chapter.facts, project)
        return (
          <section
            key={chapter.id}
            id={`fact-chapter-${chapter.id}`}
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
            {groups.map((group) => (
              <div
                key={group.title ?? 'flat'}
                data-testid={
                  group.title
                    ? `knower-group-${group.title}`
                    : undefined
                }
                className="flex flex-col gap-1"
              >
                {group.title && (
                  <h4 className="mt-1 text-12 uppercase tracking-wide text-tr-text-muted">
                    {group.title}
                    <span className="ml-1 normal-case tracking-normal">
                      ({group.facts.length})
                    </span>
                  </h4>
                )}
                <ul className="flex flex-col gap-1">
                  {group.facts.map((fact) => renderFactRow(fact))}
                </ul>
              </div>
            ))}
          </section>
        )
      })}
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
  const cue = atlasCollapsedCue(fact, project)
  const knowers = knownBySummary(fact, project)
  const scene = formatSourceSpanLabel(fact, project)
  return (
    <>
      <Chip hue={cue.hue}>{cue.label}</Chip>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-15 text-tr-text-primary">
          {fact.fact}
        </span>
        <span className="mt-0.5 block text-12 text-tr-text-muted">
          {knowers ? `${knowers} · ${scene}` : scene}
        </span>
      </span>
    </>
  )
}
