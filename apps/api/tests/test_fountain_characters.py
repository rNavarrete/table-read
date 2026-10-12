"""Unit tests for import cast minting (T7.14) and entity-inference merge (T7.15)."""

from __future__ import annotations

from fountain.characters import (
    backfill_cast_and_known_by,
    cues_from_scenes,
    empty_character,
    extract_character_cues,
    is_filler_prose,
    is_generic_role,
    merge_characters_into_bible,
    merge_inferred_entities,
    normalize_known_by,
)
from schemas import StoryEntities


def test_extract_cues_keeps_speakers_drops_transitions():
    lines = [
        "EXT. ALLEY - DAY",
        "",
        "DOC BROWN jumps out of the car.",
        "",
        "DOC",
        "Okay, I brought some homing devices.",
        "",
        "MARTY",
        "Doc!",
        "",
        "CUT TO:",
        "",
        "JENNIFER (V.O.)",
        "Marty?",
        "",
        "FADE OUT",
        "THE END",
    ]
    assert extract_character_cues(lines) == ["Doc", "Marty", "Jennifer"]


def test_numbered_scene_headings_are_not_cues():
    lines = ["17 INT. OFFICE 17", "", "A12 EXT. ALLEY", "", "MARTA", "Hi."]
    assert extract_character_cues(lines) == ["Marta"]


def test_numbered_shots_in_a_shooting_script_are_not_cues():
    """Field of Dreams: "RAY 18" is a numbered shot of Ray, not a speaker. As
    a cast row it absorbed the real RAY by prefix and split him six ways. A
    numbered speaker who talks more than once still counts."""
    lines = [
        "17 EXT. CORNFIELD - NIGHT 17",
        "RAY",
        "Hello?",
        "RAY 18",
        "Wheels are turning in his head.",
        "INT. HOUSE - NIGHT 22",
        "CLOSE ON RAY 16",
        "His mouth opens.",
        "97 CONTINUED 97",
        "Ray walks on.",
        "30 EXT. FIELD - DAY 30",
        "CONTINUED . 64",
        "Still walking.",
        "MANN . 140",
        "He looks up.",
        "NUMBER 6",
        "Where am I?",
        "31 EXT. FIELD - DUSK 31",
        "NUMBER 6",
        "I am not a number.",
        "32 INT. KITCHEN - DAY 32",
        "C.J.",
        "Hi.",
    ]
    assert extract_character_cues(lines) == ["Ray", "Number 6", "C.J."]


def test_numbered_names_still_speak_when_the_script_numbers_no_scenes():
    """Outside a shooting script a number is part of the name, even when a
    short script's headings carry a room number or a story day."""
    lines = [
        "INT. ROOM 101",
        "NUMBER 6",
        "I am not a number.",
        "50 CENT (V.O.)",
        "Yeah.",
        "INT. HOUSE - DAY 2",
        "BOB 1",
        "Hi.",
        "EXT. PIER 39",
        "BOB 2",
        "Hello.",
    ]
    assert extract_character_cues(lines) == ["Number 6", "50 Cent", "Bob 1", "Bob 2"]


def test_merge_skips_existing_and_respects_locked_name():
    bible = {
        "characters": [
            {
                "id": "char-existing",
                "name": "Marty",
                "locked": True,
                "embodiment": "",
                "presentation": "",
                "hiding": "",
                "traits": "skateboard",
                "seriesArc": "",
            }
        ]
    }
    merge_characters_into_bible(bible, ["Marty", "Doc", "DOC"])
    names = {c["name"]: c for c in bible["characters"]}
    assert set(names) == {"Marty", "Doc"}
    assert names["Marty"]["id"] == "char-existing"
    assert names["Marty"]["traits"] == "skateboard"
    assert names["Marty"]["locked"] is True


def test_normalize_maps_names_and_drops_audience():
    characters = [
        {
            "id": "char-doc",
            "name": "Doc",
            "locked": False,
            "embodiment": "",
            "presentation": "",
            "hiding": "",
            "traits": "",
            "seriesArc": "",
        },
        {
            "id": "char-marty",
            "name": "Marty",
            "locked": False,
            "embodiment": "",
            "presentation": "",
            "hiding": "",
            "traits": "",
            "seriesArc": "",
        },
    ]
    known, chars = normalize_known_by(
        ["Doc Brown", "Marty", "audience", "char-doc"], characters
    )
    assert known == ["char-doc", "char-marty"]
    assert len(chars) == 2


