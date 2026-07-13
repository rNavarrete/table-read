"""Self-tests for the v1.1 family-level checkpoint + `--resume` (T6.1),
driven entirely by `MockLlmClient` + `MockJudge` (obligation 1). Covers the
checkpoint module in isolation (round-trip, pin mismatches), `run_suite`
wiring (skip already-done families, never write a partial family, stable
suite-order merge of prior + new results), and the CLI's `--resume` plumbing.
"""

from __future__ import annotations

import pytest

from evals import adoption, checks
from evals.checkpoint import (
    assert_checkpoint_matches,
    checkpoint_path,
    eval_result_from_dict,
    load_checkpoint,
    write_checkpoint,
)
from evals.graders import MockJudge
from evals.harness import EvalResult
from evals.suite import load_model_roles, resolve_run_map, run_suite
from llm.mock import MockLlmClient

_MODELS = {"writer": "claude-writer-mock", "classifier": "claude-classifier-mock"}
_RUNS = resolve_run_map(1)


@pytest.fixture()
def session_factory(db_session):
    from storage.db import SessionLocal

    return SessionLocal


def _result(**kw) -> EvalResult:
    base = dict(name="schema-validity", metric="rate", score=1.0, gate=0.98, hard=True)
    base.update(kw)
    return EvalResult(**base)


def _complete_results() -> list[EvalResult]:
    return [
        _result(name="schema-validity"),
        _result(name="act-boundary-validity", gate=1.0),
        _result(name="lock-violation", gate=1.0),
        _result(name="continuity-adherence"),
        _result(name="segmentation-determinism", hard=False),
        _result(name="lock-repair-quality", hard=False),
        _result(name="import-inference", hard=False),
        _result(name="subtext-fidelity", hard=False),
        _result(name="act-boundary-quality", hard=False),
    ]


# ── checkpoint module: round-trip + pin mismatches ──────────────────────────


def test_checkpoint_path_builds_expected_filename(tmp_path):
    path = checkpoint_path(tmp_path, "20260711T120000")
    assert path == tmp_path / "checkpoint-20260711T120000.json"
    assert tmp_path.is_dir()  # created eagerly


def test_write_then_load_checkpoint_roundtrips_results(tmp_path):
    path = tmp_path / "checkpoint-1.json"
    result = _result(detail={"perOp": {}}, notes=["n1"])
    write_checkpoint(
        path,
        prompt_version="0.9.0",
        models=_MODELS,
        dry_run=True,
        runs=_RUNS,
        results=[result],
        estimated_calls={"totalNominal": 42},
    )
    cp = load_checkpoint(path)
    assert cp["promptVersion"] == "0.9.0"
    assert cp["models"] == _MODELS
    assert cp["dryRun"] is True
    assert cp["runs"] == _RUNS
    assert cp["estimatedCalls"] == {"totalNominal": 42}
    assert cp["results"] == [result.to_dict()]

    restored = eval_result_from_dict(cp["results"][0])
    assert restored == result


def test_assert_checkpoint_matches_passes_when_pins_equal():
    cp = {"promptVersion": "0.9.0", "models": _MODELS, "dryRun": True, "runs": _RUNS}
    assert_checkpoint_matches(cp, prompt_version="0.9.0", models=_MODELS, dry_run=True, runs=_RUNS)


def test_resume_refuses_prompt_version_mismatch(tmp_path):
    path = tmp_path / "checkpoint.json"
    write_checkpoint(
        path,
        prompt_version="0.1.0",
        models=_MODELS,
        dry_run=True,
        runs=_RUNS,
        results=[],
        estimated_calls={},
    )
    cp = load_checkpoint(path)
    with pytest.raises(ValueError, match="promptVersion"):
        assert_checkpoint_matches(
            cp, prompt_version="0.2.0", models=_MODELS, dry_run=True, runs=_RUNS
        )


def test_resume_refuses_models_mismatch():
    cp = {"promptVersion": "0.9.0", "models": _MODELS, "dryRun": True, "runs": _RUNS}
    with pytest.raises(ValueError, match="models"):
        assert_checkpoint_matches(
            cp,
            prompt_version="0.9.0",
            models={"writer": "other", "classifier": "other"},
            dry_run=True,
            runs=_RUNS,
        )


def test_resume_refuses_dry_run_mismatch():
    cp = {"promptVersion": "0.9.0", "models": _MODELS, "dryRun": True, "runs": _RUNS}
    with pytest.raises(ValueError, match="dryRun"):
        assert_checkpoint_matches(
            cp, prompt_version="0.9.0", models=_MODELS, dry_run=False, runs=_RUNS
        )


