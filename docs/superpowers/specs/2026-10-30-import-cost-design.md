# Import cost: meter, estimate, spending limit (T11.1–T11.4) — design

Status: owner request 2026-10-29/30 — "a very accurate estimate of how much someone is going to spend… optimizing this tool the most we can… be very clear and upfront". The owner skipped design questions; every _(call)_ is the builder's default for the owner to check in review.

## Why

If Table Read ever runs on a writer's own API key, the feared case is a writer importing a long script and getting a large bill they didn't expect. Two things make that safe: an estimate that is honest before anything is spent, and a hard ceiling that holds even when the estimate is wrong. Cutting what an import costs comes after, and only where it does not lower the breakdown's quality.

## What imports cost today (measured)

From `apps/api/logs/import-diagnostics.log` (every `llm_call` logs model and token usage), at rates fetched from the Anthropic pricing page on 2026-10-30 (Opus 5.5 $4 in / $20 out / $0.20 cache read; Sonnet 5.5 $2 / $10 / $0.10; Haiku 5.5 $0.10 / $0.50 / $0.01 up to 100K-token prompts, 5× above; cache writes 1.25× input for 5 minutes, 2× for 1 hour):

| Import | Scenes | Source chars | Actual | Largest stages |
|---|---|---|---|---|
| Simpsons episode (PROMPT_VERSION 0.62.0) | 37 | 41,874 | $2.33 | segment 34% · overview 15% · promises 13% · entities 12% · motivations 9% |
| Long script (0.63.0) | 179 | 128,303 | $8.90 | segment 43% ($3.80: output $1.89, cache reads $1.24) · overview 12% · entities 11% · promises 9% · facts 7% · motivations 7% |

Cache-read share of input was 78–93%. Every cached prefix was re-read within 72 s of the previous read (segment ≤7 s, entities ≤15 s, facts ≤72 s), so the 1-hour cache tier the client writes (`ttl: "1h"`, 2× input) buys nothing over the 5-minute tier (1.25×).

The wizard's current estimate (`apps/web/src/projects/wizard/importCostEstimate.ts`, calibrated on 0.51.0) showed **$1.35–$2.15 for the $2.33 Simpsons import** — the actual beat the quoted ceiling — and $7.69–$12.22 for the $8.90 one (right by cancellation). It predates `infer_scene_motivations` and the P0–P2 output fields, and its pricing table charged Sonnet cache reads at $0.20 instead of $0.10 (fixed in this design's commit; `config/llm_pricing.json` now also carries a per-model table, Haiku's long-prompt tier and both cache-write multipliers, with the old role keys kept so nothing breaks).

## Goals

1. The writer sees an honest estimate before importing: a likely cost and the most it should cost, for this script.
2. While an import runs, the writer sees what it has spent so far; after it finishes, the project keeps what it cost.
3. An import never spends more than the writer's limit. At the limit it pauses and asks, and continuing loses nothing.
4. Imports stop paying for the 1-hour cache tier they don't use.

## Non-goals

- Changes that alter the breakdown: lower effort, a cheaper model for an op, a smaller context per call, a restructured prompt. Each needs an eval; evals are on hold. They are listed under "Next" with their measured ceilings.
- Batch API ("half price, results in a few hours") — an architecture change for later.
- Costs outside import (Next Beat, structure check, craft check). The meter's plumbing should make them easy to add; showing them is not in scope _(call)_.
- Accounts, keys per user, billing. This is the groundwork that makes them safe.

## Anti-goals

- An estimate that quotes a ceiling the import then beats without telling the writer.
- A limit the import can blow through between checks by more than a few cents.
- A pause that throws away paid work.
- Writer text in logs (hard rule 5) — costs log as numbers only.

## T11.4 Five-minute cache (first, small)

The client's `cache_control` uses `{"type": "ephemeral"}` (5-minute default) instead of `ttl: "1h"`. The estimate and the meter price cache writes at `cacheWrite5mMultiplier`. The prewarm calls stay — they still save the concurrent first-wave misses. If a stage can ever wait longer than five minutes between reads of its prefix (a spending-limit pause is the one new case: a resumed run prewarms again), the cost is one more write, not a failure. Saves roughly 2–3% of an import (`measured`, from the log above).

## T11.1 Cost meter and receipt

- **One pricing source.** A small Python module reads `config/llm_pricing.json` (the same file the web reads) and prices one call from its model id and `usage`: regular input, cache writes (5m or 1h — whichever the request used), cache reads, output (thinking included, as billed), with Haiku's long-prompt rates when the call's prompt (input + cache write + cache read) is over `overPromptTokens`. Unknown model → cost unknown, logged as such, never guessed.
- **Per import run.** Every LLM call made under an import run adds its cost to that run's meter, including prewarms, retries and failed attempts that returned usage (they are billed). The meter is per run and thread-safe (the import fans out). It lives with the run so a resumed run continues the same total _(call)_.
- **Progress.** Import progress events carry `spentUsd` (to the cent). The wizard shows it beside the stage list: "Spent $1.12 so far".
- **Receipt.** When the import completes, the total (`importCostUsd`) and the token totals by stage are stored with the run and shown on the finished import ("This import cost $2.31"). The project keeps its import cost so Settings or the dashboard can show it later _(call: stored, shown on the finale only for now)_.
- **Logs.** The existing `llm_call` line gains `cost_usd`; an `import_cost` line per run gives the total and per-stage totals. Numbers only.

