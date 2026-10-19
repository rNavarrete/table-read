"""Unit tests for `drama_manager.promises.merge_narrative_promises` (T7.20).

Mirrors `test_fountain_characters.py`'s style for the sibling
`merge_inferred_entities` merge: plain doc/character dicts, no DB, no LLM.
"""

from __future__ import annotations

import copy
import logging

from drama_manager.promises import merge_narrative_promises
from schemas import NarrativePromises


def _character(cid: str, name: str, *, locked: bool = False, aliases=None) -> dict:
    return {
        "id": cid,
        "name": name,
        "locked": locked,
        "aliases": aliases or [],
        "embodiment": "",
        "presentation": "",
        "hiding": "",
        "traits": "",
        "seriesArc": "",
    }


def _doc(*, characters=None, world_rules=None, scenes=None, threads=None) -> dict:
    scenes = scenes or [
        {"id": "scene-1", "motivations": []},
        {"id": "scene-2", "motivations": []},
    ]
    return {
        "seasons": [
            {
                "id": "season-1",
                "episodes": [
                    {
                        "id": "ep-1",
                        "scenes": scenes,
                        "threads": threads if threads is not None else [],
                    }
                ],
            }
        ],
        "seriesBible": {
            "characters": characters or [],
            "worldRules": world_rules or [],
        },
    }


def promises(
    threads: list[dict] | None = None,
    scene_motivations: list[dict] | None = None,
    world_rules: list[dict] | None = None,
    secrets: list[dict] | None = None,
    storylines: list[dict] | None = None,
) -> NarrativePromises:
    return NarrativePromises.model_validate(
        {
            "threads": threads or [],
            "secrets": secrets or [],
            "sceneMotivations": scene_motivations or [],
            "worldRules": world_rules or [],
            "storylines": storylines or [],
        }
    )


def _thread(**overrides) -> dict:
    return {
        "label": "The missing money",
        "summary": "Marta suspects Dan.",
        "status": "open",
        "ownerNames": ["Marta"],
        "setupSceneId": "scene-1",
        "payoffSceneId": None,
        "setupBeatId": None,
        "payoffBeatId": None,
        **overrides,
    }


def _world_rule(**overrides) -> dict:
    return {
        "text": "The bar is neutral ground.",
        "limit": "",
        "cost": "",
        "exception": "",
        "evidenceSceneId": "scene-1",
        "evidenceBeatId": None,
        **overrides,
    }


# ── threads ──────────────────────────────────────────────────────────────


def test_merge_mints_thread_and_resolves_owner_by_alias():
    doc = _doc(characters=[_character("char-marta", "Marta Vega")])

    result = merge_narrative_promises(
        doc, "ep-1", promises(threads=[_thread(ownerNames=["Marta"])])
    )

    episode = result["seasons"][0]["episodes"][0]
    assert len(episode["threads"]) == 1
    thread = episode["threads"][0]
    assert thread["id"].startswith("thread-")
    assert thread["ownerCharacterIds"] == ["char-marta"]
    assert thread["setupSceneId"] == "scene-1"
    assert thread["payoffSceneId"] is None
    assert thread["locked"] is False


def test_merge_drops_unresolvable_owner_but_keeps_resolved_ones():
    doc = _doc(characters=[_character("char-marta", "Marta Vega")])

    result = merge_narrative_promises(
        doc, "ep-1", promises(threads=[_thread(ownerNames=["Marta", "Ghost"])])
    )

    thread = result["seasons"][0]["episodes"][0]["threads"][0]
    assert thread["ownerCharacterIds"] == ["char-marta"]


def test_merge_drops_thread_with_unknown_setup_scene():
    doc = _doc()

    result = merge_narrative_promises(
        doc, "ep-1", promises(threads=[_thread(setupSceneId="scene-nope")])
    )

    assert result["seasons"][0]["episodes"][0]["threads"] == []


def test_merge_treats_unresolved_payoff_scene_as_still_open():
    doc = _doc()

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(threads=[_thread(status="paid_off", payoffSceneId="scene-nope")]),
    )

    thread = result["seasons"][0]["episodes"][0]["threads"][0]
    assert thread["payoffSceneId"] is None


