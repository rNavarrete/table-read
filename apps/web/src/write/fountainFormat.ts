/**
 * Lightweight Fountain-ish line classification for Write-mode teleplay
 * layout (UI spec §4 "Fountain rendered"). Not a full Fountain parser —
 * enough to indent character / dialogue / parenthetical / transitions
 * the way a US letter screenplay looks in Courier.
 */

export type FountainLineType =
  | 'blank'
  | 'scene_heading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'

export interface FountainLine {
  type: FountainLineType
  text: string
}

const SCENE_HEADING =
  /^(?:\d+[A-Z]?\.\s*)?(INT\.|EXT\.|EST\.|I\/E\.|INT\/EXT\.|INT\s|EXT\s)/i

const TRANSITION =
  /^(FADE (IN|OUT)|CUT TO|DISSOLVE TO|SMASH CUT|MATCH CUT|CONTINUED:?|\(.*CONTINUED.*\)|.* TO:)\s*$/i

/** PDF / bad-import element labels that are not screenplay content. */
const JUNK_LABEL = /^(ACTION|CHARACTER|DIALOGUE|PARENTHETICAL|TRANSITION|SCENE HEADING|SHOT)$/i

/** Lone page numbers left in from print PDFs. */
const PAGE_NUMBER = /^\d{1,3}$/

function isCharacterLine(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 45) return false
  if (SCENE_HEADING.test(t) || TRANSITION.test(t)) return false
  if (t.startsWith('(') || t.startsWith('!')) return false
  // Strip trailing extensions: (V.O.), (O.S.), (CONT'D)
  const core = t.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (!core || /[a-z]/.test(core)) return false
  // Must look like a name (letters / spaces / . ' -), not a whole action line
  if (!/^[A-Z0-9 .'\-@]+$/.test(core)) return false
  const words = core.split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 6
}

/**
 * Classify `scriptText` into typed lines for teleplay CSS. Preserves blank
 * lines (for spacing). Drops lone PDF element labels like `ACTION`.
 */
export function parseFountainLines(scriptText: string): FountainLine[] {
  const raw = scriptText.replace(/\r\n/g, '\n').split('\n')
  const out: FountainLine[] = []
  let afterCharacter = false

  for (const original of raw) {
    const trimmed = original.trimEnd()
    const t = trimmed.trim()

    if (!t) {
      out.push({ type: 'blank', text: '' })
      afterCharacter = false
      continue
    }

    if (JUNK_LABEL.test(t) || PAGE_NUMBER.test(t)) {
      continue
    }

    if (SCENE_HEADING.test(t)) {
      out.push({ type: 'scene_heading', text: t })
      afterCharacter = false
      continue
    }

    if (TRANSITION.test(t) || /^\(CONTINUED\)$/i.test(t)) {
      out.push({ type: 'transition', text: t })
      afterCharacter = false
      continue
    }

    if (t.startsWith('(') && t.endsWith(')') && afterCharacter) {
      out.push({ type: 'parenthetical', text: t })
      continue
    }

    if (isCharacterLine(t)) {
      out.push({ type: 'character', text: t })
      afterCharacter = true
      continue
    }

    if (afterCharacter) {
      out.push({ type: 'dialogue', text: t })
      continue
    }

    out.push({ type: 'action', text: t })
    afterCharacter = false
  }

  return out
}