def test_resume_refuses_runs_map_mismatch():
    cp = {"promptVersion": "0.9.0", "models": _MODELS, "dryRun": True, "runs": _RUNS}
    other_runs = dict(_RUNS)
    other_runs["schemaValidity"] = 99
    with pytest.raises(ValueError, match="runs"):
        assert_checkpoint_matches(
            cp, prompt_version="0.9.0", models=_MODELS, dry_run=True, runs=other_runs
        )


# ── run_suite wiring: skip completed families, incremental checkpoint ──────


def test_resume_skips_completed_family(tmp_path, session_factory, monkeypatch):
    """Brief step 1: resuming with a checkpoint holding only schema-validity
    must not re-invoke the schema eval, but lock-violation (and the rest)
    still run."""

    def _fail_if_called(*_a, **_kw):
        raise AssertionError("schema_validity_eval must not be called when resuming past it")

    monkeypatch.setattr(checks, "schema_validity_eval", _fail_if_called)

    prior = [_result(name="schema-validity", score=1.0)]
    cp_path = tmp_path / "checkpoint.json"
    report = run_suite(
        MockLlmClient(),
        MockJudge(),
        session_factory,
        runs=_RUNS,
        dry_run=True,
        full=True,
        checkpoint_path=cp_path,
        skip_families={"schema-validity"},
        prior_results=prior,
    )
    names = [r.name for r in report.results]
    assert names == [
        "schema-validity",
        "act-boundary-validity",
        "lock-violation",
        "continuity-adherence",
        "segmentation-determinism",
        "lock-repair-quality",
        "import-inference",
        "subtext-fidelity",
        "act-boundary-quality",
    ]
    # the resumed family is the exact prior object, not recomputed
    assert report.results[0] is prior[0]


def test_checkpoint_rewritten_after_each_family(tmp_path, session_factory):
    cp_path = tmp_path / "checkpoint.json"
    report = run_suite(
        MockLlmClient(),
        MockJudge(),
        session_factory,
        runs=_RUNS,
        dry_run=True,
        full=True,
        checkpoint_path=cp_path,
    )
    cp = load_checkpoint(cp_path)
    assert [r["name"] for r in cp["results"]] == [r.name for r in report.results]
    assert cp["promptVersion"] and cp["models"] == report.models
    assert cp["dryRun"] is True
    assert cp["runs"] == _RUNS


def test_incomplete_family_never_written(tmp_path, session_factory, monkeypatch):
    """A family that raises mid-run must never appear in the checkpoint —
    only the families that completed *before* it do."""

    def _boom(*_a, **_kw):
        raise RuntimeError("simulated crash mid lock-violation family")

    monkeypatch.setattr(checks, "lock_violation_eval", _boom)

    cp_path = tmp_path / "checkpoint.json"
    with pytest.raises(RuntimeError, match="simulated crash"):
        run_suite(
            MockLlmClient(),
            MockJudge(),
            session_factory,
            runs=_RUNS,
            dry_run=True,
        full=True,
            checkpoint_path=cp_path,
        )
    cp = load_checkpoint(cp_path)
    assert [r["name"] for r in cp["results"]] == [
        "schema-validity",
        "act-boundary-validity",
    ]


def test_resume_merges_prior_and_new_in_stable_suite_order(session_factory, monkeypatch):
    monkeypatch.setattr(
        checks, "schema_validity_eval", lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("must not recompute schema")
        )
    )
    monkeypatch.setattr(
        checks, "lock_violation_eval", lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("must not recompute lock")
        )
    )
    prior = [
        _result(name="schema-validity", score=0.42),
        _result(name="lock-violation", score=0.99, gate=1.0),
    ]
    report = run_suite(
        MockLlmClient(),
        MockJudge(),
        session_factory,
        runs=_RUNS,
        dry_run=True,
        full=True,
        skip_families={"schema-validity", "lock-violation"},
        prior_results=prior,
    )
    names = [r.name for r in report.results]
    assert names == [
        "schema-validity",
        "act-boundary-validity",
        "lock-violation",
        "continuity-adherence",
        "segmentation-determinism",
        "lock-repair-quality",
        "import-inference",
        "subtext-fidelity",
        "act-boundary-quality",
    ]
    assert report.results[0].score == 0.42
    assert report.results[2].score == 0.99


def test_resume_with_only_still_honors_skip(session_factory, monkeypatch):
    """`--only` combined with a resumed family that's already done: nothing
    else runs, and the (already-complete) family is not recomputed."""

    def _fail_if_called(*_a, **_kw):
        raise AssertionError("must not recompute a skipped family even under --only")

    monkeypatch.setattr(checks, "schema_validity_eval", _fail_if_called)
    prior = [_result(name="schema-validity", score=0.7)]
    report = run_suite(
        MockLlmClient(),
        MockJudge(),
        session_factory,
        runs=_RUNS,
        dry_run=True,
        only="schema",
        skip_families={"schema-validity"},
        prior_results=prior,
    )
    assert [r.name for r in report.results] == ["schema-validity"]
    assert report.results[0].score == 0.7


