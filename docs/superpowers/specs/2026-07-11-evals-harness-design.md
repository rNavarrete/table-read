# Evals harness redesign — design spec

**Date:** 2026-07-11  
**Status:** approved  
**Authority after merge:** this spec updates harness behavior in `apps/api/evals/` and the cost/run notes in `Makefile` + `docs/tableread-test-plan.md` §3. Gate thresholds, soft vs hard classification, and which families exist are unchanged unless a later task adds missing test-plan evals.

## 1. Goal

Make `make evals` usable for merge sign-off when `PROMPT_VERSION` bumps:

1. **Visible progress** — a long run never looks hung.
2. **Tiered defaults** — hard gates keep statistical weight; soft / high-N-waste families run cheaper.
3. **Per-call timeout** — one stuck Anthropic request fails that attempt; the suite continues.
4. **Checkpoint + resume (v1.1)** — killing a run does not throw away completed families.

Hard gates, exit-code semantics, MockLlmClient dry-run, rule-5 logging, and “never fabricate fallback LLM output” stay as today.

## 2. Locked decisions

| Decision                       | Choice                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------- |
| v1 scope                       | Progress + unbuffered stdout + tiered run map + per-call timeout              |
| v1.1 scope                     | Family-level checkpoint + `--resume` (same PR series or immediate follow-up)  |
| Parallelism                    | **Out of scope** — suite stays sequential                                     |
| Missing test-plan evals        | **Out of scope** (conflict reporting, voice, injection, etc.) — separate task |
| Gate thresholds / hard vs soft | **Unchanged**                                                                 |
| Uniform `--runs N`             | Still overrides **all** families (smoke / diagnosis)                          |
| Per-tier CLI flags             | Deferred (`--runs-hard` / `--runs-soft` not in v1)                            |
| Default timeout                | **120s** wall clock per `messages.create` (product + judge)                   |
| Mid-family resume              | **No** — incomplete family re-runs from scratch                               |

## 3. Non-goals

- Concurrent families or worker pools
- Changing lock / schema / continuity gates or soft→hard promotion
- Adding new eval families from test plan §3 gaps
- Streaming Anthropic responses for progress (attempt-level lines are enough)
- Committing checkpoint or report artifacts (remain under gitignored `evals/reports/`)

## 4. Tiered run map

When `--runs` is omitted, each family uses its tier default:

| Tier                | Families                                                               | Default N |
| ------------------- | ---------------------------------------------------------------------- | --------- |
| Hard                | `lock`, `continuity`                                                   | **20**    |
| Soft / high-N waste | `schema`, `segmentation`, `lock-repair`, `import-inference`, `subtext` | **5**     |

Rationale:

- Test plan §3 pins **20** for lock and continuity hard gates; keep that weight.
- Schema validity is `len(SCHEMA_PROBES) × N` (currently 8 probes) — the dominant cost at N=20.
- Segmentation and adoption soft families do not need N=20 for merge-grade signal.

`--runs N` sets every family’s N to N (preserves today’s cheap smoke: `--runs 1`).

### 4.1 Cost estimate (nominal, retry-free)

At tiered defaults (approximate; keep `nominal_call_estimate` as source of truth in code):

| Family           | Formula    | ~Calls   |
| ---------------- | ---------- | -------- |
| schema           | 8 × 5      | 40       |
| lock             | ≤ 4 × 20   | 80       |
| continuity       | 3 + 2 × 20 | 43       |
| segmentation     | 5          | 5        |
| lock-repair      | 5          | 5        |
| import-inference | 5          | 5        |
| subtext          | 5          | 5        |
| **totalNominal** |            | **~183** |

Was ~363 at uniform 20. Rule-9 retries can still add up to ~1.5× observed-worst.

Report header must show **per-family runs** (not a single `runs/eval=` integer that implies uniformity). `SuiteReport.runs` becomes a `dict[str, int]` using the same camelCase family keys as `estimatedCalls` (`schemaValidity`, `lockViolation`, …). Dry-run and self-tests update accordingly.

### 4.2 `nominal_call_estimate`

Signature changes to accept a per-family run map (or hard/soft ints). Makefile comment and any printed preflight estimate must match the new defaults (~180, not ~283/~363).

## 5. Progress

### 5.1 Buffering

`make evals` / `python -m evals.run` must flush progress promptly:

- Prefer `PYTHONUNBUFFERED=1` in the Makefile `evals` / `evals-dry` targets, and/or
- `print(..., flush=True)` on progress lines, and/or
- reopen stdout line-buffered at process start.

Any one of these is sufficient if verified under a pipe (`make evals | tee …`).

### 5.2 Line format

Emit rule-5-safe lines:

