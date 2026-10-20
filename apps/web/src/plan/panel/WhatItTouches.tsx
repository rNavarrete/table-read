import { useState, type ReactNode } from 'react'
import type { Character, LedgerFact, RelationshipState, Scene } from 'contract'
import { Chip } from '../Chip'
import { characterName } from '../planTree'
import { PHASE_WORD, type SceneSecret, type SceneThread } from '../story'

export interface WhatItTouchesProps {
  /** To print other scenes' numbers (index + 1) and to link only to scenes that exist. */
  scenes: Scene[]
  threads: SceneThread[]
  secrets: SceneSecret[]
  facts: { shown: LedgerFact[]; retired: LedgerFact[] }
  relationshipMoments: RelationshipState[]
  characters: Character[]
  /** Present only by dialogue cues (the list WhoWantsWhat gets): their
   * in-the-dark line is labelled "from dialogue cues" (spec §6). */
  alsoInScene: Character[]
  onSelectScene: (sceneId: string) => void
  onOpenFact: (factId: string) => void
  onOpenLedger: () => void
}

const THREAD_ROLE: Record<SceneThread['role'], string> = {
  sets_up: '↗ Sets up',
  pays_off: '↘ Pays off',
  moves: '→ Moves',
}

// A row's own role already says it: "↗ Sets up" needs no "sets up" phase.
const ROLE_PHASE: Partial<Record<SceneThread['role'], string>> = {
  sets_up: 'setup',
  pays_off: 'payoff',
}

const ROLE_TAG: Record<SceneSecret['role'], string> = {
  set: '◆ Set here',
  kept: '◆ Kept here',
  out: '◇ Out here',
}

const RETIRED_WORD: Partial<Record<LedgerFact['status'], string>> = {
  superseded: 'Superseded',
  stale: 'Stale',
  rejected: 'Rejected',
}

const QUIET = 'text-13 text-tr-text-secondary'
const FOCUS =
  'focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-sky'
const LINK = `text-13 text-tr-text-primary underline ${FOCUS}`

/** "A, B +2": the first two names, then how many more. */
function shortList(names: string[]): string {
  return names.length > 2
    ? `${names.slice(0, 2).join(', ')} +${names.length - 2}`
    : names.join(', ')
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-12 font-semibold uppercase tracking-wide text-tr-text-primary">
        {title}
      </h3>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </div>
  )
}

function FactRow({
  fact,
  knownBy,
  onOpen,
}: {
  fact: LedgerFact
  knownBy: string
  onOpen: (factId: string) => void
}) {
  const retiredWord = RETIRED_WORD[fact.status]
  return (
    <button
      type="button"
      onClick={() => onOpen(fact.id)}
      className={`flex w-full flex-col items-start gap-1 rounded-card border border-tr-border bg-tr-surface-raised p-2 text-left hover:bg-tr-surface-clay ${FOCUS}`}
    >
      <span className="text-13 text-tr-text-primary">{fact.fact}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-12 text-tr-text-primary">
        <Chip hue="sky">{fact.factType.replace(/_/g, ' ')}</Chip>
        {fact.status === 'pending_review' && (
          <Chip hue="neutral">Unconfirmed</Chip>
        )}
        {retiredWord && <Chip hue="neutral">{retiredWord}</Chip>}
        {fact.audienceKnows === false && (
          <span>◆ hidden from the audience</span>
        )}
        {knownBy && <span>Known by {knownBy}</span>}
      </span>
    </button>
  )
}

/**
 * Section 3 (spec §4.6): what this scene connects to. Threads it sets up or
 * pays off, the secret as a dramatic-irony callout, the facts it establishes
 * (active and pending; retired behind a toggle, spec §4.12), and relationship
 * moments. Read-only; the data is derived in story.ts by ScenePanel.
 */