def test_resume_complete_checkpoint_writes_fresh_checkpoint_without_reinvoking_families(
    tmp_path, session_factory, monkeypatch
):
    """A fully completed resume still writes this run's fresh checkpoint path
    with the prior results, without recomputing any skipped family."""

    def _fail_if_called(*_a, **_kw):
        raise AssertionError("completed checkpoint resume must not recompute eval families")

    monkeypatch.setattr(checks, "schema_validity_eval", _fail_if_called)
    monkeypatch.setattr(checks, "act_boundary_validity_eval", _fail_if_called)
    monkeypatch.setattr(checks, "lock_violation_eval", _fail_if_called)
    monkeypatch.setattr(checks, "continuity_eval", _fail_if_called)
    monkeypatch.setattr(checks, "segmentation_determinism_eval", _fail_if_called)
    monkeypatch.setattr(adoption, "lock_repair_eval", _fail_if_called)
    monkeypatch.setattr(adoption, "import_inference_eval", _fail_if_called)
    monkeypatch.setattr(adoption, "subtext_eval", _fail_if_called)
    monkeypatch.setattr(checks, "act_boundary_quality_eval", _fail_if_called)

    prior = _complete_results()
    cp_path = tmp_path / "checkpoint-fresh.json"
    report = run_suite(
        MockLlmClient(),
        MockJudge(),
        session_factory,
        runs=_RUNS,
        dry_run=True,
        full=True,
        checkpoint_path=cp_path,
        skip_families={r.name for r in prior},
        prior_results=prior,
    )

    assert cp_path.is_file()
    cp = load_checkpoint(cp_path)
    assert [r["name"] for r in cp["results"]] == [r.name for r in prior]
    assert [r.name for r in report.results] == [r.name for r in prior]
    assert cp["dryRun"] is True
    assert cp["runs"] == _RUNS
    assert cp["estimatedCalls"]["totalNominal"] > 0


# ── CLI wiring ───────────────────────────────────────────────────────────────


def test_cli_parses_resume_default_and_value():
    from evals import run as run_module

    args = run_module._parse_args([])
    assert args.resume is None
    args2 = run_module._parse_args(["--resume", "/tmp/checkpoint.json"])
    assert args2.resume == "/tmp/checkpoint.json"


def test_cli_writes_fresh_checkpoint_and_prints_path(tmp_path, capsys):
    from evals import run as run_module

    rc = run_module.main(["--dry-run", "--runs", "1", "--out", str(tmp_path)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "checkpoint:" in out

    checkpoints = list(tmp_path.glob("checkpoint-*.json"))
    assert len(checkpoints) == 1
    cp = load_checkpoint(checkpoints[0])
    assert len(cp["results"]) == 4  # core hard gates only


def test_cli_resume_skips_completed_family(tmp_path, monkeypatch):
    from drama_manager.render import PROMPT_VERSION
    from evals import run as run_module
    from evals.suite import CORE_EVAL_KEYS, filter_run_map

    cp_path = tmp_path / "checkpoint-prior.json"
    write_checkpoint(
        cp_path,
        prompt_version=PROMPT_VERSION,
        models=load_model_roles(),
        dry_run=True,
        runs=filter_run_map(_RUNS, CORE_EVAL_KEYS),
        results=[_result(name="schema-validity", score=1.0)],
        estimated_calls={},
    )

    def _fail_if_called(*_a, **_kw):
        raise AssertionError("schema_validity_eval must not run when resuming past it")

    monkeypatch.setattr(checks, "schema_validity_eval", _fail_if_called)

    rc = run_module.main(
        ["--dry-run", "--runs", "1", "--out", str(tmp_path), "--resume", str(cp_path)]
    )
    assert rc == 0


def test_cli_resume_refuses_prompt_version_mismatch(tmp_path):
    from evals import run as run_module
    from evals.suite import CORE_EVAL_KEYS, filter_run_map

    cp_path = tmp_path / "checkpoint-stale.json"
    write_checkpoint(
        cp_path,
        prompt_version="not-the-real-prompt-version",
        models=load_model_roles(),
        dry_run=True,
        runs=filter_run_map(_RUNS, CORE_EVAL_KEYS),
        results=[],
        estimated_calls={},
    )
    with pytest.raises(ValueError, match="promptVersion"):
        run_module.main(
            ["--dry-run", "--runs", "1", "--out", str(tmp_path), "--resume", str(cp_path)]
        )
