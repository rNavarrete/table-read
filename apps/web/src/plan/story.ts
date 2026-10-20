import type {
  Beat,
  Character,
  ConsistencyFlag,
  Episode,
  LedgerFact,
  Project,
  Scene,
  Secret,
  StoryOverviewBeatItem,
  StoryThread,
  ThreadMovementPhase,
} from 'contract'
import { tvActStages } from '../ledger/structure/tvActStructure'
import { plural } from '../projects/wizard/board/boardText'
import { parseFountainLines } from '../write/fountainFormat'
import { boardOrder } from '../write/projectTree'
import {
  actLabel,
  actNumbersForBoard,
  affectedFacts,
  applySceneMove,
  type MoveRefusal,
  type SceneMove,
  tagAct,
} from './planTree'

// Board order (act, then index) lives with the shared project-tree helpers so
// Write and Ledger use the same story order (planTree's applySceneMove builds
// on it too); re-exported for Plan's importers.
export { boardOrder }

// Every pure derivation the Plan panel reads (redesign spec §6: one module,
// unit-tested). Missing arrays read as empty everywhere: PATCH returns the
// raw stored doc, which omits defaulted keys (threads, secrets,
// timelineAnchors, relationshipStates, storyOverview, aliases…).

// ── Notes ────────────────────────────────────────────────────────────────

export type FlagKind = 'continuity' | 'act_split' | 'import'

const IMPORT_CODE = /^\[([a-z][a-z0-9_]*)\]\s*/
// Imports from before the repair codes wrote this for model_unassigned.
const LEGACY_UNASSIGNED =
  /^Imported source lines \d+-\d+ could not be assigned to a beat/
const ACT_SPLIT =
  /\bact (one|two|three|four|five|six)\b[^.]*\bbreak\b|\bact structure\b/i

function importCode(explanation: string): string | null {
  return (
    IMPORT_CODE.exec(explanation)?.[1] ??
    (LEGACY_UNASSIGNED.test(explanation) ? 'model_unassigned' : null)
  )
}

/** ponytail: the kind is read from the explanation text. A leading
 * `[snake_case]` repair code (fountain/pipeline.py, fountain/characters.py)
 * means an import note; an act-break / act-structure phrase means an act-split
 * note; anything else is continuity. Replace with `flag.kind` once the
 * contract carries one (redesign spec §9). */
export function flagKind(flag: ConsistencyFlag): FlagKind {
  if (importCode(flag.explanation)) return 'import'
  if (ACT_SPLIT.test(flag.explanation)) return 'act_split'
  return 'continuity'
}

export interface PlanNote {
  flag: ConsistencyFlag
  kind: FlagKind
  /** null for a scene-level flag */
  beat: Beat | null
}

/** Open flags on this scene or one of its beats: story notes first, then
 * import notes, each group in beat order (scene-level first). A flag on a beat
 * this scene doesn't have is dropped. */
export function notesForScene(
  flags: readonly ConsistencyFlag[],
  scene: Scene,
): PlanNote[] {
  const notes: PlanNote[] = []
  for (const flag of flags) {
    if (flag.status !== 'open') continue
    const beat =
      flag.objectType === 'beat'
        ? scene.beats.find((b) => b.id === flag.objectId)
        : undefined
    const onThisScene =
      flag.objectType === 'scene' ? flag.objectId === scene.id : !!beat
    if (onThisScene)
      notes.push({ flag, kind: flagKind(flag), beat: beat ?? null })
  }
  const beatOrder = (note: PlanNote) => (note.beat ? note.beat.index + 1 : 0)
  return notes.sort(
    (a, b) =>
      Number(a.kind === 'import') - Number(b.kind === 'import') ||
      beatOrder(a) - beatOrder(b),
  )
}

/** Plain-language import note; never shows the `[code]` marker. `beatLabel`
 * looks like "7.1"; null means the note is on the scene.
 * ponytail: one sentence per repair code the server writes
 * (fountain/pipeline.py `_segmentation_issue_explanation`,
 * `_UNIT_FAILED_EXPLANATIONS`; fountain/characters.py merge_proposal); a new
 * code gets the generic "adjusted" line until it is added here. */
export function importNoteText(
  flag: ConsistencyFlag,
  beatLabel: string | null,
): string {
  const text = flag.explanation
  const code = importCode(text)
  if (!code) return text
  // The server writes "the scene segmentation" when a repair has no range.
  const lines = /source lines (\d+)-(\d+)/.exec(text)
  const one = !!lines && lines[1] === lines[2]
  const span = !lines
    ? 'some script lines'
    : one
      ? `script line ${lines[1]}`
      : `script lines ${lines[1]}–${lines[2]}`
  const where = beatLabel ? `beat ${beatLabel}` : 'this scene'
  const checkStart = 'Check where the beat starts.'
  const checkBeats = 'Check the beats in this scene.'
  switch (code) {
    case 'model_unassigned':
      return `The import couldn't place ${span} and kept ${one ? 'it' : 'them'} in ${where}.`
    case 'duplicate_start':
      return `The import got two beat breaks at the same line and kept ${span} in ${where}. ${checkStart}`
    case 'missing_initial_start':
      return `The import didn't start a beat at the top of the scene and kept ${span} in ${where}. ${checkStart}`
    case 'empty_output':
    case 'no_valid_segments':
      return `The import couldn't break this scene into beats and kept ${span} in ${where}. ${checkBeats}`
    case 'out_of_bounds_start':
      return `The import got a beat break past the end of this scene and dropped it. ${checkBeats}`
    case 'unordered_segments':
      return `The import got this scene's beat breaks out of order and put them back in script order. ${checkBeats}`
    case 'no_beats_returned':
      return `The import found no beats in this scene and kept ${span} as one beat with no description. You can write it yourself.`
    case 'empty_beat_fields':
      return `The import wrote no description for ${span} in ${where}. You can write it yourself.`
    case 'tool_markup':
      return `The import blanked a garbled description in ${where}. The script is intact; you can write the description yourself.`
    case 'segmentation_failed':
      return "The import couldn't break this scene into beats, so it kept the whole scene as one beat with no description. You can write it yourself."
    case 'extraction_failed':
      return "The import couldn't read continuity facts from this scene, so the Ledger has none from it. The script is intact; check it for facts the Ledger should hold."
    case 'merge_proposal':
      // Already writer prose that names the cast entries.
      return text.replace(IMPORT_CODE, '')
    default:
      return `The import adjusted ${span} in ${where}. ${checkStart}`
  }
}

