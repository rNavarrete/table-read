"""Family-level checkpoint (v1.1): an interrupt/resume affordance for real
`make evals` runs. Not a report artifact (no rule-5 audit) — this is
engineer-facing recovery state, rewritten in full after every family that
finishes, so a killed run can `--resume` without repaying completed families.

Only a *complete* family's `EvalResult` is ever written: `write_checkpoint`
is called by `suite.run_suite` right after a family's result is appended, so
a crash mid-family leaves the checkpoint exactly where it was before that
family started — nothing partial ever lands on disk.

`assert_checkpoint_matches` refuses to resume against a checkpoint whose
prompt version, model pins, dry-run mode, or run map differ from the current
invocation: those four fields determine what the already-scored results
*mean*, so silently continuing across a mismatch would misrepresent the
final report.
"""

from __future__ import annotations

import json
from pathlib import Path

from evals.harness import EvalResult


def checkpoint_path(out_dir: Path, run_id: str) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    return out / f"checkpoint-{run_id}.json"


def write_checkpoint(
    path: Path,
    *,
    prompt_version: str,
    models: dict[str, str],
    dry_run: bool,
    runs: dict[str, int],
    results: list[EvalResult],
    estimated_calls: dict,
) -> None:
    """Overwrite `path` with the full checkpoint state. A single-process CLI
    run is the only writer, so a plain overwrite (no tmp-file + rename) is
    sufficient — the file is only ever read back by an operator's explicit
    `--resume`, never by a concurrent process."""
    payload = {
        "promptVersion": prompt_version,
        "models": models,
        "dryRun": dry_run,
        "runs": runs,
        "estimatedCalls": estimated_calls,
        "results": [r.to_dict() for r in results],
    }
    Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def load_checkpoint(path: Path) -> dict:
    return json.loads(Path(path).read_text())


def assert_checkpoint_matches(
    cp: dict,
    *,
    prompt_version: str,
    models: dict[str, str],
    dry_run: bool,
    runs: dict[str, int],
) -> None:
    mismatches = []
    if cp.get("promptVersion") != prompt_version:
        mismatches.append(
            f"promptVersion: checkpoint={cp.get('promptVersion')!r} run={prompt_version!r}"
        )
    if cp.get("models") != models:
        mismatches.append(f"models: checkpoint={cp.get('models')!r} run={models!r}")
    if cp.get("dryRun") != dry_run:
        mismatches.append(f"dryRun: checkpoint={cp.get('dryRun')!r} run={dry_run!r}")
    if cp.get("runs") != runs:
        mismatches.append(f"runs: checkpoint={cp.get('runs')!r} run={runs!r}")
    if mismatches:
        raise ValueError(
            "checkpoint does not match this run's pins, refusing to resume: "
            + "; ".join(mismatches)
        )


def eval_result_from_dict(d: dict) -> EvalResult:
    """Round-trip a checkpoint `results[i]` entry back into an `EvalResult`.
    Only constructor fields are read — `status`/`meets_gate`/`blocks` are
    derived properties, recomputed fresh from `score`/`gate`/`hard`/`errored`."""
    return EvalResult(
        name=d["name"],
        metric=d["metric"],
        score=d["score"],
        gate=d["gate"],
        hard=d["hard"],
        detail=d.get("detail", {}),
        notes=d.get("notes", []),
        errored=d.get("errored", False),
    )
