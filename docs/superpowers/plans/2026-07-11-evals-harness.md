# Evals Harness Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `make evals` merge-usable: tiered run defaults (~half cost), live progress under pipes, per-call 120s timeouts, then family-level checkpoint/resume.

**Architecture:** Keep the sequential suite. Resolve a per-family `runs` map in `evals/suite.py`, thread optional progress callbacks through checks/adoption, wrap Anthropic `messages.create` (product + judge) with a wall-clock timeout that raises `LlmTimeoutError` (no fabricated output, no rule-9 retry). v1.1 adds checkpoint JSON under gitignored reports + `--resume`.

**Tech Stack:** Python 3.12, pytest, FastAPI evals package (`apps/api/evals/`), `AnthropicClient`, Makefile. Spec: `docs/superpowers/specs/2026-07-11-evals-harness-design.md`.

## Global Constraints

- Never call Anthropic in tests — `MockLlmClient` / fake SDK only.
- No writer text in logs/progress/reports (rule 5): ids, op names, counts, scores, elapsed only.
- Timeout ≠ schema-invalid retry: one timeout = attempt failed; no second 120s wait.
- Gate thresholds and hard/soft classification unchanged.
- `--runs N` still overrides all families; no `--runs-hard` / `--runs-soft` in this plan.
- Do not run real `make evals` unless the user explicitly asks (costs money).
- Commit style: `area: imperative summary` (e.g. `evals: tier hard 20 soft 5 defaults`).

---

## File map

| Area | Files |
|---|---|
| Run map + estimate | `apps/api/evals/suite.py`, `apps/api/evals/run.py` |
| Report shape | `apps/api/evals/harness.py` |
| Progress | new `apps/api/evals/progress.py`; wire `checks.py`, `adoption.py`, `suite.py`, `run.py` |
| Timeout | `apps/api/llm/errors.py`, `apps/api/llm/anthropic_client.py`, `apps/api/evals/graders.py`; catch in `checks.py` / `adoption.py` |
| Checkpoint (v1.1) | new `apps/api/evals/checkpoint.py`; `suite.py`, `run.py` |
| Docs | `Makefile`, `docs/tableread-test-plan.md` §3 |
| Tests | `apps/api/tests/test_evals_checks.py`, `test_evals_harness.py`, new `test_evals_progress.py`, `test_llm_timeout.py`, `test_evals_checkpoint.py` |

---

### Task 1: Tiered run map + `SuiteReport.runs` dict

**Files:**
- Modify: `apps/api/evals/suite.py`
- Modify: `apps/api/evals/harness.py` (`SuiteReport.runs: dict[str, int]`, markdown/JSON)
- Modify: `apps/api/evals/run.py` (resolve map; print per-family runs)
- Modify: `apps/api/tests/test_evals_checks.py`, `apps/api/tests/test_evals_harness.py`
- Modify: `Makefile` evals cost comment (tiered ~183)

**Interfaces:**
- Produces:
  - `HARD_RUNS = 20`, `SOFT_RUNS = 5`
  - `HARD_FAMILY_KEYS = frozenset({"lockViolation", "continuityAdherence"})`
  - `def default_run_map() -> dict[str, int]` — every `EVAL_KEYS` value → hard or soft N
  - `def resolve_run_map(override: int | None) -> dict[str, int]` — `None` → defaults; `int` → uniform
  - `def nominal_call_estimate(runs: dict[str, int]) -> dict` — per-family formula using that family’s N
  - `run_suite(..., runs: dict[str, int], ...)` — pass `runs[EVAL_KEYS[key]]` into each eval
  - `SuiteReport.runs: dict[str, int]` — camelCase keys aligned with `estimatedCalls`

- [ ] **Step 1: Write failing tests for defaults and estimate**

In `test_evals_checks.py`, replace `test_nominal_call_estimate_matches_reviewer_numbers` with:

