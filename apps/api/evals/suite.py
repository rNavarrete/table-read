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
from evals.progress import ProgressFn
from llm.protocol import LlmClient

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


def load_model_roles() -> dict[str, str]:
    """Pinned model ids (config/models.toml) for the report header. Reads the
    toml directly — no `anthropic` import, no client construction."""
    with _MODELS_CONFIG.open("rb") as f:
        return tomllib.load(f)["models"]


def nominal_call_estimate(runs: dict[str, int]) -> dict:
    """Nominal (retry-free) real-API call counts per eval family — cost
    visibility for the report header and the Makefile target.

    Per family: schema = one call per probe per run (8 × schema runs). lock =
    up to 3 product calls per regenerate attempt (preview's regenerate + apply's
    extract + scan; guard rejections stop after 1) plus 1 per candidate attempt
    → ≤ 4 × lock runs. continuity = 3 grader calibration calls + (1 generate +
    1 grade) × continuity runs. Segmentation and each adoption soft eval = 1 ×
    that family's runs. Rule-9 retries can add up to one extra call per product
    call (observed-worst budget ≈ 1.5× total). Tiered defaults: 183 nominal
    (schema 40, lock 80, continuity 43, soft families 5 each); `--runs 1`
    ≈ 18–25."""
    schema = len(probes.SCHEMA_PROBES) * runs["schemaValidity"]
    lock = 4 * runs["lockViolation"]
    continuity = 3 + 2 * runs["continuityAdherence"]
    segmentation = runs["segmentationDeterminism"]
    lock_repair = runs["lockRepairQuality"]
    import_inference = runs["importInference"]
    subtext = runs["subtextFidelity"]
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
    runs: dict[str, int],
    dry_run: bool,
    only: str | None = None,
    capture=None,
    on_progress: ProgressFn | None = None,
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

    def emit_start(key: str) -> None:
        if on_progress is not None:
            on_progress(family=key, runs=runs[EVAL_KEYS[key]], status="start")

    def emit_done(key: str, result) -> None:
        if on_progress is not None:
            on_progress(family=key, status="done", score=result.score, gate=result.gate)

    results = []
    if want("schema"):
        emit_start("schema")
        result = checks.schema_validity_eval(
            client, ctx, runs=runs[EVAL_KEYS["schema"]], on_progress=on_progress
        )
        results.append(result)
        emit_done("schema", result)
    if want("lock"):
        emit_start("lock")
        result = checks.lock_violation_eval(
            client,
            ctx,
            session_factory,
            runs=runs[EVAL_KEYS["lock"]],
            on_progress=on_progress,
        )
        results.append(result)
        emit_done("lock", result)
    if want("continuity"):
        emit_start("continuity")
        result = checks.continuity_eval(
            client,
            ctx,
            judge,
            runs=runs[EVAL_KEYS["continuity"]],
            capture=capture,
            on_progress=on_progress,
        )
        results.append(result)
        emit_done("continuity", result)
    if want("segmentation"):
        emit_start("segmentation")
        result = checks.segmentation_determinism_eval(
            client, ctx, runs=runs[EVAL_KEYS["segmentation"]], on_progress=on_progress
        )
        results.append(result)
        emit_done("segmentation", result)
    if want("lock-repair"):
        emit_start("lock-repair")
        result = adoption.lock_repair_eval(
            client, ctx, runs=runs[EVAL_KEYS["lock-repair"]], on_progress=on_progress
        )
        results.append(result)
        emit_done("lock-repair", result)
    if want("import-inference"):
        emit_start("import-inference")
        result = adoption.import_inference_eval(
            client, runs=runs[EVAL_KEYS["import-inference"]], on_progress=on_progress
        )
        results.append(result)
        emit_done("import-inference", result)
    if want("subtext"):
        emit_start("subtext")
        result = adoption.subtext_eval(
            client, ctx, runs=runs[EVAL_KEYS["subtext"]], on_progress=on_progress
        )
        results.append(result)
        emit_done("subtext", result)

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
