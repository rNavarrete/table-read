import type {
  Character,
  LedgerFact,
  Motivation,
  Project,
  Secret,
} from 'contract'
import { allScenes } from '../write/projectTree'

export type ProfileSource = 'stored' | 'bible' | 'derived' | 'empty'

export interface ResolvedCharacterProfile {
  name: string
  aliases: string[]
  summary: string
  bio: string
  source: ProfileSource
}

const FACT_PRIORITY: Record<LedgerFact['factType'], number> = {
  event: 0,
  state: 1,
  knowledge: 2,
  relationship: 3,
  world_rule: 4,
}

/**
 * Biography ranks facts almost inversely to the list view.
 *
 * `state` is what someone IS and `relationship` is how they stand to other
 * people — that is character. `event` is what happened, which is plot: it
 * makes a fine ledger row and a terrible biography. A character who was in
 * the room for the episode's B-story should not have the B-story as their
 * bio.
 */
const BIO_PRIORITY: Record<LedgerFact['factType'], number> = {
  state: 0,
  relationship: 1,
  knowledge: 2,
  event: 3,
  world_rule: 4,
}

const MAX_DERIVED_FACTS = 4
const MAX_SUMMARY_LEN = 160
const MAX_BIO_LEN = 480

function trimProse(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  const cut = cleaned.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

function knownByIds(fact: LedgerFact): string[] {
  return fact.knownByAsOf ?? fact.knownBy
}

/**
 * Is this fact *about* the character, rather than merely known to them?
 *
 * knownBy is the wrong test for biography: a character standing in the room
 * "knows" every fact established there, so a bio built from knownBy becomes
 * whatever the scene was about. Sam's read as Cuban refugee statistics.
 * Being named in the fact is a far better proxy for the fact being his.
 *
 * Word-boundary matched so "Sam" doesn't claim a fact about "Sammy", and
 * alias-aware so a fact naming "Sam Seaborn" still counts for Sam.
 */
function mentionsCharacter(fact: LedgerFact, character: Character): boolean {
  const names = [character.name, ...(character.aliases ?? [])]
    .map((n) => (n || '').trim())
    .filter(Boolean)
  if (names.length === 0) return false
  const text = fact.fact
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'iu').test(text)
  })
}

/** Motivations for a character across the project's scenes (story order). */
export function motivationsForCharacter(
  project: Project,
  characterId: string,
): Motivation[] {
  return allScenes(project).flatMap((scene) =>
    (scene.motivations ?? []).filter((m) => m.characterId === characterId),
  )
}

function bibleSummary(character: Character): string {
  return (character.traits || '').trim()
}

function bibleBio(character: Character): string {
  return [character.presentation, character.hiding, character.embodiment]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join('\n\n')
}

function derivedFromEvidence(
  character: Character,
  facts: LedgerFact[],
  motivations: Motivation[],
): { summary: string; bio: string } {
  const linked = facts
    .filter(
      (f) => f.status !== 'rejected' && knownByIds(f).includes(character.id),
    )
    .sort((a, b) => {
      const typeDelta =
        (FACT_PRIORITY[a.factType] ?? 9) - (FACT_PRIORITY[b.factType] ?? 9)
      if (typeDelta !== 0) return typeDelta
      return a.fact.localeCompare(b.fact)
    })
    .slice(0, MAX_DERIVED_FACTS)

  const motiveLine = motivations
    .map((m) => (m.objective || '').trim())
    .filter(Boolean)[0]

  const firstFact = linked[0]?.fact?.trim() ?? ''
  // Objectives are written as imperative phrases ("Find out who…", "Get out
  // of Laurie's bed"), so splicing one after "wants" produced "Sam wants
  // Find out who…". A colon sidesteps the grammar entirely rather than
  // guessing whether the phrase takes a "to".
  const summary = motiveLine
    ? trimProse(
        `${character.name} wants: ${motiveLine.replace(/\.$/, '')}`,
        MAX_SUMMARY_LEN,
      )
    : firstFact
      ? trimProse(firstFact, MAX_SUMMARY_LEN)
      : ''

  // Bio draws only on facts that NAME the character, ranked so who they are
  // outranks what happened around them.
  const about = facts
    .filter((f) => f.status !== 'rejected' && mentionsCharacter(f, character))
    .sort((a, b) => {
      const delta =
        (BIO_PRIORITY[a.factType] ?? 9) - (BIO_PRIORITY[b.factType] ?? 9)
      if (delta !== 0) return delta
      return a.fact.localeCompare(b.fact)
    })
    .slice(0, MAX_DERIVED_FACTS)

  const bioParts: string[] = []
  if (about.length > 0) {
    bioParts.push(
      about
        .map((f) => f.fact.trim())
        .filter(Boolean)
        .join(' '),
    )
  }
  for (const m of motivations.slice(0, 2)) {
    const bits = [m.objective, m.stakes, m.obstacle]
      .map((s) => (s || '').trim())
      .filter(Boolean)
    if (bits.length > 0) {
      bioParts.push(bits.join(' — '))
    }
  }
  const bio = trimProse(bioParts.join('\n\n'), MAX_BIO_LEN)

  return { summary, bio }
}

