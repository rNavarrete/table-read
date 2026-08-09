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
import re
from typing import TYPE_CHECKING

from drama_manager.ledger_policy import IdMinter, verify_source_text
from drama_manager.narrative_map import _source_quote
from fountain.characters import resolve_character_id

if TYPE_CHECKING:
    from schemas import NarrativePromises

_logger = logging.getLogger("drama_manager.promises")


# A screenplay line that is only a character cue ("MANDY"), a transition
# ("FADE TO BLACK."), or a stray fragment ("levels.") is verbatim source text,
# so it passes any presence check — and supports nothing. Requiring a few words
# of actual line is the cheapest way to tell a citation from a filled field.
_CUE_OR_TRANSITION = re.compile(r"^[A-Z0-9][A-Z0-9 .,'’()/-]*$")
_MIN_QUOTE_WORDS = 3


def is_substantive_quote(quote: str) -> bool:
    """Whether ``quote`` could support a claim at all.

    Presence in the script is necessary but nowhere near sufficient. On a real
    import 7 of 51 stored quotes were bare cues or fragments — `MANDY`,
    `MALLORY`, `levels.`, `FADE TO BLACK.` — each verifiable verbatim and each
    evidence of nothing.
    """
    text = " ".join((quote or "").split())
    if len(text.split()) < _MIN_QUOTE_WORDS:
        return False
    return not _CUE_OR_TRANSITION.match(text)


_CHARACTER_CUE = re.compile(r"^[A-Z][A-Z0-9 .'’-]{0,30}(\([^)]*\))?$")
_SLUGLINE_PREFIXES = ("INT.", "EXT.", "I/E.", "INT/EXT.", "EST.")


def _is_slugline(line: str) -> bool:
    return line.upper().startswith(_SLUGLINE_PREFIXES)

_PARENTHETICAL = re.compile(r"^\(.*\)$")


def _dialogue_line(beat: dict) -> str:
    """The first spoken line in a beat, or "" if it has none.

    `_source_quote` takes the first line that is not a slugline or a cue,
    which in a screenplay is nearly always action: on a real import it
    returned "Sam's PAGER BEEPS --" and "The RECEPTIONIST appears in the
    doorway." for beats whose actual content was the exchange underneath.
    Threads and secrets are almost always carried by what someone says, so
    prefer dialogue and let action be the fallback.

    Fountain puts dialogue on the lines after an all-caps character cue,
    optionally past a parenthetical.
    """
    lines = [line.strip() for line in str(beat.get("scriptText") or "").splitlines()]
    for index, line in enumerate(lines):
        if not line or _is_slugline(line) or not _CHARACTER_CUE.match(line):
            continue
        for candidate in lines[index + 1 :]:
            if not candidate:
                break  # blank line ends the dialogue block
            if _PARENTHETICAL.match(candidate):
                continue
            return candidate[:200]
    return ""


def quote_for_beat(
    scene: dict | None, beat_id: str | None
) -> tuple[str, str | None]:
    """Derive the evidence quote from the beat the model cited.

    Returns ``(quote, beat_id)``, or ``("", None)`` when the beat is not one of
    the cited scene's own — an id that does not resolve is a claim without
    evidence, not a licence to quote something else.

    The model used to supply the quote directly, picked from six
    positionally-sampled lines per scene. On a long scene that is six lines out
    of hundreds, so it could not cite the line that states a secret unless that
    line happened to fall on a sample point; the quotes that came back were
    fragments like "Yes. Bonnie --". Beat ids are already in the prompt spine
    and the server holds every beat's full text, so letting the model point at
    the beat and deriving the line here is both exact and cheaper. Same
    division of labour as the Narrative Map.

    `_source_quote` skips sluglines and bare character cues, which is why the
    substance floor below is a backstop rather than the main defence.
    """
    if not beat_id or scene is None:
        return ("", None)
    beat = next(
        (b for b in scene.get("beats") or [] if b.get("id") == beat_id), None
    )
    if beat is None:
        return ("", None)
    quote = _dialogue_line(beat) or _source_quote(beat)
    if not is_substantive_quote(quote):
        return ("", None)
    return (quote, beat_id)


def anchor_quote(scene: dict | None, quote: str) -> tuple[str, str | None]:
    """Locate ``quote`` verbatim among ``scene``'s beats.

    Returns ``(quote, beat_id)`` when it is found, and ``("", None)`` when it
    is not — an unverifiable quote is dropped rather than stored, the same
    stance `ledger_policy.apply_extraction_policy` takes when `sourceText`
    misses its window (prompt spec §8: "schema conformance alone never implies
    acceptance").

    Threads and secrets cite a *scene*, and until now their quotes were stored
    with no verification at all. Scene scope is also too coarse to trust on its
    own: a scene that runs two locations under a single slugline — the West
    Wing pilot intercuts Josh/Mandy at a restaurant with Sam/Laurie at her
    apartment under one — will verify a quote drawn from the wrong storyline.
    Resolving the beat says *where* inside the scene the evidence actually sits,
    so a citation attached to the wrong half is visible instead of merely
    plausible.

    Matching runs through `verify_source_text`, so it inherits the typographic
    folding that lets a curly-quoted script match a straight-quoted citation.
    """
    if not quote.strip() or scene is None or not is_substantive_quote(quote):
        return ("", None)
    for beat in scene.get("beats") or []:
        script = beat.get("scriptText", "")
        if not script:
            continue
        _start, _end, verified = verify_source_text(
            script, quote, 1, len(script.split("\n"))
        )
        if verified:
            return (quote, beat["id"])
    return ("", None)


