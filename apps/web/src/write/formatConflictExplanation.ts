/**
 * Turn model continuityConflict.explanation into short writer-facing copy.
 * Strips ledger internals (fact ids, audienceKnows flags) that land in prompts
 * but shouldn't dominate the candidate card.
 */
export function formatConflictExplanation(explanation: string): string {
  let text = explanation
    .replace(/\baudienceKnows\s*[:=]\s*(true|false)\b/gi, '')
    .replace(/\bfact-[a-z0-9-]+\b/gi, '')
    .replace(/\bre:\s*/gi, '')
    .replace(/\(\s*;?\s*\)/g, '')
    .replace(/\s*;\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .replace(/\.\s*\./g, '.')
    .trim()

  if (!text)
    return 'This beat may disagree with something already in the Ledger.'

  // Prefer a single readable sentence for the card.
  if (text.length > 140) {
    const cut = text.slice(0, 140)
    const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '))
    text =
      lastBreak > 60 ? cut.slice(0, lastBreak + 1).trim() : `${cut.trim()}…`
  }
  return text
}
