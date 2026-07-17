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
from evals.checkpoint import write_checkpoint
from evals.graders import Judge
from evals.harness import EvalResult, SuiteReport
from evals.progress import ProgressFn
from llm.protocol import LlmClient

_MODELS_CONFIG = Path(__file__).resolve().parents[3] / "config" / "models.toml"

# `--only` selector keys → (eval-family camelCase used by nominal_call_estimate).
# The keys are the short CLI names; the values map onto the estimate dict so a
# single-eval run reports a truthful call estimate.
EVAL_KEYS: dict[str, str] = {
    "schema": "schemaValidity",
    "act-validity": "actBoundaryValidity",
    "lock": "lockViolation",
    "continuity": "continuityAdherence",
    "segmentation": "segmentationDeterminism",
    "lock-repair": "lockRepairQuality",
    "import-inference": "importInference",
    "subtext": "subtextFidelity",
    "act-boundaries": "actBoundaryQuality",
    "entity-inference": "entityInference",
    "alias-resolution": "aliasResolution",
}

HARD_RUNS = 5
SOFT_RUNS = 5
HARD_FAMILY_KEYS = frozenset(
    {"actBoundaryValidity", "lockViolation", "continuityAdherence"}
)

# Default `make evals` runs only these hard-gate families. Soft / adoption
# families stay available via `--full` or `--only <family>`.
CORE_EVAL_KEYS: tuple[str, ...] = (
    "schema",
    "act-validity",
    "lock",
    "continuity",
)
SOFT_EVAL_KEYS: tuple[str, ...] = (
    "segmentation",
    "lock-repair",
    "import-inference",
    "subtext",
    "act-boundaries",
    "entity-inference",
    "alias-resolution",
)

