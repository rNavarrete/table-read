import { useEffect, useMemo, useState } from 'react'
import type { LedgerFact, Project } from 'contract'
import { AtlasControlBar, type AtlasFilterChip } from './AtlasControlBar'
import { AtlasFactRow } from './AtlasFactRow'
import {
  DEFAULT_ATLAS_PREFERENCES,
  loadAtlasPreferences,
  saveAtlasPreferences,
  type AtlasPreferences,
} from './atlasPreference'
import { FactDetailDrawer } from './FactDetailDrawer'
import { SceneStrip } from './SceneStrip'
import { formatSourceSpanLabel } from './sourceSpanLabel'
import { assignCharacterAvatars } from './characterAvatar'

export interface StoryAtlasProps {
  facts: LedgerFact[]
  allFacts: LedgerFact[]
  project: Project
  busy?: boolean
  onAccept?: (factId: string) => void
  onReject?: (factId: string) => void
  onSourceSpanClick?: (fact: LedgerFact) => void
  expandedFactId?: string | null
  onExpandedFactIdChange?: (factId: string | null) => void
  emptyMessage?: string
  filterChips?: AtlasFilterChip[]
}

interface AtlasGroup {
  key: string
  label: string
  detail: string | null
  sceneId: string | null
  facts: LedgerFact[]
}

const WINDOW_SIZE = 48

function sceneForFact(project: Project, fact: LedgerFact) {
  return project.seasons
    .flatMap((season) => season.episodes)
    .flatMap((episode) => episode.scenes)
    .find((scene) => scene.id === fact.sourceSpan.sceneId)
}

function sceneNumber(project: Project, fact: LedgerFact): number {
  return (sceneForFact(project, fact)?.index ?? Number.MAX_SAFE_INTEGER) + 1
}

function sceneNumberForId(project: Project, sceneId: string): number {
  const scene = project.seasons
    .flatMap((season) => season.episodes)
    .flatMap((episode) => episode.scenes)
    .find((candidate) => candidate.id === sceneId)
  return (scene?.index ?? 0) + 1
}

function beatNumber(project: Project, fact: LedgerFact): number {
  const scene = sceneForFact(project, fact)
  return (
    scene?.beats.find((beat) => beat.id === fact.sourceSpan.beatId)?.index ??
    Number.MAX_SAFE_INTEGER
  )
}

function compareStoryOrder(
  project: Project,
  left: LedgerFact,
  right: LedgerFact,
): number {
  const sceneDiff = sceneNumber(project, left) - sceneNumber(project, right)
  if (sceneDiff !== 0) return sceneDiff
  const beatDiff = beatNumber(project, left) - beatNumber(project, right)
  if (beatDiff !== 0) return beatDiff
  return left.id.localeCompare(right.id)
}

function ownerName(project: Project, fact: LedgerFact): string {
  const id = fact.knownBy[0]
  if (!id) return 'Audience'
  return (
    project.seriesBible.characters.find((character) => character.id === id)
      ?.name ?? id
  )
}

function threadForFact(project: Project, fact: LedgerFact): string | null {
  const sceneId = fact.sourceSpan.sceneId
  for (const season of project.seasons) {
    for (const episode of season.episodes) {
      const thread = episode.threads.find(
        (candidate) =>
          candidate.setupSceneId === sceneId ||
          candidate.payoffSceneId === sceneId,
      )
      if (thread) return thread.label
    }
  }
  return null
}

function groupedFacts(
  facts: LedgerFact[],
  project: Project,
  preferences: AtlasPreferences,
): AtlasGroup[] {
  const groups = new Map<string, AtlasGroup>()
  for (const fact of facts) {
    let key = 'all'
    let label = 'All matching facts'
    let detail: string | null = null
    let sceneId: string | null = null

    if (preferences.groupBy === 'scene') {
      const scene = sceneForFact(project, fact)
      sceneId = fact.sourceSpan.sceneId
      key = `scene-${sceneId}`
      label = scene ? `Scene ${scene.index + 1}` : 'Unplaced scene'
      detail = (scene as { location?: string } | undefined)?.location ?? null
    } else if (preferences.groupBy === 'character') {
      label = ownerName(project, fact)
      key = `character-${label}`
    } else if (preferences.groupBy === 'type') {
      label = fact.factType.replace('_', ' ')
      key = `type-${fact.factType}`
    } else if (preferences.groupBy === 'thread') {
      label = threadForFact(project, fact) ?? 'Unthreaded facts'
      key = `thread-${label}`
    }

    const group = groups.get(key)
    if (group) {
      group.facts.push(fact)
    } else {
      groups.set(key, { key, label, detail, sceneId, facts: [fact] })
    }
  }
  return [...groups.values()]
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  )
}

/**
 * Atlas fact browser. The row window stays bounded to keep 470 facts fast;
 * J/K crosses windows and group state survives every filter change.
 */
