# Import coverage heal + cost estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Heal uncovered import beat-line gaps as `coverage_gap` unassigned ranges (instead of aborting), and show scene count · estimated model calls · estimated $ range before Create & analyze.

**Architecture:** Server change is localized to `validate_and_slice` in `fountain/parse.py`: insert synthetic `SegmentedSceneUnassigned(reason="coverage_gap")` for gaps, then reuse existing `_merge` / flag path. Client extends `importSourceStats` with a pure cost helper fed by `config/llm_pricing.json` (Vite-importable) and surfaces the three figures on Review source + Analyze.

**Tech Stack:** Python 3.12 / pytest (API); React 18 + Vitest + Vite (web); existing wizard + Fountain parse tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-import-coverage-cost-design.md`
- Gaps heal; overlaps / OOB / empty claims still `CoverageError` → `VALIDATION`
- Synthetic unassigned reason code is exactly `coverage_gap`
- Cost preview shows all three: scenes · ~calls · Est. $low–$high
- Call formula: `2N + 1` when `N > 0`, else `0`
- Classifier rates from `config/llm_pricing.json` (no `PROMPT_VERSION` bump)
- No writer text in logs; `--tr-*` tokens only in UI
- No Zod/Pydantic schema change in this plan
- Commit style: `area: imperative summary`

---

## File map

| File | Role |
|---|---|
| `apps/api/fountain/parse.py` | Gap heal in `validate_and_slice` |
| `apps/api/tests/test_fountain_parse.py` | Gap heal / overlap / OOB tests |
| `config/llm_pricing.json` | Classifier $/MTok + heuristic constants |
| `apps/web/vite.config.ts` | Allow/import repo `config/` JSON |
| `apps/web/src/projects/wizard/importCostEstimate.ts` | Pure call + $ estimate |
| `apps/web/src/projects/wizard/importCostEstimate.test.ts` | Formula tests |
| `apps/web/src/projects/wizard/importSourceStats.ts` | Attach estimate fields to stats |
| `apps/web/src/projects/wizard/importSourceStats.test.ts` | Updated expectations |
| `apps/web/src/projects/wizard/ImportWizard.tsx` | Review + Analyze copy |
| `apps/web/src/projects/wizard/ImportWizard.test.tsx` | Assert cost line renders |
| `docs/tableread-prompt-spec.md` | §7 gap wording |
| `docs/tableread-ui-spec.md` | Review / Analyze cost line |
| `docs/tableread-test-plan.md` | Gaps heal; overlaps still reject |
| `docs/tableread-build-plan.md` | Tracking task / T1.3 accept tweak |

---

### Task 1: Heal coverage gaps in `validate_and_slice`

**Files:**
- Modify: `apps/api/fountain/parse.py`
- Modify: `apps/api/tests/test_fountain_parse.py`
- Modify: `docs/tableread-prompt-spec.md` (gap sentence only — can land in Task 3 if preferred; include here so API behavior matches docs in same commit)

**Interfaces:**
- Consumes: existing `validate_and_slice(scene, segmented)`, `SegmentedSceneUnassigned`, `_merge`
- Produces: gap lines become unassigned with `reason="coverage_gap"`; overlaps/OOB/empty still raise `CoverageError`

- [ ] **Step 1: Rewrite the gap test to expect heal; add mid-gap + keep overlap/OOB**

In `apps/api/tests/test_fountain_parse.py`, replace `test_gap_rejected` and `test_trailing_end_gap_rejected` with heal assertions, and add a mid-scene gap case:

```python
def test_trailing_gap_healed_as_coverage_gap_unassigned():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")  # 3 lines
    seg = _seg([(1, 2, "a", "b", "c")])  # line 3 uncovered
    beats = validate_and_slice(scene, seg)
    assert len(beats) == 1
    assert beats[0].script_text == "INT. BAR - NIGHT\nDan pours.\nMarta enters."
    assert beats[0].unassigned == [(3, 3)]


def test_mid_scene_gap_healed():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.\nReyes waits.")  # 4
    seg = _seg([(1, 1, "a", "b", "c"), (3, 4, "d", "e", "f")])  # line 2 gap
    beats = validate_and_slice(scene, seg)
    assert [b.script_text for b in beats] == [
        "INT. BAR - NIGHT\nDan pours.",
        "Marta enters.\nReyes waits.",
    ]
    assert beats[0].unassigned == [(2, 2)]