export type NoteSegment =
  | { type: 'text'; text: string }
  | { type: 'scene'; text: string; sceneId: string }
  | { type: 'fact'; text: 'a Ledger fact'; factId: string }

const NOTE_REF = /\bscene[ -](\d+)\b|\bfact-[0-9a-z]+\b/gi

/** Splits a note into text and links. "Scene 12" / "scene 12" / "scene-12"
 * all mean the id `scene-12` (what the model was shown, not a position), and
 * link only when that scene exists; the id form reads "Scene 12". A fact id
 * links as "a Ledger fact" when it is in the ledger and is plain "a Ledger
 * fact" text otherwise: a raw fact id is never shown. */
export function linkifyNote(
  text: string,
  scenes: readonly Scene[],
  facts: readonly LedgerFact[],
): NoteSegment[] {
  const sceneIds = new Set(scenes.map((s) => s.id))
  const factIds = new Set(facts.map((f) => f.id))
  const out: NoteSegment[] = []
  const pushText = (piece: string) => {
    if (!piece) return
    const last = out[out.length - 1]
    if (last?.type === 'text') last.text += piece
    else out.push({ type: 'text', text: piece })
  }
  let at = 0
  for (const match of text.matchAll(NOTE_REF)) {
    const start = match.index ?? 0
    pushText(text.slice(at, start))
    at = start + match[0].length
    if (match[1] !== undefined) {
      const sceneId = `scene-${match[1]}`
      if (!sceneIds.has(sceneId)) pushText(match[0])
      else
        out.push({
          type: 'scene',
          text: match[0].includes('-') ? `Scene ${match[1]}` : match[0],
          sceneId,
        })
    } else if (factIds.has(match[0])) {
      out.push({ type: 'fact', text: 'a Ledger fact', factId: match[0] })
    } else {
      pushText('a Ledger fact')
    }
  }
  pushText(text.slice(at))
  return out
}

const ORDINAL = new Intl.PluralRules('en', { type: 'ordinal' })
const SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd' }
/** 1 → "1st", 12 → "12th", 23 → "23rd". */
const nth = (n: number) => `${n}${SUFFIX[ORDINAL.select(n)] ?? 'th'}`

/** The instruction "Draft a fix in Review…" starts from (T3.9): where the note
 * sits, then the note in words — a fact id as the quoted Ledger fact, a scene
 * that is gone as "a deleted scene". Never a raw scene or fact id or [code];
 * the writer edits it before anything is sent. Continuity notes only.
 *
 * The text also reaches the model (EDIT / APPROVED EDIT), which reads
 * "scene 3" as the id scene-3 (linkifyNote). So a scene is never "scene n"
 * here, and a beat never "beat n.m": "the Basement scene (3rd on the board)",
 * "the 1st beat of …". After a reorder a card number and an id number differ.
 * Wording confirmed by the owner on 2026-10-14. */
export function fixInstruction(
  note: PlanNote,
  scene: Scene,
  scenes: readonly Scene[],
  ledger: readonly LedgerFact[],
): string {
  const named = (target: Scene) => {
    const at = nth(target.index + 1)
    const place = placeTitle(target).replace(/^the /i, '')
    // placeTitle falls back to "Scene n" when there is no place.
    return /^Scene \d+$/.test(place)
      ? `the ${at} scene on the board`
      : `the ${place} scene (${at} on the board)`
  }
  const where = note.beat
    ? `the ${nth(note.beat.index + 1)} beat of ${named(scene)}`
    : named(scene)
  const body = linkifyNote(note.flag.explanation, scenes, ledger)
    .map((s) => {
      if (s.type === 'scene')
        return named(scenes.find((x) => x.id === s.sceneId)!)
      if (s.type === 'fact')
        return `the Ledger fact “${ledger.find((f) => f.id === s.factId)!.fact}”`
      // linkifyNote leaves as text a missing scene ("Scene 40", "scene-40")
      // and any hex id (guided setup mints `scene-<uuid hex>`), existing or
      // not. Hex only, so prose like "scene-level" stays.
      return s.text.replace(/\bscene-[0-9a-f]+\b|\bscene \d+\b/gi, (m) => {
        const id = m.toLowerCase().replace(' ', '-')
        const target = scenes.find((x) => x.id === id)
        return target ? named(target) : 'a deleted scene'
      })
    })
    .join('')
    .trim()
  return `Fix this continuity note in ${where}: ${body}`
}

