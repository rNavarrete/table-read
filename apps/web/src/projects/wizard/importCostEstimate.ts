import costModel from '../../../../../config/import_cost_model.json'
import pricing from '../../../../../config/llm_pricing.json'
import modelsToml from '../../../../../config/models.toml?raw'

/** What an import should cost, in USD: `about` is the point estimate the
 *  wizard quotes, `high` the "at most" (and the spending limit's default,
 *  T11.3). `low` bounds the calibration band. */
export interface ImportCostRange {
  low: number
  about: number
  high: number
}

// Op by op, for the pipeline in apps/api/fountain/pipeline.py: every
// coefficient, the chunking rule, which stages prewarm, the range and where
// the numbers come from live in config/import_cost_model.json (its `notes`),
// shared with the server's spending-limit projection
// (apps/api/fountain/import_spend.py), which evaluates it the same way.
// Rates: config/llm_pricing.json per model, each op's role pinned in
// config/models.toml (read below).

interface Rates {
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  cacheReadUsdPerMTok: number
  longPrompt?: Omit<Rates, 'longPrompt'> & { overPromptTokens: number }
}

/** Tokens: base + perScene·N + perChar·C + perCharPerScene·(C/N). */
interface Linear {
  base?: number
  perScene?: number
  perChar?: number
  perCharPerScene?: number
}

interface CostModel {
  range: { low: number; high: number }
  prefixes: Record<string, Linear>
  entityChunks: {
    maxScenes: number
    charsPerChunk: number
    summaryChars: Linear
  }
  ops: Record<
    string,
    {
      role: string
      calls: 'scene' | 'chunk' | 'one'
      cachedPrefix?: string
      prewarm?: boolean
      input: Linear
      output: Linear
    }
  >
}

const MODEL = costModel as CostModel
const PINS: Record<string, string> = Object.fromEntries(
  [...modelsToml.matchAll(/^(\w+) *= *"([^"]+)"/gm)].map((m) => [m[1], m[2]]),
)
const MODELS: Record<string, Rates> = pricing.models

function tokens(l: Linear, n: number, c: number): number {
  return (
    (l.base ?? 0) +
    (l.perScene ?? 0) * n +
    (l.perChar ?? 0) * c +
    (l.perCharPerScene ?? 0) * (c / n)
  )
}

/** USD for one call, at the long-prompt rates when its prompt is over the
 *  model's threshold. */
function usd(
  model: Rates,
  input: number,
  cacheWrite: number,
  cacheRead: number,
  output: number,
  writeMultiplier: number,
): number {
  const r =
    model.longPrompt &&
    input + cacheWrite + cacheRead > model.longPrompt.overPromptTokens
      ? model.longPrompt
      : model
  return (
    (input * r.inputUsdPerMTok +
      cacheWrite * r.inputUsdPerMTok * writeMultiplier +
      cacheRead * r.cacheReadUsdPerMTok +
      output * r.outputUsdPerMTok) /
    1_000_000
  )
}

/** Entity chunks for N scenes (fountain/entity_inference.py's rule). */
export function entityChunks(n: number, c: number): number {
  const { maxScenes, charsPerChunk, summaryChars } = MODEL.entityChunks
  return Math.max(
    Math.ceil(n / maxScenes),
    Math.ceil(tokens(summaryChars, n, c) / charsPerChunk),
  )
}

/** null without scenes: there is nothing to estimate, never $0. */
export function estimateImportCost(input: {
  sceneCount: number
  charCount: number
  /** Cache-write price as a multiple of input; defaults to 5-minute writes. */
  cacheWriteMultiplier?: number
}): ImportCostRange | null {
  const n = input.sceneCount
  if (n <= 0) return null
  const c = input.charCount
  const w = input.cacheWriteMultiplier ?? pricing.cacheWrite5mMultiplier
  let point = 0
  for (const op of Object.values(MODEL.ops)) {
    const model = MODELS[PINS[op.role]]
    const calls =
      op.calls === 'scene' ? n : op.calls === 'chunk' ? entityChunks(n, c) : 1
    const prefix = op.cachedPrefix
      ? tokens(MODEL.prefixes[op.cachedPrefix], n, c)
      : 0
    // A stage with 2+ calls writes its prefix once first (its prewarm).
    if (op.prewarm && calls >= 2) point += usd(model, 0, prefix, 0, 0, w)
    point +=
      calls *
      usd(model, tokens(op.input, n, c), 0, prefix, tokens(op.output, n, c), w)
  }
  return {
    low: Math.floor(point * MODEL.range.low * 100) / 100,
    about: Math.round(point * 100) / 100,
    high: Math.ceil(point * MODEL.range.high * 100) / 100,
  }
}

/** The Check & start sentence. `llmMode` is GET /health's: "your API key"
 *  only on a real key, no cost in demo mode (design T11.2). */
export function importCostCopy(
  sceneCount: number,
  estimate: ImportCostRange | null,
  llmMode: string | null,
): string {
  if (sceneCount <= 0 || !estimate) {
    return 'No scenes found, so there is no cost estimate.'
  }
  const scenes = `This script has ${sceneCount} ${sceneCount === 1 ? 'scene' : 'scenes'}.`
  if (llmMode === 'mock') return `${scenes} Demo mode — no cost.`
  const key = llmMode === 'real' ? ' on your API key' : ''
  return `${scenes} Importing it will cost about $${estimate.about.toFixed(2)}${key}, and at most $${estimate.high.toFixed(2)}.`
}
