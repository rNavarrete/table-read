"""Self-tests for the DESIGN-GAP CI grep gate (T6.1, obligation 4)."""

from __future__ import annotations

import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import check_design_gaps  # noqa: E402  (sys.path set up above)


def test_bare_gap_is_untracked():
    assert check_design_gaps.untracked_lines("# DESIGN-GAP: unresolved question") == [1]
    assert check_design_gaps.untracked_lines("// DESIGN-GAP no id here") == [1]


def test_task_referenced_gap_is_tracked():
    assert check_design_gaps.untracked_lines("# DESIGN-GAP(T6.1): tracked") == []
    assert check_design_gaps.untracked_lines("// DESIGN-GAP(T4.5): tracked") == []


def test_mixed_lines_report_only_the_untracked_one():
    text = "# DESIGN-GAP(T6.1): ok\nprint('x')\n# DESIGN-GAP: bad\n"
    assert check_design_gaps.untracked_lines(text) == [3]


def test_current_tree_passes_the_gate():
    """Obligation 4: the gate must pass on the current tree (only the two
    properly-referenced T6.1 gaps remain in code)."""
    assert check_design_gaps.find_untracked() == []
