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
    merged, _relationship_states, _ = merge_inferred_entities({"characters": []}, entities)
    planted = adoption._entity_planted_spec()
    for pair in planted["plantedAliasPairs"]:
        assert adoption._alias_pair_resolved(merged, pair)


def test_narrative_promises_fixture_has_one_of_each_planted_kind():
    planted = adoption._promises_planted_spec()
    assert len(planted["plantedThreads"]) == 2
    statuses = {t["status"] for t in planted["plantedThreads"]}
    assert statuses == {"paid_off", "open"}
    assert len(planted["plantedMotivations"]) == 1
    assert len(planted["plantedWorldRules"]) == 1
    assert planted["plantedWorldRules"][0]["limitMatchAny"]
    assert adoption._PROMISES_FOUNTAIN.is_file()
    text = adoption._PROMISES_FOUNTAIN.read_text()
    # The thread/motivation/world-rule labels are implied, never named literally.
    assert "setup" not in text.lower()
    assert "payoff" not in text.lower()
    assert "motivation" not in text.lower()
    assert "world rule" not in text.lower()


def test_narrative_promises_eval_runs_soft_on_mock():
    result = adoption.narrative_promises_eval(MockLlmClient(), runs=2)
    assert result.name == "narrative-promises"
    assert result.hard is False
    assert result.gate == adoption.NARRATIVE_PROMISES_GATE
    assert result.detail["plantedCount"] == 4


def test_narrative_promises_merge_eval_runs_soft_on_mock():
    result = adoption.narrative_promises_merge_eval(MockLlmClient(), runs=2)
    assert result.name == "narrative-promises-merge"
    assert result.hard is False
    assert result.gate == adoption.NARRATIVE_PROMISES_MERGE_GATE
    assert result.detail["attempts"] == 8


def test_narrative_promises_seeded_response_satisfies_recall_and_merge():
    """The seeded dry-run response itself must satisfy both the recall
    checks and the real merge path — a regression guard on the
    fixture/seed staying in sync."""
    result = adoption._seed_promises_response()
    planted = adoption._promises_planted_spec()
    for p in planted["plantedThreads"]:
        assert adoption._thread_found(result.threads, p)
    for p in planted["plantedMotivations"]:
        assert adoption._motivation_found(result.scene_motivations, p)
    for p in planted["plantedWorldRules"]:
        assert adoption._world_rule_found(result.world_rules, p)

    _project, scene_summaries, _cast = adoption._promises_fixture_context()
    scene_ids = [s["id"] for s in scene_summaries]
    doc = adoption.merge_narrative_promises(
        adoption._promises_doc_scaffold(scene_ids), "ep-promises-1", result
    )
    episode = doc["seasons"][0]["episodes"][0]
    paid_off = next(t for t in episode["threads"] if t["status"] == "paid_off")
    still_open = next(t for t in episode["threads"] if t["status"] == "open")
    assert paid_off["payoffSceneId"] is not None
    assert still_open["payoffSceneId"] is None
    assert any(s["motivations"] for s in episode["scenes"])
    assert any((r.get("limit") or "").strip() for r in doc["seriesBible"]["worldRules"])
