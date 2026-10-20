import type { ReactNode } from 'react'
import type { Episode, Project } from 'contract'
import { plural } from '../../projects/wizard/board/boardText'
import { ShareBar } from '../ActHeader'
import { Chip } from '../Chip'
import { characterName } from '../planTree'
import {
  castCounts,
  noteSentence,
  type BoardModel,
  type Highlight,
  type SceneSignals,
} from '../story'
import { PanelSection } from './PanelSection'
import { PlanField } from './PlanField'
import { draftKey } from './usePlanDrafts'
import { useSectionOpenState, type PlanSectionId } from './useSectionOpenState'

export interface EpisodeViewProps {
  project: Project
  episode: Episode
  model: BoardModel
  pending: boolean
  openingReview: boolean
  onSelectScene: (sceneId: string) => void
  onHighlight: (highlight: Highlight) => void
  /** "See all n in Ledger → Threads". */
  onOpenLedgerThreads: () => void
  onSaveEpisodePremise: (value: string) => Promise<boolean>
  onSaveSeriesPremise: (value: string) => Promise<boolean>
  /** The craft check's state. The open count comes from the model (a fixed
   * line's note is already hidden) and the last check from the episode. */
  craft: { dismissed: number; busy: boolean; error: string | null }
  /** Check craft: the one model call in this view, on the click only. */
  onCheckCraft: () => void
}

