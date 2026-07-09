"""Assemble the four eval families into one scored `SuiteReport`.

`run_suite` is client/judge/session-injected, so both the real `make evals` run
(run.py) and the harness self-tests drive the identical code — the tests just
pass `MockLlmClient` + `MockJudge` + a temp-DB session.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

from drama_manager import render
from evals import checks, probes
from evals.graders import Judge
from evals.harness import SuiteReport
from llm.protocol import LlmClient

# test plan §3 pins 20 runs/operation for schema validity, the lock gate, and
# continuity; segmentation determinism is unspecified there and reuses the same
# count. Overridable via `--runs` for a cheaper smoke run.
DEFAULT_RUNS = 20

_MODELS_CONFIG = Path(__file__).resolve().parents[3] / "config" / "models.toml"


def load_model_roles() -> dict[str, str]:
    """Pinned model ids (config/models.toml) for the report header. Reads the
    toml directly — no `anthropic` import, no client construction."""
    with _MODELS_CONFIG.open("rb") as f:
        return tomllib.load(f)["models"]


def nominal_call_estimate(runs: int) -> dict:
    """Nominal (retry-free) real-API call counts per eval family — cost
    visibility for the report header and the Makefile target.

    Per family: schema = one call per probe per run (7 × runs). lock = up to 3
    product calls per regenerate attempt (preview's regenerate + apply's
    extract + scan; guard rejections stop after 1) plus 1 per candidate attempt
    → ≤ 4 × runs. continuity = 3 grader calibration calls + (1 generate +
    1 grade) × runs. segmentation = 1 × runs. Rule-9 retries can add up to one
    extra call per product call (observed-worst budget ≈ 1.5× total). At the
    default 20 runs: 283 nominal (schema 140, lock 80, continuity 43,
    segmentation 20) — ≈280–300, up to ~420 with retries; `--runs 1` ≈ 15–20."""
    schema = len(probes.SCHEMA_PROBES) * runs
    lock = 4 * runs
    continuity = 3 + 2 * runs
    segmentation = runs
    return {
        "schemaValidity": schema,
        "lockViolation": lock,
        "continuityAdherence": continuity,
        "segmentationDeterminism": segmentation,
        "totalNominal": schema + lock + continuity + segmentation,
    }


def run_suite(
    client: LlmClient,
    judge: Judge,
    session_factory,
    *,
    runs: int = DEFAULT_RUNS,
    dry_run: bool,
) -> SuiteReport:
    """`session_factory` is a zero-arg callable returning a fresh DB `Session`
    (the lock-violation eval seeds + mutates an isolated project per attempt)."""
    ctx = probes.load_fixture_ctx()
    results = [
        checks.schema_validity_eval(client, ctx, runs=runs),
        checks.lock_violation_eval(client, ctx, session_factory, runs=runs),
        checks.continuity_eval(client, ctx, judge, runs=runs),
        checks.segmentation_determinism_eval(client, ctx, runs=runs),
    ]
    return SuiteReport(
        prompt_version=render.PROMPT_VERSION,
        models=load_model_roles(),
        dry_run=dry_run,
        runs=runs,
        results=results,
        estimated_calls=nominal_call_estimate(runs),
    )
