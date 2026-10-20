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
from collections import Counter
from collections.abc import Iterable
from typing import TYPE_CHECKING

from fountain.parse import is_slugline
from fountain.timeline import _SCENE_NUMBER_SUFFIX_RE

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
# Every trailing extension group, closed or not: "(V.O.) (CONT'D)", "(CONT'D".
_EXTENSIONS_RE = re.compile(r"(?:\s*\([^)]*\)?)+\s*$")
# The left-margin twin of timeline's trailing production scene number
# ("17 INT. OFFICE 17").
_SCENE_NUMBER_PREFIX_RE = re.compile(r"^[A-Za-z]?\d{1,3}[A-Za-z]?\s")

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
        # One-word shots (multi-word ones: is_shot_heading).
        "INSERT",
        "ANGLE",
        "POV",
        # Structural markers. A teleplay is full of all-caps lines that are
        # not people, and on a real 60-page import these were minting
        # characters called "Act One", "End Of Teaser" and "Main Titles" —
        # which then poison every downstream name resolution (knownBy, secret
        # holders, relationships) because they compete with the real cast.
        "TEASER",
        "END OF TEASER",
        "MAIN TITLE",
        "MAIN TITLES",
        "TITLES",
        "ESTABLISHING",
        "MONTAGE",
        "END MONTAGE",
        "INTERCUT",
        "END INTERCUT",
        "FLASHBACK",
        "END FLASHBACK",
        "SERIES OF SHOTS",
        "PRELAP",
        "BEAT",
        "SILENCE",
        "PAUSE",
        "LATER",
        "CONTINUOUS",
        "CONTINUOUS ACTION",
        "SAME",
        "MOMENTS LATER",
    }
)

# `ACT ONE`, `ACT 2`, `END OF ACT THREE`, `TOP OF ACT FOUR` … enumerating every
# spelling is a losing game, so match the shape instead.
_ACT_MARKER_RE = re.compile(
    r"^(?:END OF |TOP OF |BEGIN(?:NING)? OF )?ACT\b[ .]*"
    r"(?:[0-9IVX]+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN)?$"
)
# Any `END OF <something>` is structure, never a character.
_END_OF_RE = re.compile(r"^END OF\b")

# Screenplay bit-part and collective vocabulary. Scripts name unnamed people
# by their function ("MAN", "SECURITY OFFICER", "MOVING MAN") and groups by a
# collective noun ("PRESS CORPS", "FOURTH GRADERS", "PARENTS"). Those are real
# cues and the dialogue under them is real, but they are roles, not people the
# story tracks — and in the People rail they crowd out the actual cast.
#
# Matched on every word after the first, not only the head noun: "Moving Man"
# ends in a role, but "All reporters present" and "Man in Grey Coat"-style
# descriptions put a modifier after it. A leading role word is a title
# ("Agent Carter", "Uncle Mickey") unless it stands alone.
_GENERIC_ROLE_HEADS = frozenset(
    {
        # people, unspecified
        "man", "men", "woman", "women", "boy", "boys", "girl", "girls",
        "kid", "kids", "child", "children", "teen", "teens", "guy", "guys",
        "lady", "ladies", "gentleman", "gentlemen", "person", "people",
        "stranger", "strangers", "passerby", "bystander", "bystanders",
        "neighbor", "neighbors", "patron", "patrons", "tourist", "tourists",
        # press
        "reporter", "reporters", "photographer", "photographers", "press",
        "corps", "anchor", "anchors", "cameraman", "crew", "journalist",
        "journalists",
        # staff / office
        "staffer", "staffers", "staff", "aide", "aides", "assistant",
        "assistants", "secretary", "receptionist", "operator", "clerk",
        "intern", "interns", "official", "officials",
        # service
        "waiter", "waitress", "bartender", "driver", "cabbie", "attendant",
        "doorman", "bellhop", "usher",
        # uniformed
        "guard", "guards", "officer", "officers", "cop", "cops", "policeman",
        "agent", "agents", "soldier", "soldiers", "marine", "marines",
        "lt", "sgt", "captain", "sentry",
        # medical
        "doctor", "doctors", "nurse", "nurses", "paramedic", "paramedics",
        "surgeon", "technician", "technicians",
        # school
        "student", "students", "teacher", "teachers", "grader", "graders",
        "principal", "class", "parent", "parents",
        # labour
        "worker", "workers", "workman", "workmen", "engineer", "foreman",
        "mover", "movers",
        # collectives / non-people
        "crowd", "group", "team", "audience", "protester", "protesters",
        "consulting", "company", "corporation", "inc", "corp", "llc",
        "voice", "voices", "announcer", "narrator",
        # relational descriptors ("Leo's wife" is a description, not a name)
        "wife", "husband", "mother", "father", "son", "daughter", "sister",
        "brother", "aunt", "uncle", "cousin", "widow", "widower",
    }
)

