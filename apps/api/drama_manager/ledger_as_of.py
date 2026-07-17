"""Pure temporal filters for the ledger.

`facts_as_of` (T7.18 P1 slice 1, design doc
`docs/superpowers/specs/2026-07-16-time-aware-ledger-design.md` "Semantics")
answers "what was true as of scene N" using data already stored on each fact
(`sourceSpan.sceneId`, the supersede chain) plus the episode's scene order.
It is temporal-only: status filtering (active / pending_review / …) is the
caller's job, applied after this filter, exactly like today's GET does
before this slice (design doc §"API").

`knowers_as_of` (T7.23, design doc
`docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-design.md`
"Semantics for as-of") answers "who knew this fact as of scene N": baseline
`knownBy` at the fact's establishing scene, plus every `knowledgeEvents`
entry at or before scene N applied in scene order (`learns` adds knowers,
`forgets` removes them).

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


def knowers_as_of(fact: dict, scenes: list[dict], as_of_scene_id: str) -> list[str]:
    """Who knows `fact` as of `as_of_scene_id` (design doc "Semantics for as-of").

    Starts from `fact["knownBy"]` (the baseline knower set) and applies every
    `fact["knowledgeEvents"]` entry at or before `as_of_scene_id` in scene
    order — not list order, so an out-of-order `knowledgeEvents` list still
    replays correctly: `learns` appends `characterIds` not already present,
    `forgets` removes them. An event whose `sceneId` doesn't resolve in
    `scenes` (orphan) or falls after `as_of_scene_id` is skipped. Raises
    `KeyError` if `as_of_scene_id` is not one of `scenes`' ids, same contract
    as `facts_as_of`.
    """
    scene_order = {scene["id"]: index for index, scene in enumerate(scenes)}
    if as_of_scene_id not in scene_order:
        raise KeyError(as_of_scene_id)
    as_of_index = scene_order[as_of_scene_id]

    applicable = sorted(
        (
            (scene_order[event["sceneId"]], position, event)
            for position, event in enumerate(fact.get("knowledgeEvents") or [])
            if scene_order.get(event.get("sceneId")) is not None
            and scene_order[event["sceneId"]] <= as_of_index
        ),
        key=lambda item: (item[0], item[1]),
    )

    knowers: list[str] = list(fact.get("knownBy") or [])
    for _index, _position, event in applicable:
        character_ids = event.get("characterIds") or []
        if event.get("kind") == "learns":
            for character_id in character_ids:
                if character_id not in knowers:
                    knowers.append(character_id)
        elif event.get("kind") == "forgets":
            forgotten = set(character_ids)
            knowers = [cid for cid in knowers if cid not in forgotten]
    return knowers
