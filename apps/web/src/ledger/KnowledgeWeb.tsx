import { useMemo, useState } from 'react'
import type { LedgerFact, Project } from 'contract'
import { Card } from '../plan/Card'
import { Chip } from '../plan/Chip'
import { FactCard } from './FactCard'
import {
  buildKnowledgeGraph,
  knownByForFocus,
  relatedFactIds,
} from './knowledgeGraph'
import { formatSourceSpanLabel } from './sourceSpanLabel'

export interface KnowledgeWebProps {
  facts: LedgerFact[]
  allFacts: LedgerFact[]
  project: Project
  busy: boolean
  characterId: string | null
  onAccept?: (factId: string) => void
  onReject?: (factId: string) => void
  onEdit?: (factId: string, body: { fact: string; knownBy: string[] }) => void
  onSourceSpanClick?: (fact: LedgerFact) => void
  onOpenInAtlas?: (factId: string) => void
  /** Overflow “+N more” — switch to Atlas without expanding a fact. */
  onBrowseInAtlas?: () => void
}

const TYPE_CUE: Record<LedgerFact['factType'], string> = {
  event: 'EVENT',
  state: 'STATE',
  knowledge: 'KNOWS',
  relationship: 'REL',
  world_rule: 'RULE',
}

const CLUSTER_ORDER: LedgerFact['factType'][] = [
  'knowledge',
  'relationship',
  'event',
  'state',
  'world_rule',
]

function factRowClass(
  fact: LedgerFact,
  selected: boolean,
  related: boolean,
): string {
  const base =
    'flex w-full items-start gap-3 rounded-card border px-3 py-2.5 text-left shadow-raised transition-[box-shadow,outline-color,background-color] duration-standard ease-standard motion-reduce:transition-none focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral'
  const surface =
    fact.status === 'pending_review'
      ? 'border-tr-border bg-tr-amber-soft'
      : 'border-tr-border bg-tr-surface-raised'
  const selectedClass = selected
    ? ' outline outline-selected outline-offset-2 outline-tr-coral shadow-lift'
    : related
      ? ' outline outline-1 outline-offset-0 outline-tr-border-strong bg-tr-sky-soft'
      : ' outline outline-0 outline-transparent hover:bg-tr-surface-clay hover:shadow-lift'
  return `${base} ${surface}${selectedClass}`
}

function knowerCountLabel(fact: LedgerFact): string {
  const knowers = knownByForFocus(fact)
  if (knowers.length === 0) return 'audience'
  return `${knowers.length} knower${knowers.length === 1 ? '' : 's'}`
}

function sceneShortLabel(fact: LedgerFact, project: Project): string {
  const full = formatSourceSpanLabel(fact, project)
  const scenePart = full.split(' · ').find((part) => part.startsWith('sc '))
  return scenePart ?? full
}

function typeClusterCounts(
  factNodes: LedgerFact[],
): { type: LedgerFact['factType']; count: number }[] {
  const counts = new Map<LedgerFact['factType'], number>()
  for (const fact of factNodes) {
    counts.set(fact.factType, (counts.get(fact.factType) ?? 0) + 1)
  }
  return CLUSTER_ORDER.flatMap((type) => {
    const count = counts.get(type) ?? 0
    return count > 0 ? [{ type, count }] : []
  })
}

/**
 * Knowledge Web — hybrid focus strip + ranked fact list + detail (UI spec §7e).
 * Ranking/cap from `buildKnowledgeGraph`; no graph library; no radial FactCards.
 */