def test_merge_replaces_episodes_prior_import_threads():
    doc = _doc(threads=[{"id": "thread-old", "label": "stale"}])

    result = merge_narrative_promises(doc, "ep-1", promises(threads=[]))

    assert result["seasons"][0]["episodes"][0]["threads"] == []


# ── scene motivations ───────────────────────────────────────────────────


def test_merge_patches_scene_motivations_when_character_resolves():
    doc = _doc(characters=[_character("char-marta", "Marta Vega")])

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            scene_motivations=[
                {
                    "sceneId": "scene-1",
                    "motivations": [
                        {
                            "characterName": "Marta",
                            "objective": "Find the money.",
                            "stakes": "Trust.",
                            "obstacle": "Dan's charm.",
                            "statedObjective": "",
                            "concealed": False,
                        }
                    ],
                }
            ]
        ),
    )

    scene = result["seasons"][0]["episodes"][0]["scenes"][0]
    assert scene["motivations"] == [
        {
            "characterId": "char-marta",
            "objective": "Find the money.",
            "stakes": "Trust.",
            "obstacle": "Dan's charm.",
            "statedObjective": "",
            "concealed": False,
        }
    ]


def test_merge_keeps_prior_motivations_when_none_resolve():
    prior = [
        {
            "characterId": "char-marta",
            "objective": "old",
            "stakes": "old",
            "obstacle": "old",
        }
    ]
    doc = _doc(scenes=[{"id": "scene-1", "motivations": prior}])

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            scene_motivations=[
                {
                    "sceneId": "scene-1",
                    "motivations": [
                        {
                            "characterName": "Ghost",
                            "objective": "x",
                            "stakes": "x",
                            "obstacle": "x",
                            "statedObjective": "",
                            "concealed": False,
                        }
                    ],
                }
            ]
        ),
    )

    scene = result["seasons"][0]["episodes"][0]["scenes"][0]
    assert scene["motivations"] == prior


def test_merge_ignores_motivations_for_unknown_scene():
    doc = _doc(characters=[_character("char-marta", "Marta Vega")])

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            scene_motivations=[
                {
                    "sceneId": "scene-nope",
                    "motivations": [
                        {
                            "characterName": "Marta",
                            "objective": "x",
                            "stakes": "x",
                            "obstacle": "x",
                            "statedObjective": "",
                            "concealed": False,
                        }
                    ],
                }
            ]
        ),
    )

    scenes = result["seasons"][0]["episodes"][0]["scenes"]
    assert all(s["motivations"] == [] for s in scenes)


# ── world rules ──────────────────────────────────────────────────────────


def test_merge_appends_new_world_rule_with_structured_fields():
    doc = _doc()

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            world_rules=[
                _world_rule(
                    text="No one drinks alone on a debt night.",
                    limit="Only inside the bar.",
                    cost="Free drinks for the table.",
                    exception="Unless the sheriff is there.",
                )
            ]
        ),
    )

    rules = result["seriesBible"]["worldRules"]
    assert rules == [
        {
            "text": "No one drinks alone on a debt night.",
            "locked": False,
            "limit": "Only inside the bar.",
            "cost": "Free drinks for the table.",
            "exception": "Unless the sheriff is there.",
            "evidenceSceneId": "scene-1",
            # No beat cited, so no evidence — the server never invents one.
            "evidenceQuote": "",
        }
    ]


def test_merge_skips_world_rule_matching_existing_text_casefold():
    doc = _doc(world_rules=[{"text": "The Bar Is Neutral Ground.", "locked": False}])

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(world_rules=[_world_rule(text="the bar is neutral ground.")]),
    )

    assert result["seriesBible"]["worldRules"] == [
        {"text": "The Bar Is Neutral Ground.", "locked": False}
    ]


def test_merge_never_duplicates_locked_world_rule_text():
    doc = _doc(
        world_rules=[{"text": "Debts are never spoken aloud.", "locked": True}]
    )

    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(world_rules=[_world_rule(text="Debts are never spoken aloud.")]),
    )

    rules = result["seriesBible"]["worldRules"]
    assert rules == [{"text": "Debts are never spoken aloud.", "locked": True}]


