import type {
  Beat,
  Character,
  ConsistencyFlag,
  Episode,
  LedgerFact,
  Scene,
  Secret,
  StoryOverviewBeatItem,
  StoryThread,
} from 'contract'
import { parseFountainLines } from '../write/fountainFormat'
import { affectedFacts } from './planTree'

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
 * this scene doesn't have is dropped, as in flaggedScenes.ts. */
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

// ── Scene reading ───────────────────────────────────────────────────────

const SLUG_PREFIX = /^(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.|EXT\.)\s*/i

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /(^|[\s\-/(])(\p{L})/gu,
      (_, sep: string, ch: string) => sep + ch.toUpperCase(),
    )
}

/** "INT. THE LONG POUR - NIGHT" → "The Long Pour": drops the INT./EXT./I/E.
 * prefix and, when there are two or more " - " parts, the last one (the
 * time); title-cases only an all-caps remainder. Empty → "Scene n". */
export function placeTitle(scene: Scene): string {
  const parts = scene.location.trim().replace(SLUG_PREFIX, '').split(' - ')
  if (parts.length >= 2) parts.pop()
  const place = parts.join(' - ').trim()
  if (!place) return `Scene ${scene.index + 1}`
  return place === place.toUpperCase() ? titleCase(place) : place
}

/** Board order: act, then index (Board's frames). Drives ‹ › and "of N". */
export function boardOrder(scenes: readonly Scene[]): Scene[] {
  return [...scenes].sort((a, b) => a.act - b.act || a.index - b.index)
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

export interface SceneThread {
  thread: StoryThread
  role: 'sets_up' | 'pays_off'
  /** sets_up → the payoff scene, pays_off → the setup scene; null when there
   * is none or it is not a scene in this episode ("Never paid off"). */
  otherSceneId: string | null
}

export function threadsForScene(
  episode: Episode,
  sceneId: string,
): SceneThread[] {
  const known = (id: string | null) =>
    id && episode.scenes.some((s) => s.id === id) ? id : null
  const out: SceneThread[] = []
  for (const thread of episode.threads ?? []) {
    if (thread.setupSceneId === sceneId)
      out.push({
        thread,
        role: 'sets_up',
        otherSceneId: known(thread.payoffSceneId ?? null),
      })
    if (thread.payoffSceneId === sceneId)
      out.push({
        thread,
        role: 'pays_off',
        otherSceneId: known(thread.setupSceneId),
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
