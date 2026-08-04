"""Harness-core self-tests (T6.1): gating math, status/exit-code logic, and
rule-5-safe report rendering. Pure — no LLM, no network."""

from __future__ import annotations

from evals.harness import EvalResult, SuiteReport, assert_rule5_clean


def _result(**kw) -> EvalResult:
    base = dict(name="e", metric="rate", score=1.0, gate=0.98, hard=True)
    base.update(kw)
    return EvalResult(**base)


def test_hard_gate_met_passes_and_does_not_block():
    r = _result(score=0.99, gate=0.98, hard=True)
    assert r.meets_gate
    assert not r.blocks
    assert r.status == "PASS"


def test_hard_gate_unmet_blocks_and_marks_fail():
    r = _result(score=0.5, gate=0.98, hard=True)
    assert not r.meets_gate
    assert r.blocks
    assert r.status == "FAIL"


def test_soft_gate_unmet_warns_but_never_blocks():
    r = _result(score=0.4, gate=0.70, hard=False)
    assert not r.meets_gate
    assert not r.blocks
    assert r.status == "WARN"


def test_report_only_eval_is_info_and_never_blocks():
    r = _result(score=0.1, gate=None, hard=False)
    assert r.meets_gate  # report-only always "meets"
    assert not r.blocks
    assert r.status == "INFO"


def test_errored_eval_is_inconclusive_and_blocks_when_hard():
    r = _result(score=1.0, errored=True, hard=True)
    assert not r.meets_gate
    assert r.blocks
    assert r.status == "ERROR"


def test_lock_violation_zero_tolerance_gate():
    # score = (attempts - violations) / attempts; one violation in 20 → below 1.0
    one_violation = _result(name="lock", metric="lock-safe", score=19 / 20, gate=1.0, hard=True)
    assert one_violation.blocks
    clean = _result(name="lock", score=1.0, gate=1.0, hard=True)
    assert not clean.blocks


def _report(results) -> SuiteReport:
    return SuiteReport(
        prompt_version="0.5.0",
        models={
            "writer": "claude-sonnet-5",
            "classifier": "claude-haiku-4-5",
            "import_analyst": "claude-opus-5",
        },
        dry_run=False,
        runs={
            "schemaValidity": 5,
            "actBoundaryValidity": 5,
            "lockViolation": 20,
            "continuityAdherence": 20,
            "segmentationDeterminism": 5,
            "lockRepairQuality": 5,
            "importInference": 5,
            "subtextFidelity": 5,
            "actBoundaryQuality": 5,
        },
        results=results,
    )


def test_suite_exit_code_nonzero_iff_any_hard_gate_fails():
    ok = _report([_result(score=1.0), _result(name="soft", score=0.0, gate=0.7, hard=False)])
    assert ok.exit_code == 0
    bad = _report([_result(score=1.0), _result(name="lock", score=0.9, gate=1.0, hard=True)])
    assert bad.exit_code == 1


def test_single_lock_violation_exits_nonzero():
    """Self-review item: one lock violation must force a nonzero suite exit."""
    lock = _result(name="lock-violation", metric="lock-safe", score=39 / 40, gate=1.0, hard=True)
    report = _report([_result(score=1.0), lock])
    assert lock.blocks
    assert report.exit_code == 1


def test_report_renders_json_and_markdown_with_version_and_models():
    report = _report([_result(name="schema-validity", score=0.99)])
    blob = report.to_json()
    assert '"promptVersion": "0.5.0"' in blob
    assert "claude-sonnet-5" in blob
    md = report.to_markdown()
    assert "PROMPT_VERSION" in md
    assert "schema-validity" in md
    assert "suite exit code" in md


def test_rule5_audit_flags_leaked_fixture_text():
    """The audit fails when writer/fixture text leaks into the report."""
    leaked = _report([
        EvalResult(
            name="e",
            metric="rate",
            score=1.0,
            gate=0.98,
            hard=True,
            notes=["Marta slides a folded printout across the counter"],
        )
    ])
    try:
        assert_rule5_clean(leaked, ["Marta slides a folded printout"])
        raise AssertionError("expected rule-5 audit to fail on leaked text")
    except AssertionError as exc:
        assert "rule-5 violation" in str(exc)


def test_rule5_audit_passes_on_clean_report():
    clean = _report([_result(name="schema-validity", score=1.0)])
    # ids/counts only → no fixture text present
    assert_rule5_clean(clean, ["Marta slides a folded printout", "ice machine", "sixty days"])


def test_write_is_a_runtime_rule5_choke_point(tmp_path):
    """Review fix 2: `write` audits against the fixture-derived fragment set
    before writing — a leaking report never lands on disk."""
    leaked = _report([
        EvalResult(
            name="e",
            metric="rate",
            score=1.0,
            gate=0.98,
            hard=True,
            # a complete fixture field value (fact-02's fact text) — the audit
            # matches whole fixture fragments appearing inside report text
            notes=["The stolen $40,000 is hidden inside the bar's basement ice machine"],
        )
    ])
    try:
        leaked.write(tmp_path)
        raise AssertionError("expected write() to fail the rule-5 audit")
    except AssertionError as exc:
        assert "rule-5 violation" in str(exc)
    assert list(tmp_path.iterdir()) == []  # nothing written


def test_write_clean_report_lands_both_artifacts(tmp_path):
    clean = _report([_result(name="schema-validity", score=1.0)])
    json_path, md_path = clean.write(tmp_path)
    names = {p.name for p in tmp_path.iterdir()}
    assert {json_path.rsplit("/", 1)[-1], md_path.rsplit("/", 1)[-1]} == names


def test_estimated_calls_render_in_report_header():
    report = SuiteReport(
        prompt_version="0.5.0",
        models={"writer": "w", "classifier": "c", "import_analyst": "i"},
        dry_run=False,
        runs={
            "schemaValidity": 5,
            "actBoundaryValidity": 5,
            "lockViolation": 20,
            "continuityAdherence": 20,
            "segmentationDeterminism": 5,
            "lockRepairQuality": 5,
            "importInference": 5,
            "subtextFidelity": 5,
            "actBoundaryQuality": 5,
        },
        results=[_result(score=1.0)],
        estimated_calls={"schemaValidity": 140, "totalNominal": 283},
    )
    assert '"estimatedApiCalls"' in report.to_json()
    md = report.to_markdown()
    assert "estimated real-API calls" in md
    assert "total 283" in md
