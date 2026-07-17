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

function atlasRowClass(expanded: boolean): string {
  const base =
    'flex w-full items-start gap-3 rounded-card border border-tr-border bg-tr-surface-raised px-3 py-2.5 text-left shadow-raised transition-[box-shadow,background-color,outline-color] duration-standard ease-standard motion-reduce:transition-none focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral'
  if (expanded) {
    return `${base} outline outline-selected outline-offset-2 outline-tr-coral shadow-lift`
  }
  return `${base} hover:bg-tr-surface-clay hover:shadow-lift`
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
      <div
        data-testid="story-atlas"
        className="rounded-card border border-tr-border bg-tr-surface-raised px-6 py-10 shadow-raised"
      >
        <p className="font-display text-17 text-tr-text-primary">{emptyMessage}</p>
        {emptyMessage === 'No facts match.' && (
          <p className="mt-2 text-13 text-tr-text-secondary">
            Try clearing a filter, or switch Browse to All truths.
          </p>
        )}
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
            className={atlasRowClass(true)}
            data-testid={`atlas-row-${fact.id}`}
            aria-expanded
          >
            <CollapsedRowContent fact={fact} project={project} />
          </button>
          <div className="tr-ledger-view-enter pl-1">
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
        </li>
      )
    }

    return (
      <li key={fact.id}>
        <button
          type="button"
          onClick={() => toggleExpanded(fact.id)}
          className={atlasRowClass(false)}
          data-testid={`atlas-row-${fact.id}`}
          aria-expanded={false}
        >
          <CollapsedRowContent fact={fact} project={project} />
        </button>
      </li>
    )
  }

  return (
    <div data-testid="story-atlas" className="flex flex-col gap-8">
      {chapters.map((chapter) => {
        const groups = groupChapterFactsByKnower(chapter.facts, project)
        return (
          <section
            key={chapter.id}
            id={`fact-chapter-${chapter.id}`}
            data-testid={`fact-chapter-${chapter.id}`}
            className="flex flex-col gap-3"
          >
            <header className="flex items-baseline gap-2 border-b border-tr-border pb-2">
              <h3 className="font-display text-17 text-tr-text-primary">
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
                className="flex flex-col gap-1.5"
              >
                {group.title && (
                  <h4 className="mt-1 text-11 font-medium uppercase tracking-wide text-tr-text-muted">
                    {group.title}
                    <span className="ml-1 normal-case tracking-normal">
                      ({group.facts.length})
                    </span>
                  </h4>
                )}
                <ul className="flex flex-col gap-1.5">
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
      <Chip hue={cue.hue} className="shrink-0">
        {cue.label}
      </Chip>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-15 leading-snug text-tr-text-primary">
          {fact.fact}
        </span>
        <span className="mt-1 block text-12 text-tr-text-muted">
          {knowers ? `${knowers} · ${scene}` : scene}
        </span>
      </span>
    </>
  )
}
