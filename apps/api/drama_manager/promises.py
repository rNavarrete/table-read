"""`merge_narrative_promises` (T7.20): fold `infer_narrative_promises`
(NarrativePromises) output into a project doc — see
`docs/superpowers/specs/2026-07-16-narrative-promises-design.md`.

Mirrors `fountain/characters.merge_inferred_entities`'s shape, but the
design doc's merge rule differs from that op's: an owner/motivation name
that doesn't resolve against the already-minted cast is **dropped**, never
minted a stand-in character (`fountain.characters.resolve_character_id`
never mints). Threads mint a fresh `thread-{hex}` id per import (MVP: an
episode's imported threads are replaced wholesale, same as its scenes);
scene motivations are only written onto scenes that exist and only when at
least one motivation resolves; world rules append only text the bible
doesn't already have (case-insensitive), which also protects a locked
rule's text from ever being duplicated underneath it.

No writer/import text is logged here (hard rule 5) — only ids and counts.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from drama_manager.ledger_policy import IdMinter
from fountain.characters import resolve_character_id

if TYPE_CHECKING:
    from schemas import NarrativePromises

_logger = logging.getLogger("drama_manager.promises")


def _find_episode(doc: dict, episode_id: str) -> dict:
    for season in doc.get("seasons") or []:
        for episode in season.get("episodes") or []:
            if episode["id"] == episode_id:
                return episode
    raise KeyError(episode_id)


def merge_narrative_promises(
    doc: dict, episode_id: str, result: NarrativePromises
) -> dict:
    """Mutate (and return) `doc`: mint+attach `episode.threads`, patch
    matching scenes' `motivations`, and append new world rules to
    `seriesBible.worldRules`. `doc["seriesBible"]["characters"]` must
    already reflect any earlier `infer_story_entities` merge for this
    import — names resolve against exactly that list.

    - Threads: every inferred thread with a `setupSceneId` naming a real
      scene of this episode gets a minted id; unresolvable owner names are
      dropped (counted, never logged by name). A thread whose
      `payoffSceneId` doesn't name a real scene is treated as still open
      (`payoffSceneId` -> `None`) rather than trusting an ungrounded id.
      Replaces the episode's entire `threads` list (re-import semantics,
      same as scenes: v1 has no thread locking).
    - Scene motivations: only scenes present in this episode are patched,
      and only with the motivations whose `characterName` resolves; a scene
      with zero resolved motivations keeps its prior `motivations` (never
      wiped to `[]` by an inference miss).
    - World rules: appended when `text` (casefold, trimmed) isn't already
      present among the bible's existing rules — this also means a locked
      rule's text can never be duplicated underneath it, satisfying "locked
      world rules untouched on merge" without any lock-cascade lookup.
    """
    bible = doc.setdefault("seriesBible", {})
    characters = bible.get("characters") or []
    episode = _find_episode(doc, episode_id)
    scenes_by_id = {s["id"]: s for s in episode.get("scenes") or []}

    threads: list[dict] = []
    dropped_owners = 0
    thread_minter = IdMinter([], "thread-")
    for inferred in result.threads:
        if inferred.setup_scene_id not in scenes_by_id:
            continue
        owner_ids: list[str] = []
        seen: set[str] = set()
        for name in inferred.owner_names:
            char_id = resolve_character_id(name, characters)
            if char_id is None:
                dropped_owners += 1
                continue
            if char_id not in seen:
                seen.add(char_id)
                owner_ids.append(char_id)
        payoff_scene_id = (
            inferred.payoff_scene_id
            if inferred.payoff_scene_id in scenes_by_id
            else None
        )
        threads.append(
            {
                "id": thread_minter.mint(),
                "label": inferred.label,
                "summary": inferred.summary,
                "status": str(inferred.status),
                "ownerCharacterIds": owner_ids,
                "setupSceneId": inferred.setup_scene_id,
                "payoffSceneId": payoff_scene_id,
                "setupQuote": inferred.setup_quote,
                "payoffQuote": inferred.payoff_quote,
                "locked": False,
            }
        )
    episode["threads"] = threads

    dropped_motivations = 0
    for scene_motivations in result.scene_motivations:
        scene = scenes_by_id.get(scene_motivations.scene_id)
        if scene is None:
            continue
        resolved: list[dict] = []
        for motivation in scene_motivations.motivations:
            char_id = resolve_character_id(motivation.character_name, characters)
            if char_id is None:
                dropped_motivations += 1
                continue
            resolved.append(
                {
                    "characterId": char_id,
                    "objective": motivation.objective,
                    "stakes": motivation.stakes,
                    "obstacle": motivation.obstacle,
                }
            )
        if resolved:
            scene["motivations"] = resolved

    existing_rules = list(bible.get("worldRules") or [])
    existing_texts = {
        rule["text"].strip().casefold() for rule in existing_rules if rule.get("text")
    }
    appended_rules = 0
    for rule in result.world_rules:
        key = rule.text.strip().casefold()
        if not key or key in existing_texts:
            continue
        existing_texts.add(key)
        evidence_scene_id = (
            rule.evidence_scene_id if rule.evidence_scene_id in scenes_by_id else None
        )
        existing_rules.append(
            {
                "text": rule.text,
                "locked": False,
                "limit": rule.limit,
                "cost": rule.cost,
                "exception": rule.exception,
                "evidenceSceneId": evidence_scene_id,
                "evidenceQuote": rule.evidence_quote,
            }
        )
        appended_rules += 1
    bible["worldRules"] = existing_rules

    if dropped_owners or dropped_motivations:
        _logger.info(
            "merge_narrative_promises owners_dropped=%d motivations_dropped=%d",
            dropped_owners,
            dropped_motivations,
        )
    _logger.info(
        "merge_narrative_promises threads=%d rules_appended=%d",
        len(threads),
        appended_rules,
    )
    return doc
