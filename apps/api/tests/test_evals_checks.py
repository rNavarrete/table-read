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

from drama_manager.render import PROMPT_VERSION
from evals import checks, probes
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
from evals.suite import resolve_run_map, run_suite
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from schemas import BeatCandidate, InferredActBreaks, RegeneratedElements

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
    # All registered ops have real prompt builders (incl. suggest_instructions / A4).
    assert result.detail["perOp"].keys() >= {
        "generate_beat_candidates",
        "infer_act_breaks",
        "segment_scene",
        "suggest_instructions",
    }
    assert not any("suggest_instructions" in n and "uncovered" in n.lower() for n in result.notes)


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


def test_lock_violation_missing_preview_target_is_guard_rejected(session_factory):
    """If the model omits the approved unlocked beat from its preview payload,
    apply refuses the unpreviewed id before mutation. The lock eval must count
    that protected refusal rather than crash the whole suite."""
    ctx = load_fixture_ctx()
    client = MockLlmClient()
    client.set_response(
        "regenerate_elements",
        RegeneratedElements(beats=[], scenes=[], continuityConflicts=[]),
    )
    result = lock_violation_eval(client, ctx, session_factory, runs=1)
    assert result.detail["guardRejections"] >= 1
    assert result.detail["violations"] == 0
    assert result.score == 1.0


def test_lock_violation_schema_failure_is_protected_not_crash(session_factory):
    ctx = load_fixture_ctx()
    client = _OneOpFails(MockLlmClient(), "generate_beat_candidates")
    result = lock_violation_eval(client, ctx, session_factory, runs=1)
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
        prompt_version="x", models={}, dry_run=True, runs=resolve_run_map(2), results=[result]
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


# ── act-boundary quality (soft gate) ────────────────────────────────────────────


def test_act_boundary_quality_scores_within_two_scenes():
    client = MockLlmClient()
    client.set_responses(
        "infer_act_breaks",
        [
            InferredActBreaks(
                starts=[
                    {"act": 0, "startSceneIndex": 0},
                    {"act": 1, "startSceneIndex": 2},
                    {"act": 2, "startSceneIndex": 5},
                ]
            ),
            InferredActBreaks(
                starts=[
                    {"act": 0, "startSceneIndex": 0},
                    {"act": 1, "startSceneIndex": 1},
                    {"act": 2, "startSceneIndex": 3},
                    {"act": 3, "startSceneIndex": 4},
                    {"act": 4, "startSceneIndex": 5},
                ]
            ),
        ],
    )
    result = checks.act_boundary_quality_eval(client, load_fixture_ctx(), runs=1)
    assert result.score >= 0.8
    assert not result.blocks


def test_act_boundary_quality_semantic_invalid_scores_zero_without_text_leak():
    invalid = InferredActBreaks(starts=[{"act": 0, "startSceneIndex": 1}])
    client = MockLlmClient()
    client.set_responses("infer_act_breaks", [invalid, invalid])

    result = checks.act_boundary_quality_eval(client, load_fixture_ctx(), runs=1)

    assert result.score == 0.0
    assert result.detail["invalid"] == 2
    assert result.detail["expected"] == sum(
        len(case["expectedStarts"]) for case in probes.act_boundary_cases(load_fixture_ctx())
    )
    detail = repr(result.detail)
    assert "Nia hides a disastrous birthday cake" not in detail
    assert "Marta slides a folded printout" not in detail
    assert not result.blocks


# ── end-to-end dry run + rule-5 audit ──────────────────────────────────────────


def test_run_suite_dry_run_end_to_end_and_rule5_clean(session_factory, tmp_path):
    report = run_suite(
        MockLlmClient(), MockJudge(), session_factory, runs=resolve_run_map(2), dry_run=True
    )
    assert report.dry_run is True
    assert [r.name for r in report.results] == [
        "schema-validity",
        "lock-violation",
        "continuity-adherence",
    ]
    assert report.exit_code == 0
    # Rule 5: the report must carry no fixture/writer text.
    assert_rule5_clean(report, _FIXTURE_TEXT)
    # And the runtime choke point (write-time audit vs the full fixture-derived
    # fragment set) must also pass on a real suite report.
    report.write(tmp_path)
    # And it must carry the version + model ids that gate a prompt bump.
    assert PROMPT_VERSION in report.to_json()


def test_run_suite_full_includes_soft_families(session_factory):
    report = run_suite(
        MockLlmClient(),
        MockJudge(),
        session_factory,
        runs=resolve_run_map(1),
        dry_run=True,
        full=True,
    )
    assert [r.name for r in report.results] == [
        "schema-validity",
        "lock-violation",
        "continuity-adherence",
        "segmentation-determinism",
        "lock-repair-quality",
        "import-inference",
        "subtext-fidelity",
        "act-boundary-quality",
    ]


# ── cost visibility + CLI guards (review fixes 1 & 3) ──────────────────────────


def test_default_run_map_tiers_hard_and_soft():
    from evals.suite import HARD_RUNS, SOFT_RUNS, default_run_map

    m = default_run_map()
    assert m["lockViolation"] == HARD_RUNS == 5
    assert m["continuityAdherence"] == 5
    assert m["schemaValidity"] == SOFT_RUNS == 5
    assert m["segmentationDeterminism"] == 5
    assert m["lockRepairQuality"] == 5
    assert m["importInference"] == 5
    assert m["subtextFidelity"] == 5
    assert m["actBoundaryQuality"] == 5


def test_resolve_run_map_override_is_uniform():
    from evals.suite import resolve_run_map

    m = resolve_run_map(1)
    assert set(m.values()) == {1}
    assert len(m) == 8