def test_merge_drops_evidence_scene_id_for_unknown_scene():
    doc = _doc()

    result = merge_narrative_promises(
        doc, "ep-1", promises(world_rules=[_world_rule(evidenceSceneId="scene-nope")])
    )

    assert result["seriesBible"]["worldRules"][0]["evidenceSceneId"] is None


_CAST = [
    {
        "id": "char-dan",
        "name": "Dan Vega",
        "locked": False,
        "aliases": ["Dan"],
        "embodiment": "",
        "presentation": "",
        "hiding": "",
        "traits": "",
        "seriesArc": "",
    },
    {
        "id": "char-marta",
        "name": "Marta Vega",
        "locked": False,
        "aliases": ["Marta"],
        "embodiment": "",
        "presentation": "",
        "hiding": "",
        "traits": "",
        "seriesArc": "",
    },
]


def _secret(**overrides) -> dict:
    return {
        "summary": "Dan hid the money in the ice machine.",
        "holderNames": ["Dan"],
        "concealedFromNames": ["Marta"],
        "audienceKnows": True,
        "establishedSceneId": "scene-1",
        "revealedSceneId": None,
        "concealmentSceneIds": [],
        "establishedBeatId": None,
        "revealedBeatId": None,
        **overrides,
    }


def test_merge_mints_a_secret_and_resolves_both_sides():
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(doc, "ep-1", promises(secrets=[_secret()]))

    secrets = result["seasons"][0]["episodes"][0]["secrets"]
    assert len(secrets) == 1
    secret = secrets[0]
    assert secret["id"].startswith("secret-")
    assert secret["holderCharacterIds"] == ["char-dan"]
    assert secret["concealedFromCharacterIds"] == ["char-marta"]
    assert secret["revealedSceneId"] is None
    assert secret["provenance"] == "inferred"
    assert secret["locked"] is False
    # Promises inference runs before fact extraction, so there is nothing to
    # link yet — better null than an id that resolves to nothing.
    assert secret["factId"] is None


def test_merge_drops_a_secret_nobody_is_keeping():
    """No resolvable holder means it is not a secret, just a fact.

    Storing it would put a duplicate of an ordinary ledger fact into the
    secrets list and inflate the count with things no one is hiding.
    """
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc, "ep-1", promises(secrets=[_secret(holderNames=["Nobody At All"])])
    )
    assert result["seasons"][0]["episodes"][0]["secrets"] == []


def test_merge_drops_a_secret_nobody_is_in_the_dark_about():
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc, "ep-1", promises(secrets=[_secret(concealedFromNames=[])])
    )
    assert result["seasons"][0]["episodes"][0]["secrets"] == []


def test_merge_treats_an_ungrounded_reveal_scene_as_still_concealed():
    """Same rule threads use for an ungrounded payoff: trust the page, not the id."""
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc, "ep-1", promises(secrets=[_secret(revealedSceneId="scene-999")])
    )
    assert result["seasons"][0]["episodes"][0]["secrets"][0]["revealedSceneId"] is None


def test_merge_filters_concealment_scenes_to_real_scenes():
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(secrets=[_secret(concealmentSceneIds=["scene-1", "scene-999"])]),
    )
    secret = result["seasons"][0]["episodes"][0]["secrets"][0]
    assert secret["concealmentSceneIds"] == ["scene-1"]


def test_merge_skips_a_secret_established_in_an_unknown_scene():
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc, "ep-1", promises(secrets=[_secret(establishedSceneId="scene-999")])
    )
    assert result["seasons"][0]["episodes"][0]["secrets"] == []


def test_merge_records_an_ulterior_motive_as_a_stated_actual_gap():
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            scene_motivations=[
                {
                    "sceneId": "scene-1",
                    "motivations": [
                        {
                            "characterName": "Dan",
                            "objective": "Keep Marta away from the ice machine.",
                            "stakes": "The money.",
                            "obstacle": "She saw the transfer.",
                            "statedObjective": "Close up the bar.",
                            "concealed": True,
                        }
                    ],
                }
            ]
        ),
    )
    motivation = result["seasons"][0]["episodes"][0]["scenes"][0]["motivations"][0]
    assert motivation["statedObjective"] == "Close up the bar."
    assert motivation["concealed"] is True


