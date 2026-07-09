#!/usr/bin/env python3
"""CI gate for CLAUDE.md's DESIGN-GAP convention (T6.1, obligation 4).

CLAUDE.md: "CI greps for `DESIGN-GAP` and fails unless each occurrence
references a task id (`// DESIGN-GAP(T4.5): ...`)." This script is that grep.
Every `DESIGN-GAP` in source code must be written `DESIGN-GAP(T<id>)` (e.g.
`DESIGN-GAP(T6.1)`); a bare `DESIGN-GAP` (or `DESIGN-GAP:`) fails the build, so
a design question can never be left untracked.

Scope — source code only. The convention is a *code comment* form
(`// DESIGN-GAP(Tx): ...` / `# DESIGN-GAP(Tx): ...`), so this scans code files
(.py/.ts/.tsx/.js/.jsx) under apps/, scripts/, packages/, and config/, skipping
vendored/build trees. Markdown docs (CLAUDE.md itself, the build plan) are
deliberately out of scope: they *describe* the convention and legitimately
contain the bare token in prose and examples — grepping them would make the
rule fail on its own definition. Documented here and in the T6.1 report.

Runs on the PR path via `make lint` (which depends on `make check-gaps`).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

_SCAN_ROOTS = ("apps", "scripts", "packages", "config")
_CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx"}
_SKIP_DIRS = {".venv", "node_modules", "dist", "build", "__pycache__", ".git", ".pytest_cache"}

# A `DESIGN-GAP` NOT immediately followed by a `(T<id>)` reference is untracked.
_UNTRACKED = re.compile(r"DESIGN-GAP(?!\(T[0-9.]+\))")


def _is_meta(path: Path) -> bool:
    """Files that legitimately hold the literal token as data/pattern rather
    than a gap marker: this enforcer itself, and test files (whose fixtures may
    contain bare `DESIGN-GAP` strings on purpose). Real gaps to track live in
    shipped source, not in test data or the linter."""
    name = path.name
    if name == "check_design_gaps.py":
        return True
    return name.startswith("test_") or ".test." in name or ".spec." in name


def _iter_code_files() -> list[Path]:
    files: list[Path] = []
    for root_name in _SCAN_ROOTS:
        root = REPO_ROOT / root_name
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.suffix not in _CODE_SUFFIXES:
                continue
            if any(part in _SKIP_DIRS for part in path.parts):
                continue
            if _is_meta(path):
                continue
            files.append(path)
    return files


def untracked_lines(text: str) -> list[int]:
    """1-indexed line numbers holding a DESIGN-GAP without a `(T<id>)` reference."""
    return [
        lineno
        for lineno, line in enumerate(text.splitlines(), start=1)
        if _UNTRACKED.search(line)
    ]


def find_untracked() -> list[str]:
    failures: list[str] = []
    for path in _iter_code_files():
        try:
            text = path.read_text()
        except (OSError, UnicodeDecodeError):
            continue
        if "DESIGN-GAP" not in text:
            continue
        rel = path.relative_to(REPO_ROOT)
        for lineno in untracked_lines(text):
            failures.append(f"{rel}:{lineno}: untracked DESIGN-GAP (need DESIGN-GAP(T<id>))")
    return failures


def main() -> int:
    failures = find_untracked()
    if failures:
        print("check-gaps: FAILED — every DESIGN-GAP must reference a task id\n", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("check-gaps: OK (all DESIGN-GAP occurrences reference a task id)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
