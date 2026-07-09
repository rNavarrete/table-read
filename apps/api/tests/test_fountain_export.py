"""Fountain export (apps/api/fountain/export.py): walk scenes/beats → text.

The cross-language "valid Fountain / round-trips through fountain-js" half of
the T1.3 acceptance is split across a committed golden file: this suite proves
`to_fountain(fixture)` equals the golden bytes, and the vitest suite
(packages/contract/src/fountain-roundtrip.test.ts) proves the golden parses
through fountain-js with the expected scene-heading count.
"""

from __future__ import annotations

from pathlib import Path

from fountain.export import to_fountain
from storage.seed import load_fixture

_GOLDEN = Path(__file__).resolve().parent / "data" / "long-pour.fountain"


def test_export_walks_beats_in_order():
    project = load_fixture()["project"]
    text = to_fountain(project)
    # first scripted beat opens the document with its slugline
    assert text.startswith("INT. THE LONG POUR - NIGHT")
    # every scripted beat's text is present, in order
    idx_first = text.index("INT. THE LONG POUR - NIGHT")
    idx_office = text.index("INT. THE LONG POUR - BACK OFFICE - LATER")
    idx_basement = text.index("INT. THE LONG POUR - BASEMENT - NIGHT")
    assert idx_first < idx_office < idx_basement


def test_export_skips_beats_without_script_text():
    project = load_fixture()["project"]
    text = to_fountain(project)
    # scene-5's only beat has empty scriptText and scene-6 has no beats; the
    # fixture's six scripted beats each carry a slugline → six headings.
    assert text.count("INT.") + text.count("EXT.") == 6


def test_export_matches_committed_golden():
    project = load_fixture()["project"]
    assert to_fountain(project) == _GOLDEN.read_text(encoding="utf-8")