// ── Scene reading ───────────────────────────────────────────────────────

const SLUG_PREFIX =
  /^(?:(?:INT|EXT)\.?\/(?:INT|EXT)\.?|I\/E\.?|(?:INT|EXT)(?:\.|\s))\s*/i

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /(^|[\s\-/(])(\p{L})/gu,
      (_, sep: string, ch: string) => sep + ch.toUpperCase(),
    )
}

// ponytail: the common slugline time / continuity words and shot descriptors
// ("MOVING", "FLASHBACK"), none of which name a place. A part made only of
// these ("MORNING", "LATER THAT MORNING", "NEXT DAY") is not the place; an
// unlisted word ("MAGIC HOUR", "3 AM") makes it the title. Add words as real
// scripts show them.
const SLUG_TIME_WORDS = new Set(
  (
    'DAY NIGHT MORNING AFTERNOON EVENING DAWN DUSK SUNRISE SUNSET LATER ' +
    'CONTINUOUS SAME TIME EARLY LATE NEXT THAT MOMENTS MOMENT MOVING ' +
    'ESTABLISHING SHOT FLASHBACK INTERCUT POV MONTAGE WIDE AERIAL'
  ).split(' '),
)
const isTimePart = (part: string) =>
  part
    .toUpperCase()
    .split(/\s+/)
    .every((word) => SLUG_TIME_WORDS.has(word.replace(/[^A-Z]/g, '')))

/** The most specific part of the slug: "INT. THE LONG POUR - BAR - DAY" →
 * "Bar". Drops the INT./EXT./I/E. prefix (period optional), splits on spaced
 * " - ", " = " and " ~ ", then takes the last part, skipping trailing parts
 * made only of time / continuity words ("NIGHT", "LATER THAT MORNING"); a
 * slug with one part stays whole. Title-cases only an all-caps result.
 * Empty → "Scene n". */
export function placeTitle(scene: Scene): string {
  const parts = scene.location
    .trim()
    .replace(SLUG_PREFIX, '')
    .split(/\s+[-–—=~]\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  while (parts.length > 1 && isTimePart(parts[parts.length - 1])) parts.pop()
  const place = parts.at(-1)
  if (!place) return `Scene ${scene.index + 1}`
  return place === place.toUpperCase() ? titleCase(place) : place
}

/** Labelled beat-sheet rows that sit in this scene (by scene id or by one of
 * its beats). */
export function landmarksForScene(
  episode: Episode,
  scene: Scene,
): StoryOverviewBeatItem[] {
  const beatIds = new Set(scene.beats.map((b) => b.id))
  return (episode.storyOverview?.beatSheet ?? []).filter(
    (row) =>
      (row.label ?? '').trim() !== '' &&
      (row.sceneId === scene.id || beatIds.has(row.beatId)),
  )
}

/** ponytail: who speaks in this scene, from the character cues Write's
 * teleplay parser already finds (write/fountainFormat.ts), matched
 * case-insensitively to a character's name, first name or alias. Unmatched
 * cues ("BARTENDER", "BACK TO SCENE") are dropped: that is the noise filter.
 * Always shown labelled "from dialogue cues". Bible order, no duplicates. */
export function castFromDialogue(
  scene: Scene,
  characters: readonly Character[],
): Character[] {
  const cues = new Set<string>()
  for (const beat of scene.beats) {
    for (const line of parseFountainLines(beat.scriptText ?? '')) {
      if (line.type !== 'character') continue
      cues.add(
        line.text
          .replace(/\s*\([^)]*\)\s*$/, '')
          .trim()
          .toLowerCase(),
      )
    }
  }
  return characters.filter((c) =>
    [c.name, c.name.split(/\s+/)[0], ...(c.aliases ?? [])].some(
      (name) => !!name && cues.has(name.toLowerCase()),
    ),
  )
}

// ── What it touches ─────────────────────────────────────────────────────

/** T10.3: a thread movement's phase as a verb ("Scene 4 · escalates"). */
export const PHASE_WORD: Record<ThreadMovementPhase, string> = {
  setup: 'sets up',
  escalation: 'escalates',
  reversal: 'reverses',
  reveal: 'reveals',
  payoff: 'pays off',
  aftermath: 'aftermath',
}

export interface SceneThread {
  thread: StoryThread
  /** `moves`: the thread has a movement here (T10.3) but is neither set up
   * nor paid off in this scene. */
  role: 'sets_up' | 'pays_off' | 'moves'
  /** sets_up → the payoff scene, pays_off and moves → the setup scene; null
   * when there is none or it is not a scene in this episode ("Never paid
   * off"). */
  otherSceneId: string | null
  /** T10.3: the phases of this scene's movements for the thread, in stored
   * order; [] when it has none here. */
  phases: ThreadMovementPhase[]
}