export function KnowledgeWeb({
  facts,
  allFacts,
  project,
  busy,
  characterId,
  onAccept,
  onReject,
  onEdit,
  onSourceSpanClick,
  onOpenInAtlas,
  onBrowseInAtlas,
}: KnowledgeWebProps) {
  const graph = useMemo(
    () => buildKnowledgeGraph(facts, project, characterId),
    [facts, project, characterId],
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedFact =
    graph.factNodes.find((fact) => fact.id === selectedId) ?? null

  const relatedIds = useMemo(
    () => relatedFactIds(selectedId, graph.relatedEdges),
    [selectedId, graph.relatedEdges],
  )

  const clusters = useMemo(
    () => typeClusterCounts(graph.factNodes),
    [graph.factNodes],
  )

  const showPeopleNudge =
    characterId === null &&
    (graph.factNodes.length === 0 || graph.factNodes.length < 3)

  if (graph.factNodes.length === 0) {
    return (
      <div
        className="flex flex-col gap-3 rounded-card border border-tr-border bg-tr-surface-raised px-6 py-10 shadow-raised"
        data-testid="knowledge-web"
      >
        <p
          className="font-display text-17 text-tr-text-primary"
          data-testid="knowledge-web-empty"
        >
          No knowledge facts for {graph.focusLabel} yet
        </p>
        {characterId === null ? (
          <p
            className="max-w-prose text-13 leading-snug text-tr-text-secondary"
            data-testid="knowledge-web-people-nudge"
          >
            Audience view only shows facts nobody specifically knows yet. Pick a
            person in People to see their knowledge web — or open Atlas for the
            full story bible.
          </p>
        ) : (
          <p className="max-w-prose text-13 leading-snug text-tr-text-secondary">
            Try another person in People, or switch to Atlas for the full story
            bible.
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row"
      data-testid="knowledge-web"
    >
      <Card
        variant="raised"
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden border border-tr-border bg-tr-surface-page p-4 shadow-raised"
      >
        {showPeopleNudge && (
          <p
            className="mb-3 shrink-0 rounded-card border border-tr-border bg-tr-sky-soft px-3 py-2.5 text-13 text-tr-accent-ink"
            data-testid="knowledge-web-people-nudge"
          >
            Audience overview is sparse — pick a person in People for a denser
            knowledge web.
          </p>
        )}

        <div
          className="mb-4 flex shrink-0 flex-wrap items-center gap-2"
          data-testid="knowledge-web-focus-strip"
        >
          <div
            className="rounded-card border border-tr-border bg-tr-surface-raised px-4 py-2.5 shadow-raised"
            data-testid="web-focus-node"
          >
            <span className="text-11 font-medium uppercase tracking-wide text-tr-text-muted">
              Focus
            </span>
            <p
              className="font-display text-17 text-tr-text-primary"
              data-testid="web-focus-label"
            >
              {graph.focusLabel}
            </p>
          </div>
          <div
            className="flex flex-wrap items-center gap-1.5"
            data-testid="knowledge-web-clusters"
            aria-label="Fact type clusters for focus"
          >
            {clusters.map(({ type, count }) => (
              <span
                key={type}
                className="inline-flex items-center gap-1.5 rounded-chip border border-tr-border bg-tr-surface-raised px-2.5 py-1 text-11 text-tr-text-secondary"
                data-testid={`web-cluster-${type}`}
              >
                <span
                  className="inline-block size-1.5 rounded-chip bg-tr-border-strong"
                  aria-hidden
                />
                {TYPE_CUE[type]} · {count}
              </span>
            ))}
          </div>
        </div>

        <ul
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
          data-testid="knowledge-web-list"
        >
          {graph.factNodes.map((fact) => {
            const selected = selectedId === fact.id
            const related = !selected && relatedIds.has(fact.id)
            return (
              <li key={fact.id}>
                <button
                  type="button"
                  className={factRowClass(fact, selected, related)}
                  data-testid={`web-fact-${fact.id}`}
                  data-related={related ? 'true' : undefined}
                  aria-pressed={selected}
                  onClick={() => setSelectedId(fact.id)}
                >
                  <Chip hue="neutral" className="shrink-0 px-1.5 py-0 text-11">
                    {TYPE_CUE[fact.factType]}
                  </Chip>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-15 leading-snug text-tr-text-primary">
                      {fact.fact}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-12 text-tr-text-muted">
                      <span data-testid={`web-fact-scene-${fact.id}`}>
                        {sceneShortLabel(fact, project)}
                      </span>
                      <span data-testid={`web-fact-knowers-${fact.id}`}>
                        {knowerCountLabel(fact)}
                      </span>
                      {related ? (
                        <span className="text-tr-accent-ink">related</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {graph.overflowCount > 0 && (
          <div className="mt-3 flex shrink-0 justify-end">
            <button
              type="button"
              className="rounded-card border border-tr-border bg-tr-surface-raised px-3 py-1.5 text-13 text-tr-accent-ink shadow-raised transition-[box-shadow,background-color] duration-standard ease-standard hover:bg-tr-coral-soft hover:shadow-lift focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
              data-testid="knowledge-web-overflow"
              onClick={() => onBrowseInAtlas?.()}
            >
              +{graph.overflowCount} more — open Atlas
            </button>
          </div>
        )}
      </Card>

      {selectedFact && (
        <div
          className="tr-ledger-view-enter w-full shrink-0 lg:w-80"
          data-testid="knowledge-web-detail"
        >
          <FactCard
            fact={selectedFact}
            allFacts={allFacts}
            project={project}
            queueActions={selectedFact.status === 'pending_review'}
            busy={busy}
            onAccept={onAccept}
            onReject={onReject}
            onEdit={onEdit}
            onSourceSpanClick={onSourceSpanClick}
          />
          <button
            type="button"
            className="mt-2 w-full rounded-card border border-tr-border bg-tr-surface-raised px-3 py-2 text-13 text-tr-text-primary shadow-raised transition-[box-shadow,background-color] duration-standard ease-standard hover:bg-tr-coral-soft hover:text-tr-accent-ink hover:shadow-lift focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
            onClick={() => onOpenInAtlas?.(selectedFact.id)}
          >
            Open in Atlas
          </button>
        </div>
      )}
    </div>
  )
}
