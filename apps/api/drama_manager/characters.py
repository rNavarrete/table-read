"""Cast management: rename/alias edit, merge, delete (data contract §4 Cast
management, T7.16). Pure doc/ledger transforms; routes wrap these in
`storage/snapshots.mutate` (hard rule 4: every mutation snapshots) and check
`drama_manager.locks.is_locked` before calling in (hard rule 2: locks are
sacred) — none of these functions themselves know about locks.
"""

from __future__ import annotations

import copy


class CharacterNotFound(LookupError):
    """No character with this id (route → 404)."""


class ValidationError(ValueError):
    """Request is not valid for this transform (route → 400)."""


class ReferencedError(ValueError):
    """Delete refused: the character is still referenced. Carries the counts
    for the 409 `VALIDATION` `details` (data contract §4)."""

    def __init__(self, counts: dict[str, int]) -> None:
        self.counts = counts
        super().__init__(f"character is still referenced: {counts}")


def _characters(doc: dict) -> list[dict]:
    return doc.get("seriesBible", {}).get("characters", [])


def _find_character(doc: dict, cid: str) -> dict | None:
    for character in _characters(doc):
        if character["id"] == cid:
            return character
    return None


def get_character(doc: dict, cid: str) -> dict:
    """Look up a character by id, raising `CharacterNotFound` (route → 404)
    if absent — the shared existence check every route runs before its own
    guards (lock check, self-merge check, …)."""
    character = _find_character(doc, cid)
    if character is None:
        raise CharacterNotFound(cid)
    return character


def rename_character(
    doc: dict,
    cid: str,
    *,
    name: str | None = None,
    aliases: list[str] | None = None,
) -> dict:
    """Rename and/or replace aliases. Returns a new doc; never mutates `doc`."""
    if name is None and aliases is None:
        raise ValidationError("patch must include name and/or aliases")
    result = copy.deepcopy(doc)
    character = get_character(result, cid)
    if name is not None:
        character["name"] = name
    if aliases is not None:
        character["aliases"] = list(aliases)
    return result


def character_reference_counts(doc: dict, ledger: list[dict], cid: str) -> dict[str, int]:
    """Live references that block delete (data contract §4): ledger facts
    whose `knownBy` includes `cid`, and relationships whose `between`
    includes `cid`."""
    fact_count = sum(1 for fact in ledger if cid in fact.get("knownBy", []))
    relationship_count = sum(
        1
        for rel in doc.get("seriesBible", {}).get("relationships", [])
        if cid in rel.get("between", ())
    )
    return {"facts": fact_count, "relationships": relationship_count}


def delete_character(doc: dict, ledger: list[dict], cid: str) -> dict:
    """Remove a character with zero remaining references. Raises
    `CharacterNotFound` or `ReferencedError` (any fact/relationship reference
    remains); never mutates `doc`."""
    get_character(doc, cid)
    counts = character_reference_counts(doc, ledger, cid)
    if any(counts.values()):
        raise ReferencedError(counts)
    result = copy.deepcopy(doc)
    result["seriesBible"]["characters"] = [c for c in _characters(result) if c["id"] != cid]
    return result


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            out.append(value)
    return out


def merge_character(
    doc: dict, ledger: list[dict], source_id: str, target_id: str
) -> tuple[dict, list[dict]]:
    """Merge `source_id` into `target_id`, atomically:

      - absorbs the source's aliases (plus the source's own name as an
        alias) into the target;
      - rewrites every characterId reference from source to target: ledger
        `knownBy`, relationship `between`, scene `motivations`, season
        `characterArcs`, episode storyline `characterIds` and episode
        `characterArcs` (deduping the set-shaped ones so the merge never
        produces a duplicate id; of two episode arcs for the merged pair the
        first is kept) — a merge must leave no dangling reference to the
        removed source id;
      - drops any relationship the merge collapsed into a self-reference
        (source and target were directly related);
      - removes the source character.

    Returns `(new_doc, new_ledger)`; never mutates its inputs. Raises
    `ValidationError` (source == target) or `CharacterNotFound`.
    """
    if source_id == target_id:
        raise ValidationError("cannot merge a character into itself")

    result = copy.deepcopy(doc)
    source = get_character(result, source_id)
    target = get_character(result, target_id)

    target["aliases"] = [
        alias
        for alias in _dedupe_preserve_order(
            [*target.get("aliases", []), *source.get("aliases", []), source["name"]]
        )
        if alias != target["name"]
    ]

    result["seriesBible"]["characters"] = [c for c in _characters(result) if c["id"] != source_id]

    def repoint(value: str) -> str:
        return target_id if value == source_id else value

    kept_relationships = []
    for rel in result["seriesBible"].get("relationships", []):
        a, b = (repoint(v) for v in rel["between"])
        if a == b:
            continue  # merge collapsed both ends of this relationship
        rel["between"] = [a, b]
        kept_relationships.append(rel)
    result["seriesBible"]["relationships"] = kept_relationships

    for season in result.get("seasons", []):
        for arc in season.get("characterArcs", []):
            if arc.get("characterId") == source_id:
                arc["characterId"] = target_id
        for episode in season.get("episodes", []):
            for storyline in episode.get("storylines", []):
                storyline["characterIds"] = _dedupe_preserve_order(
                    [repoint(c) for c in storyline.get("characterIds", [])]
                )
            for scene in episode.get("scenes", []):
                for motivation in scene.get("motivations", []):
                    if motivation.get("characterId") == source_id:
                        motivation["characterId"] = target_id
            if episode.get("characterArcs"):
                arcs: list[dict] = []
                for arc in episode["characterArcs"]:
                    arc["characterId"] = repoint(arc["characterId"])
                    if all(kept["characterId"] != arc["characterId"] for kept in arcs):
                        arcs.append(arc)
                episode["characterArcs"] = arcs

    new_ledger = copy.deepcopy(ledger)
    for fact in new_ledger:
        fact["knownBy"] = _dedupe_preserve_order([repoint(c) for c in fact.get("knownBy", [])])

    return result, new_ledger