export function threadsForScene(
  episode: Episode,
  sceneId: string,
): SceneThread[] {
  const known = (id: string | null) =>
    id && episode.scenes.some((s) => s.id === id) ? id : null
  const out: SceneThread[] = []
  for (const thread of episode.threads ?? []) {
    const phases = (thread.movements ?? [])
      .filter((m) => m.sceneId === sceneId)
      .map((m) => m.phase)
    const setsUp = thread.setupSceneId === sceneId
    const paysOff = thread.payoffSceneId === sceneId
    if (setsUp)
      out.push({
        thread,
        role: 'sets_up',
        otherSceneId: known(thread.payoffSceneId ?? null),
        phases,
      })
    if (paysOff)
      out.push({
        thread,
        role: 'pays_off',
        otherSceneId: known(thread.setupSceneId),
        phases,
      })
    if (!setsUp && !paysOff && phases.length > 0)
      out.push({
        thread,
        role: 'moves',
        otherSceneId: known(thread.setupSceneId),
        phases,
      })
  }
  return out
}

export interface SceneSecret {
  secret: Secret
  /** first match in this order: establishedSceneId, revealedSceneId, concealmentSceneIds */
  role: 'set' | 'out' | 'kept'
  /** concealedFromCharacterIds present in this scene */
  inTheDark: string[]
}

export function secretsForScene(
  episode: Episode,
  sceneId: string,
  presentCharacterIds: ReadonlySet<string>,
): SceneSecret[] {
  const out: SceneSecret[] = []
  for (const secret of episode.secrets ?? []) {
    const role =
      secret.establishedSceneId === sceneId
        ? 'set'
        : secret.revealedSceneId === sceneId
          ? 'out'
          : (secret.concealmentSceneIds ?? []).includes(sceneId)
            ? 'kept'
            : null
    if (!role) continue
    out.push({
      secret,
      role,
      inTheDark: (secret.concealedFromCharacterIds ?? []).filter((id) =>
        presentCharacterIds.has(id),
      ),
    })
  }
  return out
}

/** Facts established in this scene (planTree.affectedFacts), split into the
 * ones Plan shows (active, pending_review) and the retired rest; both keep
 * ledger order. */
export function factsForScene(
  ledger: readonly LedgerFact[],
  sceneId: string,
): { shown: LedgerFact[]; retired: LedgerFact[] } {
  const shown: LedgerFact[] = []
  const retired: LedgerFact[] = []
  for (const fact of affectedFacts(ledger as LedgerFact[], sceneId)) {
    if (fact.status === 'active' || fact.status === 'pending_review')
      shown.push(fact)
    else retired.push(fact)
  }
  return { shown, retired }
}

// ── Order check (spec §4.8) ─────────────────────────────────────────────

export type OrderIssueKind =
  | 'payoff_first' // a thread's payoff scene plays before its setup scene
  | 'revealed_first' // the secret comes out before it is established
  | 'kept_after' // the secret is kept after it is out
  | 'kept_before' // the secret is kept before it is established

export interface OrderIssue {
  /** Stable across moves: `${kind}:${sourceId}:${sceneId}`. */
  id: string
  kind: OrderIssueKind
  /** The thread or secret id. */
  sourceId: string
  /** The thread's label; null for a secret. */
  label: string | null
  /** The scene now out of order: the payoff, the reveal, or the scene keeping the secret. */
  sceneId: string
  /** The scene it is out of order with: the setup, the establishing scene, or the reveal. */
  otherSceneId: string
}

/** An Order note as one side of a problem reads it. */
export interface OrderNote {
  issue: OrderIssue
  /** The other side's scene, for "Go to scene n". */
  otherSceneId: string
  otherNumber: number
  /** One sentence from this scene's side, e.g. 'Pays off “The spare key” before its setup in scene 2.' */
  text: string
}

/** Problems in the episode's board order (act, then index). Abandoned
 * threads, a payoff in its own setup scene, and scene ids not in the episode
 * are skipped. Threads first (episode order), then secrets. */
export function orderIssues(episode: Episode): OrderIssue[] {
  const pos = new Map(boardOrder(episode.scenes).map((s, i) => [s.id, i]))
  const out: OrderIssue[] = []
  const add = (
    kind: OrderIssueKind,
    sourceId: string,
    label: string | null,
    sceneId: string,
    otherSceneId: string,
  ) =>
    out.push({
      id: `${kind}:${sourceId}:${sceneId}`,
      kind,
      sourceId,
      label,
      sceneId,
      otherSceneId,
    })
  for (const t of episode.threads ?? []) {
    if (t.status === 'abandoned' || !t.payoffSceneId) continue
    const setup = pos.get(t.setupSceneId)
    const payoff = pos.get(t.payoffSceneId)
    if (setup !== undefined && payoff !== undefined && payoff < setup)
      add('payoff_first', t.id, t.label, t.payoffSceneId, t.setupSceneId)
  }
  for (const x of episode.secrets ?? []) {
    const set = pos.get(x.establishedSceneId)
    if (set === undefined) continue
    // No reveal, or a reveal scene off the board, reads as never revealed.
    const reveal = x.revealedSceneId ?? ''
    const revealed = pos.get(reveal)
    if (revealed !== undefined && revealed < set)
      add('revealed_first', x.id, null, reveal, x.establishedSceneId)
    for (const kept of new Set(x.concealmentSceneIds ?? [])) {
      // The endpoints are already covered by revealed_first (and are never
      // out of order otherwise): one misplaced scene, one problem.
      if (kept === x.establishedSceneId || kept === reveal) continue
      const k = pos.get(kept)
      if (k === undefined) continue
      if (revealed !== undefined && k > revealed)
        add('kept_after', x.id, null, kept, reveal)
      else if (k < set)
        add('kept_before', x.id, null, kept, x.establishedSceneId)
    }
  }
  return out
}