```python
def test_default_run_map_tiers_hard_and_soft():
    from evals.suite import HARD_RUNS, SOFT_RUNS, default_run_map

    m = default_run_map()
    assert m["lockViolation"] == HARD_RUNS == 20
    assert m["continuityAdherence"] == 20
    assert m["schemaValidity"] == SOFT_RUNS == 5
    assert m["segmentationDeterminism"] == 5
    assert m["lockRepairQuality"] == 5
    assert m["importInference"] == 5
    assert m["subtextFidelity"] == 5


def test_resolve_run_map_override_is_uniform():
    from evals.suite import resolve_run_map

    m = resolve_run_map(1)
    assert set(m.values()) == {1}
    assert len(m) == 7


def test_nominal_call_estimate_tiered_defaults():
    from evals.suite import default_run_map, nominal_call_estimate

    full = nominal_call_estimate(default_run_map())
    assert full["schemaValidity"] == 40  # 8 probes × 5
    assert full["lockViolation"] == 80
    assert full["continuityAdherence"] == 43
    assert full["segmentationDeterminism"] == 5
    assert full["lockRepairQuality"] == 5
    assert full["importInference"] == 5
    assert full["subtextFidelity"] == 5
    assert full["totalNominal"] == 183


def test_nominal_call_estimate_uniform_one():
    from evals.suite import nominal_call_estimate, resolve_run_map

    assert 18 <= nominal_call_estimate(resolve_run_map(1))["totalNominal"] <= 25
```

Update `test_evals_harness.py` `_report` to pass `runs={"schemaValidity": 20, ...}` (any complete map or minimal dict used in that test’s assertions). Update any assertion on `runs/eval: 20` to expect a dict rendering.

Update `test_run_suite_dry_run_end_to_end_and_rule5_clean` / `test_run_suite_report_carries_call_estimate` to pass `runs=resolve_run_map(2)` (or keep `runs=2` only if you add a thin overload — prefer always passing a dict from tests via `resolve_run_map(2)`).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/api && .venv/bin/pytest tests/test_evals_checks.py -k "run_map or nominal_call" -v
```

Expected: import/attribute errors for `default_run_map` / new estimate signature.

- [ ] **Step 3: Implement run map + estimate + `run_suite` wiring**

In `suite.py`:

```python
HARD_RUNS = 20
SOFT_RUNS = 5
HARD_FAMILY_KEYS = frozenset({"lockViolation", "continuityAdherence"})

def default_run_map() -> dict[str, int]:
    return {
        family: HARD_RUNS if family in HARD_FAMILY_KEYS else SOFT_RUNS
        for family in EVAL_KEYS.values()
    }

def resolve_run_map(override: int | None) -> dict[str, int]:
    if override is None:
        return default_run_map()
    return {family: override for family in EVAL_KEYS.values()}

def nominal_call_estimate(runs: dict[str, int]) -> dict:
    schema = len(probes.SCHEMA_PROBES) * runs["schemaValidity"]
    lock = 4 * runs["lockViolation"]
    continuity = 3 + 2 * runs["continuityAdherence"]
    # … same formulas for remaining keys using runs[key]
```

`run_suite(..., runs: dict[str, int], ...)`: for each family, `n = runs[EVAL_KEYS[key]]` and pass `runs=n` into the eval. Build `estimated_calls` from full map; if `only`, filter estimate as today.

`SuiteReport`: `runs: dict[str, int]`; `to_dict` keeps key `runsPerEval` but value is the dict; markdown line like:

`- runs/eval: schemaValidity 5, lockViolation 20, …`

`run.py`: `runs = resolve_run_map(args.runs)` before `run_suite`; print map not a single int.

Makefile comment: replace ~283/~360 with tiered ~183 nominal (schema 40, lock 80, continuity 43, soft families 5 each).

- [ ] **Step 4: Run focused tests — expect PASS**

```bash
cd apps/api && .venv/bin/pytest tests/test_evals_checks.py tests/test_evals_harness.py -v
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/evals/suite.py apps/api/evals/harness.py apps/api/evals/run.py \
  apps/api/tests/test_evals_checks.py apps/api/tests/test_evals_harness.py Makefile
