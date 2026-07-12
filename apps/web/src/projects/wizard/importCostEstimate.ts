import pricing from '../../../../../config/llm_pricing.json'

export interface ImportCostEstimate {
  estimatedModelCalls: number
  estimatedCostUsd: { low: number; high: number } | null
}

export function estimateImportCost(input: {
  sceneCount: number
  charCount: number
}): ImportCostEstimate {
  const n = input.sceneCount
  if (n <= 0) {
    return { estimatedModelCalls: 0, estimatedCostUsd: null }
  }
  const calls = 2 * n + 1
  const h = pricing.importHeuristic
  const rates = pricing.classifier
  const inputTokens =
    h.systemOverheadTokensPerCall * calls +
    (input.charCount / h.charsPerToken) * 2
  const outputTokens = h.avgOutputTokensPerCall * calls
  const low =
    (inputTokens / 1_000_000) * rates.inputUsdPerMTok +
    (outputTokens / 1_000_000) * rates.outputUsdPerMTok
  const high = low * h.highMultiplier
  return {
    estimatedModelCalls: calls,
    estimatedCostUsd: {
      low: roundUsd(low),
      high: roundUsd(high),
    },
  }
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100
}
