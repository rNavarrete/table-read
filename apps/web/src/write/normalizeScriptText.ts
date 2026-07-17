/**
 * Collapse LLM double-escaped Fountain whitespace.
 *
 * After JSON parse, a properly escaped `"line\\nline"` becomes a real
 * newline. When the model double-escapes (`"line\\\\nline"`), the value
 * retains the two-character sequence `\` + `n`, which then shows up
 * literally in the candidate dock. Real newlines are left alone.
 */
export function normalizeScriptText(text: string): string {
  if (!text.includes('\\')) return text
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
}

/** Normalize scriptText on a BeatCandidate without mutating the original. */
export function withNormalizedScriptText<T extends { scriptText: string }>(
  candidate: T,
): T {
  const scriptText = normalizeScriptText(candidate.scriptText)
  return scriptText === candidate.scriptText
    ? candidate
    : { ...candidate, scriptText }
}
