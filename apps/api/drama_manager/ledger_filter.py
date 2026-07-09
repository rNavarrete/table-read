"""The one canonical prompt-eligibility predicate (prompt spec §8).

Every mention of "filtered", "confirmed", or "high-confidence" facts in any
doc means exactly `is_prompt_eligible_fact` below — implemented once, here, so
Write-mode candidate bundles, `scan_consistency` inputs, and the undo-orphan
guarantee all agree on which facts a prompt may see.

    isPromptEligibleFact(fact, context) =
          fact.status == "active"
      AND ( fact.provenance in {"writer_confirmed", "writer_authored"}
            OR (fact.provenance == "inferred" AND fact.confidence >= 0.8) )
      AND relevant(fact, context)

    relevant(fact, context) =
          fact.factType == "world_rule"
       OR fact.knownBy ∩ context.charactersInScene != empty
       OR fact.sourceSpan.sceneId == context.sceneId

Status alone is not sufficient (an active inferred fact below 0.8 exists only
transiently mid-transaction, but the predicate guards it anyway); confidence
alone is never used. Facts are camelCase wire dicts (`LedgerFact`).

Token budget (§1): if eligible facts exceed 40, rank by (a) characters-in-scene
overlap, then (b) recency of sourceSpan, and truncate — never silently drop
without an ordering.
"""

from __future__ import annotations

from dataclasses import dataclass, field

_CONFIDENCE_FLOOR = 0.8
_MAX_FACTS = 40


@dataclass(frozen=True)
class RelevanceContext:
    """The relevance inputs the predicate needs. `characters_in_scene` is the
    set of character ids on stage; `scene_id` is the scene the prompt is about.
    For whole-episode ops (§8c) pass every character and the changed scene id
    — world_rule and known-by relevance still hold."""

    scene_id: str
    characters_in_scene: frozenset[str] = field(default_factory=frozenset)


def _provenance_ok(fact: dict) -> bool:
    provenance = fact.get("provenance")
    if provenance in ("writer_confirmed", "writer_authored"):
        return True
    return provenance == "inferred" and float(fact.get("confidence", 0.0)) >= _CONFIDENCE_FLOOR


def _relevant(fact: dict, context: RelevanceContext) -> bool:
    if fact.get("factType") == "world_rule":
        return True
    known_by = set(fact.get("knownBy", []))
    if known_by & set(context.characters_in_scene):
        return True
    return fact.get("sourceSpan", {}).get("sceneId") == context.scene_id


def is_prompt_eligible_fact(fact: dict, context: RelevanceContext) -> bool:
    """The canonical predicate (prompt spec §8). See module docstring."""
    return (
        fact.get("status") == "active"
        and _provenance_ok(fact)
        and _relevant(fact, context)
    )


def _rank_key(fact: dict, context: RelevanceContext) -> tuple:
    """Ranking for truncation (§1): (a) characters-in-scene overlap, then
    (b) recency of sourceSpan. Higher is kept; sorted descending."""
    overlap = len(set(fact.get("knownBy", [])) & set(context.characters_in_scene))
    span = fact.get("sourceSpan", {})
    recency = span.get("endLine") or span.get("startLine") or 0
    return (overlap, recency)


def eligible_facts(facts: list[dict], context: RelevanceContext) -> list[dict]:
    """Facts passing `is_prompt_eligible_fact`, ranked and truncated to the
    §1 token-budget cap of 40. Order is stable for facts kept within the cap:
    input order is preserved when the eligible set fits (≤ 40); only when it
    overflows does the (overlap, recency) ranking decide what survives."""
    kept = [f for f in facts if is_prompt_eligible_fact(f, context)]
    if len(kept) <= _MAX_FACTS:
        return kept
    ranked = sorted(kept, key=lambda f: _rank_key(f, context), reverse=True)
    return ranked[:_MAX_FACTS]
