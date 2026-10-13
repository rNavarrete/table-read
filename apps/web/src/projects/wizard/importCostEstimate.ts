import pricing from '../../../../../config/llm_pricing.json'

export interface ImportCostEstimate {
  estimatedModelCalls: number
  estimatedCostUsd: { low: number; high: number } | null
}

// Per-call token figures, from the llm_call lines of real imports
// (PROMPT_VERSION 0.51.0, October 2026: "Marge vs. the Monorail", 68 scenes,
// and "Mr. Plow", 54 scenes, each ~37k source characters; Monorail cost
// ~$2.64). Stage -> model is each op's role in apps/api/llm/ops.py, pinned in
// config/models.toml. Assumptions:
// - The whole script is a cached prompt prefix: segmentation and the cast
//   each write it once (the stage's prewarm, at the 1-hour-TTL write rate)
//   and every call reads it. Measured ~25k tokens for ~37k characters
//   (tool, system prompt and the script as JSON): 3,000 + 0.6 per character.
//   The facts prefix carries beat ids and Haiku's tokenizer counts ~30% more:
//   ~29k, so 3,000 + 0.7 per character.
// - Segmentation (Sonnet), per scene: ~1,100 uncached input tokens (the
//   line-numbered scene) and ~750 output (450-740 measured, plus thinking on
//   a few calls).
// - Cast (Sonnet), per chunk of ~10 scenes (68 scenes made 7): ~4,600 input,
//   ~3,400 output.
// - Acts, threads and overview (Opus, uncached; they read per-scene spines):
//   input ~420, ~470 and ~940 tokens per scene; output ~800, ~170 per scene
//   (12.5k on 68 scenes, half of it thinking) and ~90 per scene.
// - Facts (Haiku), per scene: ~7,900 uncached input (the cast list sits after
//   the cache point) and ~900 output (270-1,540 measured).
// - Consistency (Haiku): ~1,030 input and ~120 output tokens per scene.
// Not modelled: retries, a script whose printed acts skip the acts call, and
// Haiku's higher rate above 100k-token prompts. The range is -15%/+35% around
// that point estimate. Narrative Map is an explicit post-import analysis.
const ENTITY_SCENES_PER_CHUNK = 10
const LOW = 0.85
const HIGH = 1.35

interface Rates {
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  cacheReadUsdPerMTok: number
}

interface Tokens {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

function usd(rates: Rates, tokens: Tokens): number {
  const write = rates.inputUsdPerMTok * pricing.cacheWrite1hMultiplier
  return (
    (tokens.input * rates.inputUsdPerMTok +
      tokens.output * rates.outputUsdPerMTok +
      (tokens.cacheRead ?? 0) * rates.cacheReadUsdPerMTok +
      (tokens.cacheWrite ?? 0) * write) /
    1_000_000
  )
}

/** Model calls for N scenes: N segment + ceil(N/10) cast chunks (Sonnet),
 *  acts + threads + overview (Opus), N facts + 1 consistency (Haiku). */
export function estimateImportCost(input: {
  sceneCount: number
  charCount: number
}): ImportCostEstimate {
  const n = input.sceneCount
  if (n <= 0) {
    return { estimatedModelCalls: 0, estimatedCostUsd: null }
  }
  const chunks = Math.ceil(n / ENTITY_SCENES_PER_CHUNK)
  const scriptPrefix = 3_000 + 0.6 * input.charCount
  const factsPrefix = 3_000 + 0.7 * input.charCount
  const sonnet = pricing.importWorker
  const opus = pricing.importAnalyst
  const haiku = pricing.classifier
  const point =
    usd(sonnet, {
      input: 1_100 * n,
      output: 750 * n,
      cacheRead: scriptPrefix * n,
      cacheWrite: scriptPrefix,
    }) +
    usd(sonnet, {
      input: 4_600 * chunks,
      output: 3_400 * chunks,
      cacheRead: scriptPrefix * chunks,
      cacheWrite: scriptPrefix,
    }) +
    usd(opus, { input: 2_000 + 420 * n, output: 800 }) +
    usd(opus, { input: 2_000 + 470 * n, output: 1_000 + 170 * n }) +
    usd(opus, { input: 2_000 + 940 * n, output: 500 + 90 * n }) +
    usd(haiku, {
      input: 7_900 * n,
      output: 900 * n,
      cacheRead: factsPrefix * n,
      cacheWrite: factsPrefix,
    }) +
    usd(haiku, { input: 2_000 + 1_030 * n, output: 120 * n })
  return {
    estimatedModelCalls: 2 * n + chunks + 4,
    estimatedCostUsd: {
      low: roundUsd(point * LOW),
      high: roundUsd(point * HIGH),
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