def test_merge_normalizes_a_stated_objective_that_matches_the_real_one():
    """A restated objective is not a gap.

    Left as-is, a model that echoes `objective` into `statedObjective` would
    make every motivation look like an ulterior motive, so a non-empty value
    would stop meaning anything.
    """
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            scene_motivations=[
                {
                    "sceneId": "scene-1",
                    "motivations": [
                        {
                            "characterName": "Marta",
                            "objective": "Find the money.",
                            "stakes": "Trust.",
                            "obstacle": "Dan's charm.",
                            "statedObjective": "  find the money.  ",
                            "concealed": False,
                        }
                    ],
                }
            ]
        ),
    )
    motivation = result["seasons"][0]["episodes"][0]["scenes"][0]["motivations"][0]
    assert motivation["statedObjective"] == ""


def test_dangling_closing_quote_is_stripped_from_prose():
    """The model closes a quotation it never opened.

    Every secret summary on a real 60-page import came back ending `.'`,
    which rendered verbatim on the character profile.
    """
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc, "ep-1", promises(secrets=[_secret(summary="He hid the money.'")])
    )
    secret = result["seasons"][0]["episodes"][0]["secrets"][0]
    assert secret["summary"] == "He hid the money."


def test_a_real_quotation_keeps_its_closing_quote():
    """Balanced quotes are the writer's punctuation, not model noise."""
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc, "ep-1", promises(secrets=[_secret(summary='She only said "no."')])
    )
    assert result["seasons"][0]["episodes"][0]["secrets"][0]["summary"] == (
        'She only said "no."'
    )


def test_a_possessive_apostrophe_is_never_stripped():
    doc = _doc(characters=_CAST)
    result = merge_narrative_promises(
        doc, "ep-1", promises(secrets=[_secret(summary="The bag was Sam's")])
    )
    assert result["seasons"][0]["episodes"][0]["secrets"][0]["summary"] == (
        "The bag was Sam's"
    )


# ── quote grounding ─────────────────────────────────────────────────────────
#
# Threads and secrets cite a scene, and their quotes used to be stored with no
# verification at all. On a real West Wing import that produced 51 stored quote
# uses of which 33 were duplicates — one line cited nine separate times — plus
# bare character cues ("MANDY") passing as evidence. Presence in the script is
# necessary and nowhere near sufficient.

from drama_manager.promises import (  # noqa: E402
    anchor_quote,
    drop_reused_quotes,
    is_substantive_quote,
    quote_for_beat,
)


def _scene_with_beats(scene_id: str, *beats: tuple[str, str]) -> dict:
    return {
        "id": scene_id,
        "motivations": [],
        "beats": [{"id": bid, "scriptText": text} for bid, text in beats],
    }


def test_anchor_quote_resolves_the_beat_holding_the_quote():
    scene = _scene_with_beats(
        "scene-1",
        ("beat-1-1", "INT. BAR - NIGHT\nDan wipes the counter."),
        ("beat-1-2", "MARTA\nYou took the money, didn't you?"),
    )
    quote, beat_id = anchor_quote(scene, "You took the money, didn't you?")
    assert quote == "You took the money, didn't you?"
    assert beat_id == "beat-1-2", "must name the beat, not just confirm the scene"


def test_anchor_quote_drops_a_quote_absent_from_the_cited_scene():
    scene = _scene_with_beats("scene-1", ("beat-1-1", "INT. BAR - NIGHT\nDan wipes."))
    assert anchor_quote(scene, "A line from somewhere else entirely.") == ("", None)


def test_anchor_quote_drops_a_quote_when_the_cited_scene_is_missing():
    assert anchor_quote(None, "You took the money, didn't you?") == ("", None)


def test_substance_floor_rejects_cues_transitions_and_fragments():
    for junk in ("MANDY", "MALLORY", "FADE TO BLACK.", "levels.", "WOMAN (V.0.)"):
        assert not is_substantive_quote(junk), junk
    for real in ("You took the money, didn't you?", "Apparently it's neither."):
        assert is_substantive_quote(real), real