git commit -m "$(cat <<'EOF'
evals: tier hard 20 / soft 5 run defaults

EOF
)"
```

---

### Task 2: Progress lines + unbuffered Makefile

**Files:**
- Create: `apps/api/evals/progress.py`
- Modify: `apps/api/evals/checks.py`, `apps/api/evals/adoption.py`, `apps/api/evals/suite.py`, `apps/api/evals/run.py`
- Create: `apps/api/tests/test_evals_progress.py`
- Modify: `Makefile` (`PYTHONUNBUFFERED=1` on `evals` / `evals-dry`)

**Interfaces:**
- Produces:
  - `ProgressFn = Callable[..., None]` — kwargs-only events
  - `def make_stdout_progress() -> ProgressFn` — prints + `flush=True`
  - Line shapes (verbatim keys):  
    `progress family=<short> runs=<n> status=start`  
    `progress family=<short> run=<i>/<n> [probe=<op>] elapsed=<s>s`  
    `progress family=<short> status=done score=<f> gate=<g|none>`
  - Eval signatures gain `on_progress: ProgressFn | None = None`
  - Short family keys = CLI keys (`schema`, `lock`, …)

- [ ] **Step 1: Write failing progress unit test**

```python
# apps/api/tests/test_evals_progress.py
from evals.progress import format_progress_line

def test_format_progress_attempt_and_probe():
    assert format_progress_line(family="schema", run=2, runs=5, probe="tune_beat", elapsed=1.25) == (
        "progress family=schema run=2/5 probe=tune_beat elapsed=1.3s"
    )  # one decimal is fine; lock the chosen format in implementation

def test_schema_eval_invokes_progress_per_probe_attempt(session_factory unused):
    from evals import checks, probes
    from evals.probes import load_fixture_ctx
    from llm.mock import MockLlmClient

    events = []
    def on_progress(**kw):
        events.append(kw)

    checks.schema_validity_eval(
        MockLlmClient(), load_fixture_ctx(), runs=1, on_progress=on_progress
    )
    probes_seen = [e.get("probe") for e in events if e.get("probe")]
    assert set(probes_seen) == set(probes.SCHEMA_PROBES)
```

(Adjust `format_progress_line` API if you prefer pure kwargs → string inside `make_stdout_progress` only; then test by capturing a list callback from `schema_validity_eval` as above — **callback invocation is the required contract**.)

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && .venv/bin/pytest tests/test_evals_progress.py -v
```

- [ ] **Step 3: Implement `progress.py` and wire evals + suite**

```python
# evals/progress.py
from __future__ import annotations
import sys
import time
from collections.abc import Callable
from typing import Any

ProgressFn = Callable[..., None]

def make_stdout_progress(clock=time.monotonic) -> ProgressFn:
    started = clock()
    def on_progress(**kw: Any) -> None:
        parts = ["progress"]
        for key in ("family", "runs", "run", "probe", "status", "score", "gate", "elapsed"):
            if key not in kw:
                continue
            val = kw[key]
            if key == "run" and "runs" in kw:
                parts.append(f"run={val}/{kw['runs']}")
                continue
            if key == "runs" and "run" in kw:
                continue  # already emitted as run=i/n
            if key == "elapsed":
                parts.append(f"elapsed={float(val):.1f}s")
                continue
            parts.append(f"{key}={val}")
        # Prefer computing elapsed in caller; if absent and status soft, optional
        print(" ".join(parts), flush=True)
    return on_progress
```

Prefer **callers** pass `elapsed=clock()-t0` each attempt. Suite emits `status=start` / `status=done` around each family; checks/adoption emit per-attempt (schema: include `probe=`).

`run_suite(..., on_progress: ProgressFn | None = None)`.  
`run.py`: `on_progress = make_stdout_progress()` always (dry-run and real).

Makefile:

