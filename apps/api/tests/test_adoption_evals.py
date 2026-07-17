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


def test_entity_inference_fixture_has_planted_kinds_and_no_literal_aliasing():
    planted = adoption._entity_planted_spec()
    kinds = {p["kind"] for p in planted["plantedEntities"]}
    assert kinds == {"character", "relationship", "location", "object"}
    assert len(planted["plantedAliasPairs"]) == 2
    assert planted["plantedNonSpeakingCharacters"] == ["planted-char-owen"]
    assert adoption._ENTITY_FOUNTAIN.is_file()
    text = adoption._ENTITY_FOUNTAIN.read_text()
    # The cousin/wariness relationships are implied, never named literally.
    assert "cousin" not in text.lower()
    speaker_names = {n.casefold() for n in adoption._entity_fixture_context()[2]}
    assert speaker_names == {"dorothy ashworth-kane", "marguerite"}  # Owen never speaks


def test_entity_inference_eval_runs_soft_on_mock():
    result = adoption.entity_inference_eval(MockLlmClient(), runs=2)
    assert result.name == "entity-inference"
    assert result.hard is False
    assert result.gate == adoption.ENTITY_INFERENCE_GATE
    assert "plantedCount" in result.detail


def test_alias_resolution_eval_runs_soft_on_mock():
    result = adoption.alias_resolution_eval(MockLlmClient(), runs=2)
    assert result.name == "alias-resolution"
    assert result.hard is False
    assert result.gate == adoption.ALIAS_RESOLUTION_GATE
    assert result.detail["pairs"] == 2


def test_alias_resolution_seeded_response_resolves_both_pairs():
    """The seeded dry-run response itself must satisfy the merge path — a
    regression guard on the fixture/seed staying in sync."""
    from fountain.characters import merge_inferred_entities

    entities = adoption._seed_entity_response()
    merged = merge_inferred_entities({"characters": []}, entities)
    planted = adoption._entity_planted_spec()
    for pair in planted["plantedAliasPairs"]:
        assert adoption._alias_pair_resolved(merged, pair)
