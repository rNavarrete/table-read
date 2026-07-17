"""Pure temporal filter for the ledger (T7.18 P1 slice 1, design doc
`docs/superpowers/specs/2026-07-16-time-aware-ledger-design.md` "Semantics").

`facts_as_of` answers "what was true as of scene N" using data already
stored on each fact (`sourceSpan.sceneId`, the supersede chain) plus the
episode's scene order. It is temporal-only: status filtering (active /
pending_review / …) is the caller's job, applied after this filter, exactly
like today's GET does before this slice (design doc §"API").

Doc shapes are camelCase wire dicts (`Scene`, `LedgerFact`), matching the
convention in `drama_manager/locks.py`.
"""

from __future__ import annotations


def facts_as_of(
    scenes: list[dict], ledger: list[dict], as_of_scene_id: str
) -> list[dict]:
    """Facts in force as of `as_of_scene_id` (design doc semantics 1 & 3).

    `scenes` is an episode's ordered scene list (`id` field defines order).
    Raises `KeyError` if `as_of_scene_id` is not one of `scenes`' ids.

    A fact is in force when its establishing scene (`sourceSpan.sceneId`) is
    at or before `as_of_scene_id` in scene order, and — if it was later
    superseded — the superseding fact's establishing scene is *after*
    `as_of_scene_id` (otherwise the supersession already happened by then,
    and the old fact is out of force). A fact whose establishing scene is
    missing from `scenes` (orphan) is always excluded. A `supersededBy` that
    doesn't resolve to a ledger entry can't be confirmed superseded by
    `as_of_scene_id`, so the fact is kept.
    """
    scene_order = {scene["id"]: index for index, scene in enumerate(scenes)}
    if as_of_scene_id not in scene_order:
        raise KeyError(as_of_scene_id)
    as_of_index = scene_order[as_of_scene_id]
    facts_by_id = {fact["id"]: fact for fact in ledger}

    def establishing_index(fact: dict) -> int | None:
        scene_id = fact.get("sourceSpan", {}).get("sceneId")
        return scene_order.get(scene_id)

    in_force = []
    for fact in ledger:
        index = establishing_index(fact)
        if index is None or index > as_of_index:
            continue

        superseder = facts_by_id.get(fact.get("supersededBy"))
        if superseder is not None:
            superseder_index = establishing_index(superseder)
            if superseder_index is not None and superseder_index <= as_of_index:
                continue

        in_force.append(fact)
    return in_force
