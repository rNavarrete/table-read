import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  ConsistencyFlag,
  Episode,
  LedgerFact,
  Project,
  Scene,
} from 'contract'
import { prefersReducedMotion } from '../../projects/wizard/board/boardMotion'
import { LockToggle } from '../LockToggle'
import { actLabel, actNumbersForFormat } from '../planTree'
import {
  boardOrder,
  castFromDialogue,
  expositionLine,
  factsForScene,
  knowledgeModes,
  landmarksForScene,
  notesForScene,
  secretsForScene,
  threadsForScene,
} from '../story'
import { BeatLadder } from './BeatLadder'
import { DetailsSection } from './DetailsSection'
import { PanelHeader, type JumpTarget } from './PanelHeader'
import { PanelSection } from './PanelSection'
import type { BeatTextField } from './PlanField'
import { usePlanDrafts } from './usePlanDrafts'
import { useSectionOpenState } from './useSectionOpenState'
import { WhatItTouches } from './WhatItTouches'
import { WhatTheSceneDoes } from './WhatTheSceneDoes'
import { WhoWantsWhat } from './WhoWantsWhat'

export interface ScenePanelProps {
  project: Project
  episode: Episode
  scene: Scene
  selectedBeatId: string | null
  ledger: LedgerFact[]
  /** All open flags; the panel derives this scene's notes. */
  flags: ConsistencyFlag[]
  pending: boolean
  openingReview: boolean
  /** T3.4 seam: the notes strip (id="plan-section-notes" data-plan-section="notes").
   * Given `showBeat` so a note's "Show beat" opens Beats and scrolls to the row. */
  notes?: (showBeat: (beatId: string) => void) => ReactNode
  /** T3.4 seam: "Notes n" in the jump bar. */
  noteCount?: number
  onBack: () => void
  /** Esc outside a field: back to this scene's card on the board. */
  onEscape: () => void
  onSelectScene: (sceneId: string) => void
  onSelectBeat: (sceneId: string, beatId: string | null) => void
  onToggleSceneLock: (sceneId: string, locked: boolean) => void
  onToggleBeatLock: (sceneId: string, beatId: string, locked: boolean) => void
  onToggleBeatScriptLock: (
    sceneId: string,
    beatId: string,
    scriptLocked: boolean,
  ) => void
  onSaveSceneField: <K extends keyof Scene>(
    sceneId: string,
    field: K,
    value: Scene[K],
  ) => Promise<boolean>
  onSaveBeatField: (
    sceneId: string,
    beatId: string,
    field: BeatTextField,
    value: string,
  ) => Promise<boolean>
  onOpenReview: (sceneId: string, instruction: string) => void
  onSuggest: (sceneId: string) => Promise<string[]>
  onOpenInWrite: (sceneId: string) => void
  onOpenBeatInWrite: (sceneId: string, beatId: string) => void
  onOpenFact: (factId: string) => void
  onOpenLedger: () => void
}

/**
 * The 400px scene panel (spec §4.6; `data-testid="inspector"` kept for e2e and
 * the onboarding recipes). It scrolls on its own under a sticky header; every
 * section is derived in render from the props with story.ts. The panel is not
 * remounted per scene: drafts live in the Plan draft store, and focus stays on
 * ‹ › while stepping.
 */
