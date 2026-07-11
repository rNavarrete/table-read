"""Adoption A1/A2/A10 eval wiring — MockLlmClient only (hard rule 1)."""

from __future__ import annotations

from evals import adoption
from evals.probes import load_fixture_ctx
from llm.mock import MockLlmClient


def test_import_inference_fixture_has_three_planted_kinds():
    planted = adoption._planted_spec()
    kinds = {p["kind"] for p in planted["plantedImpliedFacts"]}
    assert kinds >= {"relationship", "location", "knowledge"}
    assert adoption._FOUNTAIN.is_file()
    text = adoption._FOUNTAIN.read_text()
    # Planted implications must not appear as literal prose claims.
    assert "are siblings" not in text.lower()
    assert "does not know about the envelope" not in text.lower()


def test_lock_repair_eval_runs_soft_on_mock():
    result = adoption.lock_repair_eval(MockLlmClient(), load_fixture_ctx(), runs=2)
    assert result.name == "lock-repair-quality"
    assert result.hard is False
    assert 0.0 <= result.score <= 1.0


def test_subtext_eval_runs_soft_on_mock():
    result = adoption.subtext_eval(MockLlmClient(), load_fixture_ctx(), runs=2)
    assert result.name == "subtext-fidelity"
    assert result.hard is False
    assert result.score >= 0.0


def test_import_inference_eval_runs_soft_on_mock():
    result = adoption.import_inference_eval(MockLlmClient(), runs=2)
    assert result.name == "import-inference"
    assert result.hard is False
    assert "plantedCount" in result.detail