```makefile
evals: $(VENV_BIN)/activate
	cd $(API_DIR) && PYTHONUNBUFFERED=1 $(VENV_BIN)/python -m evals.run

evals-dry: $(VENV_BIN)/activate
	cd $(API_DIR) && PYTHONUNBUFFERED=1 $(VENV_BIN)/python -m evals.run --dry-run
```

- [ ] **Step 4: Run progress + dry-run suite tests**

```bash
cd apps/api && .venv/bin/pytest tests/test_evals_progress.py tests/test_evals_checks.py::test_run_suite_dry_run_end_to_end_and_rule5_clean -v
```

Optional smoke (no API key needed):

```bash
make evals-dry 2>&1 | head -20
```

Expected: `progress family=` lines before final summary.

- [ ] **Step 5: Commit**

```bash
git add apps/api/evals/progress.py apps/api/evals/checks.py apps/api/evals/adoption.py \
  apps/api/evals/suite.py apps/api/evals/run.py apps/api/tests/test_evals_progress.py Makefile
git commit -m "$(cat <<'EOF'
evals: emit flushed per-attempt progress lines

EOF
)"
```

---

### Task 3: Per-call 120s timeout

**Files:**
- Modify: `apps/api/llm/errors.py` — add `LlmTimeoutError`
- Modify: `apps/api/llm/anthropic_client.py` — wrap `messages.create` (non-stream + stream entry if it also calls create)
- Modify: `apps/api/evals/graders.py` — same wrap in `ContinuityJudge.grade`
- Modify: `apps/api/evals/checks.py`, `apps/api/evals/adoption.py` — catch `LlmTimeoutError` like `SchemaInvalidLlmError` (attempt failure; no fabricated output)
- Create: `apps/api/tests/test_llm_timeout.py`
- Modify existing anthropic client tests if constructor gains `call_timeout_seconds`

**Interfaces:**
- Produces:
  - `DEFAULT_LLM_CALL_TIMEOUT_SECONDS = 120`
  - `class LlmTimeoutError(Exception):` with `.op: str` (op name or `"continuity_judge"`)
  - `AnthropicClient(..., call_timeout_seconds: float = DEFAULT_LLM_CALL_TIMEOUT_SECONDS)`
  - `ContinuityJudge(..., call_timeout_seconds: float = DEFAULT_LLM_CALL_TIMEOUT_SECONDS)`
  - Helper e.g. `_create_with_timeout(sdk, timeout, op, **kwargs)` using `concurrent.futures.ThreadPoolExecutor` + `future.result(timeout=…)` → on `TimeoutError` / `FuturesTimeout`, cancel if possible, raise `LlmTimeoutError(op)`
  - Timeout must **not** invoke `_retry_once`

- [ ] **Step 1: Write failing timeout test**

```python
# apps/api/tests/test_llm_timeout.py
import time
from llm.anthropic_client import AnthropicClient, DEFAULT_LLM_CALL_TIMEOUT_SECONDS
from llm.errors import LlmTimeoutError

class _HangSdk:
    def __init__(self):
        self.messages = self
    def create(self, **kwargs):
        time.sleep(5)
        raise AssertionError("should not complete")

def test_anthropic_client_times_out_hung_create():
    client = AnthropicClient(
        _HangSdk(),
        {"writer": "m", "classifier": "m"},
        call_timeout_seconds=0.2,
    )
    # Use any public op with minimal valid-enough kwargs for the client path;
    # if builders are heavy, call a thin internal `_create_with_timeout` test
    # exported for testing, or invoke generate_beat_candidates with dummy strings.
    t0 = time.monotonic()
    try:
        client.generate_beat_candidates(
            system="s", user_message="u", prompt_version="0.0.0-test"
        )
        assert False, "expected LlmTimeoutError"
    except LlmTimeoutError as e:
        assert e.op == "generate_beat_candidates"
    assert time.monotonic() - t0 < 2.0
    assert DEFAULT_LLM_CALL_TIMEOUT_SECONDS == 120
```

