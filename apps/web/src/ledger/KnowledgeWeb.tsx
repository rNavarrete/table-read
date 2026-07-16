import { useMemo, useState } from 'react'
import type { LedgerFact, Project } from 'contract'
import { Card } from '../plan/Card'
import { FactCard } from './FactCard'
import { buildKnowledgeGraph } from './knowledgeGraph'

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
}

function factNodeClass(fact: LedgerFact): string {
  const base =
    'rounded-card border border-tr-border px-3 py-2 text-left text-13 text-tr-text-primary shadow-raised'
  if (fact.status === 'pending_review') {
    return `${base} bg-tr-amber-soft`
  }
  return `${base} bg-tr-surface-raised`
}

/**
 * Knowledge Web — character-focused graph (spec §6). CSS layout only; no graph lib.
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
}: KnowledgeWebProps) {
  const graph = useMemo(
    () => buildKnowledgeGraph(facts, project, characterId),
    [facts, project, characterId],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedFact =
    graph.factNodes.find((fact) => fact.id === selectedId) ?? null

  if (graph.factNodes.length === 0) {
    return (
      <div
        className="flex flex-col gap-2 rounded-card border border-tr-border bg-tr-surface-clay p-6"
        data-testid="knowledge-web"
      >
        <p
          className="font-display text-17 text-tr-text-primary"
          data-testid="knowledge-web-empty"
        >
          No knowledge facts for {graph.focusLabel} yet
        </p>
        <p className="text-13 text-tr-text-muted">
          Select a person in People to explore their knowledge, or switch to
          Atlas for the full story bible.
        </p>
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
        className="relative flex min-h-64 flex-1 flex-col border border-tr-border bg-tr-surface-clay p-4"
      >
        <div className="relative flex min-h-0 flex-1 gap-6">
          <div className="flex shrink-0 flex-col items-center justify-center self-center">
            <div
              className="rounded-card border border-tr-border bg-tr-surface-raised px-4 py-3 text-center shadow-raised"
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
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              className="absolute bottom-0 left-0 top-0 w-px bg-tr-border"
              aria-hidden
            />
            <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto pl-6">
              {graph.factNodes.map((fact) => (
                <li key={fact.id} className="relative">
                  <span
                    className="absolute -left-6 top-1/2 h-px w-6 -translate-y-1/2 bg-tr-border"
                    aria-hidden
                  />
                  <button
                    type="button"
                    className={
                      factNodeClass(fact) +
                      (selectedId === fact.id
                        ? ' ring-1 ring-tr-coral-soft'
                        : '')
                    }
                    data-testid={`web-fact-${fact.id}`}
                    onClick={() => setSelectedId(fact.id)}
                  >
                    <span className="line-clamp-2">{fact.fact}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
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