def test_overlap_rejected():
    scene = _scene("INT. BAR - NIGHT\nDan pours.\nMarta enters.")
    seg = _seg([(1, 2, "a", "b", "c"), (2, 3, "d", "e", "f")])
    with pytest.raises(CoverageError, match="overlap"):
        validate_and_slice(scene, seg)


def test_out_of_bounds_rejected():
    scene = _scene("INT. BAR - NIGHT\nDan pours.")
    seg = _seg([(1, 5, "a", "b", "c")])
    with pytest.raises(CoverageError, match="out of bounds"):
        validate_and_slice(scene, seg)
```

Keep `test_empty_segmentation_rejected` unchanged. Remove the old `test_gap_rejected` that expected `CoverageError` for gaps (or rename as above).

- [ ] **Step 2: Run tests — expect FAIL on heal cases**

Run: `cd apps/api && .venv/bin/pytest tests/test_fountain_parse.py::test_trailing_gap_healed_as_coverage_gap_unassigned tests/test_fountain_parse.py::test_mid_scene_gap_healed -q --tb=short`

Expected: FAIL with `CoverageError: gap: ...`

- [ ] **Step 3: Implement gap heal in `validate_and_slice`**

Replace the contiguity loop in `apps/api/fountain/parse.py` so gaps insert synthetic unassigned claims. Import `SegmentedSceneUnassigned` from `schemas`.

```python
from schemas import SegmentedScene, SegmentedSceneUnassigned
```

Update the docstring: gaps are healed as `coverage_gap`; overlaps / OOB / empty still raise.

```python
    claims.sort(key=lambda c: (c[0], c[1]))

    healed: list[Claim] = []
    cursor = 1
    for start, end, is_beat, payload in claims:
        if start < 1 or end < start or end > k:
            raise CoverageError(
                f"range {start}-{end} is out of bounds for a {k}-line scene"
            )
        if start < cursor:
            raise CoverageError(f"overlap at line {start} (expected {cursor})")
        if start > cursor:
            gap = SegmentedSceneUnassigned(
                start_line=cursor,
                end_line=start - 1,
                reason="coverage_gap",
            )
            healed.append((cursor, start - 1, False, gap))
        healed.append((start, end, is_beat, payload))
        cursor = end + 1
    if cursor <= k:
        gap = SegmentedSceneUnassigned(
            start_line=cursor,
            end_line=k,
            reason="coverage_gap",
        )
        healed.append((cursor, k, False, gap))

    return _merge(scene, healed)
```

Also update the module header / `CoverageError` docstring so they no longer say gaps always reject.

- [ ] **Step 4: Run fountain parse tests**

Run: `cd apps/api && .venv/bin/pytest tests/test_fountain_parse.py -q --tb=short`

Expected: PASS (all green)

- [ ] **Step 5: Update prompt-spec §7 one sentence**

In `docs/tableread-prompt-spec.md`, change the Server rules sentence from hard-rejecting gaps to:

> Server rules: `scriptText` is **sliced from the source by line range, never transcribed by the model** — beats + `unassigned` must be ordered and non-overlapping within `1..K`; **gaps are filled server-side as `unassigned` with reason `coverage_gap` and flagged for review**; overlaps / out-of-bounds / empty coverage still `VALIDATION` reject. `unassigned` ranges (model or healed) attach to the nearest beat's scriptText so no source text is ever dropped — five missing percent could be the twist.

- [ ] **Step 6: Commit**

```bash
git add apps/api/fountain/parse.py apps/api/tests/test_fountain_parse.py docs/tableread-prompt-spec.md
git commit -m "$(cat <<'EOF'
import: heal beat coverage gaps as coverage_gap unassigned