# `--only`/checkpoint short key → the `EvalResult.name` that family produces.
# Used by `run_suite`'s resume path to map a checkpoint's family-skip set
# (which stores `EvalResult.name`, the report-facing identity) back onto the
# short keys the family-dispatch loop is keyed on.
FAMILY_RESULT_NAME: dict[str, str] = {
    "schema": "schema-validity",
    "act-validity": "act-boundary-validity",
    "lock": "lock-violation",
    "continuity": "continuity-adherence",
    "segmentation": "segmentation-determinism",
    "lock-repair": "lock-repair-quality",
    "import-inference": "import-inference",
    "subtext": "subtext-fidelity",
    "act-boundaries": "act-boundary-quality",
    "entity-inference": "entity-inference",
    "alias-resolution": "alias-resolution",
}


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

    Per family: schema = one call per probe per run (9 × schema runs). lock =
    up to 3 product calls per regenerate attempt (preview's regenerate + apply's
    extract + scan; guard rejections stop after 1) plus 1 per candidate attempt
    → ≤ 4 × lock runs. continuity = 3 grader calibration calls + (1 generate +
    1 grade) × continuity runs.     Segmentation and each adoption soft eval = 1 ×
    that family's runs. Act-boundary validity and quality each have two labeled
    probes, so each is 2 × that family's runs. `entityInference` and
    `aliasResolution` each call `infer_story_entities` once per run, same as
    the other single-probe soft families. Rule-9 retries can add up to one
    extra call per product call (observed-worst budget ≈ 1.5× total). Core
    defaults (schema/act-validity/lock/continuity, N=5): ≈88 nominal; `--full`
    adds soft families (≈+40); `--runs 1` core ≈20."""
    schema = len(probes.SCHEMA_PROBES) * runs["schemaValidity"]
    act_validity = 2 * runs["actBoundaryValidity"]
    lock = 4 * runs["lockViolation"]
    continuity = 3 + 2 * runs["continuityAdherence"]
    segmentation = runs["segmentationDeterminism"]
    lock_repair = runs["lockRepairQuality"]
    import_inference = runs["importInference"]
    subtext = runs["subtextFidelity"]
    act_boundaries = 2 * runs["actBoundaryQuality"]
    entity_inference = runs["entityInference"]
    alias_resolution = runs["aliasResolution"]
    return {
        "schemaValidity": schema,
        "actBoundaryValidity": act_validity,
        "lockViolation": lock,
        "continuityAdherence": continuity,
        "segmentationDeterminism": segmentation,
        "lockRepairQuality": lock_repair,
        "importInference": import_inference,
        "subtextFidelity": subtext,
        "actBoundaryQuality": act_boundaries,
        "entityInference": entity_inference,
        "aliasResolution": alias_resolution,
        "totalNominal": (
            schema
            + act_validity
            + lock
            + continuity
            + segmentation
            + lock_repair
            + import_inference
            + subtext
            + act_boundaries
            + entity_inference
            + alias_resolution
        ),
    }


def selected_eval_keys(*, full: bool = False, only: str | None = None) -> tuple[str, ...]:
    """Which short family keys a suite invocation will attempt."""
    if only is not None:
        return (only,)
    if full:
        return tuple(EVAL_KEYS)
    return CORE_EVAL_KEYS


def filter_run_map(runs: dict[str, int], keys: tuple[str, ...]) -> dict[str, int]:
    return {EVAL_KEYS[k]: runs[EVAL_KEYS[k]] for k in keys}


def filter_call_estimate(estimate: dict, keys: tuple[str, ...]) -> dict:
    families = [EVAL_KEYS[k] for k in keys]
    out = {f: estimate[f] for f in families}
    out["totalNominal"] = sum(out.values())
    return out


def run_suite(
    client: LlmClient,
    judge: Judge,
    session_factory,
    *,
    runs: dict[str, int],
    dry_run: bool,
    only: str | None = None,
    full: bool = False,
    capture=None,
    on_progress: ProgressFn | None = None,
    checkpoint_path: Path | None = None,
    skip_families: set[str] | None = None,
    prior_results: list[EvalResult] | None = None,
) -> SuiteReport:
    """`session_factory` is a zero-arg callable returning a fresh DB `Session`
    (the lock-violation eval seeds + mutates an isolated project per attempt).

    Default suite is **core hard gates only** (`schema`, `act-validity`, `lock`,
    `continuity`). Pass `full=True` to include soft/adoption families, or
    `only=<key>` for a single family. See `CORE_EVAL_KEYS` / `SOFT_EVAL_KEYS`.

    `checkpoint_path`/`skip_families`/`prior_results` are the v1.1 resume
    affordance (`--resume` in run.py): `skip_families` holds the
    `EvalResult.name`s a prior checkpoint already scored — those families are
    not recomputed, the matching entry from `prior_results` is reused verbatim
    instead. When `checkpoint_path` is set, the checkpoint is rewritten (full
    overwrite) immediately after every *freshly computed* family, then once
    more at normal suite completion so an all-skipped resume still creates this
    run's fresh checkpoint path. A family that raises leaves the checkpoint
    exactly where the last completed family left it (nothing partial is ever
    written)."""
    if only is not None and only not in EVAL_KEYS:
        raise ValueError(f"unknown --only eval {only!r}; choose from {sorted(EVAL_KEYS)}")
    if only is not None and full:
        raise ValueError("pass only one of full=True or only=<family>")
    keys = selected_eval_keys(full=full, only=only)
    selected_runs = filter_run_map(runs, keys)
    ctx = probes.load_fixture_ctx()
    skip_families = skip_families or set()
    prior_by_name = {r.name: r for r in (prior_results or [])}

    def emit_start(key: str) -> None:
        if on_progress is not None:
            on_progress(family=key, runs=runs[EVAL_KEYS[key]], status="start")

    def emit_done(key: str, result) -> None:
        if on_progress is not None:
            on_progress(family=key, status="done", score=result.score, gate=result.gate)

    results: list[EvalResult] = []

    def run_family(key: str, compute) -> None:
        if key not in keys:
            return
        name = FAMILY_RESULT_NAME[key]
        if name in skip_families:
            results.append(prior_by_name[name])
            return
        emit_start(key)
        result = compute()
        results.append(result)
        emit_done(key, result)
        if checkpoint_path is not None:
            write_checkpoint(
                checkpoint_path,
                prompt_version=render.PROMPT_VERSION,
                models=load_model_roles(),
                dry_run=dry_run,
                runs=selected_runs,
                results=results,
                estimated_calls=filter_call_estimate(nominal_call_estimate(runs), keys),
            )

    run_family(
        "schema",
        lambda: checks.schema_validity_eval(
            client, ctx, runs=runs[EVAL_KEYS["schema"]], on_progress=on_progress
        ),
    )
    run_family(
        "act-validity",
        lambda: checks.act_boundary_validity_eval(
            client,
            ctx,
            runs=runs[EVAL_KEYS["act-validity"]],
            on_progress=on_progress,
        ),
    )
    run_family(
        "lock",
        lambda: checks.lock_violation_eval(
            client,
            ctx,
            session_factory,
            runs=runs[EVAL_KEYS["lock"]],
            on_progress=on_progress,
        ),
    )
    run_family(
        "continuity",
        lambda: checks.continuity_eval(
            client,
            ctx,
            judge,
            runs=runs[EVAL_KEYS["continuity"]],
            capture=capture,
            on_progress=on_progress,
        ),
    )
    run_family(
        "segmentation",
        lambda: checks.segmentation_determinism_eval(
            client, ctx, runs=runs[EVAL_KEYS["segmentation"]], on_progress=on_progress
        ),
    )
    run_family(
        "lock-repair",
        lambda: adoption.lock_repair_eval(
            client, ctx, runs=runs[EVAL_KEYS["lock-repair"]], on_progress=on_progress
        ),
    )
    run_family(
        "import-inference",
        lambda: adoption.import_inference_eval(
            client, runs=runs[EVAL_KEYS["import-inference"]], on_progress=on_progress
        ),
    )
    run_family(
        "subtext",
        lambda: adoption.subtext_eval(
            client, ctx, runs=runs[EVAL_KEYS["subtext"]], on_progress=on_progress
        ),
    )
    run_family(
        "act-boundaries",
        lambda: checks.act_boundary_quality_eval(
            client,
            ctx,
            runs=runs[EVAL_KEYS["act-boundaries"]],
            on_progress=on_progress,
        ),
    )
    run_family(
        "entity-inference",
        lambda: adoption.entity_inference_eval(
            client, runs=runs[EVAL_KEYS["entity-inference"]], on_progress=on_progress
        ),
    )
    run_family(
        "alias-resolution",
        lambda: adoption.alias_resolution_eval(
            client, runs=runs[EVAL_KEYS["alias-resolution"]], on_progress=on_progress
        ),
    )

    estimate = filter_call_estimate(nominal_call_estimate(runs), keys)
    if checkpoint_path is not None:
        write_checkpoint(
            checkpoint_path,
            prompt_version=render.PROMPT_VERSION,
            models=load_model_roles(),
            dry_run=dry_run,
            runs=selected_runs,
            results=results,
            estimated_calls=estimate,
        )
    return SuiteReport(
        prompt_version=render.PROMPT_VERSION,
        models=load_model_roles(),
        dry_run=dry_run,
        runs=selected_runs,
        results=results,
        estimated_calls=estimate,
    )