# Action lines that look like cues. A stage direction in caps ("BEEPER GOES
# OFF.", "THE DOOR SLAMS") matches the cue shape exactly, and one slipped
# through as a character on a real import.
#
# Verb detection is the obvious tool and the dangerous one — WILL, MAY, MARK,
# GRANT, CHASE, ROSE and HUNTER are all names. Two constraints keep it safe:
#
#   1. Third-person-singular -s forms only. "GOES"/"SLAMS"/"RINGS" are verbs
#      in a way "WILL"/"MAY"/"MARK" are not, and English names very rarely
#      take that shape.
#   2. Multi-word cues only, so a single-word name can never be rejected here
#      no matter what it is.
#
# A real cue is a name, and names don't conjugate.
_ACTION_VERBS = frozenset(
    {
        "goes", "comes", "enters", "exits", "leaves", "arrives", "returns",
        "opens", "closes", "slams", "shuts", "locks", "knocks",
        "rings", "buzzes", "beeps", "chimes", "blares", "sounds",
        "walks", "runs", "crosses", "steps", "moves", "turns", "spins",
        "sits", "stands", "rises", "falls", "drops", "lands",
        "looks", "watches", "stares", "glances", "waits", "pauses",
        "holds", "grabs", "pulls", "pushes", "lifts", "hands", "puts",
        "picks", "takes", "gives", "throws", "catches",
        "starts", "stops", "begins", "ends", "continues", "reveals",
        "appears", "vanishes", "fades", "cuts", "flickers", "glows",
        "hangs", "sits", "lies", "rests", "waits",
    }
)


def is_action_line(name: str) -> bool:
    """A multi-word cue containing a conjugated verb is stage direction."""
    tokens = re.findall(r"[A-Za-z]+", name or "")
    if len(tokens) < 2:
        return False
    return any(token.casefold() in _ACTION_VERBS for token in tokens)


# Camera directions in caps ("ON BART", "CLOSE ON MRS. KRABAPPEL", "BART'S
# POV", "REVERSE ANGLE"). With action directly under them they pass the
# dialogue-follows test too, and on a real import "ON BART" minted first and
# then absorbed BART by suffix, naming the lead "On Bart". Multi-word only,
# like is_action_line, so a one-word name ("PAN") is never a shot.
# ponytail: a word list; extend it when a script shows another shot word.
_SHOT_HEADS = frozenset(
    {
        "on", "close", "closeup", "wide", "tight", "back", "insert", "push", "pull",
        "extreme", "ecu", "cu", "mcu", "tracking", "aerial", "overhead", "establishing",
    }
)
_SHOT_WORDS = frozenset({"angle", "pov"})


def is_shot_heading(name: str) -> bool:
    """A multi-word cue led by a shot word, or naming an angle or POV."""
    tokens = [token.casefold() for token in re.findall(r"[A-Za-z]+", name or "")]
    if len(tokens) < 2:
        return False
    return tokens[0] in _SHOT_HEADS or any(token in _SHOT_WORDS for token in tokens)


_PARENTHETICAL_RE = re.compile(r"\s*\([^)]*\)")


def is_generic_role(name: str) -> bool:
    """Is this a role/collective rather than a named individual?

    Parentheticals are stripped first, so "Elizabeth (Annie's mother)" is
    judged on "Elizabeth" — a real name with a descriptive gloss — and kept,
    while a bare "Mother" is dropped.
    """
    stripped = _PARENTHETICAL_RE.sub("", name or "").strip()
    tokens = re.findall(r"[A-Za-z]+", stripped)
    # ponytail: a title after the first word ("Special Agent Carter") reads as
    # a role; needs a name lexicon if real names start getting dropped.
    return any(token.casefold() in _GENERIC_ROLE_HEADS for token in tokens[1:] or tokens)


# "C.J." / "J.R." — every dot-separated segment is a single letter.
_INITIALISM_RE = re.compile(r"^(?:[A-Za-z]\.){2,}$")

