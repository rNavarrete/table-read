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
                {
                    "code": "verifier_rejected",
                    "path": "sceneTurns[1].turnBeatId",
                    "reason": "beat-1-2 is Leo/Josh dialogue, not the turn claimed here.",
                },
                # Recorded before the verifier had a reason field to fill.
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
        {
            "code": "verifier_rejected",
            "path": "sceneTurns[1].turnBeatId",
            "reason": "beat-1-2 is Leo/Josh dialogue, not the turn claimed here.",
        },
        {"code": "verifier_rejected", "path": "themes[0].evidence", "reason": ""},
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


def _completed_run(checkpoint: dict) -> SimpleNamespace:
    return SimpleNamespace(
        id="nmap-3",
        project_id="proj-1",
        source_snapshot_id="snap-1",
        source_hash="h",
        analysis_version=NARRATIVE_MAP_ANALYSIS_VERSION,
        status="completed",
        phase="complete",
        scene_count=27,
        completed_scene_count=27,
        attempt_count=1,
        estimated_cost_usd=None,
        actual_input_tokens=None,
        actual_output_tokens=None,
        result_snapshot_id="snap-2",
        error_code=None,
        error_message=None,
        checkpoint=checkpoint,
        created_at=datetime(2026, 8, 13, tzinfo=UTC),
        updated_at=datetime(2026, 8, 13, tzinfo=UTC),
    )


def test_completed_run_says_what_the_evidence_gate_removed_and_why():
    """A map that publishes after local repair has had claims pruned from it,
    and the writer saw a smaller map with no word about why. On one real run
    the gate blanked a character's want; on the next, it removed a whole theme
    and cleared another character's arc summary. "Never rewrite silently" is
    the design doc's first trust rule — this is the gate's half of keeping it.

    (An earlier version of this docstring said the gate had "dropped an entire
    character". It had not: the arc published with its want cleared. The check
    that said otherwise matched a name against a hex character id.)"""
    run = _completed_run(
        {
            "verification": {
                "unsupportedClaims": [
                    {
                        "path": "themes[0].evidence[0] (beat-10-1)",
                        "reason": "beat-10-1 shows Josh replaying the tape, nothing more.",
                        "excerptCarriesClaim": False,
                    },
                    {
                        "path": "characterArcs[C.J.].arcSummary",
                        "reason": "No cited beat shows C.J. admitting to anything.",
                        "excerptCarriesClaim": False,
                    },
                ]
            },
            "verificationRepairs": [
                {
                    "action": "remove_theme",
                    "path": "themes[0].evidence[0] (beat-10-1)",
                    "label": "Tactlessness as the price of conviction",
                },
                {
                    "action": "clear_character_arc_claim",
                    "path": "characterArcs[C.J.].arcSummary",
                    "characterName": "C.J.",
                    "field": "arcSummary",
                },
                {"action": "remove_character_arc", "path": "characterArcs[Bartlet]",
                 "characterName": "Bartlet"},
                {"action": "clear_act_escalation", "path": "acts[0].escalation", "act": 0},
                {"action": "clear_scene_turn_claim", "path": "sceneTurns[scene-14].stakes",
                 "sceneId": "scene-14", "field": "stakes"},
                # Advisories did nothing to the map and must not be listed.
                {"action": "record_verifier_advisory", "path": "acts[4].turnBeatId",
                 "reason": "Supported, worth a look."},
                {"action": "record_self_retracted_claim", "path": "themes[1].statement",
                 "reason": "Actually supported."},
                "not-a-dict",
            ],
        }
    )

    payload = narrative_map_runs.serialize_run(run)

    assert payload["removedClaims"] == [
        {
            "action": "remove_theme",
            "path": "themes[0].evidence[0] (beat-10-1)",
            "subject": 'Theme "Tactlessness as the price of conviction"',
            "reason": "beat-10-1 shows Josh replaying the tape, nothing more.",
        },
        {
            "action": "clear_character_arc_claim",
            "path": "characterArcs[C.J.].arcSummary",
            "subject": "C.J.'s arc summary",
            "reason": "No cited beat shows C.J. admitting to anything.",
        },
        {
            "action": "remove_character_arc",
            "path": "characterArcs[Bartlet]",
            "subject": "Bartlet's character arc",
            "reason": "",
        },
        {
            "action": "clear_act_escalation",
            "path": "acts[0].escalation",
            "subject": "Cold open escalation",
            "reason": "",
        },
        {
            "action": "clear_scene_turn_claim",
            "path": "sceneTurns[scene-14].stakes",
            "subject": "Scene 14 stakes",
            "reason": "",
        },
    ]


def test_removed_claims_are_empty_unless_the_run_completed():
    """A rejected run has `rejectionDiagnostics`; nothing was pruned from a map
    that was never published, whatever the checkpoint holds."""
    run = _completed_run(
        {"verificationRepairs": [{"action": "remove_theme", "path": "themes[0]", "label": "x"}]}
    )
    run.status = "rejected"

    assert narrative_map_runs.serialize_run(run)["removedClaims"] == []
    assert narrative_map_runs.serialize_run(_completed_run({}))["removedClaims"] == []


def test_completed_run_is_retryable_only_for_what_it_could_not_analyse():
    assert narrative_map_runs.serialize_run(_completed_run({}))["retryAllowed"] is False
    with_gaps = _completed_run({"unanalyzedSceneIds": ["scene-4"]})
    assert narrative_map_runs.serialize_run(with_gaps)["retryAllowed"] is True
    # A map converted by the T9.3 migration sits on a pre-3.6 run; Generate starts a new one.
    older = _completed_run({})
    older.analysis_version = "2.6"
    assert narrative_map_runs.serialize_run(older)["retryAllowed"] is True
