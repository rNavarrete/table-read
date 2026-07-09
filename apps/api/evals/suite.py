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
    )