Also add: timeout is treated as invalid in schema eval (score drops / valid count not incremented) when a fake client raises `LlmTimeoutError` — can be a small mock `LlmClient` in the same file.

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && .venv/bin/pytest tests/test_llm_timeout.py -v
```

- [ ] **Step 3: Implement timeout wrapper + catch sites**

```python
# llm/errors.py
class LlmTimeoutError(Exception):
    """Wall-clock timeout waiting for messages.create. Not retried as rule-9."""
    def __init__(self, op: str) -> None:
        self.op = op
        super().__init__(f"{op}: LLM call timed out")
```

In `anthropic_client.py`, replace bare `self._sdk.messages.create(**kwargs)` (initial + retry) with timed helper. On timeout during the **first** call: raise `LlmTimeoutError` immediately (do not enter `_retry_once`). On timeout during rule-9 retry after a completed first response: raise `LlmTimeoutError` (attempt failed).

Print/log rule-5-safe: existing logger fields + `timeout=true` / or rely on eval progress; do not log payloads.

`ContinuityJudge.grade`: same helper; on timeout raise `LlmTimeoutError("continuity_judge")` (or `GraderError` subclass — prefer `LlmTimeoutError` so continuity_eval can catch one type). Update `continuity_eval` to treat timeout like schema-invalid for that run.

Every `except SchemaInvalidLlmError:` in checks/adoption → `except (SchemaInvalidLlmError, LlmTimeoutError):`.

- [ ] **Step 4: Run timeout + eval tests**

```bash
cd apps/api && .venv/bin/pytest tests/test_llm_timeout.py tests/test_evals_checks.py tests/test_llm_anthropic_client.py -v
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/llm/errors.py apps/api/llm/anthropic_client.py apps/api/evals/graders.py \
  apps/api/evals/checks.py apps/api/evals/adoption.py apps/api/tests/test_llm_timeout.py
git commit -m "$(cat <<'EOF'
llm: wall-clock timeout on messages.create for evals

EOF
)"
```

---

### Task 4: Docs sync (test plan §3 + spec status)

**Files:**
- Modify: `docs/tableread-test-plan.md` §3 — harness defaults note
- Modify: `docs/superpowers/specs/2026-07-11-evals-harness-design.md` — Status → `approved`

**Interfaces:** none (docs only).

- [ ] **Step 1: Edit test plan runner blurb**

After “Runner: `make evals` …”, add a short paragraph:

> Harness defaults (see `docs/superpowers/specs/2026-07-11-evals-harness-design.md`): hard families (lock, continuity) run **20** times; schema validity and soft families (segmentation, lock-repair, import-inference, subtext) run **5**. `--runs N` overrides all. Gates in the table below are unchanged; the “×20” method text remains the statistical target for hard gates / historical method, not a claim that every soft family always executes 20 under default `make evals`.

Do **not** rewrite every table cell’s ×20 unless you want consistency — the paragraph above is enough.

Mark design spec status `approved`.

- [ ] **Step 2: Commit**

```bash
git add docs/tableread-test-plan.md docs/superpowers/specs/2026-07-11-evals-harness-design.md
git commit -m "$(cat <<'EOF'
docs: note tiered eval harness defaults