def test_a_bare_cue_is_not_anchored_even_though_it_is_in_the_beat():
    scene = _scene_with_beats("scene-1", ("beat-1-1", "MARTA\nYou took the money."))
    assert anchor_quote(scene, "MARTA") == ("", None)


def test_reused_quote_is_cleared_from_every_claim_that_cites_it():
    """A line offered as evidence for two different claims identifies neither,
    and there is no way to tell which use was intended — so all of them go."""
    threads = [
        {"setupQuote": "He seems effeminate to me.", "setupBeatId": "beat-22-5",
         "payoffQuote": "", "payoffBeatId": None},
    ]
    secrets = [
        {"establishedQuote": "He seems effeminate to me.", "establishedBeatId": "beat-22-5",
         "revealedQuote": "A line used exactly once.", "revealedBeatId": "beat-9-1"},
    ]
    assert drop_reused_quotes(threads, secrets) == 2
    assert threads[0]["setupQuote"] == "" and threads[0]["setupBeatId"] is None
    assert secrets[0]["establishedQuote"] == ""
    assert secrets[0]["revealedQuote"] == "A line used exactly once."
    assert secrets[0]["revealedBeatId"] == "beat-9-1", "a unique citation survives"


def test_merge_derives_the_quote_from_the_beat_the_model_cited():
    """The model points at a beat; the server reads the line out of it. It used
    to supply the line itself, chosen from six sampled lines per scene."""
    doc = _doc(
        characters=[_character("char-marta", "Marta")],
        scenes=[
            _scene_with_beats(
                "scene-1",
                ("beat-1-1", "INT. BAR - NIGHT\nDan wipes the counter."),
                ("beat-1-2", "MARTA\nYou took the money, didn't you?"),
            ),
        ],
    )
    merge_narrative_promises(doc, "ep-1", promises(threads=[
        _thread(setupBeatId="beat-1-2")
    ]))
    thread = doc["seasons"][0]["episodes"][0]["threads"][0]
    assert thread["setupBeatId"] == "beat-1-2"
    assert thread["setupQuote"] == "You took the money, didn't you?"


def test_merge_skips_the_slugline_when_deriving_a_quote():
    doc = _doc(
        characters=[_character("char-marta", "Marta")],
        scenes=[_scene_with_beats(
            "scene-1", ("beat-1-1", "INT. BAR - NIGHT\nDan wipes the counter clean."))],
    )
    merge_narrative_promises(doc, "ep-1", promises(threads=[
        _thread(setupBeatId="beat-1-1")
    ]))
    thread = doc["seasons"][0]["episodes"][0]["threads"][0]
    assert thread["setupQuote"] == "Dan wipes the counter clean."


def test_merge_drops_a_beat_id_that_is_not_in_the_cited_scene():
    """An id that does not resolve is a claim without evidence, not a licence
    to quote something else from the scene."""
    doc = _doc(
        characters=[_character("char-marta", "Marta")],
        scenes=[_scene_with_beats("scene-1", ("beat-1-1", "MARTA\nYou took the money."))],
    )
    merge_narrative_promises(doc, "ep-1", promises(threads=[
        _thread(setupBeatId="beat-9-9")
    ]))
    thread = doc["seasons"][0]["episodes"][0]["threads"][0]
    assert thread["setupQuote"] == ""
    assert thread["setupBeatId"] is None
    assert thread["label"] == "The missing money", "the thread itself survives"


def test_derived_quote_prefers_dialogue_over_stage_direction():
    """`_source_quote` takes the first non-cue line, which in a screenplay is
    nearly always action — a real import cited "Sam's PAGER BEEPS --" for a
    beat whose content was the exchange underneath."""
    scene = _scene_with_beats(
        "scene-1",
        (
            "beat-1-1",
            "INT. BAR - NIGHT\nDan wipes the counter clean.\n\nMARTA\n"
            "(quietly)\nYou took the money, didn't you?",
        ),
    )
    quote, beat_id = quote_for_beat(scene, "beat-1-1")
    assert quote == "You took the money, didn't you?"
    assert beat_id == "beat-1-1"


def test_derived_quote_falls_back_to_action_when_a_beat_has_no_dialogue():
    scene = _scene_with_beats(
        "scene-1", ("beat-1-1", "INT. BAR - NIGHT\nDan wipes the counter clean.")
    )
    assert quote_for_beat(scene, "beat-1-1")[0] == "Dan wipes the counter clean."


