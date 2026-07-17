import { useMemo, useState } from 'react'
import type { LedgerFact, Project } from 'contract'
import { Card } from '../plan/Card'
import { Chip } from '../plan/Chip'
import { FactCard } from './FactCard'
import {
  WEB_FOCUS,
  WEB_VIEW,
  buildKnowledgeGraph,
  knownByForFocus,
  layoutFactNodes,
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

const NODE_W = 168
const NODE_H = 72

function factNodeClass(fact: LedgerFact, selected: boolean): string {
  const base =
    'absolute box-border flex w-[168px] -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-card border px-2.5 py-2 text-left shadow-raised transition-[box-shadow,outline-color,background-color] duration-standard ease-standard motion-reduce:transition-none focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral'
  const surface =
    fact.status === 'pending_review'
      ? 'border-tr-border bg-tr-amber-soft'
      : 'border-tr-border bg-tr-surface-raised'
  const selectedClass = selected
    ? ' z-10 outline outline-selected outline-offset-2 outline-tr-coral shadow-lift'
    : ' outline outline-0 outline-transparent'
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

/**
 * Knowledge Web — character-focused radial graph (UI spec §7e).
 * SVG spokes + mini-edges; no graph library.
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
  const layouts = useMemo(
    () => layoutFactNodes(graph.factNodes),
    [graph.factNodes],
  )
  const layoutById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    for (const entry of layouts) {
      map.set(entry.factId, { x: entry.x, y: entry.y })
    }
    return map
  }, [layouts])

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedFact =
    graph.factNodes.find((fact) => fact.id === selectedId) ?? null

  const showPeopleNudge =
    characterId === null &&
    (graph.factNodes.length === 0 || graph.factNodes.length < 3)

  if (graph.factNodes.length === 0) {
    return (
      <div
        className="flex flex-col gap-3 rounded-card border border-tr-border bg-tr-surface-clay p-6"
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
            className="text-13 text-tr-text-secondary"
            data-testid="knowledge-web-people-nudge"
          >
            Audience view only shows facts nobody specifically knows yet. Pick a
            person in People to see their knowledge web — or open Atlas for the
            full story bible.
          </p>
        ) : (
          <p className="text-13 text-tr-text-muted">
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
        className="relative flex min-h-[32rem] flex-1 flex-col overflow-hidden border border-tr-border bg-tr-surface-clay p-3"
      >
        {showPeopleNudge && (
          <p
            className="mb-2 shrink-0 rounded-card bg-tr-sky-soft px-3 py-2 text-13 text-tr-accent-ink"
            data-testid="knowledge-web-people-nudge"
          >
            Audience overview is sparse — pick a person in People for a denser
            knowledge web.
          </p>
        )}

        <div
          className="relative min-h-0 w-full flex-1"
          data-testid="knowledge-web-canvas"
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${WEB_VIEW.width} ${WEB_VIEW.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
            data-testid="knowledge-web-svg"
          >
            {graph.relatedEdges.map((edge) => {
              const from = layoutById.get(edge.fromFactId)
              const to = layoutById.get(edge.toFactId)
              if (!from || !to) return null
              const midX = (from.x + to.x) / 2
              const midY = (from.y + to.y) / 2 - 18
              return (
                <path
                  key={edge.id}
                  d={`M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`}
                  fill="none"
                  stroke="var(--tr-border-strong)"
                  strokeWidth={edge.kind === 'relationship' ? 1.25 : 1}
                  strokeOpacity={edge.kind === 'relationship' ? 0.55 : 0.4}
                  data-testid={edge.id}
                  data-edge-kind={edge.kind}
                />
              )
            })}

            {layouts.map((layout) => (
              <line
                key={`spoke-${layout.factId}`}
                x1={WEB_FOCUS.x}
                y1={WEB_FOCUS.y}
                x2={layout.x}
                y2={layout.y}
                stroke="var(--tr-border)"
                strokeWidth={1.5}
                data-testid={`web-spoke-${layout.factId}`}
              />
            ))}
          </svg>

          <div className="pointer-events-none absolute inset-0">
            <div
              className="pointer-events-auto absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-card border border-tr-border-strong bg-tr-surface-raised px-4 py-3 text-center shadow-lift"
              style={{
                left: `${(WEB_FOCUS.x / WEB_VIEW.width) * 100}%`,
                top: `${(WEB_FOCUS.y / WEB_VIEW.height) * 100}%`,
              }}
              data-testid="web-focus-node"
            >
              <span className="text-12 text-tr-text-muted">Focus</span>
              <p
                className="font-display text-17 text-tr-text-primary"
                data-testid="web-focus-label"
              >
                {graph.focusLabel}
              </p>
            </div>

            {graph.factNodes.map((fact) => {
              const layout = layoutById.get(fact.id)
              if (!layout) return null
              const selected = selectedId === fact.id
              return (
                <button
                  key={fact.id}
                  type="button"
                  className={`pointer-events-auto ${factNodeClass(fact, selected)}`}
                  style={{
                    left: `${(layout.x / WEB_VIEW.width) * 100}%`,
                    top: `${(layout.y / WEB_VIEW.height) * 100}%`,
                    width: NODE_W,
                    minHeight: NODE_H,
                  }}
                  data-testid={`web-fact-${fact.id}`}
                  aria-pressed={selected}
                  onClick={() => setSelectedId(fact.id)}
                >
                  <span className="flex items-center gap-1">
                    <Chip hue="neutral" className="px-1.5 py-0 text-11">
                      {TYPE_CUE[fact.factType]}
                    </Chip>
                  </span>
                  <span className="line-clamp-2 text-13 text-tr-text-primary">
                    {fact.fact}
                  </span>
                  <span className="flex items-center justify-between gap-2 text-11 text-tr-text-muted">
                    <span data-testid={`web-fact-scene-${fact.id}`}>
                      {sceneShortLabel(fact, project)}
                    </span>
                    <span data-testid={`web-fact-knowers-${fact.id}`}>
                      {knowerCountLabel(fact)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {graph.overflowCount > 0 && (
          <div className="mt-2 flex shrink-0 justify-end">
            <button
              type="button"
              className="rounded-card border border-tr-border bg-tr-surface-raised px-3 py-1.5 text-13 text-tr-accent-ink shadow-raised transition-shadow duration-standard ease-standard hover:shadow-lift motion-reduce:transition-none"
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
          className="w-full shrink-0 lg:w-80"
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
            className="mt-2 rounded-card bg-tr-surface-clay px-3 py-1 text-13 text-tr-text-primary"
            onClick={() => onOpenInAtlas?.(selectedFact.id)}
          >
            Open in Atlas
          </button>
        </div>
      )}
    </div>
  )
}
