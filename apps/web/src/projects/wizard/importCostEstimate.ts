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

// Op by op, for the pipeline in apps/api/fountain/pipeline.py, calibrated
// (T11.2, design docs/superpowers/specs/2026-10-30-import-cost-design.md) on
// the two complete imports in import-diagnostics.log (llm_call / llm_prewarm
// token counts, priced by scripts/import_cost_report.py):
//   A  import-28f20507, PROMPT_VERSION 0.62.0:  37 scenes,  41,874 chars, $2.33
//   B  import-c45b4084, PROMPT_VERSION 0.63.0: 179 scenes, 128,303 chars, $8.90
// Every coefficient below is the exact two-point fit through A and B,
// rounded, so it reproduces both runs. N = scenes, C = source characters.
// A second run of A's script (import-ea615510, stopped at promises) came
// within 6% op by op.
// - Cached prefixes: each cached stage writes its prefix once (its prewarm)
//   and every call reads it. Segment and entities share the whole script
//   (split_source): 4,500 + 0.507·C tokens (25.7k on A, 69.5k on B). Facts
//   read the scene-ordered episode (episode_source, Haiku's tokenizer):
//   3,900 + 0.59·C (28.6k, 79.6k).
// - segment_scene (Sonnet), per scene: input 770 + 1.51 per character of an
//   average scene (C/N), output 440 + 0.86·C/N (thinking included).
// - infer_story_entities (Sonnet), per chunk: input 4,700, output 3,100.
//   Chunks follow fountain/entity_inference.py: at most 12 scenes and 12,000
//   summary characters each. Summaries measured 690·N + 0.87·C characters
//   (61.9k on A, 235k on B) and filled 11,000 a chunk on average (6 and 21
//   chunks; this rule says 6 and 22).
// - Opus single calls (acts, promises, motivations, overview), uncached:
//   input per scene + per character, output fixed + per scene (thinking
//   included). B's promises call was a retry: its logged input carries the
//   replayed first answer, and the first attempt itself is missing from the
//   log, so B's real bill was likely ~$0.80 higher than $8.90.
// - extract_ledger_facts (Haiku), per scene: input 1,280 + 0.119·C (the cast,
//   after the cache point, grows with the script: 6.3k a call on A, 16.6k on
//   B), output 1,285 + 0.78·C/N.
// - scan_consistency (Haiku), one uncached call: input 419·N + 0.966·C,
//   output 7,860 + 34·N.
// - Haiku's long-prompt rates apply to a facts or consistency call whose
//   prompt (input + cache) is over `overPromptTokens`: B's scan (199k) did;
//   its facts calls (96-97k each) did not. A facts call crosses at ~134k
//   source characters, and the estimate steps up there. ponytail: a step on
//   the average call, not a share of calls; near the step the margin carries
//   it (B's facts crossing would have added ~$2.40, inside B's "at most").
// - Cache writes at 5 minutes (T11.4); the calibration test prices them at
//   the 1-hour rate the measured runs paid.
// - Models: each op's role in apps/api/llm/ops.py, pinned in
//   config/models.toml (read below); rates from config/llm_pricing.json.
// Not modelled: a script whose printed acts skip the acts call (slightly
// high), retries (in the margin), Narrative Map (a separate action).
// Range: LOW..HIGH around the point. A and B sit within 1% of it; HIGH is
// that error plus the design's 15% margin plus room for one Opus retry (B's
// missing first attempt was ~9%).
const LOW = 0.85
const HIGH = 1.3

interface Rates {
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  cacheReadUsdPerMTok: number
  longPrompt?: Omit<Rates, 'longPrompt'> & { overPromptTokens: number }
}

interface Call {
  input?: number
  cacheWrite?: number
  cacheRead?: number
  output?: number
}

const PINS: Record<string, string> = Object.fromEntries(
  [...modelsToml.matchAll(/^(\w+) *= *"([^"]+)"/gm)].map((m) => [m[1], m[2]]),
)
const MODELS: Record<string, Rates> = pricing.models
const importWorker = MODELS[PINS.import_worker]
const importAnalyst = MODELS[PINS.import_analyst]
const classifier = MODELS[PINS.classifier]

/** USD for `calls` calls of this size, at the long-prompt rates when one
 *  call's prompt is over the model's threshold. */
function usd(
  model: Rates,
  calls: number,
  t: Call,
  writeMultiplier: number,
): number {
  const prompt = (t.input ?? 0) + (t.cacheWrite ?? 0) + (t.cacheRead ?? 0)
  const r =
    model.longPrompt && prompt > model.longPrompt.overPromptTokens
      ? model.longPrompt
      : model
  return (
    (calls *
      ((t.input ?? 0) * r.inputUsdPerMTok +
        (t.cacheWrite ?? 0) * r.inputUsdPerMTok * writeMultiplier +
        (t.cacheRead ?? 0) * r.cacheReadUsdPerMTok +
        (t.output ?? 0) * r.outputUsdPerMTok)) /
    1_000_000
  )
}

/** Entity chunks for N scenes (fountain/entity_inference.py's rule). */
export function entityChunks(n: number, c: number): number {
  return Math.max(Math.ceil(n / 12), Math.ceil((690 * n + 0.87 * c) / 11_000))
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
  const script = 4_500 + 0.507 * c
  const episode = 3_900 + 0.59 * c
  const perScene = c / n
  const point =
    // prewarms: segment and entities write the script, facts the episode
    usd(importWorker, 2, { cacheWrite: script }, w) +
    usd(classifier, 1, { cacheWrite: episode }, w) +
    // segment_scene
    usd(
      importWorker,
      n,
      {
        input: 770 + 1.51 * perScene,
        cacheRead: script,
        output: 440 + 0.86 * perScene,
      },
      w,
    ) +
    // infer_story_entities
    usd(
      importWorker,
      entityChunks(n, c),
      { input: 4_700, cacheRead: script, output: 3_100 },
      w,
    ) +
    // infer_act_breaks
    usd(
      importAnalyst,
      1,
      { input: 108 * n + 0.426 * c, output: 225 + 3.1 * n },
      w,
    ) +
    // infer_narrative_promises
    usd(
      importAnalyst,
      1,
      { input: 456 * n + 0.212 * c, output: 7_450 + 70 * n },
      w,
    ) +
    // infer_scene_motivations
    usd(
      importAnalyst,
      1,
      { input: 130 * n + 0.449 * c, output: 4_470 + 47.5 * n },
      w,
    ) +
    // infer_story_overview
    usd(
      importAnalyst,
      1,
      { input: 360 * n + 0.838 * c, output: 4_410 + 85 * n },
      w,
    ) +
    // extract_ledger_facts
    usd(
      classifier,
      n,
      {
        input: 1_280 + 0.119 * c,
        cacheRead: episode,
        output: 1_285 + 0.78 * perScene,
      },
      w,
    ) +
    // scan_consistency
    usd(
      classifier,
      1,
      { input: 419 * n + 0.966 * c, output: 7_860 + 34 * n },
      w,
    )
  return {
    low: Math.floor(point * LOW * 100) / 100,
    about: Math.round(point * 100) / 100,
    high: Math.ceil(point * HIGH * 100) / 100,
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
