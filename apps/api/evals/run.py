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
    "continuity",
    "lock",
    "schema",
    "segmentation",
    "lock-repair",
    "import-inference",
    "subtext",
)


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
        help="Uniform runs per eval (default: tiered 20 hard / 5 soft).",
    )
    parser.add_argument(
        "--out",
        type=str,
        default=str(_DEFAULT_OUT),
        help="Directory for the report artifact.",
    )
    parser.add_argument(
        "--only",
        type=str,
        default=None,
        choices=sorted(_ONLY_CHOICES),
        help="Run a single eval family (diagnosis/spot-check); default runs all four.",
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
    args = parser.parse_args(argv)
    if args.runs is not None and args.runs < 1:
        parser.error(f"--runs must be >= 1 (got {args.runs}); scores divide by the run count")
    return args


def _build_real_clients():
    """Construct the real product client (via the sanctioned factory) and the
    grader judge (raw SDK client). Only reached under `make evals`."""
    import anthropic

    from evals.graders import ContinuityJudge
    from evals.suite import load_model_roles
    from llm.factory import build_anthropic_client

    api_key = os.environ["ANTHROPIC_API_KEY"]  # KeyError → fail fast (no key, no real eval)
    client = build_anthropic_client()
    models = load_model_roles()
    judge = ContinuityJudge(anthropic.Anthropic(api_key=api_key), models["classifier"])
    return client, judge


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    # Isolate every run in a throwaway DB before importing anything under
    # `storage` (the lock-violation eval seeds + mutates a real project).
    tmp = tempfile.mkdtemp(prefix="tableread-evals-")
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp}/evals.db"

    from evals.progress import make_stdout_progress
    from evals.suite import resolve_run_map, run_suite
    from storage.db import Base, SessionLocal, engine, ensure_storage_schema

    runs = resolve_run_map(args.runs)
    on_progress = make_stdout_progress()

    if args.dry_run:
        from evals.graders import MockJudge
        from llm.mock import MockLlmClient

        client, judge = MockLlmClient(), MockJudge()
    else:
        client, judge = _build_real_clients()

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
        capture=capture,
        on_progress=on_progress,
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