# ── storylines (T10.2) ───────────────────────────────────────────────────


def _storyline(letter: str, scene_ids: list[str], **overrides) -> dict:
    return {
        "letter": letter,
        "summary": f"Storyline {letter}.",
        "characterNames": [],
        "sceneIds": scene_ids,
        **overrides,
    }


def _imported_doc(scene_count: int = 4, **kwargs) -> dict:
    """An episode the way import builds it: every scene stamped "A",
    `storylines: []`."""
    doc = _doc(
        scenes=[
            {"id": f"scene-{i}", "storyline": "A", "motivations": []}
            for i in range(1, scene_count + 1)
        ],
        **kwargs,
    )
    doc["seasons"][0]["episodes"][0]["storylines"] = []
    return doc


def _episode(doc: dict) -> dict:
    return doc["seasons"][0]["episodes"][0]


def _letters(doc: dict) -> dict[str, str]:
    return {scene["id"]: scene["storyline"] for scene in _episode(doc)["scenes"]}


def test_storylines_tag_scenes_and_fill_the_episode_in_letter_order():
    doc = _imported_doc(
        characters=[
            _character("char-marta", "Marta Vega"),
            _character("char-reyes", "Reyes"),
        ]
    )

    merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            storylines=[
                _storyline("B", ["scene-2"], characterNames=["Reyes"]),
                _storyline(
                    "A", ["scene-1", "scene-3"], characterNames=["Marta", "Reyes"]
                ),
            ]
        ),
    )

    assert _episode(doc)["storylines"] == [
        {
            "id": "A",
            "summary": "Storyline A.",
            "characterIds": ["char-marta", "char-reyes"],
        },
        {"id": "B", "summary": "Storyline B.", "characterIds": ["char-reyes"]},
    ]
    # scene-4 is in no storyline, so it keeps today's default.
    assert _letters(doc) == {
        "scene-1": "A",
        "scene-2": "B",
        "scene-3": "A",
        "scene-4": "A",
    }


def test_storyline_d_is_accepted():
    doc = _imported_doc()

    merge_narrative_promises(
        doc, "ep-1", promises(storylines=[_storyline("D", ["scene-4"])])
    )

    assert [s["id"] for s in _episode(doc)["storylines"]] == ["D"]
    assert _letters(doc)["scene-4"] == "D"


def test_a_repeated_letter_keeps_its_first_entry():
    doc = _imported_doc()

    merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            storylines=[
                _storyline("A", ["scene-1"], summary="First."),
                _storyline("A", ["scene-2"], summary="Second."),
            ]
        ),
    )

    assert _episode(doc)["storylines"] == [
        {"id": "A", "summary": "First.", "characterIds": []}
    ]


def test_a_repeated_letter_does_not_claim_scenes_for_its_letter():
    doc = _imported_doc()

    merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            storylines=[
                _storyline("A", ["scene-1"]),
                _storyline("B", ["scene-2"]),
                _storyline("B", ["scene-3"]),
            ]
        ),
    )

    assert _letters(doc) == {
        "scene-1": "A",
        "scene-2": "B",
        "scene-3": "A",
        "scene-4": "A",
    }


def test_unknown_scene_ids_are_dropped():
    doc = _imported_doc()

    merge_narrative_promises(
        doc,
        "ep-1",
        promises(storylines=[_storyline("B", ["scene-nope", "scene-2"])]),
    )

    assert _letters(doc)["scene-2"] == "B"
    assert "scene-nope" not in _letters(doc)


def test_a_scene_listed_under_two_letters_keeps_the_earliest():
    doc = _imported_doc()

    merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            storylines=[
                _storyline("C", ["scene-2", "scene-3"]),
                _storyline("B", ["scene-2"]),
            ]
        ),
    )

    assert _letters(doc)["scene-2"] == "B"
    assert _letters(doc)["scene-3"] == "C"