export function StoryAtlas({
  facts,
  allFacts,
  project,
  busy = false,
  onAccept,
  onReject,
  onSourceSpanClick,
  expandedFactId,
  onExpandedFactIdChange,
  emptyMessage = 'No facts match these filters.',
  filterChips = [],
}: StoryAtlasProps) {
  const [uncontrolledSelectedId, setUncontrolledSelectedId] = useState<
    string | null
  >(null)
  const [query, setQuery] = useState('')
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [page, setPage] = useState(0)
  const [preferences, setPreferences] = useState<AtlasPreferences>(() =>
    project.id ? loadAtlasPreferences(project.id) : DEFAULT_ATLAS_PREFERENCES,
  )
  const selectedId =
    expandedFactId === undefined ? uncontrolledSelectedId : expandedFactId
  const avatars = useMemo(
    () =>
      assignCharacterAvatars(
        project.seriesBible.characters.map((character) => character.name),
      ),
    [project],
  )

  const searchedFacts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return facts.filter((fact) => {
      if (selectedSceneId && fact.sourceSpan.sceneId !== selectedSceneId)
        return false
      if (!needle) return true
      const scene = sceneForFact(project, fact)
      return [
        fact.fact,
        ownerName(project, fact),
        (scene as { location?: string } | undefined)?.location ?? '',
        formatSourceSpanLabel(fact, project),
      ].some((value) => value.toLocaleLowerCase().includes(needle))
    })
  }, [facts, project, query, selectedSceneId])

  const orderedFacts = useMemo(() => {
    const next = [...searchedFacts]
    if (preferences.sortBy === 'fewest_knowers') {
      next.sort(
        (left, right) =>
          left.knownBy.length - right.knownBy.length ||
          compareStoryOrder(project, left, right),
      )
    } else {
      next.sort((left, right) => compareStoryOrder(project, left, right))
    }
    return next
  }, [preferences.sortBy, project, searchedFacts])

  const selectedIndex = selectedId
    ? orderedFacts.findIndex((fact) => fact.id === selectedId)
    : -1
  const selectedPage =
    selectedIndex >= 0 ? Math.floor(selectedIndex / WINDOW_SIZE) : null
  const pageCount = Math.max(1, Math.ceil(orderedFacts.length / WINDOW_SIZE))
  const currentPage = Math.min(selectedPage ?? page, pageCount - 1)
  const pageStart = currentPage * WINDOW_SIZE
  const windowFacts = orderedFacts.slice(pageStart, pageStart + WINDOW_SIZE)
  const groups = useMemo(
    () => groupedFacts(windowFacts, project, preferences),
    [preferences, project, windowFacts],
  )
  const selectedFact = allFacts.find((fact) => fact.id === selectedId) ?? null

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        isEditableTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return
      const key = event.key.toLowerCase()
      if (
        key !== 'j' &&
        key !== 'k' &&
        key !== 'arrowdown' &&
        key !== 'arrowup' &&
        key !== 'enter' &&
        key !== 'c'
      )
        return
      if (orderedFacts.length === 0) return

      if (key === 'enter' && selectedFact) {
        event.preventDefault()
        onSourceSpanClick?.(selectedFact)
        return
      }
      if (key === 'c' && selectedFact?.status === 'pending_review') {
        event.preventDefault()
        onAccept?.(selectedFact.id)
        return
      }
      if (
        key === 'j' ||
        key === 'arrowdown' ||
        key === 'k' ||
        key === 'arrowup'
      ) {
        event.preventDefault()
        const direction = key === 'j' || key === 'arrowdown' ? 1 : -1
        const current = selectedId
          ? orderedFacts.findIndex((fact) => fact.id === selectedId)
          : direction > 0
            ? -1
            : 0
        const nextIndex = Math.max(
          0,
          Math.min(orderedFacts.length - 1, current + direction),
        )
        const next = orderedFacts[nextIndex]
        if (!next) return
        if (expandedFactId === undefined) setUncontrolledSelectedId(next.id)
        onExpandedFactIdChange?.(next.id)
        setPage(Math.floor(nextIndex / WINDOW_SIZE))
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    expandedFactId,
    onAccept,
    onExpandedFactIdChange,
    onSourceSpanClick,
    orderedFacts,
    selectedFact,
    selectedId,
  ])

  function updatePreferences(next: AtlasPreferences) {
    setPreferences(next)
    setPage(0)
    saveAtlasPreferences(project.id, next)
  }

  function selectFact(factId: string) {
    if (expandedFactId === undefined) setUncontrolledSelectedId(factId)
    onExpandedFactIdChange?.(factId)
  }

  function clearSelectedFact() {
    if (expandedFactId === undefined) setUncontrolledSelectedId(null)
    onExpandedFactIdChange?.(null)
  }

  function selectScene(sceneId: string) {
    setSelectedSceneId(sceneId)
    setPage(0)
  }

  function selectPage(nextPage: number) {
    clearSelectedFact()
    setPage(nextPage)
  }

  const atlasChips: AtlasFilterChip[] = [
    ...filterChips,
    ...(selectedSceneId
      ? [
          {
            kind: 'scene',
            label: `Scene ${sceneNumberForId(project, selectedSceneId)}`,
            onClear: () => {
              setSelectedSceneId(null)
              setPage(0)
            },
          },
        ]
      : []),
  ]

  if (searchedFacts.length === 0) {
    return (
      <div data-testid="story-atlas" className="flex min-h-0 flex-col">
        <AtlasControlBar
          query={query}
          onQueryChange={(value) => {
            setQuery(value)
            setPage(0)
          }}
          chips={atlasChips}
          shownCount={0}
          totalCount={0}
          groupBy={preferences.groupBy}
          onGroupByChange={(groupBy) =>
            updatePreferences({ ...preferences, groupBy })
          }
          sortBy={preferences.sortBy}
          onSortByChange={(sortBy) =>
            updatePreferences({ ...preferences, sortBy })
          }
          density={preferences.density}
          onDensityChange={(density) =>
            updatePreferences({ ...preferences, density })
          }
        />
        <SceneStrip
          project={project}
          facts={[]}
          selectedSceneId={selectedSceneId}
          onSelectScene={selectScene}
        />
        <div className="rounded-card border border-tr-border bg-tr-surface-raised px-6 py-12 text-center">
          <p className="font-ledger-display text-22 font-medium text-tr-text-primary">
            No facts match these filters
          </p>
          <p className="mt-2 text-13 text-tr-text-muted">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="story-atlas" className="flex min-h-0 flex-col">
      <AtlasControlBar
        query={query}
        onQueryChange={(value) => {
          setQuery(value)
          setPage(0)
        }}
        chips={atlasChips}
        shownCount={windowFacts.length}
        totalCount={orderedFacts.length}
        groupBy={preferences.groupBy}
        onGroupByChange={(groupBy) =>
          updatePreferences({ ...preferences, groupBy })
        }
        sortBy={preferences.sortBy}
        onSortByChange={(sortBy) =>
          updatePreferences({ ...preferences, sortBy })
        }
        density={preferences.density}
        onDensityChange={(density) =>
          updatePreferences({ ...preferences, density })
        }
      />
      <SceneStrip
        project={project}
        facts={searchedFacts}
        selectedSceneId={selectedSceneId}
        onSelectScene={selectScene}
      />
      <div className="grid min-h-0 gap-5 pt-5 xl:grid-cols-[minmax(0,1fr)_var(--spacing-panel-inspector)]">
        <div className="min-w-0">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key)
            return (
              <section key={group.key} className="mb-3 last:mb-0">
                <div className="sticky top-[53px] z-10 flex items-center gap-2 border-b border-tr-border bg-tr-ledger-content py-2">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current)
                        if (next.has(group.key)) next.delete(group.key)
                        else next.add(group.key)
                        return next
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral"
                    data-testid={`atlas-group-header-${group.key}`}
                  >
                    <span
                      className="font-script text-10 text-tr-text-muted"
                      aria-hidden
                    >
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                    <span className="min-w-0 truncate font-script text-11 font-bold uppercase tracking-[0.06em] text-tr-text-primary">
                      {group.label}
                    </span>
                    {group.detail ? (
                      <span className="hidden truncate font-script text-10 uppercase text-tr-text-muted sm:inline">
                        {group.detail}
                      </span>
                    ) : null}
                    <span className="ml-auto font-script text-10 tabular-nums text-tr-text-muted">
                      {group.facts.length} facts
                    </span>
                  </button>
                  {group.sceneId ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (group.sceneId) selectScene(group.sceneId)
                      }}
                      className="shrink-0 text-11 text-tr-sky underline-offset-2 hover:underline"
                    >
                      open scene →
                    </button>
                  ) : null}
                </div>
                {!isCollapsed ? (
                  <ul className="m-0 list-none p-0">
                    {group.facts.map((fact) => (
                      <AtlasFactRow
                        key={fact.id}
                        fact={fact}
                        project={project}
                        avatars={avatars}
                        density={preferences.density}
                        selected={selectedId === fact.id}
                        onSelect={() => selectFact(fact.id)}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            )
          })}
          {pageCount > 1 ? (
            <nav
              className="mt-4 flex items-center justify-between border-t border-tr-border pt-3"
              aria-label="Atlas fact windows"
            >
              <button
                type="button"
                onClick={() => selectPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="rounded-control border border-tr-border px-3 py-1.5 text-12 text-tr-text-secondary disabled:opacity-40"
              >
                Previous facts
              </button>
              <span className="font-script text-10 text-tr-text-muted">
                Facts {pageStart + 1}–
                {Math.min(pageStart + WINDOW_SIZE, orderedFacts.length)} of{' '}
                {orderedFacts.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  selectPage(Math.min(pageCount - 1, currentPage + 1))
                }
                disabled={currentPage === pageCount - 1}
                className="rounded-control border border-tr-border px-3 py-1.5 text-12 text-tr-text-secondary disabled:opacity-40"
              >
                Next facts
              </button>
            </nav>
          ) : null}
        </div>
        <FactDetailDrawer
          fact={selectedFact}
          allFacts={allFacts}
          project={project}
          busy={busy}
          onAccept={onAccept}
          onReject={onReject}
          onOpenSource={onSourceSpanClick}
          onClose={clearSelectedFact}
        />
      </div>
    </div>
  )
}
