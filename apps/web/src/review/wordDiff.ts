/** One token in a word-level before/after diff (UI spec §5 DiffPane). */
export type DiffToken =
  | { kind: 'equal'; text: string }
  | { kind: 'del'; text: string }
  | { kind: 'ins'; text: string }

/**
 * Split on whitespace while keeping the separators so the rendered diff
 * preserves spacing. Empty input → empty token list.
 */
function tokenize(text: string): string[] {
  if (text.length === 0) return []
  return text.split(/(\s+)/).filter((t) => t.length > 0)
}

/**
 * Word-level LCS diff for plan-field panes (UI spec §5: del = strikethrough
 * muted, ins = sage underline). Script panes use a coarser block compare
 * elsewhere; this helper is for plan text only.
 */
export function wordDiff(before: string, after: string): DiffToken[] {
  const a = tokenize(before)
  const b = tokenize(after)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const tokens: DiffToken[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      tokens.push({ kind: 'equal', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ kind: 'del', text: a[i] })
      i++
    } else {
      tokens.push({ kind: 'ins', text: b[j] })
      j++
    }
  }
  while (i < n) {
    tokens.push({ kind: 'del', text: a[i] })
    i++
  }
  while (j < m) {
    tokens.push({ kind: 'ins', text: b[j] })
    j++
  }
  return tokens
}
