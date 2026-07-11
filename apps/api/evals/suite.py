"""Assemble the four eval families into one scored `SuiteReport`.

`run_suite` is client/judge/session-injected, so both the real `make evals` run
(run.py) and the harness self-tests drive the identical code — the tests just
pass `MockLlmClient` + `MockJudge` + a temp-DB session.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

from drama_manager import render
from evals import adoption, checks, probes
from evals.graders import Judge
from evals.harness import SuiteReport
from llm.protocol import LlmClient

# test plan §3 pins 20 runs/operation for schema validity, the lock gate, and
# continuity; segmentation determinism is unspecified there and reuses the same
# count. Overridable via `--runs` for a cheaper smoke run.
DEFAULT_RUNS = 20

_MODELS_CONFIG = Path(__file__).resolve().parents[3] / "config" / "models.toml"

# `--only` selector keys → (eval-family camelCase used by nominal_call_estimate).
# The keys are the short CLI names; the values map onto the estimate dict so a
# single-eval run reports a truthful call estimate.
EVAL_KEYS: dict[str, str] = {
    "schema": "schemaValidity",
    "lock": "lockViolation",
    "continuity": "continuityAdherence",
    "segmentation": "segmentationDeterminism",
    "lock-repair": "lockRepairQuality",
    "import-inference": "importInference",
    "subtext": "subtextFidelity",
}


def load_model_roles() -> dict[str, str]:
    """Pinned model ids (config/models.toml) for the report header. Reads the
    toml directly — no `anthropic` import, no client construction."""
    with _MODELS_CONFIG.open("rb") as f:
        return tomllib.load(f)["models"]


def nominal_call_estimate(runs: int) -> dict:
    """Nominal (retry-free) real-API call counts per eval family — cost
    visibility for the report header and the Makefile target.

    Per family: schema = one call per probe per run (8 × runs). lock = up to 3
    product calls per regenerate attempt (preview's regenerate + apply's
    extract + scan; guard rejections stop after 1) plus 1 per candidate attempt
    → ≤ 4 × runs. continuity = 3 grader calibration calls + (1 generate +
    1 grade) × runs. segmentation = 1 × runs. Adoption soft evals: lock-repair
    and subtext = 1 × runs each; import-inference = 1 × runs. Rule-9 retries can
    add up to one extra call per product call (observed-worst budget ≈ 1.5×
    total). At the default 20 runs: 363 nominal (schema 160, lock 80,
    continuity 43, segmentation 20, lock-repair 20, import-inference 20,
    subtext 20) — ≈360–380; `--runs 1` ≈ 18–25."""
    schema = len(probes.SCHEMA_PROBES) * runs
    lock = 4 * runs
    continuity = 3 + 2 * runs
    segmentation = runs
    lock_repair = runs
    import_inference = runs
    subtext = runs
    return {
        "schemaValidity": schema,
        "lockViolation": lock,
        "continuityAdherence": continuity,
        "segmentationDeterminism": segmentation,
        "lockRepairQuality": lock_repair,
        "importInference": import_inference,
        "subtextFidelity": subtext,
        "totalNominal": (
            schema
            + lock
            + continuity
            + segmentation
            + lock_repair
            + import_inference
            + subtext
        ),
    }


def run_suite(
    client: LlmClient,
    judge: Judge,
    session_factory,
    *,
    runs: int = DEFAULT_RUNS,
    dry_run: bool,
    only: str | None = None,
    capture=None,
) -> SuiteReport:
    """`session_factory` is a zero-arg callable returning a fresh DB `Session`
    (the lock-violation eval seeds + mutates an isolated project per attempt).

    `only` (an `EVAL_KEYS` short name, e.g. "continuity") runs a single eval
    family — a diagnosis/spot-check affordance so the operator can iterate on one
    metric without paying for the full suite. `capture` (a `capture.CaptureSink`)
    is threaded into `continuity_eval` for per-failure human-review artifacts."""
    if only is not None and only not in EVAL_KEYS:
        raise ValueError(f"unknown --only eval {only!r}; choose from {sorted(EVAL_KEYS)}")
    ctx = probes.load_fixture_ctx()

    def want(key: str) -> bool:
        return only is None or only == key

    results = []
    if want("schema"):
        results.append(checks.schema_validity_eval(client, ctx, runs=runs))
    if want("lock"):
        results.append(checks.lock_violation_eval(client, ctx, session_factory, runs=runs))
    if want("continuity"):
        results.append(checks.continuity_eval(client, ctx, judge, runs=runs, capture=capture))
    if want("segmentation"):
        results.append(checks.segmentation_determinism_eval(client, ctx, runs=runs))
    if want("lock-repair"):
        results.append(adoption.lock_repair_eval(client, ctx, runs=runs))
    if want("import-inference"):
        results.append(adoption.import_inference_eval(client, runs=runs))
    if want("subtext"):
        results.append(adoption.subtext_eval(client, ctx, runs=runs))

    estimate = nominal_call_estimate(runs)
    if only is not None:
        family = EVAL_KEYS[only]
        estimate = {family: estimate[family], "totalNominal": estimate[family]}
    return SuiteReport(
        prompt_version=render.PROMPT_VERSION,
        models=load_model_roles(),
        dry_run=dry_run,
        runs=runs,
        results=results,
        estimated_calls=estimate,
    )
