# Import coverage resilience + pre-analyze cost estimate — design spec

**Date:** 2026-07-12  
**Status:** partially superseded by T7.10 typed segment starts; cost-preview decisions remain active
**Authority after merge:** updates `docs/tableread-prompt-spec.md` §7 server rules (gap handling), `docs/tableread-ui-spec.md` (Import Review / Analyze copy), `docs/tableread-test-plan.md`, and `docs/tableread-build-plan.md` with a tracking task. No Zod/Pydantic schema change required unless we add an optional import-complete usage field (deferred).

## 1. Goal

Two related import pain points from real feature-script use (`Number_Two.pdf` / ~110 scenes):

1. **One missed line aborts the whole run.** Model beat ranges that leave a gap (e.g. trailing `CUT TO:`) raise `CoverageError` → `VALIDATION`, persist nothing, after earlier per-scene LLM calls may already have been billed.
2. **Writers cannot see cost before Create & analyze.** Scene count is already previewed client-side; call count and dollar estimate are not.

Trust promise stays intact: analyze is still the only AI gesture; PDF extract stays $0 LLM; coverage still guarantees **no source text is dropped**; dollar figures are **estimates**, not invoices.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Gap in beat/`unassigned` tiling | **Heal** → synthesize `unassigned` range(s) with stable reason `coverage_gap`; merge into nearest beat; flag for review |
| Overlap | Still **hard-fail** `VALIDATION` |
| Out-of-bounds range | Still **hard-fail** `VALIDATION` |
| Empty claims (no beats, no unassigned) | Still **hard-fail** `VALIDATION` |
| Schema-invalid LLM output | Unchanged (rule 9: one retry → `SCHEMA_INVALID_LLM`) |
| Cost preview location | **Review source** step (primary) + same summary near **Create & analyze script** on Analyze |
| Cost preview contents | **All three:** detected scene count · estimated model calls · estimated $ range |
| Call-shape formula | `2N + 1` classifier calls for `N` detected scenes (segment + extract per scene, +1 consistency scan) |
| Model for $ math | Pinned **classifier** role from `config/models.toml` (today Haiku 4.5) |
| Rate source | `config/llm_pricing.json` (classifier $/MTok + heuristic constants) — updateable without `PROMPT_VERSION` bump; web imports or mirrors the same numbers |
| Actual post-run spend | **Defer** unless usage is already easy to thread through SSE; estimate-only for this change |
| PDF extract | Unchanged — no LLM / $0 model cost |

## 3. Non-goals

- Billing, quotas, or charging writers inside the product
- Changing which model role import uses
- Softening overlap / OOB validation
- Server authoritative cost endpoint (client heuristic is enough for MVP; server may later expose the same formula)
- Showing Sonnet writer-tier prices on this path
- Changing snapshot / lock / pending_review import guarantees

## 4. Coverage gap heal (server)

### 4.1 Where

`apps/api/fountain/parse.py` — `validate_and_slice` (or a helper immediately before the contiguity check).

### 4.2 Algorithm

After collecting beat + unassigned claims (sorted by start):

1. Reject empty claims (unchanged).
2. Reject any claim with `start < 1`, `end < start`, or `end > K` (unchanged).
3. Reject any overlap (`start < cursor`) (unchanged).
4. **New:** if `start > cursor`, insert a synthetic unassigned claim `(cursor, start - 1)` with reason `coverage_gap` before continuing.
5. After the loop, if `cursor <= K`, insert synthetic unassigned `(cursor, K)` with reason `coverage_gap`.
6. Proceed to existing `_merge` so synthetic gaps attach to the nearest beat and surface as review flags (same path as model-authored unassigned).

Logging: IDs / counts only (e.g. scene line count, number of healed gap lines) — never script text (hard rule 5).

### 4.3 Spec wording delta (prompt-spec §7)

