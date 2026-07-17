import { useEffect, useState } from 'react'
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

/** Match Plan SceneCard chevron — rotate when expanded. */
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none${expanded ? ' rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function knowerCollapseKey(chapterId: string, title: string): string {
  return `${chapterId}:${title}`
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
  const [collapsedChapters, setCollapsedChapters] = useState(
    () => new Set<string>(),
  )
  const [collapsedKnowers, setCollapsedKnowers] = useState(
    () => new Set<string>(),
  )
  const expandedId =
    expandedFactId === undefined ? uncontrolledExpandedId : expandedFactId
  const chapters = groupFactsIntoChapters(facts)

  // Keep the chapter / knower group that holds the selected fact open so
  // Browse deep-links and Web→Atlas handoff aren't surprising.
  useEffect(() => {
    if (!expandedId) return
    const chapter = groupFactsIntoChapters(facts).find((c) =>
      c.facts.some((f) => f.id === expandedId),
    )
    if (!chapter) return

    setCollapsedChapters((prev) => {
      if (!prev.has(chapter.id)) return prev
      const next = new Set(prev)
      next.delete(chapter.id)
      return next
    })

    const groups = groupChapterFactsByKnower(chapter.facts, project)
    const group = groups.find((g) => g.facts.some((f) => f.id === expandedId))
    if (!group?.title) return
    const key = knowerCollapseKey(chapter.id, group.title)
    setCollapsedKnowers((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [expandedId, facts, project])

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

  function toggleChapter(chapterId: string) {
    setCollapsedChapters((prev) => {
      const next = new Set(prev)
      if (next.has(chapterId)) next.delete(chapterId)
      else next.add(chapterId)
      return next
    })
  }

  function toggleKnower(chapterId: string, title: string) {
    const key = knowerCollapseKey(chapterId, title)
    setCollapsedKnowers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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
        const chapterOpen = !collapsedChapters.has(chapter.id)
        const groups = groupChapterFactsByKnower(chapter.facts, project)
        return (
          <section
            key={chapter.id}
            id={`fact-chapter-${chapter.id}`}
            data-testid={`fact-chapter-${chapter.id}`}
            className="flex flex-col gap-3"
          >
            <h3 className="m-0 border-b border-tr-border pb-2">
              <button
                type="button"
                aria-expanded={chapterOpen}
                onClick={() => toggleChapter(chapter.id)}
                data-testid={`fact-chapter-toggle-${chapter.id}`}
                className="flex w-full items-baseline gap-2 text-left text-tr-text-muted transition-colors duration-standard ease-standard hover:text-tr-text-secondary focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
              >
                <Chevron expanded={chapterOpen} />
                <span className="font-display text-17 text-tr-text-primary">
                  {chapter.title}
                </span>
                <span className="text-13 text-tr-text-muted">
                  ({chapter.facts.length})
                </span>
              </button>
            </h3>
            {chapterOpen &&
              groups.map((group) => {
                const knowerOpen =
                  !group.title ||
                  !collapsedKnowers.has(
                    knowerCollapseKey(chapter.id, group.title),
                  )
                return (
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
                      <h4 className="m-0 mt-1">
                        <button
                          type="button"
                          aria-expanded={knowerOpen}
                          onClick={() =>
                            toggleKnower(chapter.id, group.title!)
                          }
                          data-testid={`knower-group-toggle-${group.title}`}
                          className="flex items-baseline gap-1.5 text-left text-11 font-medium uppercase tracking-wide text-tr-text-muted transition-colors duration-standard ease-standard hover:text-tr-text-secondary focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
                        >
                          <Chevron expanded={knowerOpen} />
                          <span>
                            {group.title}
                            <span className="ml-1 normal-case tracking-normal">
                              ({group.facts.length})
                            </span>
                          </span>
                        </button>
                      </h4>
                    )}
                    {knowerOpen && (
                      <ul className="flex flex-col gap-1.5">
                        {group.facts.map((fact) => renderFactRow(fact))}
                      </ul>
                    )}
                  </div>
                )
              })}
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
