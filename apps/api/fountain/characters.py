"""Heuristic cast minting for import (T7.14), plus the `infer_story_entities`
merge (T7.15).

Fountain character cues → ``seriesBible.characters`` shells, then map ledger
``knownBy`` display names onto those ids. No LLM. See
``docs/superpowers/specs/2026-07-16-import-character-mint-design.md`` (T7.14)
and ``docs/superpowers/specs/2026-07-16-continuity-layer-roadmap-design.md``
(T7.15).

`merge_inferred_entities` folds the classifier op's `StoryEntities` output
(names only -- the model never mints or knows ids) into the bible: resolved
character names extend existing rows with aliases, relationships whose both
endpoints resolve are appended, and world elements land as `worldQA`
entries. A `locked: true` character's own fields are never modified by
either merge path (CLAUDE.md rule 2) -- only its id is used to resolve
relationships/knownBy against it.
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import Iterable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from schemas import StoryEntities

_logger = logging.getLogger("fountain.characters")

# DESIGN-GAP(T7.14): design doc §4.8 wants full bible reverse-engineering on
# import; new-project-flow listed that as a non-goal. This module is the narrow
# characters + knownBy-id unblocker only — not relationships/theme/arcs.

# Cue name token + optional parenthetical extension (V.O.), (O.S.), (CONT'D)…
_CUE_RE = re.compile(
    r"^\s*([A-Z0-9][A-Z0-9 \.'.\-]*?[A-Z0-9.]|[A-Z0-9])"
    r"(?:\s*\([^)]*\))?\s*$"
)

_SLUGLINE_RE = re.compile(
    r"^\s*(INT\./EXT\.?|INT/EXT\.?|I/E\.?|INT\.?|EXT\.?|EST\.?)[\s.]",
    re.IGNORECASE,
)

_TRANSITION_EXACT = frozenset(
    {
        "FADE IN",
        "FADE OUT",
        "FADE TO BLACK",
        "CUT TO",
        "SMASH CUT",
        "MATCH CUT",
        "DISSOLVE TO",
        "WIPE TO",
        "TITLE",
        "TITLE CARD",
        "THE END",
        "END",
        "CONTINUED",
        "MORE",
        "OMITTED",
        "BLACKOUT",
        "BACK TO SCENE",
    }
)

_AUDIENCE_TOKENS = frozenset({"audience", "the audience", "viewer", "viewers"})


def extract_character_cues(lines: Iterable[str]) -> list[str]:
    """Return ordered unique display names from Fountain-style character cues."""
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        name = _cue_display_name(line)
        if name is None:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def cues_from_scenes(scenes: Iterable[dict]) -> list[str]:
    """Collect cues from beat ``scriptText`` across imported scene docs."""
    lines: list[str] = []
    for scene in scenes:
        for beat in scene.get("beats") or []:
            text = beat.get("scriptText") or ""
            lines.extend(text.split("\n"))
    return extract_character_cues(lines)


def empty_character(name: str, *, character_id: str | None = None) -> dict:
    """Foundation-shaped Character shell (routes._series_bible_from_foundation)."""
    return {
        "id": character_id or f"char-{uuid.uuid4().hex}",
        "name": name,
        "locked": False,
        "aliases": [],
        "embodiment": "",
        "presentation": "",
        "hiding": "",
        "traits": "",
        "seriesArc": "",
    }


def merge_characters_into_bible(
    bible: dict,
    display_names: Iterable[str],
) -> list[dict]:
    """Ensure each display name exists in ``bible["characters"]``; return the list.

    Never renames or replaces a locked character. Case-insensitive name match
    skips minting a duplicate.
    """
    characters = list(bible.get("characters") or [])
    by_fold = {c["name"].casefold(): c for c in characters if c.get("name")}
    for raw in display_names:
        name = (raw or "").strip()
        if not name or _is_audience_token(name):
            continue
        key = name.casefold()
        if key in by_fold:
            continue
        # Prefer extending an existing longer/shorter alias match rather than
        # minting Doc + Doc Brown as two people when one already exists.
        alias = _alias_match(name, characters)
        if alias is not None:
            by_fold[key] = alias
            continue
        minted = empty_character(name)
        characters.append(minted)
        by_fold[key] = minted
    bible["characters"] = characters
    return characters


def normalize_known_by(
    known_by: Iterable[str],
    characters: list[dict],
) -> tuple[list[str], list[dict]]:
    """Map ``knownBy`` entries to character ids; mint missing name-like knowers.

    Drops audience tokens. Returns ``(normalized_ids, characters)`` — characters
    may grow when a knower cannot be resolved.
    """
    chars = list(characters)
    resolved: list[str] = []
    seen: set[str] = set()
    for raw in known_by:
        token = (raw or "").strip()
        if not token or _is_audience_token(token):
            continue
        char_id = _resolve_to_id(token, chars)
        if char_id is None:
            # Already an unknown id-shaped token with no matching character —
            # drop rather than invent a nameless person.
            if token.startswith("char-") and all(
                c.get("id") != token for c in chars
            ):
                continue
            minted = empty_character(_display_from_token(token))
            chars.append(minted)
            char_id = minted["id"]
        if char_id not in seen:
            seen.add(char_id)
            resolved.append(char_id)
    return resolved, chars


def backfill_cast_and_known_by(doc: dict, ledger: list[dict]) -> tuple[dict, list[dict]]:
    """Mint cast from script cues + ledger knownBy names; rewrite fact knownBy."""
    bible = doc.setdefault("seriesBible", {})
    scenes: list[dict] = []
    for season in doc.get("seasons") or []:
        for episode in season.get("episodes") or []:
            scenes.extend(episode.get("scenes") or [])

    names = list(cues_from_scenes(scenes))
    for fact in ledger:
        for kb in fact.get("knownBy") or []:
            if isinstance(kb, str) and kb.strip() and not _is_audience_token(kb):
                if not kb.startswith("char-"):
                    names.append(_display_from_token(kb))

    characters = merge_characters_into_bible(bible, names)
    new_ledger: list[dict] = []
    for fact in ledger:
        known = fact.get("knownBy") or []
        normalized, characters = normalize_known_by(known, characters)
        updated = dict(fact)
        updated["knownBy"] = normalized
        new_ledger.append(updated)
    bible["characters"] = characters
    return doc, new_ledger


def _cue_display_name(line: str) -> str | None:
    if not line or _SLUGLINE_RE.match(line):
        return None
    match = _CUE_RE.match(line)
    if match is None:
        return None
    token = re.sub(r"\s+", " ", match.group(1).strip())
    if not token or len(token) > 40:
        return None
    # Reject transitions even when written without a trailing colon on-line.
    folded = token.casefold()
    if folded.upper() in _TRANSITION_EXACT:
        return None
    if token.endswith(" TO") or token.endswith(" TO:"):
        return None
    if ":" in token:
        return None
    # Require at least two letters so lone digits / "A" noise drops.
    if sum(ch.isalpha() for ch in token) < 2:
        return None
    return _title_case_cue(token)


def _title_case_cue(token: str) -> str:
    parts: list[str] = []
    for word in token.split(" "):
        if not word:
            continue
        if "'" in word:
            # O'BRIEN → O'Brien
            head, *rest = word.split("'")
            rebuilt = "'".join(
                (p[:1].upper() + p[1:].lower()) if p else p for p in [head, *rest]
            )
            parts.append(rebuilt)
        else:
            parts.append(word[:1].upper() + word[1:].lower())
    return " ".join(parts)


def _is_audience_token(token: str) -> bool:
    return token.strip().casefold() in _AUDIENCE_TOKENS


def _display_from_token(token: str) -> str:
    """Turn a knownBy display string into a Character.name."""
    cleaned = re.sub(r"\s+", " ", token.strip())
    # Preserve leading apostrophe nicknames like '67 Doc
    if cleaned.isupper() or cleaned.islower():
        return _title_case_cue(cleaned.upper())
    return cleaned


def _alias_match(name: str, characters: list[dict]) -> dict | None:
    """Fuzzy character lookup by display name: an exact name/alias match
    (T7.15: a `knownBy`/inferred-entity name matching any character's
    `aliases` resolves to that character) short-circuits; otherwise fall
    back to the T7.14 name-prefix heuristic ("Doc" <-> "Doc Brown"), which
    only resolves when exactly one character is a prefix match (an
    ambiguous prefix mints a new character rather than guessing wrong)."""
    key = name.casefold()
    candidates = []
    for c in characters:
        other = (c.get("name") or "").casefold()
        if not other:
            continue
        if other == key:
            return c
        if key in {a.casefold() for a in (c.get("aliases") or []) if a}:
            return c
        if other.startswith(key + " ") or key.startswith(other + " "):
            candidates.append(c)
    if len(candidates) == 1:
        return candidates[0]
    return None


def _find_character(token: str, characters: list[dict]) -> dict | None:
    """Resolve a display name/id `token` to its character row (exact id,
    exact/casefold name, then `_alias_match`'s alias/prefix fallback).
    Returns the row itself (not just the id) so callers can inspect
    `locked` or merge in additional aliases."""
    for c in characters:
        if c.get("id") == token:
            return c
    key = token.casefold()
    for c in characters:
        if (c.get("name") or "").casefold() == key:
            return c
    return _alias_match(token, characters)


def _resolve_to_id(token: str, characters: list[dict]) -> str | None:
    found = _find_character(token, characters)
    return found["id"] if found else None


def _dedupe_aliases(aliases: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for alias in aliases:
        cleaned = (alias or "").strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


_WORLD_ELEMENT_QUESTION_PREFIX = {"location": "Where", "object": "What"}


def merge_inferred_entities(bible: dict, entities: StoryEntities) -> list[dict]:
    """Fold `infer_story_entities` output into `bible` (T7.15).

    - Characters: resolved names (exact/casefold/alias, `_find_character`)
      extend the matched row's `aliases` (deduped, union of old+new); an
      unresolved name mints a new shell (`empty_character`) with `aliases`
      set from the inferred row. A `locked: true` matched row's fields are
      never modified -- only its id is used for relationship resolution.
      Never renames or deletes any existing character.
    - Relationships: appended only when both `betweenNames` resolve to a
      character (post-mint); unresolvable rows are dropped and counted in
      the log (never logged by name/quote -- ids/counts only, rule 5).
    - World elements: appended to `worldQA` as `{q: "Where/What is
      <name>?", a: note}`.

    Mutates and returns `bible["characters"]`; `bible["relationships"]` and
    `bible["worldQA"]` are updated in place too.
    """
    characters = list(bible.get("characters") or [])

    for inferred in entities.characters:
        name = (inferred.name or "").strip()
        if not name:
            continue
        existing = _find_character(name, characters)
        if existing is None:
            minted = empty_character(name)
            minted["aliases"] = _dedupe_aliases(inferred.aliases)
            characters.append(minted)
        elif not existing.get("locked"):
            existing["aliases"] = _dedupe_aliases(
                [*(existing.get("aliases") or []), *inferred.aliases]
            )

    relationships = list(bible.get("relationships") or [])
    dropped_relationships = 0
    for rel in entities.relationships:
        left_id = _resolve_to_id(rel.between_names[0], characters)
        right_id = _resolve_to_id(rel.between_names[1], characters)
        if left_id is None or right_id is None:
            dropped_relationships += 1
            continue
        relationships.append(
            {
                "between": [left_id, right_id],
                "label": rel.label,
                "reallyLike": rel.really_like,
                "locked": False,
            }
        )

    world_qa = list(bible.get("worldQA") or [])
    for element in entities.world_elements:
        prefix = _WORLD_ELEMENT_QUESTION_PREFIX.get(str(element.kind), "What")
        world_qa.append(
            {"q": f"{prefix} is {element.name}?", "a": element.note, "locked": False}
        )

    bible["characters"] = characters
    bible["relationships"] = relationships
    bible["worldQA"] = world_qa
    if dropped_relationships:
        _logger.info(
            "merge_inferred_entities relationships_dropped=%d", dropped_relationships
        )
    return characters
