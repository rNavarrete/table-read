"""`make evals` entrypoint (run from apps/api: `python -m evals.run`).

Real mode constructs the Anthropic-backed client via the sanctioned factory and
a grader judge over a fresh SDK client — the only place in the harness that
touches the network (CLAUDE.md hard rule 1: "the real client is constructed only
in app startup and `make evals`"). `--dry-run` swaps in `MockLlmClient` +
`MockJudge` so the harness (and its self-tests) exercise the full suite offline;
a dry run is explicitly labeled in the report and is never a real eval.

Isolation: the run always targets a throwaway temp SQLite DB (never the dev DB),
set before any `storage` import. The report artifact (JSON + Markdown) carries
per-eval scores, PROMPT_VERSION, and the pinned model ids — ids/counts/scores
only (hard rule 5). Exit code is the suite's (nonzero on any hard-gate failure).
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

_DEFAULT_OUT = Path(__file__).resolve().parent / "reports"
# Default capture directory — git-ignored (see .gitignore). Capture files are a
# separate, opt-in artifact class (see evals/capture.py) and must never land in
# git or logs.
_DEFAULT_CAPTURE = Path(__file__).resolve().parent / "captures"
# `--only` choices, mirrored from evals.suite.EVAL_KEYS. Duplicated (not imported)
# because argparse needs them at parse time, and importing evals.suite here would
# pull `storage` in before main() sets DATABASE_URL. A self-test asserts these
# stay in sync with suite.EVAL_KEYS.
_ONLY_CHOICES = (
    "act-validity",
    "continuity",
    "lock",
    "schema",
    "segmentation",
    "lock-repair",
    "import-inference",
    "subtext",
    "act-boundaries",
    "entity-inference",
    "alias-resolution",
    "narrative-promises",
    "promise-citations",
    "narrative-promises-merge",
    "story-overview",
    "story-overview-merge",
)


def _only_families(value: str) -> str:
    """Validate `--only` at parse time so a typo exits before any paid call."""
    names = [name.strip() for name in value.split(",") if name.strip()]
    unknown = [name for name in names if name not in _ONLY_CHOICES]
    if not names or unknown:
        raise argparse.ArgumentTypeError(
            f"unknown eval families: {', '.join(unknown) or value!r}. "
            f"Choices: {', '.join(sorted(_ONLY_CHOICES))}"
        )
    return ",".join(names)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="evals", description="Table Read LLM eval suite (T6.1).")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Use MockLlmClient + MockJudge (no network); a harness self-check, not a real eval.",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=None,
        help="Uniform runs per eval (default: tiered hard 5 / soft 5).",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Include soft/adoption families (segmentation, lock-repair, "
        "import-inference, subtext, act-boundaries). Default runs hard gates "
        "only: schema, act-validity, lock, continuity.",
    )
    parser.add_argument(
        "--out",
        type=str,
        default=str(_DEFAULT_OUT),
        help="Directory for the report artifact.",
    )
    parser.add_argument(
        "--only",
        type=_only_families,
        default=None,
        help=(
            "Comma-separated eval families to run (diagnosis/spot-check, or a "
            "scoped sign-off for a prompt change); default is core hard gates. "
            f"Choices: {', '.join(sorted(_ONLY_CHOICES))}."
        ),
    )
    parser.add_argument(
        "--capture",
        nargs="?",
        const=str(_DEFAULT_CAPTURE),
        default=None,
        help=(
            "Write per-failure human-review artifacts to DIR (default "
            f"{_DEFAULT_CAPTURE}). Capture files contain generated/fixture text, "
            "are git-ignored, and must never be committed or logged (test plan §3)."
        ),
    )
    parser.add_argument(
        "--calibrate-only",
        action="store_true",
        help="Grader discipline check: run the continuity judge on its calibration "
        "cases and report per-case pass/fail (ids/booleans only), then exit. Cheap "
        "gate verification without paying for a full continuity run.",
    )
    parser.add_argument(
        "--resume",
        type=str,
        default=None,
        help="Resume from a prior checkpoint JSON (v1.1): families already "
        "recorded there are skipped, not recomputed. Refuses to resume if "
        "PROMPT_VERSION, model pins, --dry-run, or the run map differ.",
    )
    args = parser.parse_args(argv)
    if args.runs is not None and args.runs < 1:
        parser.error(f"--runs must be >= 1 (got {args.runs}); scores divide by the run count")
    if args.full and args.only is not None:
        parser.error("use either --full or --only, not both")
    return args


def _build_real_clients():
    """Construct the real product client (via the sanctioned factory) and the
    grader judge (raw SDK client). Only reached under `make evals`."""
    from evals.graders import ContinuityJudge
    from evals.suite import load_model_roles
    from llm.factory import build_anthropic_client, build_sdk_client

    api_key = os.environ["ANTHROPIC_API_KEY"]  # KeyError → fail fast (no key, no real eval)
    client = build_anthropic_client()
    models = load_model_roles()
    judge = ContinuityJudge(
        build_sdk_client(api_key),
        models["writer"],
        temperature=None,
    )
    return client, judge


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    # Isolate every run in a throwaway DB before importing anything under
    # `storage` (the lock-violation eval seeds + mutates a real project).
    tmp = tempfile.mkdtemp(prefix="tableread-evals-")
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp}/evals.db"

    from drama_manager.render import PROMPT_VERSION
    from evals.checkpoint import (
        assert_checkpoint_matches,
        checkpoint_path,
        eval_result_from_dict,
        load_checkpoint,
    )
    from evals.progress import make_stdout_progress
    from evals.suite import (
        filter_call_estimate,
        filter_run_map,
        load_model_roles,
        nominal_call_estimate,
        resolve_run_map,
        run_suite,
        selected_eval_keys,
    )
    from storage.db import Base, SessionLocal, engine, ensure_storage_schema

    runs = resolve_run_map(args.runs)
    on_progress = make_stdout_progress()
    keys = selected_eval_keys(full=args.full, only=args.only)
    selected_runs = filter_run_map(runs, keys)

    estimate = filter_call_estimate(nominal_call_estimate(runs), keys)
    mode = "dry-run" if args.dry_run else "real"
    runs_display = ", ".join(f"{k}={v}" for k, v in sorted(selected_runs.items()))
    print(
        f"evals starting mode={mode} families={{{','.join(keys)}}} "
        f"totalNominal≈{estimate['totalNominal']} runs={{{runs_display}}}",
        flush=True,
    )

    if args.dry_run:
        from evals.graders import MockJudge
        from llm.mock import MockLlmClient

        client, judge = MockLlmClient(), MockJudge()
    else:
        print("building Anthropic clients…", flush=True)
        client, judge = _build_real_clients()
        print("clients ready", flush=True)

    if args.calibrate_only:
        from evals.graders import (
            CALIBRATION_CASES,
            CONTINUITY_FACT_IDS,
            GRADER_VERSION,
            GraderError,
        )
        from evals.probes import load_fixture_ctx
        from llm.errors import LlmTimeoutError

        ledger = load_fixture_ctx().ledger
        facts = [f for f in ledger if f.get("id") in CONTINUITY_FACT_IDS]
        print(f"grader calibration: GRADER_VERSION={GRADER_VERSION} "
              f"mode={'dry-run' if args.dry_run else 'real'}")
        ok = True
        for i, (_text, expected) in enumerate(CALIBRATION_CASES, start=1):
            try:
                actual = judge.grade(script_text=_text, facts=facts).passes
            except (GraderError, LlmTimeoutError):
                actual = None
            match = actual == expected
            ok = ok and match
            print(f"  case {i}: expected={expected} actual={actual} "
                  f"{'OK' if match else 'MISMATCH'}")
        print(f"calibrated={'true' if ok else 'false'}")
        return 0 if ok else 1

    prior_results = []
    skip_families: set[str] = set()
    if args.resume:
        cp = load_checkpoint(Path(args.resume))
        assert_checkpoint_matches(
            cp,
            prompt_version=PROMPT_VERSION,
            models=load_model_roles(),
            dry_run=args.dry_run,
            runs=selected_runs,
        )
        prior_results = [eval_result_from_dict(r) for r in cp["results"]]
        skip_families = {r.name for r in prior_results}

    # A fresh checkpoint path under --out for *this* run, even when resuming
    # (the prior checkpoint is only ever read, never appended to) — printed
    # up front so an operator can --resume this run if it's interrupted.
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
    this_checkpoint = checkpoint_path(Path(args.out), stamp)
    print(f"checkpoint: {this_checkpoint} (pass to --resume if this run is interrupted)")

    capture = None
    if args.capture is not None:
        from evals.capture import CaptureSink

        capture = CaptureSink(args.capture)

    Base.metadata.create_all(bind=engine)
    ensure_storage_schema()
    report = run_suite(
        client,
        judge,
        SessionLocal,
        runs=runs,
        dry_run=args.dry_run,
        only=args.only,
        full=args.full,
        capture=capture,
        on_progress=on_progress,
        checkpoint_path=this_checkpoint,
        skip_families=skip_families,
        prior_results=prior_results,
    )

    json_path, md_path = report.write(args.out)
    if capture is not None:
        print(f"capture: {capture.count} failure artifact(s) → {capture.dir} "
              f"(git-ignored; do not commit or log)")

    runs_display = ", ".join(f"{k} {v}" for k, v in report.runs.items())
    print(f"PROMPT_VERSION={report.prompt_version} models={report.models} "
          f"mode={'dry-run' if report.dry_run else 'real'} runs/eval={runs_display}")
    for r in report.results:
        gate = "-" if r.gate is None else f"{r.gate:.2f}"
        print(f"  [{r.status:5}] {r.name:26} {r.metric}: {r.score:.3f} (gate {gate})")
    print(f"report: {json_path}")
    print(f"        {md_path}")
    print(f"exit={report.exit_code}")
    return report.exit_code


if __name__ == "__main__":
    sys.exit(main())
