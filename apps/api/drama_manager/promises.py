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


def _resolve_unique(names: list[str], characters: list[dict]) -> list[str]:
    """Resolve names to character ids, preserving order and dropping both
    unresolvable names and duplicates."""
    resolved: list[str] = []
    seen: set[str] = set()
    for name in names:
        char_id = resolve_character_id(name, characters)
        if char_id is None or char_id in seen:
            continue
        seen.add(char_id)
        resolved.append(char_id)
    return resolved


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
    - Secrets: like threads, but the holder / concealed-from pair is the
      whole point rather than decoration, so a row that resolves to no holder
      or to nobody kept in the dark is dropped instead of stored — with
      either side empty it is an ordinary ledger fact, not a secret.
      `factId` stays null here because promises inference runs *before*
      extract_ledger_facts; there is no fact to link yet.
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

    secrets: list[dict] = []
    dropped_secrets = 0
    secret_minter = IdMinter([], "secret-")
    for inferred_secret in result.secrets:
        if inferred_secret.established_scene_id not in scenes_by_id:
            continue
        holder_ids = _resolve_unique(inferred_secret.holder_names, characters)
        concealed_from_ids = _resolve_unique(
            inferred_secret.concealed_from_names, characters
        )
        # Unlike a thread's owners — which are decoration — the holder /
        # concealed-from pair IS the secret. With either side empty this is
        # not a secret at all: no one is keeping it, or no one is in the dark,
        # and what's left is an ordinary ledger fact wearing a secret's shape.
        # Storing it anyway would inflate the count with duplicates of facts
        # the ledger already holds, so drop and count instead.
        if not holder_ids or not concealed_from_ids:
            dropped_secrets += 1
            continue
        revealed_scene_id = (
            inferred_secret.revealed_scene_id
            if inferred_secret.revealed_scene_id in scenes_by_id
            else None
        )
        secrets.append(
            {
                "id": secret_minter.mint(),
                "summary": inferred_secret.summary,
                # Promises inference runs before extract_ledger_facts, so no
                # fact exists to point at yet. Left null for a later pass to
                # link rather than inventing an id that resolves to nothing.
                "factId": None,
                "holderCharacterIds": holder_ids,
                "concealedFromCharacterIds": concealed_from_ids,
                "audienceKnows": inferred_secret.audience_knows,
                "establishedSceneId": inferred_secret.established_scene_id,
                "revealedSceneId": revealed_scene_id,
                "concealmentSceneIds": [
                    scene_id
                    for scene_id in inferred_secret.concealment_scene_ids
                    if scene_id in scenes_by_id
                ],
                "establishedQuote": inferred_secret.established_quote,
                "revealedQuote": inferred_secret.revealed_quote,
                "provenance": "inferred",
                "locked": False,
            }
        )
    episode["secrets"] = secrets

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
            stated = (motivation.stated_objective or "").strip()
            resolved.append(
                {
                    "characterId": char_id,
                    "objective": motivation.objective,
                    "stakes": motivation.stakes,
                    "obstacle": motivation.obstacle,
                    # A "stated" objective identical to the real one is not a
                    # gap; normalize it away so a non-empty statedObjective
                    # always means there IS an ulterior motive.
                    "statedObjective": (
                        "" if stated.casefold() == motivation.objective.strip().casefold()
                        else stated
                    ),
                    "concealed": bool(motivation.concealed),
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

    if dropped_owners or dropped_motivations or dropped_secrets:
        _logger.info(
            "merge_narrative_promises owners_dropped=%d motivations_dropped=%d "
            "secrets_dropped=%d",
            dropped_owners,
            dropped_motivations,
            dropped_secrets,
        )
    _logger.info(
        "merge_narrative_promises threads=%d secrets=%d rules_appended=%d",
        len(threads),
        len(secrets),
        appended_rules,
    )
    return doc