export function WhatItTouches({
  scenes,
  threads,
  secrets,
  facts,
  relationshipMoments,
  characters,
  alsoInScene,
  onSelectScene,
  onOpenFact,
  onOpenLedger,
}: WhatItTouchesProps) {
  const [showRetired, setShowRetired] = useState(false)

  const sceneById = (id: string | null) => scenes.find((s) => s.id === id)
  const names = (ids: readonly string[]) =>
    ids.map((id) => characterName(characters, id))
  const cued = new Set(alsoInScene.map((c) => c.id))
  const darkLine = (ids: string[], suffix: string) =>
    ids.length > 0 && (
      <p className="mt-1 font-semibold">
        {`In this scene, ${names(ids).join(', ')} ${ids.length === 1 ? 'is' : 'are'} in the dark${suffix}`}
      </p>
    )
  const sceneLink = (text: string, sceneId: string) => (
    <button
      type="button"
      onClick={() => onSelectScene(sceneId)}
      className={LINK}
    >
      {text}
    </button>
  )

  const total =
    threads.length +
    secrets.length +
    facts.shown.length +
    facts.retired.length +
    relationshipMoments.length
  if (total === 0) {
    return (
      <p className={QUIET}>
        Nothing recorded yet: no threads, secret, facts or relationship moments
        touch this scene.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Group title="Threads">
        {threads.length === 0 && (
          <p className={QUIET}>No threads start or land here.</p>
        )}
        {threads.map(({ thread, role, otherSceneId, phases }) => {
          const other = sceneById(otherSceneId)
          const phaseWords = phases
            .filter((phase) => phase !== ROLE_PHASE[role])
            .map((phase) => PHASE_WORD[phase])
          return (
            <div key={`${thread.id}:${role}`} className="text-13">
              <p className="text-tr-text-primary">
                {THREAD_ROLE[role]}{' '}
                <span className="font-semibold">{thread.label}</span>
                {phaseWords.length > 0 && (
                  <span className="text-tr-text-secondary">
                    {` · ${phaseWords.join(', ')}`}
                  </span>
                )}
              </p>
              {thread.summary && (
                <p className="text-tr-text-primary">{thread.summary}</p>
              )}
              <p className="mt-1">
                {role === 'sets_up' ? (
                  other ? (
                    sceneLink(`Pays off in ${other.index + 1} →`, other.id)
                  ) : (
                    <Chip hue="amber">Never paid off</Chip>
                  )
                ) : (
                  other && sceneLink(`Set up in ${other.index + 1} →`, other.id)
                )}
              </p>
            </div>
          )
        })}
      </Group>

      <Group title="The secret">
        {secrets.length === 0 && (
          <p className={QUIET}>No secret is kept here.</p>
        )}
        {secrets.map(({ secret, role, inTheDark }) => {
          const hiddenFrom = names(secret.concealedFromCharacterIds ?? [])
          const setIn =
            role === 'set' ? undefined : sceneById(secret.establishedSceneId)
          const outIn =
            role === 'out' ? undefined : sceneById(secret.revealedSceneId)
          const audience =
            secret.audienceKnows === false
              ? "The audience doesn't know yet."
              : hiddenFrom.length === 0
                ? 'The audience knows.'
                : `The audience knows; ${shortList(hiddenFrom)} ${hiddenFrom.length === 1 ? "doesn't" : "don't"}.`
          return (
            <div
              key={secret.id}
              className="rounded-card border border-tr-border bg-tr-surface-sunken p-3 text-13 text-tr-text-primary"
            >
              <p>
                <span className="font-semibold">Dramatic irony.</span>{' '}
                {secret.summary}
              </p>
              <p className="mt-1">{audience}</p>
              {darkLine(
                inTheDark.filter((id) => !cued.has(id)),
                '.',
              )}
              {darkLine(
                inTheDark.filter((id) => cued.has(id)),
                ' · from dialogue cues',
              )}
              <p className="mt-2 flex flex-wrap items-center gap-3">
                <Chip hue="amber">{ROLE_TAG[role]}</Chip>
                {setIn && sceneLink(`Set in ${setIn.index + 1}`, setIn.id)}
                {outIn && sceneLink(`Out in ${outIn.index + 1}`, outIn.id)}
              </p>
            </div>
          )
        })}
      </Group>

      <Group title="Facts established here">
        {facts.shown.length === 0 && (
          <p className={QUIET}>No facts established here.</p>
        )}
        {facts.shown.map((fact) => (
          <FactRow
            key={fact.id}
            fact={fact}
            knownBy={shortList(names(fact.knownBy))}
            onOpen={onOpenFact}
          />
        ))}
        <p className="flex flex-wrap gap-3">
          {facts.retired.length > 0 && (
            <button
              type="button"
              aria-expanded={showRetired}
              onClick={() => setShowRetired((v) => !v)}
              className={LINK}
            >
              {showRetired
                ? 'Hide retired'
                : `Show ${facts.retired.length} retired`}
            </button>
          )}
          <button type="button" onClick={onOpenLedger} className={LINK}>
            Open in Ledger →
          </button>
        </p>
        {showRetired &&
          facts.retired.map((fact) => (
            <FactRow
              key={fact.id}
              fact={fact}
              knownBy={shortList(names(fact.knownBy))}
              onOpen={onOpenFact}
            />
          ))}
      </Group>

      <Group title="Relationships">
        {relationshipMoments.length === 0 ? (
          <p className={QUIET}>No relationship moments recorded.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-13 text-tr-text-primary">
            {relationshipMoments.map((moment, i) => (
              <li key={`${moment.between.join('&')}:${i}`}>
                {`${names(moment.between).join(' & ')}: ${moment.label}`}
              </li>
            ))}
          </ul>
        )}
      </Group>
    </div>
  )
}