/**
 * Resolve Ledger People profile copy (T7.31).
 * Preference: stored summary/bio → craft bible fields → facts/motivations.
 */
export function resolveCharacterProfile(
  character: Character,
  facts: LedgerFact[],
  motivations: Motivation[] = [],
): ResolvedCharacterProfile {
  const aliases = character.aliases ?? []
  const storedSummary = (character.summary || '').trim()
  const storedBio = (character.bio || '').trim()
  if (storedSummary || storedBio) {
    return {
      name: character.name,
      aliases,
      summary: storedSummary || bibleSummary(character),
      bio: storedBio || bibleBio(character),
      source: 'stored',
    }
  }

  const fromBibleSummary = bibleSummary(character)
  const fromBibleBio = bibleBio(character)
  if (fromBibleSummary || fromBibleBio) {
    return {
      name: character.name,
      aliases,
      summary: fromBibleSummary,
      bio: fromBibleBio,
      source: 'bible',
    }
  }

  const derived = derivedFromEvidence(character, facts, motivations)
  if (derived.summary || derived.bio) {
    return {
      name: character.name,
      aliases,
      summary: derived.summary,
      bio: derived.bio,
      source: 'derived',
    }
  }

  return {
    name: character.name,
    aliases,
    summary: '',
    bio: '',
    source: 'empty',
  }
}

export interface CharacterSecrets {
  /** Secrets this character is keeping from someone. */
  holding: Secret[]
  /** Secrets someone else is keeping from this character. */
  keptFrom: Secret[]
}

/**
 * Split the episode's secrets by this character's role in each one.
 *
 * The two directions read completely differently to a writer: what a
 * character is hiding drives their behaviour, while what is being hidden
 * *from* them is where their scenes carry dramatic irony. Same objects,
 * opposite dramatic function, so they never share a list.
 */
export function secretsForCharacter(
  project: Project,
  characterId: string,
): CharacterSecrets {
  const holding: Secret[] = []
  const keptFrom: Secret[] = []
  for (const season of project.seasons) {
    for (const episode of season.episodes) {
      for (const secret of episode.secrets ?? []) {
        if (secret.holderCharacterIds.includes(characterId))
          holding.push(secret)
        else if (secret.concealedFromCharacterIds.includes(characterId)) {
          keptFrom.push(secret)
        }
      }
    }
  }
  return { holding, keptFrom }
}

/** Motivations where the character claims a different goal than they pursue. */
export function ulteriorMotives(motivations: Motivation[]): Motivation[] {
  return motivations.filter((m) => (m.statedObjective ?? '').trim().length > 0)
}

/** Display names for ids, falling back to the raw id when unresolved. */
export function characterNames(project: Project, ids: string[]): string[] {
  const byId = new Map(
    project.seriesBible.characters.map((c) => [c.id, c.name] as const),
  )
  return ids.map((id) => byId.get(id) ?? id)
}