EOF
)"
```

---

### Task 2: Pricing config + client cost estimate helper

**Files:**
- Create: `config/llm_pricing.json`
- Create: `apps/web/src/projects/wizard/importCostEstimate.ts`
- Create: `apps/web/src/projects/wizard/importCostEstimate.test.ts`
- Modify: `apps/web/vite.config.ts` (fs allow + alias for repo `config/`)
- Modify: `apps/web/src/projects/wizard/importSourceStats.ts`
- Modify: `apps/web/src/projects/wizard/importSourceStats.test.ts`

**Interfaces:**
- Consumes: `detectedSceneCount`, `charCount` from `analyzeSource`
- Produces:
  - `estimateImportCost({ sceneCount, charCount }) → { estimatedModelCalls, estimatedCostUsd: { low, high } | null }`
  - `analyzeSource` also returns `estimatedModelCalls` and `estimatedCostUsd`

- [ ] **Step 1: Add `config/llm_pricing.json`**

```json
{
  "asOf": "2026-07",
  "classifier": {
    "modelIdNote": "claude-haiku-4-5 via config/models.toml classifier role",
    "inputUsdPerMTok": 1.0,
    "outputUsdPerMTok": 5.0
  },
  "importHeuristic": {
    "charsPerToken": 4,
    "systemOverheadTokensPerCall": 1500,
    "avgOutputTokensPerCall": 400,
    "highMultiplier": 1.75
  }
}
```

- [ ] **Step 2: Wire Vite to resolve repo config**

In `apps/web/vite.config.ts`:

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export default defineConfig({
  // ...existing plugins/server/test
  resolve: {
    alias: {
      '@repo-config': path.join(rootDir, 'config'),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
    fs: { allow: [rootDir] },
  },
})
```

Keep existing `test.exclude` block.

- [ ] **Step 3: Write failing cost-estimate tests**

Create `apps/web/src/projects/wizard/importCostEstimate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { estimateImportCost } from './importCostEstimate'

describe('estimateImportCost', () => {
  it('returns zeros/null for zero scenes', () => {
    expect(estimateImportCost({ sceneCount: 0, charCount: 100 })).toEqual({
      estimatedModelCalls: 0,
      estimatedCostUsd: null,
    })
  })

  it('uses 2N+1 calls for N scenes', () => {
    const r = estimateImportCost({ sceneCount: 110, charCount: 175_000 })
    expect(r.estimatedModelCalls).toBe(221)
    expect(r.estimatedCostUsd).not.toBeNull()
    expect(r.estimatedCostUsd!.low).toBeGreaterThan(0)
    expect(r.estimatedCostUsd!.high).toBeGreaterThanOrEqual(r.estimatedCostUsd!.low)
  })
})
```

- [ ] **Step 4: Run test — expect FAIL**

Run: `cd apps/web && npx vitest run src/projects/wizard/importCostEstimate.test.ts`

Expected: FAIL — module not found / export missing

- [ ] **Step 5: Implement `importCostEstimate.ts`**

```ts
import pricing from '@repo-config/llm_pricing.json'

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
```

If TS complains about JSON module, add `resolveJsonModule` check (already on in most Vite TS configs) or a `src/vite-env.d.ts` `declare module '@repo-config/*.json'`.

- [ ] **Step 6: Extend `analyzeSource` to attach estimates**

In `importSourceStats.ts`:

```ts
import { estimateImportCost } from './importCostEstimate'

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
  const charCount = source.length
  const cost = estimateImportCost({
    sceneCount: detectedSceneCount,
    charCount,
  })
  return {
    charCount,
    byteCount: new TextEncoder().encode(source).length,
    lineCount: lines.length,
    detectedSceneCount,
    estimatedModelCalls: cost.estimatedModelCalls,
    estimatedCostUsd: cost.estimatedCostUsd,
  }
}
```

Update `importSourceStats.test.ts` empty-source expectation to include `estimatedModelCalls: 0` and `estimatedCostUsd: null`. Add one assertion that a 2-scene source yields `estimatedModelCalls === 5`.

- [ ] **Step 7: Run web unit tests for these modules**

Run: `cd apps/web && npx vitest run src/projects/wizard/importCostEstimate.test.ts src/projects/wizard/importSourceStats.test.ts`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add config/llm_pricing.json apps/web/vite.config.ts \
  apps/web/src/projects/wizard/importCostEstimate.ts \
  apps/web/src/projects/wizard/importCostEstimate.test.ts \
  apps/web/src/projects/wizard/importSourceStats.ts \
  apps/web/src/projects/wizard/importSourceStats.test.ts
git commit -m "$(cat <<'EOF'
web: estimate import model calls and dollar range

