"""Opt-in per-failure capture artifacts for human review (test plan §3:
continuity failures "should be human-reviewed").

Capture is a **separate artifact class** from the main eval report, not a
loophole in it:

  - The report (`harness.SuiteReport`) is rule-5-clean — ids/counts/scores only,
    audited against the fixture-text fragment set at write time. That audit
    stays intact; capture never touches the report.
  - Capture files deliberately contain generated candidate text and fixture
    continuity facts, because a human reviewer needs the actual text to judge a
    continuity failure. They are therefore written **only when explicitly opted
    in** (`--capture`), into a **git-ignored** directory, each headed with a loud
    DO-NOT-COMMIT / DO-NOT-LOG banner. Nothing here is ever logged (hard rule 5
    governs logs; this is a local, opt-in review artifact the operator asked for).
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from drama_manager import render
from evals.graders import GRADER_VERSION, ContinuityVerdict

CAPTURE_WARNING = (
    "================ DO NOT COMMIT — EVAL CAPTURE ARTIFACT ================\n"
    "This file intentionally contains GENERATED candidate text and FIXTURE\n"
    "continuity facts, captured for human review of continuity-eval failures\n"
    "(test plan §3). It is NOT rule-5 clean by design.\n"
    "NEVER commit it to git. NEVER paste it into logs (CLAUDE.md hard rule 5).\n"
    "The capture directory is git-ignored; delete these files when done.\n"
    "======================================================================"
)


class CaptureSink:
    """Writes one artifact per captured eval failure under a timestamped subdir
    of `out_dir` (so repeat runs don't clobber each other)."""

    def __init__(self, out_dir: str) -> None:
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        self.dir = Path(out_dir) / stamp
        self.dir.mkdir(parents=True, exist_ok=True)
        self._count = 0

    @property
    def count(self) -> int:
        return self._count

    def record_continuity_failure(
        self,
        *,
        index: int,
        script_text: str,
        verdict: ContinuityVerdict,
        facts: list[dict],
    ) -> Path:
        """One continuity failure → one file: the candidate scriptText, the
        judge's verdict + flagged fact ids, and the checked facts (with knownBy),
        so a reviewer can classify genuine-contradiction vs judge-over-strictness."""
        self._count += 1
        path = self.dir / f"continuity-failure-{index:03d}.txt"
        lines = [
            CAPTURE_WARNING,
            "",
            "eval: continuity-adherence",
            f"PROMPT_VERSION: {render.PROMPT_VERSION}",
            f"GRADER_VERSION: {GRADER_VERSION}",
            f"run index: {index}",
            f"verdict.passes: {verdict.passes}",
            f"verdict.violatedFactIds: {verdict.violated_fact_ids}",
            f"checked fact ids: {[f.get('id') for f in facts]}",
            "",
            "--- CANDIDATE scriptText ---",
            script_text,
            "",
            "--- CONTINUITY FACTS (checked) ---",
        ]
        for f in facts:
            lines.append(
                f"[{f.get('id')}] factType={f.get('factType')} "
                f"knownBy={f.get('knownBy')} audienceKnows={f.get('audienceKnows')}"
            )
            lines.append(f"  {f.get('fact')}")
        path.write_text("\n".join(lines) + "\n")
        return path
