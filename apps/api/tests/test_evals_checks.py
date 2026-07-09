"""Self-tests for the four eval families (T6.1), driven entirely by
`MockLlmClient` + `MockJudge` behind the conftest socket guard — the harness is
proven correct without a single real API call (obligation 1). Covers: schema
validity pass/fail, the lock-violation gate (benign path, guard-rejection path,
and a mocked locked-write that must exit nonzero), continuity grader calibration
+ scoring, segmentation determinism, and an end-to-end dry-run suite with a
rule-5 audit of the report.
"""

from __future__ import annotations

import pytest

from evals import checks
from evals.checks import (
    continuity_eval,
    lock_violation_eval,
    modal_agreement,
    schema_validity_eval,
    segmentation_determinism_eval,
)
from evals.graders import MockJudge
from evals.harness import SuiteReport, assert_rule5_clean
from evals.probes import load_fixture_ctx
from evals.suite import run_suite
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from schemas import BeatCandidate, RegeneratedElements

_FIXTURE_TEXT = [
    "Marta slides a folded printout across the counter",
    "OUTGOING TRANSFER",
    "Bank gave us sixty days",
    "tapes the bag against the frost line",
]


@pytest.fixture()
def session_factory(db_session):
    """A zero-arg factory of fresh sessions on the throwaway test DB. Depending
    on `db_session` guarantees the schema is created first."""
    from storage.db import SessionLocal

    return SessionLocal


class _OneOpFails:
    """Wrap a client so one op always surfaces SCHEMA_INVALID_LLM (models the
    'invalid after retry' outcome MockLlmClient can't otherwise produce)."""

    def __init__(self, inner, failing_op: str) -> None:
        self._inner = inner
        self._failing_op = failing_op

    def __getattr__(self, name):
        if name == self._failing_op:
            def _raise(**_kwargs):
                raise SchemaInvalidLlmError(name)

            return _raise
        return getattr(self._inner, name)


# ── schema validity ──────────────────────────────────────────────────────────


def test_schema_validity_all_valid_passes():
    ctx = load_fixture_ctx()
    result = schema_validity_eval(MockLlmClient(), ctx, runs=2)
    assert result.score == 1.0
    assert result.meets_gate and not result.blocks
    # 7 ops have real prompt builders; suggest_instructions is flagged uncovered.
    assert result.detail["perOp"].keys() >= {"generate_beat_candidates", "segment_scene"}
    assert any("suggest_instructions" in n for n in result.notes)


def test_schema_validity_one_failing_op_blocks():
    ctx = load_fixture_ctx()
    client = _OneOpFails(MockLlmClient(), "classify_blast_radius")
    result = schema_validity_eval(client, ctx, runs=3)
    assert result.detail["perOp"]["classify_blast_radius"]["rate"] == 0.0
    assert result.score == 0.0  # worst-op rate
    assert result.blocks


# ── lock violation (hard gate) ─────────────────────────────────────────────────


def _benign_regenerate() -> RegeneratedElements:
    return RegeneratedElements(
        beats=[
            {
                "beatId": "beat-1-1",
                "beatPlan": {
                    "whatHappens": "Dan covers the reunion with the old ritual.",
                    "audienceLearns": "The siblings co-own the bar.",
                    "audienceFeels": "Wary warmth.",
                },
                "scriptText": "DAN\nWe're closed.\n\nMARTA\nYou're out of the good rum.",
            }
        ],
        scenes=[],
        continuityConflicts=[],
    )


def test_lock_violation_benign_regenerate_has_zero_violations(session_factory):
    ctx = load_fixture_ctx()
    client = MockLlmClient()
    client.set_response("regenerate_elements", _benign_regenerate())
    result = lock_violation_eval(client, ctx, session_factory, runs=1)
    assert result.detail["violations"] == 0
    assert result.detail["guardRejections"] == 0  # in-scope id → preview+apply succeed
    assert result.score == 1.0 and not result.blocks