export function ScenePanel({
  project,
  episode,
  scene,
  selectedBeatId,
  ledger,
  flags,
  pending,
  openingReview,
  notes,
  noteCount = 0,
  onBack,
  onEscape,
  onSelectScene,
  onSelectBeat,
  onToggleSceneLock,
  onToggleBeatLock,
  onToggleBeatScriptLock,
  onSaveSceneField,
  onSaveBeatField,
  onOpenReview,
  onSuggest,
  onOpenInWrite,
  onOpenBeatInWrite,
  onOpenFact,
  onOpenLedger,
}: ScenePanelProps) {
  const drafts = usePlanDrafts()
  const { open, setOpen } = useSectionOpenState()
  const asideRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  // Scroll-spy result, tied to the scene it was measured on.
  const [spied, setSpied] = useState<{
    sceneId: string
    target: JumpTarget
  } | null>(null)
  // Until when a jump-bar scroll owns the underline: spy() would otherwise
  // light up each section the smooth scroll passes, and the last one when
  // it bottoms out. `scrollend` ends it early; the deadline covers Safari
  // (no scrollend) and a scroll with nowhere to go.
  const jumpUntil = useRef(0)

  // A new scene starts at the top, unless a beat was selected with it.
  useEffect(() => {
    if (!selectedBeatId) asideRef.current?.scrollTo({ top: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per scene, not per beat
  }, [scene.id])

  useEffect(() => {
    const aside = asideRef.current
    const end = () => {
      jumpUntil.current = 0
    }
    aside?.addEventListener('scrollend', end)
    return () => aside?.removeEventListener('scrollend', end)
  }, [])

  const locked = scene.locked || episode.locked
  const characters = project.seriesBible.characters
  const order = boardOrder(episode.scenes)
  const at = order.findIndex((s) => s.id === scene.id)
  const planNotes = notesForScene(flags, scene)
  const landmarks = landmarksForScene(episode, scene)
  const wantIds = new Set(scene.motivations.map((m) => m.characterId))
  const cast = castFromDialogue(scene, characters)
  // Present by dialogue cues only: labelled as such in sections 2 and 3.
  const alsoInScene = cast.filter((c) => !wantIds.has(c.id))
  const present = new Set([...wantIds, ...cast.map((c) => c.id)])
  const headAt = (episode.characterArcs ?? []).flatMap((arc) => {
    const stop = arc.stops.find((s) => s.sceneId === scene.id)
    return stop && present.has(arc.characterId)
      ? [{ characterId: arc.characterId, headAt: stop.headAt }]
      : []
  })
  const threads = threadsForScene(episode, scene.id)
  const secrets = secretsForScene(episode, scene.id, present)
  const facts = factsForScene(ledger, scene.id)
  const modes = knowledgeModes(episode, ledger, scene.id, present)
  const moments = (episode.relationshipStates ?? []).filter(
    (r) => r.sceneId === scene.id,
  )
  const timeJump =
    (episode.timelineAnchors ?? []).find((a) => a.afterSceneId === scene.id) ??
    null
  const active: JumpTarget =
    spied?.sceneId === scene.id
      ? spied.target
      : noteCount > 0
        ? 'notes'
        : 'scene'

  function sections(): HTMLElement[] {
    return Array.from(
      asideRef.current?.querySelectorAll<HTMLElement>('[data-plan-section]') ??
        [],
    )
  }

  function spy() {
    const aside = asideRef.current
    if (!aside || Date.now() < jumpUntil.current) return
    const line = aside.scrollTop + (headerRef.current?.offsetHeight ?? 0) + 1
    const all = sections()
    // Scrolled to the bottom: the last section can't reach the top line.
    const atBottom =
      aside.scrollTop + aside.clientHeight >= aside.scrollHeight - 1
    const current = atBottom
      ? all[all.length - 1]
      : (all.filter((el) => el.offsetTop <= line).pop() ?? all[0])
    if (!current) return
    const target = current.dataset.planSection as JumpTarget
    // Same section: keep the state, or every scroll event re-renders the panel.
    setSpied((prev) =>
      prev?.sceneId === scene.id && prev.target === target
        ? prev
        : { sceneId: scene.id, target },
    )
  }

  function jump(target: JumpTarget) {
    if (target !== 'notes') setOpen(target, true)
    setSpied({ sceneId: scene.id, target })
    jumpUntil.current = Date.now() + 1000
    // Next frame: the section may have just opened.
    requestAnimationFrame(() => {
      const el = sections().find((s) => s.dataset.planSection === target)
      if (!el) return
      asideRef.current?.scrollTo({
        top: el.offsetTop - (headerRef.current?.offsetHeight ?? 0),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
    })
  }

  // A beat shown from outside the ladder (a landmark link, a note's "Show
  // beat") must be visible even when the viewer left Beats closed. Scrolled
  // from the click, next frame (once Beats is open), so a second click on
  // the same beat scrolls again.
  function showBeat(beatId: string) {
    onSelectBeat(scene.id, beatId)
    setOpen('beats', true)
    // `document`, not asideRef: showBeat is handed to `notes` during render.
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-testid="beat-card-${beatId}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    )
  }

  return (
    <aside
      ref={asideRef}
      data-testid="inspector"
      aria-label="Inspector"
      onScroll={spy}
      // Esc outside a field goes back to this scene's card on the board.
      onKeyDown={(event) => {
        if (
          event.key !== 'Escape' ||
          (event.target as HTMLElement).closest('input, textarea, select')
        )
          return
        onEscape()
      }}
      className="relative w-panel-plan shrink-0 overflow-y-auto bg-tr-surface-raised"
    >
      <div
        ref={headerRef}
        data-testid="panel-header"
        className="sticky top-0 z-10 bg-tr-surface-raised"
      >
        <PanelHeader
          scene={scene}
          position={at + 1}
          total={order.length}
          prevSceneId={order[at - 1]?.id ?? null}
          nextSceneId={order[at + 1]?.id ?? null}
          locked={locked}
          unsaved={drafts.dirtySceneIds.has(scene.id)}
          counts={{
            notes: noteCount,
            wants: scene.motivations.length,
            touches:
              threads.length +
              secrets.length +
              facts.shown.length +
              moments.length,
            beats: scene.beats.length,
          }}
          active={active}
          onBack={onBack}
          onSelectScene={onSelectScene}
          onJump={jump}
        />
      </div>
      <div className="flex flex-col gap-4 p-4">
        <p className="font-script text-13 text-tr-text-primary">
          {scene.location}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="plan-act-select"
            aria-label="Act"
            value={scene.act}
            // Disabled would blur the focused select to <body> for the save; aria-disabled keeps it.
            disabled={locked}
            aria-disabled={pending || undefined}
            onChange={(e) => {
              if (pending) return
              void onSaveSceneField(scene.id, 'act', Number(e.target.value))
            }}
            className="rounded-card border border-tr-border bg-tr-surface-page px-2 py-1 text-13 text-tr-text-primary disabled:opacity-50 aria-disabled:opacity-50"
          >
            {actNumbersForFormat(project.format).map((act) => (
              <option key={act} value={act}>
                {actLabel(act, project.format)}
              </option>
            ))}
          </select>
          <LockToggle
            locked={scene.locked}
            label="Scene"
            disabled={pending}
            onChange={(next) => onToggleSceneLock(scene.id, next)}
          />
          <button
            type="button"
            onClick={() => onOpenInWrite(scene.id)}
            className="ml-auto text-13 text-tr-sky underline"
          >
            Open in Write ↗
          </button>
        </div>
        {locked && (
          <p
            role="status"
            className="rounded-card border border-tr-border bg-tr-amber-soft px-3 py-2 text-13 text-tr-text-primary"
          >
            Locked — unlock to edit. Review will never change this scene.
          </p>
        )}
        {notes?.(showBeat)}
        <PanelSection
          id="scene"
          title="What the scene does"
          steersNextBeat
          open={open.scene}
          onToggle={(next) => setOpen('scene', next)}
        >
          <WhatTheSceneDoes
            scene={scene}
            landmarks={landmarks}
            locked={locked}
            saving={pending}
            openingReview={openingReview}
            onSaveField={(field, value) =>
              onSaveSceneField(scene.id, field, value)
            }
            onOpenReview={(instruction) => onOpenReview(scene.id, instruction)}
            onSuggest={() => onSuggest(scene.id)}
            onShowBeat={showBeat}
          />
        </PanelSection>
        <PanelSection
          id="wants"
          title="Who wants what"
          count={scene.motivations.length}
          steersNextBeat
          open={open.wants}
          onToggle={(next) => setOpen('wants', next)}
        >
          <WhoWantsWhat
            motivations={scene.motivations}
            characters={characters}
            alsoInScene={alsoInScene}
            headAt={headAt}
          />
        </PanelSection>
        <PanelSection
          id="touches"
          title="What it touches"
          open={open.touches}
          onToggle={(next) => setOpen('touches', next)}
        >
          <WhatItTouches
            key={scene.id}
            scenes={episode.scenes}
            threads={threads}
            secrets={secrets}
            facts={facts}
            modes={modes}
            exposition={(fact) => expositionLine(project, fact)}
            relationshipMoments={moments}
            characters={characters}
            alsoInScene={alsoInScene}
            onSelectScene={onSelectScene}
            onOpenFact={onOpenFact}
            onOpenLedger={onOpenLedger}
          />
        </PanelSection>
        <PanelSection
          id="beats"
          title="Beats"
          count={scene.beats.length}
          open={open.beats}
          onToggle={(next) => setOpen('beats', next)}
        >
          <BeatLadder
            scene={scene}
            characters={characters}
            episodeLocked={episode.locked}
            selectedBeatId={selectedBeatId}
            notes={planNotes}
            landmarks={landmarks}
            timeJump={timeJump}
            pending={pending}
            onSelectBeat={(beatId) => onSelectBeat(scene.id, beatId)}
            onToggleBeatLock={(beatId, next) =>
              onToggleBeatLock(scene.id, beatId, next)
            }
            onToggleBeatScriptLock={(beatId, next) =>
              onToggleBeatScriptLock(scene.id, beatId, next)
            }
            onSaveBeatField={(beatId, field, value) =>
              onSaveBeatField(scene.id, beatId, field, value)
            }
            onOpenBeatInWrite={(beatId) => onOpenBeatInWrite(scene.id, beatId)}
          />
        </PanelSection>
        <PanelSection
          id="details"
          title="Details"
          open={open.details}
          onToggle={(next) => setOpen('details', next)}
        >
          <DetailsSection
            scene={scene}
            storylines={episode.storylines}
            locked={locked}
            saving={pending}
            onSaveField={(field, value) =>
              onSaveSceneField(scene.id, field, value)
            }
          />
        </PanelSection>
      </div>
    </aside>
  )
}