_AUDIENCE_TOKENS = frozenset({"audience", "the audience", "viewer", "viewers"})


# Share of cue lines that must have dialogue directly under them before the
# script is trusted to format cues that way (see extract_character_cues).
_DIALOGUE_FOLLOWS_MAJORITY = 0.5

# A script is read as a shooting script when at least this many scene headings,
# and more than this share of them, carry a production number. Field of Dreams
# numbers 20 of 50 (OCR loses the rest), the West Wing pilot 19 of 29; a
# teleplay numbers none, and the floor keeps a short one with "INT. ROOM 101"
# or "- DAY 2" headings from tripping it.
# ponytail: count + share; parse real number sequences if scripts straddle it.
_NUMBERED_SCENES_MIN = 5
_NUMBERED_SCENES_SHARE = 0.25


def _is_numbered(text: str) -> bool:
    return bool(_SCENE_NUMBER_SUFFIX_RE.search(text) or _SCENE_NUMBER_PREFIX_RE.match(text))


def is_shooting_script(lines: Iterable[str]) -> bool:
    """Does the script number its scenes ("17 INT. OFFICE 17")?"""
    headings = [line.strip() for line in lines if is_slugline(line)]
    numbered = sum(_is_numbered(heading) for heading in headings)
    return numbered >= _NUMBERED_SCENES_MIN and numbered > len(headings) * _NUMBERED_SCENES_SHARE


def extract_character_cues(
    lines: Iterable[str], *, shooting_script: bool | None = None
) -> list[str]:
    """Return ordered unique display names from Fountain-style character cues.

    A cue counts only when dialogue (or a parenthetical) is on the next line:
    a caps shot heading such as "WIDE ANGLE ON GARAGE" has the cue shape but
    a blank line under it. Enforced only when most cue lines pass, because
    some PDF extraction puts a blank line under every cue.

    A shooting script numbers every shot at the page edge ("RAY 18",
    "97 CONTINUED 97"); as a cast row "Ray 18" absorbed the real RAY by prefix.
    Shot numbers are unique, so there a numbered cue seen once is a shot,
    while a numbered speaker ("NUMBER 6") talks more than once and stays.
    Outside a shooting script every numbered name stays ("50 CENT").
    ``shooting_script`` overrides detection, for a slice of a script whose
    own few headings cannot decide it.
    """
    lines = list(lines)
    if shooting_script is None:
        shooting_script = is_shooting_script(lines)
    cues: list[tuple[str, bool]] = []
    for index, line in enumerate(lines):
        name = _cue_display_name(line)
        if name is None:
            continue
        following = lines[index + 1] if index + 1 < len(lines) else ""
        spoken = following.strip() and not (
            _CUE_RE.match(following) or is_slugline(following)
        )
        cues.append((name, bool(spoken)))
    enforce = sum(spoken for _, spoken in cues) > len(cues) * _DIALOGUE_FOLLOWS_MAJORITY
    # Count every line naming a speaker, including repeats whose extensions
    # the cue pattern cannot parse ("NUMBER 6 (V.O.) (CONT'D)"), or a talking
    # numbered character looks like a once-seen shot.
    uses = Counter(
        name.casefold()
        for line in lines
        if (name := _cue_display_name(_EXTENSIONS_RE.sub("", line))) is not None
    )
    seen: set[str] = set()
    out: list[str] = []
    for name, spoken in cues:
        if enforce and not spoken:
            continue
        key = name.casefold()
        if shooting_script and uses[key] == 1 and _is_numbered(name):
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def cues_from_scenes(
    scenes: Iterable[dict], *, shooting_script: bool | None = None
) -> list[str]:
    """Collect cues from beat ``scriptText`` across imported scene docs."""
    lines: list[str] = []
    for scene in scenes:
        for beat in scene.get("beats") or []:
            text = beat.get("scriptText") or ""
            lines.extend(text.split("\n"))
    return extract_character_cues(lines, shooting_script=shooting_script)


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
        "summary": "",
        "bio": "",
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
            if not alias.get("locked"):
                current = alias.get("name") or ""
                # Prefer the more specific display name. Cue order is script
                # order, so a bare MARSH can easily arrive before MARY MARSH;
                # without this the cast keeps the less informative label.
                # Rename first, then file the loser as an alias, so the
                # display name never ends up listed as an alias of itself.
                if len(name) > len(current):
                    alias["name"] = name
                    _add_alias(alias, current)
                else:
                    _add_alias(alias, name)
            continue
        minted = empty_character(name)
        characters.append(minted)
        by_fold[key] = minted
    bible["characters"] = characters
    return characters