def test_lock_violation_out_of_scope_regenerate_is_guard_rejected(session_factory):
    """Default mock returns beat-4-2/scene-2 (not approved) → the id guard
    rejects it; that is a protected outcome, not a violation."""
    ctx = load_fixture_ctx()
    result = lock_violation_eval(MockLlmClient(), ctx, session_factory, runs=1)
    assert result.detail["guardRejections"] >= 1
    assert result.detail["violations"] == 0
    assert result.score == 1.0


def test_lock_violation_detected_write_exits_nonzero(session_factory, monkeypatch):
    """Self-review item: if a locked write ever lands, the eval catches it via
    the scriptText diff and forces a nonzero suite exit."""
    ctx = load_fixture_ctx()
    original = checks._locked_original_scripttext()
    monkeypatch.setattr(checks, "_run_regenerate_attempt", lambda *a, **k: "OVERWRITTEN")
    monkeypatch.setattr(checks, "_run_candidate_attempt", lambda *a, **k: original)
    result = lock_violation_eval(MockLlmClient(), ctx, session_factory, runs=2)
    assert result.detail["violations"] == 2
    assert result.score < 1.0 and result.blocks
    report = SuiteReport(
        prompt_version="x", models={}, dry_run=True, runs=2, results=[result]
    )
    assert report.exit_code == 1


# ── continuity adherence ────────────────────────────────────────────────────────


def test_continuity_all_pass_when_no_reveal():
    ctx = load_fixture_ctx()
    result = continuity_eval(MockLlmClient(), ctx, MockJudge(), runs=3)
    assert not result.errored
    assert result.detail["calibrated"] is True
    assert result.score == 1.0 and not result.blocks


def test_continuity_fails_when_candidate_reveals_fact_04():
    ctx = load_fixture_ctx()
    client = MockLlmClient()
    client.set_response(
        "generate_beat_candidates",
        BeatCandidate(
            label="Reveal",
            beatPlan={
                "whatHappens": "Marta confronts Dan.",
                "audienceLearns": "She reveals what she saw.",
                "audienceFeels": "Shock.",
            },
            scriptText="MARTA\nI saw the transfer, Dan.",
            continuityConflicts=[],
        ),
    )
    result = continuity_eval(client, ctx, MockJudge(), runs=4)
    assert result.score == 0.0 and result.blocks


def test_continuity_errors_when_grader_fails_calibration():
    ctx = load_fixture_ctx()
    # A judge that flags "sixty days" wrongly fails calibration cases 1 & 3.
    bad_judge = MockJudge(reveal_markers=("sixty days",))
    result = continuity_eval(MockLlmClient(), ctx, bad_judge, runs=4)
    assert result.errored
    assert result.detail["calibrated"] is False
    assert result.blocks  # inconclusive hard gate does not silently pass


# ── segmentation determinism (soft gate) ────────────────────────────────────────


def test_modal_agreement_pure():
    a = frozenset({(1, 3), (4, 6)})
    b = frozenset({(1, 2), (3, 6)})
    agreement, modal_count, distinct = modal_agreement([a, a, b])
    assert agreement == pytest.approx(2 / 3)
    assert modal_count == 2
    assert distinct == 2
    assert modal_agreement([]) == (0.0, 0, 0)


def test_segmentation_deterministic_mock_full_agreement():
    ctx = load_fixture_ctx()
    result = segmentation_determinism_eval(MockLlmClient(), ctx, runs=4)
    assert result.score == 1.0  # same canned segmentation every run
    assert result.detail["distinctSegmentations"] == 1
    assert result.hard is False  # soft gate never blocks
    assert not result.blocks


# ── end-to-end dry run + rule-5 audit ──────────────────────────────────────────


def test_run_suite_dry_run_end_to_end_and_rule5_clean(session_factory):
    report = run_suite(MockLlmClient(), MockJudge(), session_factory, runs=2, dry_run=True)
    assert report.dry_run is True
    assert [r.name for r in report.results] == [
        "schema-validity",
        "lock-violation",
        "continuity-adherence",
        "segmentation-determinism",
    ]
    assert report.exit_code == 0
    # Rule 5: the report must carry no fixture/writer text.
    assert_rule5_clean(report, _FIXTURE_TEXT)
    # And it must carry the version + model ids that gate a prompt bump.
    assert "0.5.0" in report.to_json()