def test_normalize_mints_unknown_display_name():
    characters: list[dict] = []
    known, chars = normalize_known_by(["Biff"], characters)
    assert len(chars) == 1
    assert chars[0]["name"] == "Biff"
    assert known == [chars[0]["id"]]


def test_cues_from_scenes_reads_beat_script_text():
    scenes = [
        {
            "beats": [
                {
                    "scriptText": "INT. LAB\n\nDOC\nGreat Scott!\n\nMARTY\nWhat?",
                }
            ]
        }
    ]
    assert cues_from_scenes(scenes) == ["Doc", "Marty"]


def test_backfill_rewrites_ledger_known_by():
    doc = {
        "seriesBible": {"characters": []},
        "seasons": [
            {
                "episodes": [
                    {
                        "scenes": [
                            {
                                "beats": [
                                    {"scriptText": "DOC\nHi.\n\nMARTY\nHey."}
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
    }
    ledger = [
        {
            "id": "fact-1",
            "fact": "Doc invented the DeLorean time machine",
            "knownBy": ["Doc Brown", "Marty", "audience"],
        }
    ]
    new_doc, new_ledger = backfill_cast_and_known_by(doc, ledger)
    chars = new_doc["seriesBible"]["characters"]
    # The script cues DOC; the ledger names "Doc Brown". They are one person,
    # and the fuller name wins the cast row with the shorter kept as an alias.
    assert {c["name"] for c in chars} >= {"Doc Brown", "Marty"}
    doc_row = next(c for c in chars if c["name"] == "Doc Brown")
    assert "Doc" in doc_row["aliases"]
    ids = {c["id"] for c in chars}
    assert set(new_ledger[0]["knownBy"]) <= ids
    assert "audience" not in new_ledger[0]["knownBy"]


# ── alias-aware resolution (T7.15) ────────────────────────────────────────


def test_normalize_resolves_via_character_alias_not_prefix():
    """"Doc" is an alias of "Emmett Brown" with no name-prefix relation at
    all — this can only resolve through the character's `aliases` list, not
    the pre-existing prefix heuristic."""
    characters = [
        {
            "id": "char-brown",
            "name": "Emmett Brown",
            "locked": False,
            "aliases": ["Doc"],
            "embodiment": "",
            "presentation": "",
            "hiding": "",
            "traits": "",
            "seriesArc": "",
        }
    ]
    known, chars = normalize_known_by(["Doc"], characters)
    assert known == ["char-brown"]
    assert len(chars) == 1  # no duplicate minted


# ── infer_story_entities merge (T7.15) ────────────────────────────────────


def _entities(**overrides) -> StoryEntities:
    payload = {
        "characters": [],
        "relationships": [],
        "worldElements": [],
        **overrides,
    }
    return StoryEntities.model_validate(payload)


def _evidence(scene_id: str = "scene-1", quote: str = "x") -> list[dict]:
    return [{"sceneId": scene_id, "quote": quote}]


def test_merge_mints_character_with_aliases_and_non_speaking_character():
    bible: dict = {"characters": [], "relationships": [], "worldQA": []}
    entities = _entities(
        characters=[
            {
                "name": "Doc Brown",
                "aliases": ["Doc"],
                "role": "principal",
                "traits": "eccentric inventor",
                "evidence": _evidence(),
            },
            {
                "name": "Einstein",
                "aliases": [],
                "role": "minor",
                "traits": "a dog",
                "evidence": _evidence(quote="Einstein barks."),
            },
        ]
    )
    characters, relationship_states, _ = merge_inferred_entities(bible, entities)
    by_name = {c["name"]: c for c in characters}
    assert set(by_name) == {"Doc Brown", "Einstein"}
    assert by_name["Doc Brown"]["aliases"] == ["Doc"]
    assert by_name["Doc Brown"]["traits"] == "eccentric inventor"
    assert by_name["Doc Brown"]["summary"] == "eccentric inventor"
    assert by_name["Einstein"]["traits"] == "a dog"
    assert by_name["Einstein"]["summary"] == "a dog"
    assert by_name["Einstein"]["locked"] is False
    assert relationship_states == []  # no relationships in this fixture


def test_merge_appends_resolved_relationship_and_drops_unresolvable():
    bible: dict = {
        "characters": [
            {
                "id": "char-marty",
                "name": "Marty",
                "locked": False,
                "aliases": [],
                "embodiment": "",
                "presentation": "",
                "hiding": "",
                "traits": "",
                "seriesArc": "",
            }
        ],
        "relationships": [],
        "worldQA": [],
    }
    entities = _entities(
        characters=[
            {
                "name": "Doc Brown",
                "aliases": ["Doc"],
                "role": "principal",
                "traits": "",
                "evidence": _evidence(),
            }
        ],
        relationships=[
            {
                "betweenNames": ["Doc Brown", "Marty"],
                "label": "friends",
                "reallyLike": "",
                "evidence": _evidence(),
            },
            {
                "betweenNames": ["Doc Brown", "Nobody"],
                "label": "unknown",
                "reallyLike": "",
                "evidence": _evidence(),
            },
        ],
    )
    characters, relationship_states, _ = merge_inferred_entities(bible, entities)
    doc_id = next(c["id"] for c in characters if c["name"] == "Doc Brown")
    marty_id = next(c["id"] for c in characters if c["name"] == "Marty")
    assert bible["relationships"] == [
        {"between": [doc_id, marty_id], "label": "friends", "reallyLike": "", "locked": False}
    ]
    # T7.25: the resolved relationship's own evidence becomes a scene-anchored
    # relationshipState; the dropped (unresolvable) relationship contributes none.
    assert relationship_states == [
        {"between": [doc_id, marty_id], "label": "friends", "sceneId": "scene-1", "quote": "x"}
    ]


def test_merge_appends_world_elements_as_world_qa():
    bible: dict = {"characters": [], "relationships": [], "worldQA": []}
    entities = _entities(
        worldElements=[
            {
                "kind": "location",
                "name": "The Long Pour",
                "note": "The bar Marta and Dan co-own.",
                "evidence": _evidence(),
            }
        ]
    )
    merge_inferred_entities(bible, entities)
    assert bible["worldQA"] == [
        {"q": "Where is The Long Pour?", "a": "The bar Marta and Dan co-own.", "locked": False}
    ]


def test_merge_never_touches_locked_character_fields():
    bible: dict = {
        "characters": [
            {
                "id": "char-locked-doc",
                "name": "Doc Brown",
                "locked": True,
                "aliases": [],
                "embodiment": "time travel",
                "presentation": "wild hair",
                "hiding": "",
                "traits": "eccentric genius",
                "seriesArc": "",
            }
        ],
        "relationships": [],
        "worldQA": [],
    }
    entities = _entities(
        characters=[
            {
                "name": "Doc Brown",
                "aliases": ["Doc", "The Doc"],
                "role": "principal",
                "traits": "should never overwrite the locked traits",
                "evidence": _evidence(),
            }
        ]
    )
    characters, _relationship_states, _ = merge_inferred_entities(bible, entities)
    assert characters == [
        {
            "id": "char-locked-doc",
            "name": "Doc Brown",
            "locked": True,
            "aliases": [],
            "embodiment": "time travel",
            "presentation": "wild hair",
            "hiding": "",
            "traits": "eccentric genius",
            "seriesArc": "",
        }
    ]


def test_merge_does_not_overwrite_locked_traits_or_summary():
    bible: dict = {
        "characters": [
            {
                "id": "char-doc",
                "name": "Doc Brown",
                "locked": True,
                "aliases": [],
                "embodiment": "",
                "presentation": "",
                "hiding": "",
                "traits": "original",
                "seriesArc": "",
                "summary": "original summary",
                "bio": "",
            }
        ],
        "relationships": [],
        "worldQA": [],
    }
    entities = _entities(
        characters=[
            {
                "name": "Doc Brown",
                "aliases": ["Doc"],
                "role": "principal",
                "traits": "should never overwrite",
                "evidence": _evidence(),
            }
        ]
    )
    characters, _, _ = merge_inferred_entities(bible, entities)
    doc = characters[0]
    assert doc["traits"] == "original"
    assert doc["summary"] == "original summary"
    assert doc["aliases"] == []  # locked: aliases untouched too


def test_act_and_structure_markers_are_not_characters():
    """A teleplay is full of all-caps lines that are not people.

    On a real 60-page import these minted characters called "Act One",
    "End Of Teaser", "Main Titles" and "Fade Out" — 54 "characters" for a
    ~23-person cast. That poisons every downstream name resolution, because
    knownBy, secret holders and relationships all resolve against this list.
    """
    lines = [
        "ACT ONE",
        "ACT TWO",
        "ACT 3",
        "END OF ACT ONE",
        "TOP OF ACT FOUR",
        "TEASER",
        "END OF TEASER",
        "MAIN TITLES.",
        "ESTABLISHING.",
        "FADE OUT.",
        "SAM",
    ]
    assert extract_character_cues(lines) == ["Sam"]


def test_a_trailing_period_does_not_mint_a_second_character():
    """`DONNA` and `DONNA.` are one person."""
    assert extract_character_cues(["DONNA", "DONNA.", "LAURIE.", "LAURIE"]) == [
        "Donna",
        "Laurie",
    ]


def test_an_initialism_keeps_its_terminal_period_and_casing():
    """C.J. is the character's name; "C.j" matches nothing and reads wrong."""
    assert extract_character_cues(["C.J.", "J.R."]) == ["C.J.", "J.R."]


def test_a_name_ending_in_a_period_still_loses_it():
    assert extract_character_cues(["MRS. LANDINGHAM."]) == ["Mrs. Landingham"]


def test_ocr_damaged_slugline_remnants_are_not_characters():
    """OCR misreads EXT. often enough that the remnant reaches the cue filter."""
    lines = ["BAT. WHITE HOUSE - DAY 18", "WE...", "JOSH"]
    assert extract_character_cues(lines) == ["Josh"]


def _inferred(name: str, traits: str = "") -> dict:
    return {
        "name": name,
        "aliases": [],
        "role": "supporting",
        "traits": traits,
        "evidence": [{"sceneId": "scene-1", "quote": "q"}],
    }


def test_ungrounded_inferred_character_is_dropped():
    """A character the script never names is not in the script.

    infer_story_entities must return a name for every row, and a model that
    cannot fill that field sometimes emits filler rather than omitting the
    row — a real import produced a character named "placeholder" with
    traits "placeholder", referenced by nothing. A denylist would catch that
    exact string and miss the next invention; this checks groundedness.
    """
    bible: dict = {"characters": []}
    entities = StoryEntities.model_validate(
        {
            "characters": [_inferred("placeholder", "placeholder"), _inferred("Marta")],
            "relationships": [],
            "worldElements": [],
        }
    )
    characters, _states, _ = merge_inferred_entities(
        bible, entities, "INT. BAR - NIGHT\n\nMARTA\nWhere is it?\n"
    )
    assert [c["name"] for c in characters] == ["Marta"]


def test_a_non_speaking_character_mentioned_in_action_survives():
    """The op exists partly to find people who never speak (T7.15).

    Grounding is token-level and permissive for exactly this reason: Elena is
    only named in an action line, and must still land in the bible.
    """
    bible: dict = {"characters": []}
    entities = StoryEntities.model_validate(
        {
            "characters": [_inferred("Elena Vasquez")],
            "relationships": [],
            "worldElements": [],
        }
    )
    characters, _states, _ = merge_inferred_entities(
        bible,
        entities,
        "INT. BAR - NIGHT\n\nA photograph of Elena sits behind the register.\n",
    )
    assert [c["name"] for c in characters] == ["Elena Vasquez"]


def test_grounding_never_removes_an_existing_character():
    """The gate applies to NEW names only.

    An existing row was grounded by whatever minted it — a script cue, or the
    writer. Re-running inference must never delete the writer's cast.
    """
    bible = {"characters": [empty_character("Ghost", character_id="char-ghost")]}
    entities = StoryEntities.model_validate(
        {
            "characters": [_inferred("Ghost")],
            "relationships": [],
            "worldElements": [],
        }
    )
    characters, _states, _ = merge_inferred_entities(bible, entities, "INT. BAR - NIGHT\n")
    assert [c["id"] for c in characters] == ["char-ghost"]


def test_without_source_text_everything_is_kept():
    """Default "" means "nothing to check against", not "reject all"."""
    bible: dict = {"characters": []}
    entities = StoryEntities.model_validate(
        {
            "characters": [_inferred("placeholder")],
            "relationships": [],
            "worldElements": [],
        }
    )
    characters, _states, _ = merge_inferred_entities(bible, entities)
    assert [c["name"] for c in characters] == ["placeholder"]


def test_generic_bit_part_cues_do_not_mint_characters():
    """A screenplay names unnamed people by function. Those are roles.

    The dialogue under a MAN or RECEPTIONIST cue is real and stays in
    scriptText verbatim — they just don't get a cast row competing with the
    people the story actually tracks.
    """
    lines = ["MAN", "WOMAN", "RECEPTIONIST", "SECURITY OFFICER", "MOVING MAN", "SAM"]
    assert extract_character_cues(lines) == ["Sam"]


def test_collective_nouns_do_not_mint_characters():
    lines = ["PRESS CORPS", "FOURTH GRADERS", "PARENTS", "STAFFERS", "TOBY"]
    assert extract_character_cues(lines) == ["Toby"]


def test_a_named_character_is_never_generic_whatever_precedes_it():
    """Head-final matching is what keeps real names safe.

    "Mary Marsh" ends in a surname, not a role noun, so no amount of
    preceding words makes it generic — unlike "Moving Man".
    """
    assert extract_character_cues(["MARY MARSH", "MRS. LANDINGHAM", "C.J."]) == [
        "Mary Marsh",
        "Mrs. Landingham",
        "C.J.",
    ]


def test_a_parenthetical_gloss_does_not_make_a_real_name_generic():
    """"Elizabeth (Annie's mother)" is a person with a description."""
    assert is_generic_role("Elizabeth (Annie's mother)") is False
    assert is_generic_role("Mother") is True


def test_generic_knowers_are_dropped_rather_than_minted():
    """normalize_known_by must not re-mint what the other paths refused."""
    resolved, characters = normalize_known_by(
        ["Reporter", "Sam"], [empty_character("Sam", character_id="char-sam")]
    )
    assert resolved == ["char-sam"]
    assert [c["name"] for c in characters] == ["Sam"]


def test_generic_inferred_entity_is_dropped():
    bible: dict = {"characters": []}
    entities = StoryEntities.model_validate(
        {
            "characters": [_inferred("Press Corps"), _inferred("Josh")],
            "relationships": [],
            "worldElements": [],
        }
    )
    characters, _states, _ = merge_inferred_entities(
        bible, entities, "INT. LOBBY - DAY\n\nThe press corps waits.\n\nJOSH\nLater.\n"
    )
    assert [c["name"] for c in characters] == ["Josh"]


def test_action_lines_are_not_characters():
    """A stage direction in caps matches the cue shape exactly."""
    lines = ["BEEPER GOES OFF.", "THE DOOR SLAMS", "PHONE RINGS", "JOSH"]
    assert extract_character_cues(lines) == ["Josh"]


def test_a_single_word_cue_is_never_rejected_as_an_action_line():
    """WILL, MAY, GRANT, CHASE, ROSE and HUNTER are all real names.

    The multi-word constraint is what makes verb matching safe at all: a
    one-word cue is a name by construction, whatever the word looks like.
    """
    for name in ["WILL", "MAY", "MARK", "GRANT", "CHASE", "HUNTER", "ROSE", "SUE"]:
        assert extract_character_cues([name]) == [name.title()], name


def test_a_two_word_name_containing_a_name_like_verb_survives():
    """Only conjugated -s forms count, so "Will Smith" is untouched."""
    assert extract_character_cues(["WILL SMITH", "MAY PARKER", "ROSE TYLER"]) == [
        "Will Smith",
        "May Parker",
        "Rose Tyler",
    ]


def test_surnames_ending_in_s_are_not_verbs():
    assert extract_character_cues(["MARCUS STEVENS", "AMY BROOKS", "JIM RIVERS"]) == [
        "Marcus Stevens",
        "Amy Brooks",
        "Jim Rivers",
    ]


def test_a_bare_surname_resolves_to_the_full_name():
    """Scripts cue the same person both ways: MARY MARSH, then MARSH.

    Prefix matching alone ("Doc" <-> "Doc Brown") never checked suffixes, so
    the cast held both as separate people — and every knownBy, secret holder
    and relationship then resolved against whichever one it happened to hit.
    """
    bible: dict = {"characters": []}
    merge_characters_into_bible(bible, ["Mary Marsh", "Marsh"])
    assert [(c["name"], c["aliases"]) for c in bible["characters"]] == [
        ("Mary Marsh", ["Marsh"])
    ]


def test_the_fuller_name_wins_regardless_of_cue_order():
    """Cue order is script order, so the bare form often arrives first."""
    bible: dict = {"characters": []}
    merge_characters_into_bible(bible, ["Marsh", "Mary Marsh"])
    assert [(c["name"], c["aliases"]) for c in bible["characters"]] == [
        ("Mary Marsh", ["Marsh"])
    ]


def test_an_honorific_name_absorbs_its_bare_surname():
    bible: dict = {"characters": []}
    merge_characters_into_bible(bible, ["Mrs. Landingham", "Landingham"])
    assert [(c["name"], c["aliases"]) for c in bible["characters"]] == [
        ("Mrs. Landingham", ["Landingham"])
    ]


def test_a_shared_surname_is_left_ambiguous_rather_than_guessed():
    """The guard that makes suffix matching safe.

    With two Smiths present a bare SMITH could be either, so it mints its own
    row instead of being silently folded into whichever came first.
    """
    bible: dict = {"characters": []}
    merge_characters_into_bible(bible, ["John Smith", "Jane Smith", "Smith"])
    assert [c["name"] for c in bible["characters"]] == [
        "John Smith",
        "Jane Smith",
        "Smith",
    ]


def test_a_locked_character_is_never_renamed_by_alias_merging():
    """Rule 2: a locked row's fields are the writer's, not ours."""
    locked = empty_character("Marsh", character_id="char-marsh")
    locked["locked"] = True
    bible = {"characters": [locked]}
    merge_characters_into_bible(bible, ["Mary Marsh"])
    assert bible["characters"][0]["name"] == "Marsh"
    assert bible["characters"][0]["aliases"] == []


def test_filler_traits_do_not_become_a_character_profile():
    """`traits` is required, so a model with nothing to say fills it.

    On a real import Sam's traits came back as the literal string
    "placeholder", which propagated into `summary` and rendered as his
    profile. An empty profile is better — resolveCharacterProfile already
    derives a fallback from the character's facts and motivations.
    """
    bible: dict = {"characters": []}
    entities = StoryEntities.model_validate(
        {
            "characters": [
                _inferred("Sam", "placeholder"),
                _inferred("Josh", "deputy chief of staff"),
            ],
            "relationships": [],
            "worldElements": [],
        }
    )
    characters, _, _ = merge_inferred_entities(
        bible, entities, "INT. OFFICE - DAY\n\nSAM\nHi.\n\nJOSH\nHi.\n"
    )
    by_name = {c["name"]: c for c in characters}
    assert by_name["Sam"]["traits"] == ""
    assert by_name["Sam"]["summary"] == ""
    assert by_name["Josh"]["summary"] == "deputy chief of staff"


def test_other_filler_spellings_are_also_rejected():
    for filler in ["N/A", "none", "TBD", "unknown", "—", "not specified"]:
        assert is_filler_prose(filler) is True, filler
    assert is_filler_prose("a quiet, watchful aide") is False


def test_an_inferred_full_name_attaches_to_the_row_its_alias_names():
    """T9.8: "Joshua Lyman" never prefix-matches "Josh"; only the alias links
    them, and without it the cast held the same person twice."""
    bible = {"characters": [empty_character("Josh", character_id="char-josh")]}
    entities = _entities(characters=[{**_inferred("Joshua Lyman"), "aliases": ["Josh"]}])
    result = merge_inferred_entities(bible, entities, "JOSH\nJoshua Lyman, hi.\n")
    characters = result[0]
    assert [c["id"] for c in characters] == ["char-josh"]
    assert characters[0]["aliases"] == ["Joshua Lyman"]
    assert result[-1] == []


def test_an_inferred_name_matching_two_rows_is_proposed_not_guessed():
    """T9.8: "Mallory O'Brien" matches both "Mallory" and "O'Brien". Folding
    it into either is a guess and minting a third row duplicates her, so the
    writer gets a merge proposal pointing at Merge into (T7.16) instead."""
    bible = {
        "characters": [
            empty_character("Mallory", character_id="char-mallory"),
            empty_character("O'Brien", character_id="char-obrien"),
        ]
    }
    entities = _entities(
        characters=[{**_inferred("Mallory O'Brien"), "evidence": _evidence("scene-2")}]
    )
    result = merge_inferred_entities(bible, entities, "MALLORY O'BRIEN\nHi.\n")
    assert [(c["id"], c["aliases"]) for c in result[0]] == [
        ("char-mallory", []),
        ("char-obrien", []),
    ]
    [proposal] = result[-1]
    assert proposal["sceneIds"] == ["scene-2"]
    assert proposal["explanation"].startswith("[merge_proposal]")
    for expected in ["Mallory O'Brien", "Mallory,", "O'Brien.", "Merge into"]:
        assert expected in proposal["explanation"], expected


def test_ledger_knowers_cannot_mint_filler_or_a_described_group():
    """T9.8: extraction minted characters called "<unknown>" and "All
    reporters present" because knownBy had none of the entity-merge gates."""
    resolved, characters = normalize_known_by(
        ["<unknown>", "All reporters present", "Sam"],
        [empty_character("Sam", character_id="char-sam")],
    )
    assert resolved == ["char-sam"]
    assert [c["name"] for c in characters] == ["Sam"]


def test_an_ambiguous_knower_is_dropped_rather_than_minted():
    """T9.8: entity merge files a proposal for "Mallory O'Brien"; minting her
    here would bring back the third row the proposal exists to prevent."""
    cast = [
        empty_character("Mallory", character_id="char-mallory"),
        empty_character("O'Brien", character_id="char-obrien"),
    ]
    resolved, characters = normalize_known_by(
        ["Mallory O'Brien", "Mallory"], cast, "MALLORY O'BRIEN\nHi.\n"
    )
    assert resolved == ["char-mallory"]
    assert [c["id"] for c in characters] == ["char-mallory", "char-obrien"]


def test_an_ungrounded_knower_is_dropped_rather_than_minted():
    resolved, characters = normalize_known_by(
        ["Zelda Fitzgerald", "Toby"], [], "INT. OFFICE - DAY\n\nTOBY\nNo.\n"
    )
    assert [c["name"] for c in characters] == ["Toby"]
    assert resolved == [characters[0]["id"]]


def test_a_caps_line_with_no_dialogue_under_it_is_not_a_speaker():
    """A shot heading in caps ("WIDE ANGLE ON GARAGE") has the cue shape but
    a blank line, not dialogue, under it."""
    lines = [
        "INT. GARAGE - NIGHT",
        "",
        "WIDE ANGLE ON GARAGE",
        "",
        "Rain on the roof.",
        "",
        "MARTY",
        "Doc?",
        "",
        "DOC",
        "(whispering)",
        "Over here.",
    ]
    assert extract_character_cues(lines) == ["Marty", "Doc"]


def test_the_dialogue_rule_is_off_when_most_cues_have_a_blank_line_under_them():
    """Some PDF extraction puts a blank line between every cue and its
    dialogue; enforcing the rule there would empty the cast."""
    lines = ["SAM", "", "Morning.", "", "JOSH", "", "Hi.", "", "WIDE ANGLE ON GARAGE", ""]
    assert extract_character_cues(lines) == ["Sam", "Josh", "Wide Angle On Garage"]


def test_a_role_anywhere_after_the_first_word_makes_the_phrase_generic():
    """T9.8: the head-noun check missed a role with a modifier after it."""
    for phrase in ["All reporters present", "Tall Man in Grey Coat", "Female Voice On Phone"]:
        assert is_generic_role(phrase) is True, phrase
    for name in ["Agent Carter", "Uncle Mickey", "Mary Marsh", "Captain Kirk"]:
        assert is_generic_role(name) is False, name