## T11.2 Estimate that matches what imports cost

- Recalibrate `estimateImportCost` from the two measured imports above (and any later ones the builder can read from the log), op by op, for the current pipeline: segment, entities (with its real chunking rule), acts, promises, motivations, overview, facts, consistency, each stage's prewarm. Price with `config/llm_pricing.json` (per model; Haiku's long-prompt tier when a facts or consistency prompt will exceed 100K tokens; 5-minute cache writes once T11.4 lands).
- **Honest range.** The writer sees "about $X" and "at most $Y". The low/high band must contain both measured imports' actual cost, with the high end at least 15% above the higher of the two errors _(call)_. If the estimate can't be computed (no scenes), say so — never show $0.
- **Where it shows.** The wizard's Check & start step, before the Import button, in plain words: "This script has 37 scenes. Importing it will cost about $2.40 on your API key, and at most $3.10." _(call: "your API key" wording only when the server is on a real key; with the mock: "Demo mode — no cost.")_
- **Calibration check.** A test pins the estimate against the measured imports (inputs: scene count, character count; expected: the actual cost inside the band). When the pipeline changes, the test is where the estimate gets re-tuned. A script under `scripts/` that reads `import-diagnostics.log` and prints actual cost per run by stage (the measurement in this design, as a tool) _(call)_.

## T11.3 Spending limit

- **The limit.** The import request carries `maxCostUsd` (optional). The wizard sets it by default to the estimate's "at most", rounded up to the next dollar, and lets the writer change it _(call)_. No limit → today's behaviour.
- **Enforcement.** Before each stage, and before launching each call within a fan-out stage, the pipeline checks `spent + projected cost of what it is about to start ≤ maxCostUsd` (projection from the same per-op model as the estimate). Calls already in flight finish; overshoot is bounded by the in-flight calls (a few cents) and the design says so in the UI copy _(call: check per unit, not per token)_.
- **At the limit.** The run stops at the last completed unit with a resumable status and a distinct error code (e.g. `IMPORT_SPEND_LIMIT`), keeping every checkpoint. The wizard shows: "Paused at $4.82 of your $5.00 limit. About $2.10 more should finish this import." with **Continue (up to $8.00)** — which resumes the same run with a higher limit — and **Stop**. Raising the limit must not count as a changed request (the run's checkpoints are kept; `create_or_resume_run` must not restart it). Stop leaves the run failed-and-resumable as today.
- **Never fabricate.** A paused import creates no project, writes no snapshot, and drops no paid work.

## Next (not in this milestone — needs an eval)

Ranked by measured savings ceiling on the long script ($8.90), not by application order:

| Lever | Type | Ceiling | Data |
|---|---|---|---|
| Opus → Sonnet for overview, promises, motivations | tradeoff (model) | ~15–20% | logs |
| Segment at `medium` effort instead of Sonnet's default `high` | tradeoff (effort) | ~8–12% (segment output is 21% of the bill) | logs + published curve |
| Share one cached episode spine across overview, promises, motivations | prompt restructure | ~8–10% | logs |
| Narrow segment context to nearby scenes instead of the whole script | tradeoff (context) | up to ~14% on long scripts, grows with length | logs |
| Batch API "economy import" | architecture | 50% of what moves to batch | published |

Each needs a frozen set of 2–3 of the owner's scripts imported at each setting and compared side by side — real spend (~$25–40), approved before running.

## Tests

T11.1: pricing per model incl. Haiku's tier and both cache-write rates; unknown model → unknown cost; the meter sums concurrent calls; prewarm, retry and failed-with-usage calls count; progress events carry `spentUsd`; the receipt is stored; logs carry numbers only. T11.2: the calibration test; the range contains both measured actuals; copy for real and demo modes; no estimate without scenes. T11.3: the limit stops before a unit that would cross it; in-flight calls finish; the run resumes with a raised limit from its checkpoints (no re-spend of finished units); raising the limit isn't a changed request; Stop leaves it resumable; no project or snapshot on pause. T11.4: requests carry 5-minute cache control; the estimate prices 5-minute writes. Every task: no Anthropic API call in tests (hard rule 1), `MockLlmClient` returns usage the meter can price.

## Sign-off

No prompt text changes (T11.4 changes a request parameter, not a template: no `PROMPT_VERSION` bump). Model and effort settings are untouched.