/** What `after` has that `before` doesn't (by id): the problems a move adds. */
export function newOrderIssues(
  before: readonly OrderIssue[],
  after: readonly OrderIssue[],
): OrderIssue[] {
  const known = new Set(before.map((i) => i.id))
  return after.filter((i) => !known.has(i.id))
}

/** What a move would do: null when nothing would move, the locked scene in
 * the way, or the order problems it would add — on applySceneMove's own
 * result, so it always matches the save. */
export type MovePrediction = MoveRefusal | { issues: OrderIssue[] } | null

export function predictMove(project: Project, move: SceneMove): MovePrediction {
  const applied = applySceneMove(project, move)
  if (!applied || 'blockedBy' in applied) return applied
  const episodeOf = (p: Project) =>
    p.seasons
      .flatMap((s) => s.episodes)
      .find((e) => e.scenes.some((s) => s.id === move.sceneId))
  const before = episodeOf(project)
  const after = episodeOf(applied.next)
  return {
    issues:
      before && after
        ? newOrderIssues(orderIssues(before), orderIssues(after))
        : [],
  }
}

/** "Can't move past scene n: it's locked", "Can't move scene n: it's
 * locked" when the locked scene is the one being moved, or "Can't renumber
 * scene n: it's locked" when the move only renumbers it (its index is out of
 * board order); n = today's number. */
export function lockedMoveText(
  model: BoardModel,
  sceneId: string,
  { blockedBy, renumber }: MoveRefusal,
): string {
  const n = cardNumber(model, blockedBy)
  return sceneId === blockedBy
    ? `Can't move scene ${n}: it's locked`
    : renumber
      ? `Can't renumber scene ${n}: it's locked`
      : `Can't move past scene ${n}: it's locked`
}

// ponytail: "the secret" names no secret; with two secrets the sentences don't
// say which. Name it (secret.summary's first clause) if episodes start
// carrying several.
const ORDER_TEXT: Record<
  OrderIssueKind,
  (label: string, n: number) => [mine: string, other: string]
> = {
  payoff_first: (label, n) => [
    `Pays off ${label} before its setup in scene ${n}.`,
    `Sets up ${label}, but it now pays off earlier, in scene ${n}.`,
  ],
  revealed_first: (_, n) => [
    `Reveals the secret before scene ${n} establishes it.`,
    `Establishes the secret after it comes out in scene ${n}.`,
  ],
  kept_after: (_, n) => [
    `Keeps the secret after it comes out in scene ${n}.`,
    `Reveals the secret, but scene ${n} still keeps it afterwards.`,
  ],
  kept_before: (_, n) => [
    `Keeps the secret before scene ${n} establishes it.`,
    `Establishes the secret after scene ${n} already keeps it.`,
  ],
}

const PREDICTION_VERB: Record<OrderIssueKind, string> = {
  payoff_first: 'would pay off before',
  revealed_first: 'would reveal the secret before',
  kept_after: 'would keep the secret after',
  kept_before: 'would keep the secret before',
}

/** The drop target's amber tape: "⚠ 5 would pay off before 2" (+k for more),
 * with today's card numbers; null for []. */
export function predictionTape(
  model: BoardModel,
  issues: readonly OrderIssue[],
): CardTape | null {
  const first = issues[0]
  if (!first) return null
  const more = issues.length > 1 ? ` +${issues.length - 1}` : ''
  return {
    text: `⚠ ${cardNumber(model, first.sceneId)} ${PREDICTION_VERB[first.kind]} ${cardNumber(model, first.otherSceneId)}${more}`,
    tone: 'amber',
  }
}

// ── Board ───────────────────────────────────────────────────────────────

export type TapeTone = 'sky' | 'amber' | 'secret' | 'accent'
/** The one strip of tape above a card (spec §4.2). */
export interface CardTape {
  text: string
  tone: TapeTone
}
export type BeatTick = 'story' | 'import' | 'plain'

export interface SceneSignals {
  scene: Scene
  /** The card number: scene.index + 1. */
  number: number
  /** placeTitle(scene) */
  place: string
  /** notesForScene(...) split by kind, each in beat order */
  storyNotes: PlanNote[]
  importNotes: PlanNote[]
  /** One per beat in index order, at most 12; a story note wins over an import note. */
  ticks: BeatTick[]
  /** Set up here and paid off in another scene, or never. Abandoned threads
   * never count (here or anywhere below). */
  setsUp: StoryThread[]
  /** Paid off here, set up in another scene of this episode (a missing setup
   * scene doesn't count). */
  paysOff: StoryThread[]
  /** One of setsUp has no payoff scene in this episode. */
  neverPaidOff: boolean
  /** The first secret touching this scene (secretsForScene order), or null. */
  secret: SceneSecret['role'] | null
  /** The marked (tvActStages 'hit') landmark label placed on this scene, e.g. "Act One Turn". */
  landmark: string | null
  /** The last scene of its act on the board. */
  actOut: boolean
  /** Character ids from dialogue cues or a recorded want, bible order. */
  castIds: string[]
  /** Character ids with a recorded want (scene.motivations), in that order. */
  wantIds: string[]
  /** Sum of the scene's beat scriptText lengths. */
  scriptLength: number
  /** Order notes for this scene on either side of a problem, issue order. */
  orderNotes: OrderNote[]
}

export interface ActLandmark {
  label: string
  short: string
  sceneId: string
  number: number
}
export interface ActSplitNote {
  sceneId: string
  number: number
  text: string
}