EOF
)"
```

---

### Task 5 (v1.1): Checkpoint + `--resume`

**Files:**
- Create: `apps/api/evals/checkpoint.py`
- Modify: `apps/api/evals/suite.py`, `apps/api/evals/run.py`, `apps/api/evals/harness.py` (only if helpers help round-trip `EvalResult`)
- Create: `apps/api/tests/test_evals_checkpoint.py`

**Interfaces:**
- Produces:
  - `def checkpoint_path(out_dir: Path, run_id: str) -> Path`
  - `def write_checkpoint(path, *, prompt_version, models, dry_run, runs, results, estimated_calls) -> None`
  - `def load_checkpoint(path) -> dict`
  - `def assert_checkpoint_matches(cp, *, prompt_version, models, dry_run, runs) -> None` — raises `ValueError` on mismatch
  - `run_suite(..., checkpoint_path: Path | None = None, skip_families: set[str] | None = None, prior_results: list[EvalResult] | None = None)`
  - CLI: `--resume PATH` — load, match pins, skip completed family **names** (`EvalResult.name`), continue, rewrite checkpoint after each family

Checkpoint schema (JSON):

```json
{
  "promptVersion": "…",
  "models": {"writer": "…", "classifier": "…"},
  "dryRun": false,
  "runs": {"schemaValidity": 5, "lockViolation": 20},
  "estimatedCalls": {"totalNominal": 183, "…": 0},
  "results": [ { "name": "schema-validity", "metric": "…", "score": 1.0, "gate": 0.98, "hard": true, "status": "PASS", "errored": false, "detail": {}, "notes": [] } ]
}
```

Map `EvalResult.name` ↔ family skip set. Incomplete family never written.

- [ ] **Step 1: Failing tests**

```python
def test_resume_skips_completed_family(tmp_path, session_factory):
    # Write checkpoint with only schema-validity result; resume with mocks;
    # assert lock-violation still runs (results length / names) and schema not re-invoked
    # (spy: wrap checks.schema_validity_eval or count MockLlmClient calls for schema ops only).

def test_resume_refuses_prompt_version_mismatch(tmp_path):
    # load_checkpoint + assert_checkpoint_matches raises ValueError
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && .venv/bin/pytest tests/test_evals_checkpoint.py -v
```

- [ ] **Step 3: Implement checkpoint module + suite/run wiring**

After each family `results.append(...)`, if `checkpoint_path`: `write_checkpoint(...)`.

`run.py`:

```python
parser.add_argument("--resume", type=str, default=None, help="Resume from checkpoint JSON (v1.1).")
# …
prior = []
skip = set()
if args.resume:
    cp = load_checkpoint(Path(args.resume))
    assert_checkpoint_matches(cp, prompt_version=render.PROMPT_VERSION, models=load_model_roles(), dry_run=args.dry_run, runs=runs)
    prior = [eval_result_from_dict(r) for r in cp["results"]]
    skip = {r.name for r in prior}
# Always write a fresh checkpoint path under --out for this run (even when resuming),
# e.g. out/checkpoint-<stamp>.json — print path at start so operators can --resume it.
```

When resuming, `want(key)` becomes false if that family’s result name is in `skip`. Prepend `prior` to final results (stable family order: use suite order, merging prior + new).

- [ ] **Step 4: Tests PASS**

```bash
cd apps/api && .venv/bin/pytest tests/test_evals_checkpoint.py tests/test_evals_checks.py -v
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/evals/checkpoint.py apps/api/evals/suite.py apps/api/evals/run.py \
  apps/api/evals/harness.py apps/api/tests/test_evals_checkpoint.py
git commit -m "$(cat <<'EOF'
evals: family checkpoint and --resume

EOF
)"
```

---

## Spec coverage checklist

| Spec section | Task |
|---|---|
| Tiered defaults + `--runs` override | 1 |
| `SuiteReport.runs` dict + estimate ~183 | 1 |
| Progress lines + flush / PYTHONUNBUFFERED | 2 |
| 120s timeout, no rule-9 on timeout | 3 |
| Docs / Makefile cost notes | 1 (Makefile) + 4 (test plan) |
| Checkpoint + `--resume` | 5 |
| Non-goals (parallelism, new families, gate changes) | honored — no tasks |

## Self-review notes

- No TBD placeholders; timeout helper and catch sites named.
- `nominal_call_estimate` and `SuiteReport.runs` both use camelCase family keys.
- Progress short keys (`schema`) vs report camelCase (`schemaValidity`) — intentional; do not mix in one line.
- Real `make evals` is **not** a plan step.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-11-evals-harness.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  

**2. Inline Execution** — implement in this session with executing-plans checkpoints  

Which approach?