def normalize_known_by(
    known_by: Iterable[str],
    characters: list[dict],
    source_text: str = "",
) -> tuple[list[str], list[dict]]:
    """Map ``knownBy`` entries to character ids; mint missing name-like knowers.

    Drops audience tokens. An unresolved knower passes the same gates as an
    inferred character (`merge_inferred_entities`) before it is minted: not a
    role, not filler, not matching several existing rows, and named in
    ``source_text`` when that is supplied.
    Returns ``(normalized_ids, characters)`` — characters may grow when a
    knower cannot be resolved.
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
            display = _display_from_token(token)
            # Don't re-mint what the cue filter and entity merge just refused;
            # a fact "known by" a Reporter names a role, not a person, and a
            # name matching several rows already got a merge proposal (T9.8).
            if (
                is_generic_role(display)
                or is_filler_prose(display)
                or (source_text and not name_is_grounded(display, source_text))
                or len(_matching_rows(display, chars)) > 1
            ):
                continue
            minted = empty_character(display)
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


def _strip_terminal_period(token: str) -> str:
    """Drop a sentence-ending period, but never an initialism's.

    OCR and hand-typed scripts both emit `DONNA.` alongside `DONNA`, which
    otherwise mint two characters for one person; the same trailing dot is why
    `FADE OUT.` slipped past the transition list. But `C.J.` and `J.R.` end in
    a period that is part of the name — strip it and the cast list gains a
    "C.J" that matches nothing.

    The distinguishing test is the final segment: a single letter means an
    initialism, anything longer means a word that happens to end the line.
    """
    if not token.endswith("."):
        return token
    segments = [part for part in token.split(".") if part.strip()]
    if segments and len(segments[-1].strip()) == 1:
        return token
    return token[:-1].rstrip()


def _cue_display_name(line: str) -> str | None:
    if not line or is_slugline(line):
        return None
    match = _CUE_RE.match(line)
    if match is None:
        return None
    token = re.sub(r"\s+", " ", match.group(1).strip())
    # Check for ellipsis/slugline shape BEFORE trimming any terminal period —
    # stripping first turns "WE..." into "WE.." and hides it from this test.
    if " - " in token or ".." in token:
        return None
    token = _strip_terminal_period(token)
    if not token or len(token) > 40:
        return None
    # Reject transitions even when written without a trailing colon on-line.
    folded = token.casefold()
    upper = folded.upper()
    if upper in _TRANSITION_EXACT:
        return None
    if _ACT_MARKER_RE.match(upper) or _END_OF_RE.match(upper):
        return None
    # A bit-part or collective cue is a role, not a person the story tracks.
    # Its dialogue still lives in scriptText verbatim; it just doesn't get a
    # row in the cast competing with the real characters.
    if is_generic_role(token):
        return None
    if is_action_line(token) or is_shot_heading(token):
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
        elif _INITIALISM_RE.match(word):
            # C.J. / J.R. are initialisms, not words — title-casing them
            # produces "C.j.", which is simply the wrong name.
            parts.append(word.upper())
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
    back to the T7.14 name-prefix heuristic ("Doc" <-> "Doc Brown") **and**
    the matching suffix heuristic ("Marsh" <-> "Mary Marsh"), each of which
    only resolves when exactly one character matches (an ambiguous match
    mints a new character rather than guessing wrong).

    The suffix half matters because scripts cue the same person both ways:
    a character is introduced as MARY MARSH and cued MARSH thereafter, and
    prefix matching alone left the cast holding both as separate people.
    Honorifics fall out for free — "Mrs. Landingham" ends with
    " landingham", so a bare LANDINGHAM resolves to her.

    The ambiguity guard is what keeps this safe: with both JOHN SMITH and
    JANE SMITH present, a bare SMITH matches two characters and is left
    alone rather than silently folded into whichever came first."""
    candidates = _matching_rows(name, characters)
    return candidates[0] if len(candidates) == 1 else None


