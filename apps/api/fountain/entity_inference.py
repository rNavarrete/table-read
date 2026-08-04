"""Chunk + combine helpers for import-time `infer_story_entities`.

Large scripts (~100+ scenes with early `scriptText` lines) can exceed the
classifier context and fail with Anthropic `400 invalid_request_error`
("prompt is too long"). Split scene summaries under a conservative char
budget, call the op per chunk, then combine name/alias-aware results before
`merge_inferred_entities` folds into the bible.

Ids are never invented here — names stay strings for server resolution.
"""

from __future__ import annotations

import json
from collections.abc import Iterable

from schemas import (
    EntityEvidence,
    InferredCharacter,
    InferredRelationship,
    InferredWorldElement,
    StoryEntities,
)

# Bound entity passes by both payload size and scene count. A 32-scene,
# ~24k-character Opus request still reached the five-minute timeout. Smaller
# Sonnet worker batches trade a little fixed prompt overhead for predictable
# completion and fine-grained durable recovery.
ENTITY_INFER_USER_CHAR_BUDGET = 12_000
ENTITY_INFER_MAX_SCENES_PER_CHUNK = 12

# Fixed instruction / source_data tag overhead in `build_entity_prompt`
# (approximate; budget is intentionally loose).
_ENTITY_USER_OVERHEAD_CHARS = 500


def estimate_entity_user_chars(
    summaries: list[dict], speaker_names: list[str]
) -> int:
    """Rough serialized size of the entity-inference user payload."""
    return (
        len(json.dumps(summaries, ensure_ascii=False))
        + len(json.dumps(speaker_names, ensure_ascii=False))
        + _ENTITY_USER_OVERHEAD_CHARS
    )


def chunk_entity_scene_summaries(
    summaries: list[dict],
    speaker_names: list[str],
    *,
    budget: int | None = None,
    max_scenes: int | None = None,
) -> list[list[dict]]:
    """Greedy pack under both the payload and scene-count ceilings.

    Order is preserved. A single scene that alone exceeds the budget becomes
    its own chunk (cannot shrink further here — early-line truncation lives
    in the pipeline summary builder). Defaults are resolved at call time so
    tests can patch them.
    """
    if budget is None:
        budget = ENTITY_INFER_USER_CHAR_BUDGET
    if max_scenes is None:
        max_scenes = ENTITY_INFER_MAX_SCENES_PER_CHUNK
    if budget <= 0 or max_scenes <= 0:
        raise ValueError("entity chunk limits must be positive")
    if not summaries:
        return []
    chunks: list[list[dict]] = []
    current: list[dict] = []
    for summary in summaries:
        trial = [*current, summary]
        exceeds_limit = (
            len(trial) > max_scenes
            or estimate_entity_user_chars(trial, speaker_names) > budget
        )
        if current and exceeds_limit:
            chunks.append(current)
            current = [summary]
        else:
            current = trial
    if current:
        chunks.append(current)
    return chunks


def _norm(token: str) -> str:
    return (token or "").strip().casefold()


def _character_keys(name: str, aliases: Iterable[str]) -> set[str]:
    keys = {_norm(name)}
    for alias in aliases:
        key = _norm(alias)
        if key:
            keys.add(key)
    keys.discard("")
    return keys


def _merge_evidence(
    left: list[EntityEvidence], right: list[EntityEvidence]
) -> list[EntityEvidence]:
    seen: set[tuple[str, str]] = set()
    out: list[EntityEvidence] = []
    for item in [*left, *right]:
        key = (item.scene_id, item.quote)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _find_character_index(
    name: str, aliases: list[str], characters: list[InferredCharacter]
) -> int | None:
    incoming = _character_keys(name, aliases)
    for index, existing in enumerate(characters):
        if incoming & _character_keys(existing.name, existing.aliases):
            return index
    return None


def _combine_characters(
    parts: list[StoryEntities],
) -> list[InferredCharacter]:
    characters: list[InferredCharacter] = []
    for part in parts:
        for inferred in part.characters:
            name = (inferred.name or "").strip()
            if not name:
                continue
            index = _find_character_index(name, inferred.aliases, characters)
            if index is None:
                characters.append(inferred)
                continue
            existing = characters[index]
            aliases = list(existing.aliases)
            for alias in inferred.aliases:
                cleaned = (alias or "").strip()
                if cleaned and _norm(cleaned) not in {_norm(a) for a in aliases}:
                    aliases.append(cleaned)
            # Prefer the longer/more specific display name; keep first on ties.
            display = existing.name
            if len(name) > len(existing.name):
                display = name
            traits = existing.traits if existing.traits.strip() else inferred.traits
            characters[index] = InferredCharacter(
                name=display,
                aliases=aliases,
                role=existing.role,
                traits=traits,
                evidence=_merge_evidence(existing.evidence, inferred.evidence),
            )
    return characters


def _pair_key(left: str, right: str) -> tuple[str, str]:
    a, b = _norm(left), _norm(right)
    return (a, b) if a <= b else (b, a)


def _canonical_character_key(
    token: str, characters: list[InferredCharacter]
) -> str:
    """Map a name/alias onto the combined character's primary display key."""
    key = _norm(token)
    for character in characters:
        if key in _character_keys(character.name, character.aliases):
            return _norm(character.name)
    return key


def _combine_relationships(
    parts: list[StoryEntities],
    characters: list[InferredCharacter],
) -> list[InferredRelationship]:
    by_key: dict[tuple[tuple[str, str], str], InferredRelationship] = {}
    order: list[tuple[tuple[str, str], str]] = []
    for part in parts:
        for rel in part.relationships:
            left = _canonical_character_key(rel.between_names[0], characters)
            right = _canonical_character_key(rel.between_names[1], characters)
            key = (_pair_key(left, right), _norm(rel.label))
            existing = by_key.get(key)
            if existing is None:
                by_key[key] = rel
                order.append(key)
                continue
            really_like = (
                existing.really_like
                if existing.really_like.strip()
                else rel.really_like
            )
            by_key[key] = InferredRelationship(
                between_names=existing.between_names,
                label=existing.label,
                really_like=really_like,
                evidence=_merge_evidence(existing.evidence, rel.evidence),
            )
    return [by_key[key] for key in order]


def _combine_world_elements(
    parts: list[StoryEntities],
) -> list[InferredWorldElement]:
    by_key: dict[tuple[str, str], InferredWorldElement] = {}
    order: list[tuple[str, str]] = []
    for part in parts:
        for element in part.world_elements:
            key = (str(element.kind), _norm(element.name))
            existing = by_key.get(key)
            if existing is None:
                by_key[key] = element
                order.append(key)
                continue
            note = existing.note if existing.note.strip() else element.note
            by_key[key] = InferredWorldElement(
                kind=existing.kind,
                name=existing.name,
                note=note,
                evidence=_merge_evidence(existing.evidence, element.evidence),
            )
    return [by_key[key] for key in order]


def combine_story_entities(parts: list[StoryEntities]) -> StoryEntities:
    """Merge per-chunk `StoryEntities` without minting ids."""
    if not parts:
        return StoryEntities(characters=[], relationships=[], world_elements=[])
    if len(parts) == 1:
        return parts[0]
    characters = _combine_characters(parts)
    return StoryEntities(
        characters=characters,
        relationships=_combine_relationships(parts, characters),
        world_elements=_combine_world_elements(parts),
    )
