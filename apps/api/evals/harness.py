"""Harness core: eval result / suite-report types, gating, exit codes, and
rule-5-safe report rendering (JSON + Markdown). Pure — no LLM, no I/O beyond
`SuiteReport.write`.

Gating model (per eval, declared at the eval site — see `suite.py`):

  - `gate` — the minimum acceptable `score` in [0, 1], higher = better. `None`
    means report-only (informational; never blocks).
  - `hard` — a hard gate *blocks the suite* (nonzero exit) when unmet. Soft
    gates (`hard=False`) still render PASS/WARN but never change the exit code;
    used for metrics the platform cannot yet guarantee (segmentation
    determinism — no temperature control on the writer tier, DESIGN-GAP(T6.1)).

`score` is always normalized so higher is better, even for "violations must be
0" gates: the lock-violation eval reports `score = (attempts - violations) /
attempts` with `gate = 1.0`, so any single violation drops below the gate and,
being hard, exits nonzero.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime


@dataclass
class EvalResult:
    """One eval's outcome. `detail`/`notes` are rule-5-safe: ids, counts,
    op names, hashes, scores — never fixture/model text."""

    name: str
    metric: str  # human label for `score`, e.g. "schema-valid rate"
    score: float  # normalized to [0, 1], higher = better
    gate: float | None  # min acceptable score, or None = report-only
    hard: bool  # hard gate blocks the suite (nonzero exit) when unmet
    detail: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    errored: bool = False  # setup/calibration failure → inconclusive, treated as unmet

    @property
    def meets_gate(self) -> bool:
        if self.errored:
            return False
        if self.gate is None:
            return True
        return self.score >= self.gate

    @property
    def blocks(self) -> bool:
        """Whether this result forces a nonzero suite exit."""
        return self.hard and not self.meets_gate

    @property
    def status(self) -> str:
        if self.errored:
            return "ERROR"
        if self.gate is None:
            return "INFO"
        if self.meets_gate:
            return "PASS"
        return "FAIL" if self.hard else "WARN"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "metric": self.metric,
            "score": round(self.score, 4),
            "gate": self.gate,
            "hard": self.hard,
            "status": self.status,
            "errored": self.errored,
            "detail": self.detail,
            "notes": self.notes,
        }


@dataclass
class SuiteReport:
    prompt_version: str
    models: dict[str, str]
    dry_run: bool
    runs: int
    results: list[EvalResult]
    generated_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    @property
    def exit_code(self) -> int:
        """0 if every hard gate is met, 1 otherwise (obligation 7)."""
        return 1 if any(r.blocks for r in self.results) else 0

    def to_dict(self) -> dict:
        return {
            "promptVersion": self.prompt_version,
            "models": self.models,
            "dryRun": self.dry_run,
            "runsPerEval": self.runs,
            "generatedAt": self.generated_at,
            "exitCode": self.exit_code,
            "results": [r.to_dict() for r in self.results],
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, sort_keys=True)

    def to_markdown(self) -> str:
        mode = "DRY-RUN (mock — not a real eval)" if self.dry_run else "REAL API"
        lines = [
            "# Table Read — LLM eval report",
            "",
            f"- PROMPT_VERSION: `{self.prompt_version}`",
            f"- models: {', '.join(f'{r}=`{m}`' for r, m in sorted(self.models.items()))}",
            f"- mode: {mode}",
            f"- runs/eval: {self.runs}",
            f"- generated: {self.generated_at}",
            f"- suite exit code: **{self.exit_code}**",
            "",
            "| Eval | Status | Metric | Score | Gate | Hard |",
            "|---|---|---|---|---|---|",
        ]
        for r in self.results:
            gate = "—" if r.gate is None else f"{r.gate:.2f}"
            lines.append(
                f"| {r.name} | {r.status} | {r.metric} | "
                f"{r.score:.3f} | {gate} | {'yes' if r.hard else 'no'} |"
            )
        lines.append("")
        for r in self.results:
            lines.append(f"### {r.name} — {r.status}")
            if r.detail:
                lines.append(f"- detail: `{json.dumps(r.detail, sort_keys=True)}`")
            for note in r.notes:
                lines.append(f"- {note}")
            lines.append("")
        return "\n".join(lines)

    def write(self, out_dir) -> tuple[str, str]:
        """Write `report.json` + `report.md` under `out_dir`; return their paths."""
        from pathlib import Path

        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        stamp = self.generated_at.replace(":", "").replace("-", "")[:15]
        json_path = out / f"report-{stamp}.json"
        md_path = out / f"report-{stamp}.md"
        json_path.write_text(self.to_json() + "\n")
        md_path.write_text(self.to_markdown() + "\n")
        return str(json_path), str(md_path)


def assert_rule5_clean(report: SuiteReport, forbidden_substrings: list[str]) -> None:
    """Rule-5 audit: fail loudly if any known fixture/writer-text substring
    appears in the rendered report. Used by the harness self-tests to prove the
    report leaks no script/plan/fact content (only ids/counts/scores)."""
    blob = report.to_json() + "\n" + report.to_markdown()
    hits = [s for s in forbidden_substrings if s and s in blob]
    if hits:
        raise AssertionError(
            f"rule-5 violation: report contains writer/fixture text fragments "
            f"({len(hits)} distinct); harness must log ids/counts only"
        )
