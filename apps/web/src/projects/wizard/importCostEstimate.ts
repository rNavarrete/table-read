import pricing from '../../../../../config/llm_pricing.json'

export interface ImportCostEstimate {
  estimatedModelCalls: number
  estimatedCostUsd: { low: number; high: number } | null
}

/** Import LLM call shape for N scenes:
 *  - import_worker (Sonnet): N segment + ceil(N/12) entity chunks
 *  - import_analyst (Opus): 3 story-wide calls (acts, promises, overview)
 *  - classifier (Haiku): N extract + 1 consistency scan
 *  Narrative Map is an explicit post-import analysis.
 */
export function estimateImportCost(input: {
  sceneCount: number
  charCount: number
}): ImportCostEstimate {
  const n = input.sceneCount
  if (n <= 0) {
    return { estimatedModelCalls: 0, estimatedCostUsd: null }
  }
  const h = pricing.importHeuristic
  const entityCalls = Math.ceil(n / h.entityScenesPerCall)
  const workerCalls = n + entityCalls
  const opusCalls = 3
  const classifierCalls = n + 1
  const calls = workerCalls + opusCalls + classifierCalls
  const workerRates = pricing.importWorker
  const opusRates = pricing.importAnalyst
  const classifierRates = pricing.classifier

  // Segmentation and entity extraction each partition the source once. Macro
  // Opus calls read compact semantic spines; Haiku fact extraction partitions
  // the screenplay once. This remains an estimate, not a billing guarantee.
  const sourceTokens = input.charCount / h.charsPerToken
  const workerInputTokens =
    h.systemOverheadTokensPerCall * workerCalls + sourceTokens * 2
  const opusInputTokens =
    h.systemOverheadTokensPerCall * opusCalls + sourceTokens * 0.75
  const classifierInputTokens =
    h.systemOverheadTokensPerCall * classifierCalls + sourceTokens
  const workerOutputTokens = h.avgOutputTokensPerCall * workerCalls
  const opusOutputTokens = h.avgOutputTokensPerCall * opusCalls
  const classifierOutputTokens = h.avgOutputTokensPerCall * classifierCalls

  const low =
    (workerInputTokens / 1_000_000) * workerRates.inputUsdPerMTok +
    (workerOutputTokens / 1_000_000) * workerRates.outputUsdPerMTok +
    (opusInputTokens / 1_000_000) * opusRates.inputUsdPerMTok +
    (opusOutputTokens / 1_000_000) * opusRates.outputUsdPerMTok +
    (classifierInputTokens / 1_000_000) * classifierRates.inputUsdPerMTok +
    (classifierOutputTokens / 1_000_000) * classifierRates.outputUsdPerMTok
  const high = low * h.highMultiplier
  return {
    estimatedModelCalls: calls,
    estimatedCostUsd: {
      low: roundUsd(low),
      high: roundUsd(high),
    },
  }
}

export function formatImportCostLine(stats: {
  detectedSceneCount: number
  estimatedModelCalls: number
  estimatedCostUsd: { low: number; high: number } | null
}): string {
  const scenes = `${stats.detectedSceneCount} scene(s) detected`
  if (!stats.estimatedCostUsd || stats.estimatedModelCalls <= 0) {
    return scenes
  }
  const { low, high } = stats.estimatedCostUsd
  return `${scenes} · ~${stats.estimatedModelCalls} model calls · Est. $${low.toFixed(2)}–$${high.toFixed(2)}`
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100
}
