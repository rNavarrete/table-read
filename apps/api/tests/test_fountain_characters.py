"""Unit tests for import cast minting (T7.14)."""

from __future__ import annotations

from fountain.characters import (
    backfill_cast_and_known_by,
    cues_from_scenes,
    extract_character_cues,
    merge_characters_into_bible,
    normalize_known_by,
)


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
    assert {c["name"] for c in chars} >= {"Doc", "Marty"}
    ids = {c["id"] for c in chars}
    assert set(new_ledger[0]["knownBy"]) <= ids
    assert "audience" not in new_ledger[0]["knownBy"]