def test_a_storyline_left_with_no_scenes_is_dropped():
    doc = _imported_doc()

    merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            storylines=[
                _storyline("A", ["scene-1", "scene-2"]),
                # Only scene the earlier letter already holds, and an unknown id.
                _storyline("B", ["scene-2", "scene-nope"]),
                _storyline("C", []),
            ]
        ),
    )

    assert [s["id"] for s in _episode(doc)["storylines"]] == ["A"]
    assert set(_letters(doc).values()) == {"A"}


def test_unresolved_storyline_characters_are_dropped():
    doc = _imported_doc(characters=[_character("char-marta", "Marta Vega")])

    merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            storylines=[
                _storyline(
                    "A", ["scene-1"], characterNames=["Ghost", "Marta", "Marta Vega"]
                )
            ]
        ),
    )

    assert _episode(doc)["storylines"][0]["characterIds"] == ["char-marta"]


def test_empty_storylines_leave_the_episode_untouched():
    doc = _imported_doc()
    before = copy.deepcopy(_episode(doc))

    merge_narrative_promises(doc, "ep-1", promises(threads=[_thread()]))

    episode = _episode(doc)
    assert episode["storylines"] == before["storylines"] == []
    assert episode["scenes"] == before["scenes"]
    assert episode["threads"][0]["storyline"] is None


def test_storylines_that_all_drop_leave_the_episode_untouched():
    doc = _imported_doc()
    before = copy.deepcopy(_episode(doc))

    merge_narrative_promises(
        doc, "ep-1", promises(storylines=[_storyline("B", ["scene-nope"])])
    )

    assert _episode(doc)["storylines"] == []
    assert _episode(doc)["scenes"] == before["scenes"]


def test_an_old_response_without_storylines_parses_and_changes_nothing():
    """A pre-0.53.0 model response or promises checkpoint has no
    `storylines` and no thread `storyline`."""
    old = {
        "threads": [_thread()],
        "secrets": [],
        "sceneMotivations": [],
        "worldRules": [],
    }
    result = NarrativePromises.model_validate(old)
    assert result.storylines == []
    assert result.threads[0].storyline is None

    doc = _imported_doc()
    merge_narrative_promises(doc, "ep-1", result)

    assert _episode(doc)["storylines"] == []
    assert set(_letters(doc).values()) == {"A"}
    assert _episode(doc)["threads"][0]["storyline"] is None


def test_a_thread_keeps_its_letter_only_if_that_storyline_survived():
    doc = _imported_doc()

    merge_narrative_promises(
        doc,
        "ep-1",
        promises(
            threads=[
                _thread(label="kept", storyline="B"),
                _thread(label="dropped storyline", storyline="C"),
                _thread(label="never returned", storyline="D"),
                _thread(label="untagged", storyline=None),
            ],
            storylines=[
                _storyline("B", ["scene-2"]),
                _storyline("C", ["scene-nope"]),
            ],
        ),
    )

    assert {t["label"]: t["storyline"] for t in _episode(doc)["threads"]} == {
        "kept": "B",
        "dropped storyline": None,
        "never returned": None,
        "untagged": None,
    }


def test_storyline_merge_logs_counts_never_text(caplog):
    doc = _imported_doc(characters=[_character("char-marta", "Marta Vega")])

    with caplog.at_level(logging.INFO, logger="drama_manager.promises"):
        merge_narrative_promises(
            doc,
            "ep-1",
            promises(
                threads=[_thread(label="SECRET THREAD LABEL", storyline="C")],
                storylines=[
                    _storyline(
                        "A",
                        ["scene-1", "scene-nope"],
                        summary="SECRET STORYLINE SUMMARY",
                        characterNames=["Marta", "SECRET GHOST NAME"],
                    ),
                    _storyline("A", ["scene-2"], summary="SECRET REPEAT"),
                    _storyline("C", ["scene-1"], summary="SECRET EMPTY"),
                ],
            ),
        )

    messages = [r.getMessage() for r in caplog.records]
    assert any(
        "storylines=1 scenes_assigned=1 letters_repeated=1 scene_ids_unknown=1 "
        "storylines_empty=1 characters_dropped=1" in m
        for m in messages
    )
    assert any("thread_storylines_dropped=1" in m for m in messages)
    assert not any("SECRET" in m or "Marta" in m for m in messages)
