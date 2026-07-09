"""isPromptEligibleFact — the one canonical predicate (prompt spec §8).

Test plan line 20: unit-test the predicate directly across the
status × provenance × confidence × relevance matrix, then assert the fixture
consequences (includes fact-02/03/04/08, excludes fact-06 pending_review and
rejected facts).
"""

from __future__ import annotations

import pytest

from drama_manager.ledger_filter import (
    RelevanceContext,
    eligible_facts,
    is_prompt_eligible_fact,
)
from storage.seed import load_fixture

_CTX = RelevanceContext(scene_id="scene-here", characters_in_scene=frozenset({"char-a"}))


def _fact(**over) -> dict:
    base = {
        "id": "fact-x",
        "fact": "something",
        "factType": "state",
        "sourceSpan": {"sceneId": "scene-elsewhere"},
        "knownBy": [],
        "audienceKnows": True,
        "provenance": "writer_confirmed",
        "confidence": 1.0,
        "status": "active",
    }
    base.update(over)
    return base


# ── provenance × confidence gate (all active + relevant via knownBy) ────────────


@pytest.mark.parametrize(
    ("provenance", "confidence", "expected"),
    [
        ("writer_confirmed", 0.0, True),   # confidence irrelevant for confirmed
        ("writer_authored", 0.0, True),    # confidence irrelevant for authored
        ("inferred", 0.8, True),           # inferred at the floor
        ("inferred", 0.95, True),          # inferred above the floor
        ("inferred", 0.79, False),         # inferred below the floor → excluded
        ("inferred", 0.0, False),
    ],
)
def test_provenance_confidence_gate(provenance, confidence, expected):
    fact = _fact(provenance=provenance, confidence=confidence, knownBy=["char-a"])
    assert is_prompt_eligible_fact(fact, _CTX) is expected


# ── status gate (all writer_confirmed + relevant) ───────────────────────────────


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("active", True),
        ("superseded", False),
        ("stale", False),
        ("pending_review", False),
        ("rejected", False),
    ],
)
def test_status_gate(status, expected):
    fact = _fact(status=status, knownBy=["char-a"])
    assert is_prompt_eligible_fact(fact, _CTX) is expected


def test_status_gate_dominates_high_confidence_inference():
    # An inferred fact at 0.99 that is only pending_review is still excluded —
    # status alone is not sufficient, and confidence alone is never used.
    fact = _fact(
        provenance="inferred", confidence=0.99, status="pending_review", knownBy=["char-a"]
    )
    assert is_prompt_eligible_fact(fact, _CTX) is False


# ── relevance (all active + writer_confirmed) ───────────────────────────────────


def test_relevant_via_world_rule_even_with_no_overlap_and_other_scene():
    fact = _fact(factType="world_rule", knownBy=[], sourceSpan={"sceneId": "scene-elsewhere"})
    assert is_prompt_eligible_fact(fact, _CTX) is True


def test_relevant_via_knownby_overlap():
    fact = _fact(knownBy=["char-a", "char-z"], sourceSpan={"sceneId": "scene-elsewhere"})
    assert is_prompt_eligible_fact(fact, _CTX) is True


def test_relevant_via_source_scene_match():
    fact = _fact(knownBy=[], sourceSpan={"sceneId": "scene-here"})
    assert is_prompt_eligible_fact(fact, _CTX) is True


def test_irrelevant_when_no_overlap_other_scene_not_world_rule():
    fact = _fact(knownBy=["char-z"], sourceSpan={"sceneId": "scene-elsewhere"})
    assert is_prompt_eligible_fact(fact, _CTX) is False


# ── fixture consequences (scene-3 context: Marta + Dan) ─────────────────────────


def test_fixture_scene3_consequences():
    ledger = load_fixture()["ledger"]
    ctx = RelevanceContext(
        scene_id="scene-3", characters_in_scene=frozenset({"char-marta", "char-dan"})
    )
    kept_ids = {f["id"] for f in eligible_facts(ledger, ctx)}
    assert {"fact-02", "fact-03", "fact-04", "fact-08"} <= kept_ids
    assert "fact-06" not in kept_ids  # pending_review


def test_rejected_facts_excluded():
    ledger = load_fixture()["ledger"]
    rejected = dict(ledger[0], id="fact-99", status="rejected")
    ctx = RelevanceContext(
        scene_id="scene-3", characters_in_scene=frozenset({"char-marta", "char-dan"})
    )
    kept_ids = {f["id"] for f in eligible_facts([*ledger, rejected], ctx)}
    assert "fact-99" not in kept_ids


def test_eligible_facts_truncates_to_forty_by_rank():
    # 45 eligible facts; only 40 survive, ranked by (overlap, recency).
    ctx = RelevanceContext(scene_id="scene-here", characters_in_scene=frozenset({"char-a"}))
    facts = [
        _fact(id=f"fact-{i}", knownBy=["char-a"], sourceSpan={"sceneId": "x", "endLine": i})
        for i in range(45)
    ]
    kept = eligible_facts(facts, ctx)
    assert len(kept) == 40
    # highest recency kept; lowest dropped
    kept_ids = {f["id"] for f in kept}
    assert "fact-44" in kept_ids
    assert "fact-0" not in kept_ids