def test_nominal_call_estimate_core_defaults():
    from evals.suite import (
        CORE_EVAL_KEYS,
        default_run_map,
        filter_call_estimate,
        nominal_call_estimate,
    )

    core = filter_call_estimate(nominal_call_estimate(default_run_map()), CORE_EVAL_KEYS)
    assert core["schemaValidity"] == 45  # 9 probes × 5
    assert core["lockViolation"] == 20
    assert core["continuityAdherence"] == 13
    assert core["totalNominal"] == 78
    assert "subtextFidelity" not in core
    assert "actBoundaryQuality" not in core


def test_nominal_call_estimate_uniform_one():
    from evals.suite import (
        CORE_EVAL_KEYS,
        filter_call_estimate,
        nominal_call_estimate,
        resolve_run_map,
    )

    core = filter_call_estimate(nominal_call_estimate(resolve_run_map(1)), CORE_EVAL_KEYS)
    assert core["totalNominal"] == 18


def test_run_suite_report_carries_call_estimate(session_factory):
    report = run_suite(
        MockLlmClient(), MockJudge(), session_factory, runs=resolve_run_map(2), dry_run=True
    )
    assert report.estimated_calls["totalNominal"] > 0
    assert "estimatedApiCalls" in report.to_json()


def test_cli_rejects_runs_below_one():
    """Review fix 3: --runs 0 must be a clear CLI error, not a ZeroDivisionError."""
    from evals import run as run_module

    for bad in ("0", "-3"):
        with pytest.raises(SystemExit) as excinfo:
            run_module.main(["--dry-run", "--runs", bad])
        assert excinfo.value.code == 2  # argparse error exit


# ── capture mode + --only (T6.1 harness capture affordance, test plan §3) ───────


def test_only_choices_match_suite_eval_keys():
    """The CLI's --only choices mirror suite.EVAL_KEYS (run.py duplicates them to
    avoid importing storage at parse time); this guards against drift."""
    from evals import run as run_module
    from evals.suite import EVAL_KEYS

    assert set(run_module._ONLY_CHOICES) == set(EVAL_KEYS)


def test_cli_parses_only_and_capture_defaults():
    from evals import run as run_module

    args = run_module._parse_args(["--only", "continuity", "--capture"])
    assert args.only == "continuity"
    assert args.capture == str(run_module._DEFAULT_CAPTURE)  # bare --capture → default dir

    args2 = run_module._parse_args(["--capture", "/tmp/whatever"])
    assert args2.capture == "/tmp/whatever"

    args3 = run_module._parse_args([])
    assert args3.only is None and args3.capture is None  # opt-in only


def test_cli_rejects_unknown_only():
    from evals import run as run_module

    with pytest.raises(SystemExit) as excinfo:
        run_module._parse_args(["--only", "bogus"])
    assert excinfo.value.code == 2


def test_cli_calibrate_only_dry_run_passes(capsys):
    """--calibrate-only is the cheap grader-discipline gate check: in dry-run
    (MockJudge scores every calibration case correctly) it exits 0 and never
    runs the suite."""
    from evals import run as run_module

    rc = run_module.main(["--dry-run", "--calibrate-only"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "calibrated=true" in out
    assert "continuity-adherence" not in out  # suite did not run


def test_run_suite_only_runs_single_eval(session_factory):
    report = run_suite(
        MockLlmClient(),
        MockJudge(),
        session_factory,
        runs=resolve_run_map(1),
        dry_run=True,
        only="continuity",
    )
    assert [r.name for r in report.results] == ["continuity-adherence"]
    # Estimate is scoped to just the selected family (truthful cost header).
    assert set(report.estimated_calls) == {"continuityAdherence", "totalNominal"}


def test_run_suite_only_act_boundaries_uses_two_calls(session_factory):
    report = run_suite(
        MockLlmClient(),
        MockJudge(),
        session_factory,
        runs=resolve_run_map(1),
        dry_run=True,
        only="act-boundaries",
    )
    assert [r.name for r in report.results] == ["act-boundary-quality"]
    assert report.estimated_calls == {
        "actBoundaryQuality": 2,
        "totalNominal": 2,
    }


def test_capture_writes_failure_artifact_with_warning(tmp_path):
    from evals.capture import CAPTURE_WARNING, CaptureSink

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
    sink = CaptureSink(str(tmp_path))
    result = continuity_eval(client, ctx, MockJudge(), runs=2, capture=sink)
    assert result.score == 0.0  # both runs fail
    assert sink.count == 2
    files = list(sink.dir.glob("continuity-failure-*.txt"))
    assert len(files) == 2
    body = files[0].read_text()
    assert CAPTURE_WARNING.splitlines()[0] in body  # loud do-not-commit banner
    assert "fact-04" in body  # verdict + checked fact ids present


def test_capture_writes_nothing_when_all_pass(tmp_path):
    from evals.capture import CaptureSink

    ctx = load_fixture_ctx()
    sink = CaptureSink(str(tmp_path))
    result = continuity_eval(MockLlmClient(), ctx, MockJudge(), runs=3, capture=sink)
    assert result.score == 1.0
    assert sink.count == 0
    assert list(sink.dir.glob("continuity-failure-*.txt")) == []


def test_capture_dir_is_gitignored():
    """The default capture dir must be git-ignored (capture files carry
    generated/fixture text — CLAUDE.md rule 5, test plan §3)."""
    import subprocess
    from pathlib import Path

    repo = Path(__file__).resolve().parents[3]
    probe = "apps/api/evals/captures/20260101T000000/continuity-failure-001.txt"
    out = subprocess.run(
        ["git", "check-ignore", probe], cwd=repo, capture_output=True, text=True
    )
    assert out.returncode == 0, "capture dir is not git-ignored"