export interface ActSummary {
  act: number
  /** actLabel(act, format) */
  label: string
  /** "CO" for a cold open, "TAG" for a tag, else the act's ordinal ("1", "2"…): the chart's narrow-band label. */
  short: string
  /** board order */
  scenes: Scene[]
  /** This act's share of the episode's script text; null when the episode has none. */
  share: number | null
  /** Threads whose setup scene is in this act. */
  setUp: number
  /** Threads paid off in this act and set up in another scene of this episode. */
  paidOff: number
  /** Marked only; short = label without "Act One ". */
  landmarks: ActLandmark[]
  actOutSceneId: string | null
  actSplitNotes: ActSplitNote[]
}

export interface BoardModel {
  /** boardOrder(episode.scenes) */
  order: Scene[]
  signals: ReadonlyMap<string, SceneSignals>
  /** One per actNumbersForBoard(format, scenes). */
  acts: ActSummary[]
  /** episode.threads ?? [] */
  threads: StoryThread[]
  /** project.seriesBible.characters */
  characters: Character[]
  hasScript: boolean
  hasThreads: boolean
  /** orderIssues(episode) */
  issues: OrderIssue[]
  /** episode.secrets ?? [] */
  secrets: Secret[]
}

/** Beat-sheet landmarks tvActStages marks ('hit'), placed on a scene by the
 * row's scene id, or through its beat when the scene id is missing or stale. */
function markedLandmarks(
  project: Project,
  episode: Episode,
): { label: string; sceneId: string }[] {
  const ids = new Set(episode.scenes.map((s) => s.id))
  const sceneOfBeat = new Map(
    episode.scenes.flatMap((s) => s.beats.map((b) => [b.id, s.id] as const)),
  )
  return (tvActStages(project.format, episode.storyOverview) ?? []).flatMap(
    (stage) => {
      if (stage.status !== 'hit') return []
      const sceneId =
        stage.sceneId && ids.has(stage.sceneId)
          ? stage.sceneId
          : stage.beatId
            ? sceneOfBeat.get(stage.beatId)
            : undefined
      return sceneId ? [{ label: stage.label, sceneId }] : []
    },
  )
}

/** Everything the board, act headers, highlight bar and Episode view read,
 * derived once per project/flags change (PlanScreen memoizes it). */
export function boardModel(
  project: Project,
  episode: Episode,
  flags: readonly ConsistencyFlag[],
): BoardModel {
  const order = boardOrder(episode.scenes)
  const ids = new Set(order.map((s) => s.id))
  const characters = project.seriesBible.characters
  const threads = episode.threads ?? []
  const live = threads.filter((t) => t.status !== 'abandoned')
  const marked = markedLandmarks(project, episode)
  const issues = orderIssues(episode)
  const numbers = new Map(order.map((s) => [s.id, s.index + 1]))
  // The tag is a coda, not an act: its last scene is no act-out (T10.7).
  const tag = tagAct(project.format)

  const list = order.map((scene, i): SceneSignals => {
    const notes = notesForScene(flags, scene)
    const storyNotes = notes.filter((n) => n.kind !== 'import')
    const importNotes = notes.filter((n) => n.kind === 'import')
    const onBeat = (group: PlanNote[], beatId: string) =>
      group.some((n) => n.beat?.id === beatId)
    const setsUp = live.filter(
      (t) => t.setupSceneId === scene.id && t.payoffSceneId !== scene.id,
    )
    const wantIds = [...new Set(scene.motivations.map((m) => m.characterId))]
    const cued = new Set(castFromDialogue(scene, characters).map((c) => c.id))
    return {
      scene,
      number: scene.index + 1,
      place: placeTitle(scene),
      storyNotes,
      importNotes,
      ticks: [...scene.beats]
        .sort((a, b) => a.index - b.index)
        .slice(0, 12)
        .map((b) =>
          onBeat(storyNotes, b.id)
            ? 'story'
            : onBeat(importNotes, b.id)
              ? 'import'
              : 'plain',
        ),
      setsUp,
      paysOff: live.filter(
        (t) =>
          t.payoffSceneId === scene.id &&
          t.setupSceneId !== scene.id &&
          ids.has(t.setupSceneId),
      ),
      neverPaidOff: setsUp.some((t) => !ids.has(t.payoffSceneId ?? '')),
      secret: secretsForScene(episode, scene.id, new Set())[0]?.role ?? null,
      landmark: marked.find((m) => m.sceneId === scene.id)?.label ?? null,
      actOut: order[i + 1]?.act !== scene.act && scene.act !== tag,
      castIds: characters
        .filter((c) => cued.has(c.id) || wantIds.includes(c.id))
        .map((c) => c.id),
      wantIds,
      scriptLength: scene.beats.reduce(
        (n, b) => n + (b.scriptText ?? '').length,
        0,
      ),
      orderNotes: issues.flatMap((issue): OrderNote[] => {
        const mine = issue.sceneId === scene.id
        if (!mine && issue.otherSceneId !== scene.id) return []
        const otherSceneId = mine ? issue.otherSceneId : issue.sceneId
        // orderIssues only names scenes on this board.
        const otherNumber = numbers.get(otherSceneId) ?? 0
        const [mineText, otherText] = ORDER_TEXT[issue.kind](
          `“${issue.label ?? ''}”`,
          otherNumber,
        )
        return [
          {
            issue,
            otherSceneId,
            otherNumber,
            text: mine ? mineText : otherText,
          },
        ]
      }),
    }
  })

  const sum = (rows: SceneSignals[], count: (s: SceneSignals) => number) =>
    rows.reduce((n, s) => n + count(s), 0)
  const total = sum(list, (s) => s.scriptLength)
  const acts = actNumbersForBoard(project.format, order).map(
    (act): ActSummary => {
      const inAct = list.filter((s) => s.scene.act === act)
      return {
        act,
        label: actLabel(act, project.format),
        short:
          project.format.coldOpen && act === 0
            ? 'CO'
            : act === tag
              ? 'TAG'
              : String(project.format.coldOpen ? act : act + 1),
        scenes: inAct.map((s) => s.scene),
        share: total ? sum(inAct, (s) => s.scriptLength) / total : null,
        setUp: sum(inAct, (s) => s.setsUp.length),
        paidOff: sum(inAct, (s) => s.paysOff.length),
        landmarks: inAct.flatMap((s) =>
          marked
            .filter((m) => m.sceneId === s.scene.id)
            .map((m) => ({
              ...m,
              short: m.label.replace(/^Act \w+ /, ''),
              number: s.number,
            })),
        ),
        actOutSceneId: act === tag ? null : (inAct.at(-1)?.scene.id ?? null),
        actSplitNotes: inAct.flatMap((s) =>
          s.storyNotes
            .filter((n) => n.kind === 'act_split')
            .map((n) => ({
              sceneId: s.scene.id,
              number: s.number,
              text: noteSentence(n, s.scene, order),
            })),
        ),
      }
    },
  )

  return {
    order,
    signals: new Map(list.map((s) => [s.scene.id, s])),
    acts,
    threads,
    characters,
    hasScript: total > 0,
    hasThreads: threads.length > 0,
    issues,
    secrets: episode.secrets ?? [],
  }
}