Replace the hard “else `VALIDATION` reject” for **gaps** with: gaps are filled server-side as `unassigned` (`coverage_gap`) and flagged; **overlaps and out-of-bounds still `VALIDATION`**.

Byte-identity reconstruction stays required.

## 5. Cost estimate (client)

### 5.1 Extend `importSourceStats`

`apps/web/src/projects/wizard/importSourceStats.ts` already mirrors slugline detection. Extend `ImportSourceStats` (or a sibling pure helper) with:

```ts
{
  // existing
  detectedSceneCount: number
  // new
  estimatedModelCalls: number  // 2 * N + 1 when N > 0, else 0
  estimatedCostUsd: { low: number; high: number } | null
}
```

When `detectedSceneCount === 0`, calls = 0 and cost = `null`.

### 5.2 Token / $ heuristic

Deterministic, documented, good enough for a range:

- Let `N = detectedSceneCount`, `C = 2N + 1`.
- Approximate total input tokens ≈ `(systemOverheadPerCall * C) + (sourceCharCount / charsPerToken) * 2`  
  (script body is sent roughly once for segment and once for extract; scan adds overhead via `systemOverheadPerCall`).
- Approximate total output tokens ≈ `avgOutputTokensPerCall * C`.
- `low` / `high` = apply classifier input/output $/MTok from config with a small band (e.g. high = low × 1.75, or separate high token multipliers). Clamp display to sensible cents.

Pin constants next to pricing config so tests assert the formula, not live Anthropic prices.

### 5.3 Pricing config

Add `config/llm_pricing.json` with classifier rates and heuristic constants (`charsPerToken`, `systemOverheadPerCall`, `avgOutputTokensPerCall`, `highMultiplier`). Web loads it via Vite import (or a thin `importCostEstimate.ts` that re-exports parsed values). No `PROMPT_VERSION` bump when rates change.

Initial rates (document as of 2026-07, classifier = Haiku 4.5):

- `inputUsdPerMTok`: 1.00  
- `outputUsdPerMTok`: 5.00  
- `highMultiplier`: 1.75

### 5.4 UI copy

**Review source** (extend existing stats block):

> {N} scene(s) detected · ~{C} model calls · Est. ${low}–${high}

> Estimate uses the classifier model; actual usage may vary. Create & analyze is the only step that spends model tokens.

**Analyze** step: repeat the one-line estimate above the stage list / near the primary button while `phase === 'idle'` (and keep it visible on failure so Retry is informed).

Use existing `--tr-*` tokens only; no new chrome colors.

### 5.5 Actual spend (deferred)

If Anthropic usage is already aggregated somewhere easy to attach to the import SSE `complete` / `failed` payload, include `usage: { inputTokens, outputTokens, estimatedUsd }` as a follow-up task. **Not required** to ship gap-heal + estimate preview.

## 6. Docs / build plan

- Prompt-spec §7: gap heal wording.
- UI spec Import wizard Review / Analyze: cost line.
- Test plan: gap heal unit tests; cost estimate pure-function tests; wizard shows the three figures.
- Build plan: one PR-sized task (or two: API gap heal, then web estimate) — prefer **one PR** if small.

## 7. Tests

| Case | Expect |
|---|---|
| Beat covers 1–33 of 34-line scene, no unassigned | Heal line 34 as `coverage_gap`; import path would not raise; beat scriptText includes line 34; unassigned flagged |
| Mid-scene single-line gap | Heal that line; contiguity after heal |
| Overlap | Still `CoverageError` |
| OOB | Still `CoverageError` |
| Empty claims | Still `CoverageError` |
| `analyzeSource` / cost helper: N=110 | calls=221; cost low/high finite and low ≤ high |
| Wizard Review source | Renders scene count, call count, and Est. $ range from fixture source |

## 8. Open follow-ups (explicitly deferred)

- SSE actual token usage on complete/failed  
- Server-side estimate endpoint for perfect parity with `split_into_scenes`  
- Soft retry of `segment_scene` before heal (optional; heal alone may be enough)