def _matching_rows(name: str, characters: list[dict]) -> list[dict]:
    """The exact name/alias match, else every prefix/suffix candidate."""
    key = name.casefold()
    candidates = []
    for c in characters:
        other = (c.get("name") or "").casefold()
        if not other:
            continue
        if other == key:
            return [c]
        if key in {a.casefold() for a in (c.get("aliases") or []) if a}:
            return [c]
        if (
            other.startswith(key + " ")
            or key.startswith(other + " ")
            or other.endswith(" " + key)
            or key.endswith(" " + other)
        ):
            candidates.append(c)
    return candidates


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


def resolve_character_id(token: str, characters: list[dict]) -> str | None:
    """Public alias-aware name/id -> character id lookup that never mints
    (T7.20 `drama_manager.promises`, and any other read-only resolution of
    a model-supplied name against the already-resolved cast). Unlike
    `normalize_known_by`, an unresolved name is simply returned as `None`
    for the caller to drop -- the narrative-promises design doc's rule is
    "drop unresolvable owners/motivations", not mint a stand-in character."""
    return _resolve_to_id(token, characters)


def _add_alias(character: dict, alias: str) -> None:
    """Append `alias` to a character's aliases unless it's already there (or
    is just the character's own display name)."""
    alias = (alias or "").strip()
    if not alias:
        return
    if alias.casefold() == (character.get("name") or "").casefold():
        return
    existing = character.get("aliases") or []
    if alias.casefold() in {a.casefold() for a in existing}:
        return
    character["aliases"] = [*existing, alias]


def _dedupe_aliases(aliases: Iterable[str], *, exclude: str = "") -> list[str]:
    """Clean an alias list. `exclude` drops the character's own display name:
    infer_story_entities routinely returns it among the aliases, which renders
    as "Also known as C.J." on a character called C.J."""
    seen: set[str] = {exclude.strip().casefold()} if exclude.strip() else set()
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


# Filler a model emits when a required prose field has nothing real to say.
# `traits` is required on every InferredCharacter, and on a real import the
# model filled Sam's with the literal string "placeholder" — which then
# propagated into `summary` and rendered as the character's profile.
_FILLER_PROSE = frozenset(
    {"placeholder", "n/a", "na", "none", "null", "unknown", "tbd", "todo",
     "-", "--", "\u2013", "\u2014", "...", "\u2026",
     "no traits", "not specified", "not stated", "not applicable"}
)


def is_filler_prose(text: str) -> bool:
    """Is this a required field filled with a non-answer rather than content?"""
    return (text or "").strip().strip(".<>").casefold() in _FILLER_PROSE


def name_is_grounded(name: str, source_text: str) -> bool:
    """Does any substantial word of this name actually appear in the script?

    `infer_story_entities` must return a name for every character it reports,
    and a model faced with a required field it cannot fill will sometimes fill
    it with filler instead of omitting the row — a real import produced a
    character literally named "placeholder", with `traits: "placeholder"`,
    referenced by nothing.

    A denylist would catch that one string and miss the next invention, so
    this checks the property that actually matters: a character who is in the
    script is *named* in the script somewhere. Deliberately token-level and
    permissive — one word of three or more characters is enough — because the
    op's whole purpose includes non-speaking characters who are only
    mentioned in action lines (T7.15). Measured against a real 60-page
    import: 46 of 47 inferred characters passed, and the one that failed was
    the placeholder.
    """
    tokens = [token for token in re.findall(r"[A-Za-z']{3,}", name or "")]
    if not tokens:
        # Nothing substantial to check (initials, digits) — don't reject on
        # no evidence either way; the cue filter already screened the shape.
        return True
    haystack = source_text.casefold()
    return any(token.casefold() in haystack for token in tokens)