/** The card number on the board now, or "?" for a scene not on it. */
function cardNumber(
  model: BoardModel,
  sceneId: string | null | undefined,
): number | '?' {
  return model.signals.get(sceneId ?? '')?.number ?? '?'
}

/** "TURN" for a marked turn, else "ACT OUT" for an act's last scene, else null. */
export function cardTag(signals: SceneSignals): 'TURN' | 'ACT OUT' | null {
  return / Turn$/.test(signals.landmark ?? '')
    ? 'TURN'
    : signals.actOut
      ? 'ACT OUT'
      : null
}

/** How a card relates to the selected scene (spec §4.2): "⚠ order with n"
 * (amber) when the two share an order problem, else through a thread
 * "↘ pays off n" / "↗ sets up n" (sky); n = the selected scene's number;
 * null otherwise. */
export function relationTape(
  model: BoardModel,
  selectedSceneId: string | null,
  sceneId: string,
): CardTape | null {
  const selected = selectedSceneId
    ? model.signals.get(selectedSceneId)
    : undefined
  if (!selected || sceneId === selectedSceneId) return null
  if (selected.orderNotes.some((n) => n.otherSceneId === sceneId))
    return { text: `⚠ order with ${selected.number}`, tone: 'amber' }
  if (selected.setsUp.some((t) => t.payoffSceneId === sceneId))
    return { text: `↘ pays off ${selected.number}`, tone: 'sky' }
  if (selected.paysOff.some((t) => t.setupSceneId === sceneId))
    return { text: `↗ sets up ${selected.number}`, tone: 'sky' }
  return null
}

/** One plain sentence for a note: an import note's importNoteText, else the
 * first sentence of the explanation with scene/fact references as plain text. */
export function noteSentence(
  note: PlanNote,
  scene: Scene,
  scenes: readonly Scene[],
): string {
  if (note.kind === 'import')
    return importNoteText(
      note.flag,
      note.beat ? `${scene.index + 1}.${note.beat.index + 1}` : null,
    )
  const text = linkifyNote(note.flag.explanation, scenes, [])
    .map((s) => s.text)
    .join('')
    .trim()
  // ponytail: first sentence = up to the first . ! or ? followed by a space or
  // the end; abbreviations ("Mr.") cut early. Fine for a one-line summary; the
  // full text is one click away.
  return /^.*?[.!?](?=\s|$)/s.exec(text)?.[0] ?? text
}

/** "Scene 3, Bar, locked. 2 notes, 1 from the import." (spec §4.10); Order
 * notes count as notes. */
export function selectionAnnouncement(
  signals: SceneSignals,
  locked: boolean,
): string {
  const notes =
    signals.storyNotes.length +
    signals.importNotes.length +
    signals.orderNotes.length
  const imported = signals.importNotes.length
  const noteText = !notes
    ? 'No notes'
    : imported
      ? `${plural(notes, 'note')}, ${imported} from the import`
      : plural(notes, 'note')
  return `Scene ${signals.number}, ${signals.place}${locked ? ', locked' : ''}. ${noteText}.`
}

// ── Highlights ──────────────────────────────────────────────────────────

export type HighlightKind =
  'none' | 'threads' | 'secret' | 'continuity' | 'acts' | 'who'
export interface Highlight {
  kind: HighlightKind
  /** Character id for Who's in it; null otherwise or before one is chosen. */
  who: string | null
}
export const NO_HIGHLIGHT: Highlight = { kind: 'none', who: null }