- Before each family: `progress family=<key> runs=<n> status=start`
- Before each attempt (and each schema probe within a run):  
  `progress family=<key> run=<i>/<n> [probe=<opName>] elapsed=<seconds>s`
- After each family: `progress family=<key> status=done score=<f> gate=<…>`

No script, plan, fact text, or prompt bodies. Op names, family keys, indices, scores, and elapsed seconds only.

Eval loops in `checks.py` / `adoption.py` take an optional progress callback (or shared logger) so dry-run self-tests can assert call counts without scraping stdout.

## 6. Timeouts

### 6.1 Where

Wrap every real Anthropic `messages.create` used by:

- product client (`AnthropicClient` / sanctioned factory path), and
- continuity judge (`ContinuityJudge` raw SDK calls).

Mock paths (`MockLlmClient`, `MockJudge`) do not apply a wall-clock timeout.

### 6.2 Behavior

- Default: **120 seconds** wall clock per call.
- On timeout: raise a harness-visible error for that attempt; the attempt counts toward the metric as failure / invalid (same treatment as other recoverable call failures for that eval — do **not** invent LLM output).
- Suite continues to remaining attempts and families.
- Log/print: `timeout=true op=<opName>` (and family/run index via progress) — no payloads.
- Optional later: CLI `--timeout-seconds`; not required in v1 if 120 is hardcoded with a named constant.

### 6.3 Interaction with rule 9

Timeouts are enforced around the HTTP/SDK call. Rule 9 (one schema-invalid retry) only applies after a response body fails validation. A timeout never enters that retry path: one timeout = that attempt failed (no automatic second 120s wait). Schema-invalid retries after a completed HTTP response remain unchanged.

## 7. Checkpoint + resume (v1.1)

### 7.1 Write path

After each family finishes (PASS/WARN/FAIL/ERROR), append/update a checkpoint file under the reports directory (already gitignored), e.g.:

`apps/api/evals/reports/checkpoint-<iso-or-run-id>.json`

Contents (rule-5-safe):

- `promptVersion`, pinned `models`, `dryRun`, per-family `runs` map
- completed `results[]` (`EvalResult`-compatible)
- `estimatedCalls` for the planned map

### 7.2 Resume

`--resume PATH`:

1. Load checkpoint.
2. Refuse unless `promptVersion`, `models`, `dryRun`, and per-family run map match the current process plan.
3. Skip families already present in `results`.
4. Run remaining families; rewrite checkpoint after each.
5. Write the normal final JSON + Markdown report as today.

Incomplete family: not stored; re-runs from scratch.

v1 may ship without `--resume` if v1.1 follows immediately; progress + tiered + timeout must not depend on checkpoint.

## 8. CLI / Makefile surface

| Flag / target                            | Behavior                                                          |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `make evals`                             | Real suite, tiered defaults, unbuffered progress                  |
| `make evals-dry`                         | Mock suite, same progress/run-map paths                           |
| `--runs N`                               | All families use N                                                |
| `--only <family>`                        | Unchanged; that family uses its tier default (or `--runs` if set) |
| `--resume PATH`                          | v1.1                                                              |
| `--capture`, `--calibrate-only`, `--out` | Unchanged                                                         |

## 9. Docs touchpoints

- `docs/tableread-test-plan.md` §3: note that the harness defaults to tiered N (hard 20 / soft+schema 5); gates and family definitions unchanged. Point at this spec or the Makefile comment for cost.
- `Makefile` `evals` comment: replace stale ~283/~360 figures with tiered estimate.
- No contract / Zod / prompt-spec changes (harness-only).

## 10. Testing (PR path — no real API)

- Dry-run suite still exits 0 on mocks with tiered or `--runs 1`.
- Unit tests: run-map selection (`--runs` override vs defaults); `nominal_call_estimate` with mixed N; progress callback invoked per attempt; timeout classified as attempt failure without fabricated output (mock clock / fake client that blocks).
- Checkpoint tests (v1.1): skip completed family; refuse mismatched PROMPT_VERSION / models / run map.
- Existing eval self-tests updated for `SuiteReport` runs shape.

## 11. Rollout

1. **v1 PR:** tiered map + progress + timeout + doc/Makefile estimate sync.
2. **v1.1 PR (or stacked):** checkpoint + `--resume`.
3. Operator then runs real `make evals` for any pending PROMPT_VERSION sign-off (costs money — only when asked).

## 12. Success criteria

- Piped `make evals-dry` shows family/attempt progress lines before the final summary.
- Default (no `--runs`) uses 20 for lock/continuity and 5 for the other five families; estimate ≈180 nominal.
- A simulated hung call fails within ~120s and the suite proceeds.
- (v1.1) Kill after family 2; `--resume` completes families 3+ without re-calling 1–2 when pins match.
