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
        help="Runs per eval (default 20, per test plan §3).",
    )
    parser.add_argument(
        "--out",
        type=str,
        default=str(_DEFAULT_OUT),
        help="Directory for the report artifact.",
    )
    return parser.parse_args(argv)


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

    from evals.suite import DEFAULT_RUNS, run_suite
    from storage.db import Base, SessionLocal, engine

    runs = args.runs if args.runs is not None else DEFAULT_RUNS

    if args.dry_run:
        from evals.graders import MockJudge
        from llm.mock import MockLlmClient

        client, judge = MockLlmClient(), MockJudge()
    else:
        client, judge = _build_real_clients()

    Base.metadata.create_all(bind=engine)
    report = run_suite(client, judge, SessionLocal, runs=runs, dry_run=args.dry_run)

    json_path, md_path = report.write(args.out)

    print(f"PROMPT_VERSION={report.prompt_version} models={report.models} "
          f"mode={'dry-run' if report.dry_run else 'real'} runs/eval={report.runs}")
    for r in report.results:
        gate = "-" if r.gate is None else f"{r.gate:.2f}"
        print(f"  [{r.status:5}] {r.name:26} {r.metric}: {r.score:.3f} (gate {gate})")
    print(f"report: {json_path}")
    print(f"        {md_path}")
    print(f"exit={report.exit_code}")
    return report.exit_code


if __name__ == "__main__":
    sys.exit(main())