EOF
)"
```

---

### Task 3: Wizard UI + docs

**Files:**
- Modify: `apps/web/src/projects/wizard/ImportWizard.tsx`
- Modify: `apps/web/src/projects/wizard/ImportWizard.test.tsx`
- Modify: `docs/tableread-ui-spec.md`
- Modify: `docs/tableread-test-plan.md`
- Modify: `docs/tableread-build-plan.md`

**Interfaces:**
- Consumes: `stats.detectedSceneCount`, `stats.estimatedModelCalls`, `stats.estimatedCostUsd` from Task 2
- Produces: Review source + Analyze idle/failed show the estimate line

- [ ] **Step 1: Add a tiny formatter helper in the wizard (or next to cost estimate)**

In `importCostEstimate.ts` add:

```ts
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
```

Add a unit test for the formatter string shape.

- [ ] **Step 2: Failing wizard test for the cost line**

In `ImportWizard.test.tsx`, on the Review source step (navigate with a multi-slugline paste), assert the document matches `/model calls/` and `/Est\. \$/`.

- [ ] **Step 3: Run wizard test — expect FAIL**

Run: `cd apps/web && npx vitest run src/projects/wizard/ImportWizard.test.tsx -t 'cost'`  
(or the specific test name you added)

Expected: FAIL — text not found

- [ ] **Step 4: Render the line on Review source and Analyze**

Review source body — replace the lone scene-count paragraph with:

```tsx
<p>{formatImportCostLine(stats)}</p>
<p>
  Estimate uses the classifier model; actual usage may vary. Create &amp;
  analyze script is the only action that sends this source to the model.
  Scenes, beats, pending Ledger facts, and consistency flags appear here
  only after that step.
</p>
```

(Merge with existing trust note — avoid duplicating “Create & analyze” twice; one combined paragraph is fine.)

Analyze body — above the stage `<ol>`, when showing estimate is useful (`session.phase === 'idle' || session.phase === 'failed'`):

```tsx
{(session.phase === 'idle' || session.phase === 'failed') &&
  stats.estimatedModelCalls > 0 && (
    <p>{formatImportCostLine(stats)}</p>
  )}
```

- [ ] **Step 5: Run wizard + cost tests**

Run: `cd apps/web && npx vitest run src/projects/wizard/ImportWizard.test.tsx src/projects/wizard/importCostEstimate.test.ts src/projects/wizard/importSourceStats.test.ts`

Expected: PASS

- [ ] **Step 6: Update product docs**

`docs/tableread-ui-spec.md` — Review source / Analyze: mention scene count · ~calls · Est. $ range and classifier estimate disclaimer.

`docs/tableread-test-plan.md` — change Fountain round-trip bullet: overlaps still `VALIDATION`; **gaps heal as `coverage_gap` unassigned** (byte-identity still required).

`docs/tableread-build-plan.md` — under M7 (after T7.8) add:

```markdown
**T7.9 Import coverage heal + cost estimate.** Server fills beat-line gaps as `coverage_gap` unassigned; Review/Analyze show scene count, ~2N+1 calls, and Est. $ range from `config/llm_pricing.json`.
*Accept:* trailing/mid gaps no longer abort import; overlaps still `VALIDATION`; wizard shows the three estimate figures before Create & analyze.
```

Also soften T1.3 accept text that says gapped ranges reject — point to T7.9 (gaps heal; overlaps reject).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/projects/wizard/ImportWizard.tsx \
  apps/web/src/projects/wizard/ImportWizard.test.tsx \
  apps/web/src/projects/wizard/importCostEstimate.ts \
  apps/web/src/projects/wizard/importCostEstimate.test.ts \
  docs/tableread-ui-spec.md docs/tableread-test-plan.md docs/tableread-build-plan.md
git commit -m "$(cat <<'EOF'
web: show import call and cost estimate in wizard

EOF
)"
```

---

### Task 4: Verification

**Files:** none new

- [ ] **Step 1: API parse suite**

Run: `cd apps/api && .venv/bin/pytest tests/test_fountain_parse.py -q`

Expected: PASS

- [ ] **Step 2: Web wizard/stats suite**

Run: `cd apps/web && npx vitest run src/projects/wizard/`

Expected: PASS

- [ ] **Step 3: Manual smoke (optional if user has key)**

Retry `Number_Two.pdf` import: first scene trailing `CUT TO:` should no longer abort; Review source should show ~110 scenes · ~221 calls · Est. $ range.

- [ ] **Step 4: Final commit only if docs/verification leftovers**

No empty commit.

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| Gap heal as `coverage_gap` | Task 1 |
| Overlap / OOB / empty still fail | Task 1 |
| Prompt-spec §7 wording | Task 1 |
| `2N+1` calls + $ range | Task 2 |
| `config/llm_pricing.json` | Task 2 |
| Review + Analyze UI | Task 3 |
| UI / test / build plan docs | Task 3 |
| Actual SSE usage | Deferred (spec §8) |

## Placeholder scan

No TBD / “implement later” steps; formulas and file paths are concrete.
