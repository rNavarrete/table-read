import type { Character, Motivation } from 'contract'
import type { ReactNode } from 'react'
import { characterName } from '../planTree'
import {
  nameList,
  type KnowledgeModes,
  type SceneClash,
  type SceneTurn,
} from '../story'

export interface AtAGlanceProps {
  /** story.sceneTurn(scene) */
  turn: SceneTurn | null
  whyNow: string
  /** story.sceneClashes(scene, characters) */
  clashes: SceneClash[]
  /** story.knowledgeModes(...) */
  modes: KnowledgeModes | null
  characters: Character[]
}

const CHIP = 'rounded-[3px] px-1.5 text-11 font-semibold leading-4'

function Row({
  term,
  wide = false,
  children,
}: {
  term: string
  /** Term above the reading, across both columns (the clash needs the width). */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={wide ? 'col-span-2 flex flex-col gap-1.5' : 'contents'}>
      <dt className="pt-px text-12 font-semibold text-tr-text-primary">
        {term}
      </dt>
      <dd className="min-w-0 text-tr-text-primary">{children}</dd>
    </div>
  )
}

/**
 * The scene's answers to the craft checks, before anything else in the
 * panel (T10.12): how it turns (McKee), why now and whose wants collide
 * (Mamet), and who knows what (McKee's dramatic irony and mystery). Read-only
 * and derived from the import's readings, with no request; each row shows
 * only when the scene has it, and the box not at all when none do. It states
 * the readings and never grades them.
 */
export function AtAGlance({
  turn,
  whyNow,
  clashes,
  modes,
  characters,
}: AtAGlanceProps) {
  const irony = modes?.irony ?? []
  const mystery = modes?.mystery ?? []
  if (!turn && !whyNow && !clashes.length && !irony.length && !mystery.length)
    return null
  const names = (ids: string[]) =>
    nameList(ids.map((id) => characterName(characters, id)))
  const verb = (ids: string[], one: string, many: string) =>
    ids.length === 1 ? one : many

  function want(m: Motivation) {
    return (
      <div className="w-full min-w-0 rounded-card bg-tr-surface-sunken px-2 py-1.5">
        <p className="text-12 font-semibold text-tr-text-primary">
          {characterName(characters, m.characterId)} wants
        </p>
        <p
          title={m.objective}
          className="line-clamp-2 text-13 text-tr-text-secondary"
        >
          {m.objective}
        </p>
      </div>
    )
  }

  return (
    <section
      aria-label="At a glance"
      data-testid="at-a-glance"
      className="rounded-card border border-tr-border bg-tr-surface-page px-3 py-2.5"
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5 text-13">
        {turn && (
          <Row term="The turn">
            {turn.stake}
            {turn.stake && turn.charges && ' '}
            {turn.charges && (
              <>
                <span
                  aria-hidden="true"
                  className="text-15 font-semibold text-tr-accent-ink"
                >
                  {turn.charges[0]}
                </span>
                <span className="sr-only">{turn.charges[1]}</span>
              </>
            )}
          </Row>
        )}
        {whyNow && (
          <Row term="Why now">
            <span className="text-tr-text-secondary">{whyNow}</span>
          </Row>
        )}
        {clashes.length > 0 && (
          <Row term="Clash" wide>
            <div className="flex flex-col gap-2">
              {clashes.map(({ a, b }) => (
                <div
                  key={`${a.characterId}-${b.characterId}`}
                  data-clash
                  className="flex flex-col items-start gap-1"
                >
                  {want(a)}
                  <span
                    className={`${CHIP} ml-2 bg-tr-accent-ink text-tr-surface-raised`}
                  >
                    vs
                  </span>
                  {want(b)}
                </div>
              ))}
              <p className="text-12 text-tr-text-secondary">
                From their wants and beats
              </p>
            </div>
          </Row>
        )}
        {(irony.length > 0 || mystery.length > 0) && (
          <Row term="Who knows">
            <div className="flex flex-col gap-1">
              {irony.length > 0 && (
                <p>
                  <span
                    className={`${CHIP} mr-2 bg-tr-ledger-secret-badge text-tr-ledger-secret-ink`}
                  >
                    Dramatic irony
                  </span>
                  <span aria-hidden="true">
                    ● the audience · ○ {names(irony)}
                  </span>
                  <span className="sr-only">
                    {`The audience knows; ${names(irony)} ${verb(irony, "doesn't", "don't")}.`}
                  </span>
                </p>
              )}
              {mystery.length > 0 && (
                <p>
                  <span
                    className={`${CHIP} mr-2 bg-tr-ledger-secret-badge text-tr-ledger-secret-ink`}
                  >
                    Mystery
                  </span>
                  <span aria-hidden="true">
                    ● {names(mystery)} · ○ the audience
                  </span>
                  <span className="sr-only">
                    {`${names(mystery)} ${verb(mystery, 'knows', 'know')}; the audience doesn't.`}
                  </span>
                </p>
              )}
            </div>
          </Row>
        )}
      </dl>
    </section>
  )
}
