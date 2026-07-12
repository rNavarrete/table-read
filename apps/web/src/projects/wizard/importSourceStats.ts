// Deterministic, client-local preview stats for the import wizard's Review
// source step (design doc §7 step 3: "byte/character and line counts,
// deterministic detected scene count where available"). `detectedSceneCount`
// mirrors the server's slugline detection (apps/api/fountain/parse.py
// `_SLUGLINE_RE`/`split_into_scenes`) closely enough for an informational
// preview — it is never authoritative; the server's own deterministic split
// during Create & analyze is what actually determines scene ownership.
import { estimateImportCost } from './importCostEstimate'

const SLUGLINE_RE =
  /^\s*(INT\.\/EXT\.?|INT\/EXT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)[\s.]/i

export interface ImportSourceStats {
  charCount: number
  byteCount: number
  lineCount: number
  detectedSceneCount: number
  estimatedModelCalls: number
  estimatedCostUsd: { low: number; high: number } | null
}

export function analyzeSource(source: string): ImportSourceStats {
  const lines = source.split('\n')
  const sluglineCount = lines.filter((line) => SLUGLINE_RE.test(line)).length
  const detectedSceneCount = source.trim() ? Math.max(sluglineCount, 1) : 0
  const cost = estimateImportCost({
    sceneCount: detectedSceneCount,
    charCount: source.length,
  })
  return {
    charCount: source.length,
    byteCount: new TextEncoder().encode(source).length,
    lineCount: lines.length,
    detectedSceneCount,
    estimatedModelCalls: cost.estimatedModelCalls,
    estimatedCostUsd: cost.estimatedCostUsd,
  }
}