_QUOTE_FIELDS = (
    ("setupQuote", "setupBeatId"),
    ("payoffQuote", "payoffBeatId"),
    ("establishedQuote", "establishedBeatId"),
    ("revealedQuote", "revealedBeatId"),
)


def drop_reused_quotes(*claim_lists: list[dict]) -> int:
    """Clear any quote cited by more than one claim, returning how many uses
    were cleared.

    A line offered as evidence for nine different secrets identifies none of
    them. On a real import 33 of 51 quote uses were duplicates, one line
    ("He seems effeminate to me.") accounting for nine — the signature of a
    required field being filled rather than a source being cited. Since there
    is no way to tell which single use was the intended one, all of them go:
    an empty quote reads as "no evidence offered", which is true, while a
    plausible-looking one reads as corroboration, which is not.
    """
    uses: dict[str, int] = {}
    for claims in claim_lists:
        for claim in claims:
            for quote_key, _beat_key in _QUOTE_FIELDS:
                text = (claim.get(quote_key) or "").strip()
                if text:
                    uses[text] = uses.get(text, 0) + 1
    reused = {text for text, count in uses.items() if count > 1}
    if not reused:
        return 0
    cleared = 0
    for claims in claim_lists:
        for claim in claims:
            for quote_key, beat_key in _QUOTE_FIELDS:
                if (claim.get(quote_key) or "").strip() in reused:
                    claim[quote_key] = ""
                    claim[beat_key] = None
                    cleared += 1
    return cleared


def _find_episode(doc: dict, episode_id: str) -> dict:
    for season in doc.get("seasons") or []:
        for episode in season.get("episodes") or []:
            if episode["id"] == episode_id:
                return episode
    raise KeyError(episode_id)


_DANGLING_QUOTE_RE = re.compile(r"([.!?])\s*(['\u2019\"\u201d])\s*$")

# Straight/curly forms of the same mark, so a curly closer is recognised as
# balancing a straight opener and vice versa.
_QUOTE_FAMILY = {
    "'": "'\u2018\u2019",
    "\u2019": "'\u2018\u2019",
    '"': '"\u201c\u201d',
    "\u201d": '"\u201c\u201d',
}


def _clean_prose(text: str) -> str:
    """Drop a dangling closing quote the model left on a prose field.

    Every secret summary on a real import came back ending `.'` — the model
    closing a quotation it never opened.

    Two guards keep this from eating real punctuation. The quote must follow
    sentence-ending punctuation, so a possessive ("...was Sam's") is never
    touched. And it must be *unbalanced* — no member of the same quote family
    appears earlier in the string — so a summary that genuinely ends in quoted
    dialogue ('she said "no."') keeps its closer. Both err toward leaving the
    writer's text alone.
    """
    cleaned = (text or "").strip()
    match = _DANGLING_QUOTE_RE.search(cleaned)
    if match is None:
        return cleaned
    family = _QUOTE_FAMILY.get(match.group(2), "")
    if any(ch in family for ch in cleaned[: match.start(2)]):
        return cleaned  # balanced — a real quotation, leave it
    return cleaned[: match.start(2)].rstrip()


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
    unresolved_beats = 0
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
        setup_quote, setup_beat_id = quote_for_beat(
            scenes_by_id.get(inferred.setup_scene_id), inferred.setup_beat_id
        )
        payoff_quote, payoff_beat_id = quote_for_beat(
            scenes_by_id.get(payoff_scene_id), inferred.payoff_beat_id
        )
        if inferred.setup_beat_id and not setup_quote:
            unresolved_beats += 1
        if inferred.payoff_beat_id and not payoff_quote:
            unresolved_beats += 1
        threads.append(
            {
                "id": thread_minter.mint(),
                "label": _clean_prose(inferred.label),
                "summary": _clean_prose(inferred.summary),
                "status": str(inferred.status),
                "ownerCharacterIds": owner_ids,
                "setupSceneId": inferred.setup_scene_id,
                "payoffSceneId": payoff_scene_id,
                "setupQuote": setup_quote,
                "payoffQuote": payoff_quote,
                "setupBeatId": setup_beat_id,
                "payoffBeatId": payoff_beat_id,
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
        established_quote, established_beat_id = quote_for_beat(
            scenes_by_id.get(inferred_secret.established_scene_id),
            inferred_secret.established_beat_id,
        )
        revealed_quote, revealed_beat_id = quote_for_beat(
            scenes_by_id.get(revealed_scene_id), inferred_secret.revealed_beat_id
        )
        if inferred_secret.established_beat_id and not established_quote:
            unresolved_beats += 1
        if inferred_secret.revealed_beat_id and not revealed_quote:
            unresolved_beats += 1
        secrets.append(
            {
                "id": secret_minter.mint(),
                "summary": _clean_prose(inferred_secret.summary),
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
                "establishedQuote": established_quote,
                "revealedQuote": revealed_quote,
                "establishedBeatId": established_beat_id,
                "revealedBeatId": revealed_beat_id,
                "provenance": "inferred",
                "locked": False,
            }
        )
    episode["secrets"] = secrets
    reused_cleared = drop_reused_quotes(threads, secrets)

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
                "evidenceQuote": quote_for_beat(
                    scenes_by_id.get(evidence_scene_id), rule.evidence_beat_id
                )[0],
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
        "merge_narrative_promises threads=%d secrets=%d rules_appended=%d "
        "beats_unresolved=%d reused_cleared=%d",
        len(threads),
        len(secrets),
        appended_rules,
        unresolved_beats,
        reused_cleared,
    )
    return doc