/** Bar order and labels. */
export const HIGHLIGHT_LABELS: Record<HighlightKind, string> = {
  none: 'None',
  threads: 'Setups & payoffs',
  secret: 'The secret',
  continuity: 'Continuity',
  acts: 'Act shape',
  who: "Who's in it",
}

/** Ring hue per highlight; a matching card's tape wears it too (except the
 * amber "never paid off"). */
export const HIGHLIGHT_TONE: Record<
  Exclude<HighlightKind, 'none'>,
  TapeTone
> = {
  threads: 'sky',
  secret: 'secret',
  continuity: 'amber',
  acts: 'accent',
  who: 'sky',
}

/** The tape a matching card wears (spec §4.5 table); null = no match. Always
 * null for 'none'. Threads follow boardModel's rule: abandoned threads never
 * tape, a payoff whose setup scene is missing is skipped. */
export function highlightTape(
  model: BoardModel,
  sceneId: string,
  highlight: Highlight,
): CardTape | null {
  const s = model.signals.get(sceneId)
  if (!s || highlight.kind === 'none') return null
  const tone = HIGHLIGHT_TONE[highlight.kind]
  const tape = (text: string | null) => (text ? { text, tone } : null)
  switch (highlight.kind) {
    case 'threads': {
      const total = s.setsUp.length + s.paysOff.length
      if (!total) return null
      const more = total > 1 ? ` +${total - 1}` : ''
      if (s.neverPaidOff)
        return { text: `↗ never paid off${more}`, tone: 'amber' }
      return tape(
        (s.setsUp.length
          ? `↗ sets up ${cardNumber(model, s.setsUp[0].payoffSceneId)}`
          : `↘ pays off ${cardNumber(model, s.paysOff[0].setupSceneId)}`) +
          more,
      )
    }
    case 'secret':
      return tape(
        s.secret === 'out' ? '◇ out' : s.secret ? `◆ ${s.secret}` : null,
      )
    case 'continuity':
      return tape(
        s.orderNotes.length
          ? '⚠ order'
          : s.storyNotes.some((n) => n.kind === 'continuity')
            ? '⚑ continuity'
            : null,
      )
    case 'acts':
      return tape(
        s.landmark?.toUpperCase() ??
          (s.actOut
            ? 'ACT OUT'
            : s.storyNotes.some((n) => n.kind === 'act_split')
              ? 'ACT SPLIT?'
              : null),
      )
    case 'who': {
      // ponytail: presence = a dialogue cue or a recorded want; a character
      // who is in the scene but never speaks and wants nothing is missed.
      // Labelled "from dialogue cues and recorded wants" wherever it shows.
      const who = highlight.who
      const c =
        who && s.castIds.includes(who)
          ? model.characters.find((ch) => ch.id === who)
          : undefined
      return tape(
        c
          ? c.name.toUpperCase() + (s.wantIds.includes(c.id) ? ' · wants' : '')
          : null,
      )
    }
  }
}

/** Matches for N and Fold: 'none' → the scene has a story note or an Order
 * note; else highlightTape !== null. */
export function matchesHighlight(
  model: BoardModel,
  sceneId: string,
  highlight: Highlight,
): boolean {
  const s = model.signals.get(sceneId)
  return highlight.kind === 'none'
    ? !!(s?.storyNotes.length || s?.orderNotes.length)
    : highlightTape(model, sceneId, highlight) !== null
}

/** Scenes that match ("every count means scenes that match"). */
export function highlightCount(
  model: BoardModel,
  highlight: Highlight,
): number {
  return model.order.filter((s) => matchesHighlight(model, s.id, highlight))
    .length
}

/** Characters in at least one scene (castIds), most scenes first, bible order
 * on ties. */
export function castCounts(
  model: BoardModel,
): { character: Character; scenes: number }[] {
  const signals = [...model.signals.values()]
  return model.characters
    .map((character) => ({
      character,
      scenes: signals.filter((s) => s.castIds.includes(character.id)).length,
    }))
    .filter((row) => row.scenes > 0)
    .sort((a, b) => b.scenes - a.scenes) // stable: ties keep bible order
}

/** "Highlight: Setups and payoffs. 19 scenes match." / "… 1 scene matches." /
 * "Highlight off." (spec §4.10); Who's in it reads the character's name. */
export function highlightAnnouncement(
  model: BoardModel,
  highlight: Highlight,
): string {
  if (highlight.kind === 'none') return 'Highlight off.'
  const name =
    (highlight.kind === 'who' &&
      model.characters.find((c) => c.id === highlight.who)?.name) ||
    HIGHLIGHT_LABELS[highlight.kind].replace('&', 'and')
  const count = highlightCount(model, highlight)
  return `Highlight: ${name}. ${count === 1 ? '1 scene matches' : `${count} scenes match`}.`
}

/** The next (dir 1) or previous (-1) scene in board order after
 * `fromSceneId` that matches, wrapping; from nothing (or a scene not on the
 * board), the first (or last). null when none. */
export function nextMatchId(
  model: BoardModel,
  fromSceneId: string | null,
  dir: 1 | -1,
  highlight: Highlight,
): string | null {
  const { order } = model
  const n = order.length
  const at = order.findIndex((s) => s.id === fromSceneId)
  const start = at >= 0 ? at : dir === 1 ? -1 : n
  for (let k = 1; k <= n; k++) {
    const id = order[(((start + dir * k) % n) + n) % n].id
    if (matchesHighlight(model, id, highlight)) return id
  }
  return null
}
