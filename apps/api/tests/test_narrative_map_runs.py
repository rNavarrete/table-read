"""Rejection diagnostics on the Narrative Map run response."""

from datetime import UTC, datetime
from types import SimpleNamespace

from drama_manager import narrative_map_runs
from drama_manager.narrative_map_runs import NARRATIVE_MAP_ANALYSIS_VERSION


def test_rejected_run_surfaces_why_the_evidence_gate_refused_it():
    """A rejection that has already cost a full analysis must say what failed.
    The diagnostics were recorded on the checkpoint and shown nowhere, so an
    over-claiming synthesis was indistinguishable from an unsupportable script
    without reading SQLite by hand."""
    run = SimpleNamespace(
        id="nmap-1",
        project_id="proj-1",
        source_snapshot_id="snap-1",
        source_hash="h",
        analysis_version=NARRATIVE_MAP_ANALYSIS_VERSION,
        status="rejected",
        phase="failed",
        scene_count=27,
        completed_scene_count=27,
        attempt_count=1,
        estimated_cost_usd=None,
        actual_input_tokens=None,
        actual_output_tokens=None,
        result_snapshot_id=None,
        error_code="EVIDENCE_REJECTED",
        error_message="rejected",
        checkpoint={
            "rejectionDiagnostics": [
                {"code": "verifier_rejected", "path": "sceneTurns[1].turnBeatId"},
                {"code": "verifier_rejected", "path": "themes[0].evidence"},
                {"path": ""},
                "not-a-dict",
            ]
        },
        created_at=datetime(2026, 8, 10, tzinfo=UTC),
        updated_at=datetime(2026, 8, 10, tzinfo=UTC),
    )

    payload = narrative_map_runs.serialize_run(run)

    assert payload["rejectionDiagnostics"] == [
        {"code": "verifier_rejected", "path": "sceneTurns[1].turnBeatId"},
        {"code": "verifier_rejected", "path": "themes[0].evidence"},
    ], "blank and malformed entries are dropped, not rendered as empty rows"


def test_run_without_diagnostics_reports_an_empty_list():
    run = SimpleNamespace(
        id="nmap-2",
        project_id="proj-1",
        source_snapshot_id="snap-1",
        source_hash="h",
        analysis_version=NARRATIVE_MAP_ANALYSIS_VERSION,
        status="completed",
        phase="done",
        scene_count=1,
        completed_scene_count=1,
        attempt_count=1,
        estimated_cost_usd=None,
        actual_input_tokens=None,
        actual_output_tokens=None,
        result_snapshot_id="snap-2",
        error_code=None,
        error_message=None,
        checkpoint=None,
        created_at=datetime(2026, 8, 10, tzinfo=UTC),
        updated_at=datetime(2026, 8, 10, tzinfo=UTC),
    )

    assert narrative_map_runs.serialize_run(run)["rejectionDiagnostics"] == []