// PanelHeader's focus ring (no outline-none: the heading takes focus).
const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'
const QUIET = 'text-12 text-tr-text-primary'
const LINK = `text-12 font-medium text-tr-sky underline underline-offset-2 ${FOCUS}`
const VERB = `rounded-card border border-tr-border-strong px-3 py-1 text-13 text-tr-text-primary hover:bg-tr-surface-sunken disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

const AGO = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
/** "Checked just now" / "Checked 5 minutes ago" / "Checked yesterday". */
function checkedAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (!(minutes >= 1)) return 'Checked just now'
  if (minutes < 60) return `Checked ${AGO.format(-minutes, 'minute')}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Checked ${AGO.format(-hours, 'hour')}`
  return `Checked ${AGO.format(-Math.round(hours / 24), 'day')}`
}

/** One scene row ("n · Place" and its lines); a button that selects the
 * scene, or plain text when the scene isn't on this board. */
function SceneRow({
  signals,
  onSelect,
  children,
}: {
  signals: SceneSignals | undefined
  onSelect: (sceneId: string) => void
  children: ReactNode
}) {
  const body = (
    <>
      {signals && (
        <span className="block font-medium">
          {signals.number} · {signals.place}
        </span>
      )}
      {children}
    </>
  )
  const row = 'block w-full rounded-card px-2 py-1.5 text-left text-13'
  return signals ? (
    <button
      type="button"
      onClick={() => onSelect(signals.scene.id)}
      className={`${row} text-tr-text-primary hover:bg-tr-surface-sunken ${FOCUS}`}
    >
      {body}
    </button>
  ) : (
    <div className={`${row} text-tr-text-primary`}>{body}</div>
  )
}

/** Term / text rows; empty text leaves no row. */
function Terms({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-13">
      {rows
        .filter(([, text]) => text)
        .map(([term, text]) => (
          <div key={term} className="contents">
            <dt className="text-12 text-tr-text-primary">{term}</dt>
            <dd className="text-tr-text-primary">{text}</dd>
          </div>
        ))}
    </dl>
  )
}

interface NoteLine {
  key: string
  text: string
}

function NoteRows({
  model,
  pick,
  onSelect,
}: {
  model: BoardModel
  pick: (s: SceneSignals) => NoteLine[]
  onSelect: (sceneId: string) => void
}) {
  return (
    <>
      {model.order.map((scene) => {
        const s = model.signals.get(scene.id)
        const lines = s ? pick(s) : []
        if (!s || !lines.length) return null
        return (
          <SceneRow key={scene.id} signals={s} onSelect={onSelect}>
            {lines.map((line) => (
              <span key={line.key} className="block text-12">
                {line.text}
              </span>
            ))}
          </SceneRow>
        )
      })}
    </>
  )
}

/**
 * The nothing-selected panel (spec §4.7): title, logline and format, the
 * import's About and lead arcs when it read them (T10.6), then
 * the episode read side by side — acts, open threads, the secret, notes by
 * scene, craft notes, who's in it, and the premises. Everything is derived
 * from the board model. Nothing here calls a model (rule 8) except Check
 * craft, and only on the writer's click. No tiles, no scores.
 */
export function EpisodeView({
  project,
  episode,
  model,
  pending,
  openingReview,
  onSelectScene,
  onHighlight,
  onOpenLedgerThreads,
  onSaveEpisodePremise,
  onSaveSeriesPremise,
  craft,
  onCheckCraft,
}: EpisodeViewProps) {
  const { open, setOpen } = useSectionOpenState()
  const { format } = project
  const scene = (id: string | null | undefined) => model.signals.get(id ?? '')
  const genre = format.genre.charAt(0).toUpperCase() + format.genre.slice(1)
  const formatLine = `${genre} · ${format.runtimeMinutes} min · ${plural(format.actCount, 'act')}${format.coldOpen ? ' + cold open' : ''}${format.tag ? ' + tag' : ''}`
  const logline = episode.storyOverview?.logline?.trim()
  // T10.6 — import readings, read-only; a section shows only when it has one.
  const about = [
    ['Question', episode.storyOverview?.dramaticQuestion],
    ['Argument', episode.storyOverview?.centralArgument],
    ['Anti-theme', episode.storyOverview?.antiTheme],
  ].filter((row): row is [string, string] => !!row[1]?.trim())
  const arcs = episode.characterArcs ?? []

  const live = model.threads.filter((t) => t.status !== 'abandoned')
  const openThreads = live.filter((t) => !scene(t.payoffSceneId))
  const secrets = episode.secrets ?? []
  const cast = castCounts(model)
  const signals = [...model.signals.values()]
  const storyLines = (s: SceneSignals): NoteLine[] => [
    // An Order note is listed once, on the scene that is out of order.
    ...s.orderNotes
      .filter((n) => n.issue.sceneId === s.scene.id)
      .map((n) => ({ key: n.issue.id, text: `Order: ${n.text}` })),
    ...s.storyNotes.map((note) => ({
      key: note.flag.id,
      text: noteSentence(note, s.scene, model.order),
    })),
  ]
  const importLines = (s: SceneSignals): NoteLine[] =>
    s.importNotes.map((note) => ({
      key: note.flag.id,
      text: noteSentence(note, s.scene, model.order),
    }))
  const notedScenes = signals.filter((s) => storyLines(s).length).length
  const importCount = signals.reduce((n, s) => n + s.importNotes.length, 0)
  const craftScenes = model.order.flatMap((s) => {
    const sig = model.signals.get(s.id)
    const n = sig?.storyNotes.filter((note) => note.kind === 'craft').length
    return sig && n ? [{ sig, n }] : []
  })
  const craftCount = craftScenes.reduce((n, s) => n + s.n, 0)
  const firstCraft = craftScenes[0]?.sig
  // Goes once the contract's Episode.craftCheckedAt lands: read it directly.
  const checkedAt =
    (episode as Episode & { craftCheckedAt?: string | null }).craftCheckedAt ??
    null

  const section = (
    id: Extract<PlanSectionId, `ep-${string}`>,
    title: string,
    children: ReactNode,
    count?: number,
  ) => (
    <PanelSection
      id={id}
      title={title}
      count={count}
      open={open[id]}
      onToggle={(next) => setOpen(id, next)}
    >
      {children}
    </PanelSection>
  )

  return (
    <aside
      data-testid="inspector"
      aria-label="Episode"
      className="w-panel-plan shrink-0 overflow-y-auto bg-tr-surface-raised"
    >
      <div className="p-4">
        <p className="text-11 font-semibold uppercase tracking-wide text-tr-text-primary">
          Episode
        </p>
        <h2
          tabIndex={-1}
          className={`mt-1 font-display text-17 text-tr-text-primary ${FOCUS}`}
        >
          Episode {episode.index + 1}: {episode.title}
        </h2>
        {logline && (
          <p className="mt-2 text-15 text-tr-text-primary">{logline}</p>
        )}
        <p className="mt-1.5 text-12 text-tr-text-primary">{formatLine}</p>
      </div>

      {about.length > 0 && section('ep-about', 'About', <Terms rows={about} />)}

      {arcs.length > 0 &&
        section(
          'ep-arcs',
          'Lead arcs',
          <ul className="flex flex-col gap-2">
            {arcs.map((arc) => (
              <li
                key={arc.characterId}
                className="rounded-card border border-tr-border bg-tr-surface-raised p-3"
              >
                <p className="text-13 font-semibold text-tr-text-primary">
                  {characterName(model.characters, arc.characterId)}
                </p>
                <Terms
                  rows={[
                    ['Wants', arc.want],
                    ['Needs', arc.need],
                    ['Lie', arc.lie],
                    ['Ghost', arc.ghost],
                    ['Continuum', arc.continuumAxis],
                  ]}
                />
              </li>
            ))}
          </ul>,
        )}

      {section(
        'ep-acts',
        'Acts, side by side',
        <>
          {model.acts.map((act) => {
            const out = scene(act.actOutSceneId)
            return (
              <div
                key={act.act}
                className="border-t border-tr-border py-2.5 first:border-t-0 first:pt-0.5"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-12 font-semibold uppercase tracking-wide text-tr-text-primary">
                    {act.label}
                  </span>
                  {act.share !== null && (
                    <ShareBar
                      share={act.share}
                      even={1 / model.acts.length}
                      actCount={model.acts.length}
                    />
                  )}
                  <span className="text-12 text-tr-text-primary tabular-nums">
                    {plural(act.scenes.length, 'scene')}
                  </span>
                  {act.landmarks.map((m) => (
                    <Chip key={m.label} hue="sage" title={m.label}>
                      ✓ {m.short} · {m.number}
                    </Chip>
                  ))}
                </div>
                {out ? (
                  <button
                    type="button"
                    onClick={() => onSelectScene(out.scene.id)}
                    className={`group mt-1.5 block w-full text-left text-12 text-tr-text-primary ${FOCUS}`}
                  >
                    <span className="block font-semibold group-hover:underline">
                      Act out · scene {out.number} · {out.place}
                    </span>
                    {out.scene.audienceLearns && (
                      <span className="mt-0.5 block">
                        {out.scene.audienceLearns}
                      </span>
                    )}
                    {out.scene.audienceFeels && (
                      <span className="mt-0.5 block italic text-tr-accent-ink">
                        Feels: {out.scene.audienceFeels}
                      </span>
                    )}
                  </button>
                ) : (
                  <p className={`mt-1.5 ${QUIET}`}>No scenes yet.</p>
                )}
              </div>
            )
          })}
          {model.hasScript && (
            <p className={`mt-1.5 ${QUIET}`}>
              Length is a share of the script text, not pages.
            </p>
          )}
        </>,
      )}

      {section(
        'ep-threads',
        model.hasThreads
          ? `Threads · ${openThreads.length} open · ${live.length - openThreads.length} paid off`
          : 'Threads',
        !model.threads.length ? (
          <p className={QUIET}>No threads recorded.</p>
        ) : (
          <div className="flex flex-col items-start gap-1">
            {openThreads.map((t) => (
              <SceneRow
                key={t.id}
                signals={scene(t.setupSceneId)}
                onSelect={onSelectScene}
              >
                <span className="block text-12">
                  ↗ {t.label} — never paid off
                </span>
              </SceneRow>
            ))}
            {!openThreads.length && <p className={QUIET}>No open threads.</p>}
            <button
              type="button"
              onClick={onOpenLedgerThreads}
              className={`mt-1 ${LINK}`}
            >
              See all {model.threads.length} in Ledger → Threads
            </button>
          </div>
        ),
      )}

      {section(
        'ep-secret',
        'The secret',
        !secrets.length ? (
          <p className={QUIET}>No secret recorded.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {secrets.map((secret) => {
              const set = scene(secret.establishedSceneId)
              const out = scene(secret.revealedSceneId)
              const kept = secret.concealmentSceneIds ?? []
              const hidden = secret.concealedFromCharacterIds ?? []
              return (
                <div
                  key={secret.id}
                  className="flex items-start gap-2 rounded-card border border-tr-ledger-secret-border bg-tr-ledger-secret-surface px-2.5 py-2 text-12 text-tr-text-primary"
                >
                  <span
                    aria-hidden="true"
                    className="font-semibold text-tr-ledger-secret-ink"
                  >
                    ◆
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p>{secret.summary}</p>
                    <p className="flex flex-wrap items-center gap-1.5">
                      {set && (
                        <button
                          type="button"
                          onClick={() => onSelectScene(set.scene.id)}
                          className={LINK}
                        >
                          Set in {set.number}
                        </button>
                      )}
                      <span>
                        {set && '· '}kept in {plural(kept.length, 'scene')} ·
                      </span>
                      {out ? (
                        <button
                          type="button"
                          onClick={() => onSelectScene(out.scene.id)}
                          className={LINK}
                        >
                          out in {out.number}
                        </button>
                      ) : (
                        <span>never revealed</span>
                      )}
                    </p>
                    {hidden.length > 0 && (
                      <p>
                        Hidden from{' '}
                        {hidden
                          .map((id) => characterName(model.characters, id))
                          .join(', ')}
                        .
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => onHighlight({ kind: 'secret', who: null })}
                      className={`self-start ${LINK}`}
                    >
                      Highlight on the board
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ),
      )}

      {section(
        'ep-notes',
        'Notes',
        !notedScenes && !importCount ? (
          <p className={QUIET}>No open notes.</p>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <NoteRows
              model={model}
              pick={storyLines}
              onSelect={onSelectScene}
            />
            {importCount > 0 && (
              <details className="mt-1 w-full border-t border-tr-border-strong pt-1.5">
                <summary
                  className={`cursor-pointer px-1 py-1 text-12 font-semibold text-tr-text-primary ${FOCUS}`}
                >
                  From the import · {importCount}
                </summary>
                <div className="flex flex-col items-start gap-1 pl-2">
                  <NoteRows
                    model={model}
                    pick={importLines}
                    onSelect={onSelectScene}
                  />
                </div>
              </details>
            )}
          </div>
        ),
        notedScenes,
      )}

      {section(
        'ep-craft',
        'Craft notes',
        <div className="flex flex-col items-start gap-1.5">
          <p className={QUIET}>
            The AI reads the dialogue for lines that say the theme out loud or
            say what a character is doing. Its notes are a reading: dismiss any
            that don&apos;t fit.
          </p>
          <button
            type="button"
            disabled={craft.busy || pending}
            onClick={onCheckCraft}
            className={VERB}
          >
            {craft.busy ? 'Checking…' : 'Check craft'}
          </button>
          {craft.error && (
            <p role="alert" className="text-12 text-tr-danger">
              {craft.error}
            </p>
          )}
          {(checkedAt || craftCount > 0 || craft.dismissed > 0) && (
            <p className="text-13 text-tr-text-primary">
              {craftCount > 0
                ? plural(craftCount, 'craft note')
                : 'No craft notes'}
              {craft.dismissed > 0 && ` · ${craft.dismissed} dismissed`}
            </p>
          )}
          {firstCraft && (
            <button
              type="button"
              onClick={() => onSelectScene(firstCraft.scene.id)}
              className={LINK}
            >
              Go to the first: scene {firstCraft.number}
            </button>
          )}
          <p className={QUIET}>
            {checkedAt ? checkedAgo(checkedAt) : 'Not checked yet'}
          </p>
        </div>,
      )}

      {section(
        'ep-cast',
        "Who's in it",
        !cast.length ? (
          <p className={QUIET}>No cast yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {cast.map(({ character, scenes }) => (
                <button
                  key={character.id}
                  type="button"
                  onClick={() =>
                    onHighlight({ kind: 'who', who: character.id })
                  }
                  className={`rounded-chip border border-tr-border-strong bg-tr-surface-raised px-2.5 py-0.5 text-12 text-tr-text-primary hover:bg-tr-coral-soft ${FOCUS}`}
                >
                  {character.name}{' '}
                  <span className="text-tr-accent-ink tabular-nums">
                    {scenes}
                  </span>
                </button>
              ))}
            </div>
            <p className={`mt-2 ${QUIET}`}>
              Scene counts from dialogue cues and recorded wants.
            </p>
          </>
        ),
      )}

      {section(
        'ep-premise',
        'Premise',
        <div className="flex flex-col gap-4">
          <PlanField
            label="Episode premise"
            draftKey={draftKey(episode.id, 'premise')}
            sceneId={null}
            value={episode.premise}
            multiline
            structural
            locked={episode.locked}
            saving={pending}
            openingReview={openingReview}
            onSave={onSaveEpisodePremise}
          />
          <PlanField
            label="Series premise"
            draftKey={draftKey('project', 'premise')}
            sceneId={null}
            value={project.premise}
            multiline
            structural
            locked={false}
            saving={pending}
            openingReview={openingReview}
            onSave={onSaveSeriesPremise}
          />
        </div>,
      )}
    </aside>
  )
}
