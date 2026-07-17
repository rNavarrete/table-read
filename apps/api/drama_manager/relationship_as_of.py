"""T7.25 relationship-state as-of helper (design doc
`docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-design.md`
"T7.25 — Relationship state history": "Ledger/Web can show state as-of
scene via last state with `sceneId` <= k.").

Pure and deterministic, matching the conventions of `ledger_as_of.py`:
doc shapes are camelCase wire dicts, and an unknown `as_of_scene_id`
raises `KeyError`. MVP has no dedicated endpoint for this yet (design
doc T7.25); it exists for a later Ledger/Web surface.
"""

from __future__ import annotations


def _pair_key(between: list[str] | tuple[str, str]) -> frozenset[str]:
    """`between` is an unordered pair -- (a, b) and (b, a) are the same relationship."""
    return frozenset(between)


def latest_relationship_state(
    states: list[dict],
    scenes: list[dict],
    between: tuple[str, str],
    as_of_scene_id: str,
) -> dict | None:
    """The `RelationshipState` for `between` most recently in force as of
    `as_of_scene_id`: the state among `states` matching `between` (order-
    insensitive) with the latest `sceneId` at or before `as_of_scene_id` in
    scene order. `None` if no such state exists (never established yet, or
    all states for the pair are later than `as_of_scene_id`). A state whose
    `sceneId` doesn't resolve in `scenes` (orphan) is ignored. Raises
    `KeyError` if `as_of_scene_id` is not one of `scenes`' ids.
    """
    scene_order = {scene["id"]: index for index, scene in enumerate(scenes)}
    if as_of_scene_id not in scene_order:
        raise KeyError(as_of_scene_id)
    as_of_index = scene_order[as_of_scene_id]

    target = _pair_key(between)
    best: dict | None = None
    best_index = -1
    for state in states:
        if _pair_key(state.get("between") or []) != target:
            continue
        index = scene_order.get(state.get("sceneId"))
        if index is None or index > as_of_index:
            continue
        if index > best_index:
            best_index = index
            best = state
    return best
