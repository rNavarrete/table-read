// Deterministic, client-local preview stats for the import wizard's Review
// source step (design doc §7 step 3: "byte/character and line counts,
// deterministic detected scene count where available"). `detectedSceneCount`
// mirrors the server's slugline detection (apps/api/fountain/parse.py
// `_SLUGLINE_RE`/`split_into_scenes`) closely enough for an informational
// preview — it is never authoritative; the server's own deterministic split
// during Create & analyze is what actually determines scene ownership.
import { estimateImportCost, type ImportCostRange } from './importCostEstimate'

// Mixed case is spelled out as Title case: the (?i:) group the API uses is
// not supported in every browser yet.
const SLUGLINE_RE =
  /^\s*(?:(?:[A-Za-z]?\d+[A-Za-z]?\s+)?(?:(?:INT\.\/EXT|INT\/EXT|EXT\.\/INT|EXT\/INT|I\/E|INT|EXT|EST|int\.\/ext|int\/ext|ext\.\/int|ext\/int|i\/e|int|ext|est)[\s.]|(?:Int\.\/Ext|Int\/Ext|Ext\.\/Int|Ext\/Int|Int|Ext|Est)[\s.](?!\s*[a-z]))|\.[^.\s])/

export interface ImportSourceStats {
  charCount: number
  byteCount: number
  lineCount: number
  detectedSceneCount: number
  estimatedCostUsd: ImportCostRange | null
}

export function analyzeSource(source: string): ImportSourceStats {
  const lines = source.split('\n')
  const sluglineCount = lines.filter((line) => SLUGLINE_RE.test(line)).length
  const detectedSceneCount = source.trim() ? Math.max(sluglineCount, 1) : 0
  return {
    charCount: source.length,
    byteCount: new TextEncoder().encode(source).length,
    lineCount: lines.length,
    detectedSceneCount,
    estimatedCostUsd: estimateImportCost({
      sceneCount: detectedSceneCount,
      charCount: source.length,
    }),
  }
}