def merge_inferred_entities(
    bible: dict, entities: StoryEntities, source_text: str = ""
) -> tuple[list[dict], list[dict], list[dict]]:
    """Fold `infer_story_entities` output into `bible` (T7.15).

    `source_text` is the imported script; when supplied, an inferred
    character whose name appears nowhere in it is dropped as ungrounded (see
    `name_is_grounded`). Defaults to "" — meaning "no source to check
    against, keep everything" — so existing callers and tests are unaffected.

    - Characters: when the inferred name and aliases together match exactly
      one existing row (exact/alias, else prefix/suffix), that row's
      `aliases` gain the name and aliases (deduped); when they match several
      rows nothing is attached or minted and a merge proposal is returned
      (T9.8); an unmatched name mints a new shell (`empty_character`) with
      `aliases` set from the inferred row. When unlocked and empty, copy inferred
      `traits` into `traits` and `summary` (T7.31 profile). A `locked: true`
      matched row's fields are never modified -- only its id is used for
      relationship resolution. Never renames or deletes any existing character.
    - Relationships: appended only when both `betweenNames` resolve to a
      character (post-mint); unresolvable rows are dropped and counted in
      the log (never logged by name/quote -- ids/counts only, rule 5).
    - World elements: appended to `worldQA` as `{q: "Where/What is
      <name>?", a: note}`.
    - Relationship states (T7.25, design doc "Scene-anchored rows"): one
      `{between, label, sceneId, quote}` per resolved relationship's own
      `evidence` entry -- the same evidence the model already cites for the
      bible-level relationship, reused as a scene-anchored timeline rather
      than a second classifier call. Dropped alongside its relationship
      when either side is unresolved.

    Mutates and returns `bible["characters"]`; `bible["relationships"]` and
    `bible["worldQA"]` are updated in place too. Returns
    `(characters, relationship_states, merge_proposals)` -- the latter two
    are not stored on `bible` (states belong on the episode; each proposal,
    `{sceneIds, explanation}`, becomes an open flag; the caller does both).
    """
    characters = list(bible.get("characters") or [])
    dropped_ungrounded = 0
    dropped_generic = 0
    merge_proposals: list[dict] = []
    proposed: set[frozenset[str]] = set()

    for inferred in entities.characters:
        name = (inferred.name or "").strip()
        if not name:
            continue
        hits = {
            row["id"]: row
            for token in [name, *inferred.aliases]
            if token.strip()
            for row in _matching_rows(token.strip(), characters)
        }
        existing = next(iter(hits.values())) if len(hits) == 1 else None
        # Only gate names that don't attach. An already-known character
        # (minted from a cue, or writer-authored) is grounded by whatever put
        # it there, and this check must never delete or skip an existing row.
        if existing is None and source_text and not name_is_grounded(name, source_text):
            dropped_ungrounded += 1
            continue
        if existing is None and is_generic_role(name):
            dropped_generic += 1
            continue
        if len(hits) > 1:
            # Attaching to any one row would be a guess; the writer decides
            # with Merge into (T7.16).
            key = frozenset(hits)
            if key not in proposed:
                proposed.add(key)
                merge_proposals.append(
                    {
                        "sceneIds": [e.scene_id for e in inferred.evidence],
                        "explanation": (
                            f'[merge_proposal] The breakdown names "{name}", which '
                            "matches more than one cast entry: "
                            f"{', '.join(row['name'] for row in hits.values())}. "
                            "If they are one person, combine them with Merge into "
                            "(Ledger, Cast, Manage)."
                        ),
                    }
                )
            continue
        traits = (inferred.traits or "").strip()
        if is_filler_prose(traits):
            # Better an empty profile than one that says "placeholder";
            # resolveCharacterProfile already derives a fallback from facts.
            traits = ""
        if existing is None:
            minted = empty_character(name)
            minted["aliases"] = _dedupe_aliases(inferred.aliases, exclude=name)
            if traits:
                minted["traits"] = traits
                minted["summary"] = traits
            characters.append(minted)
        elif not existing.get("locked"):
            existing["aliases"] = _dedupe_aliases(
                [*(existing.get("aliases") or []), name, *inferred.aliases],
                exclude=existing.get("name") or "",
            )
            if traits:
                if not (existing.get("traits") or "").strip():
                    existing["traits"] = traits
                if not (existing.get("summary") or "").strip():
                    existing["summary"] = traits

    relationships = list(bible.get("relationships") or [])
    relationship_states: list[dict] = []
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
        # DESIGN-GAP(T9.15): T9.9 asks for locate_quote offsets on these quotes,
        # but RelationshipState has no offset fields (adding them is a contract
        # change) and its evidence names a scene, not a beat or line window.
        for evidence in rel.evidence:
            relationship_states.append(
                {
                    "between": [left_id, right_id],
                    "label": rel.label,
                    "sceneId": evidence.scene_id,
                    "quote": evidence.quote,
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
    if dropped_relationships or dropped_ungrounded or dropped_generic or merge_proposals:
        _logger.info(
            "merge_inferred_entities relationships_dropped=%d "
            "characters_ungrounded=%d characters_generic=%d merge_proposals=%d",
            dropped_relationships,
            dropped_ungrounded,
            dropped_generic,
            len(merge_proposals),
        )
    return characters, relationship_states, merge_proposals
