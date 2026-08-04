"""Source-grounding tests for the imported episode Narrative Map."""

from __future__ import annotations

import pytest

from drama_manager.narrative_map import (
    NarrativeMapValidationError,
    is_usable_analysis_text,
    materialize_synthesized_threads,
    merge_narrative_map,
)
from schemas import InferredNarrativeMap, InferredNarrativeMapSynthesis


def _doc(*, locked: bool = False) -> dict:
    return {
        "seriesBible": {
            "characters": [
                {"id": "char-nora", "name": "Nora", "aliases": [], "locked": False},
                {"id": "char-cass", "name": "Cass", "aliases": [], "locked": False},
            ]
        },
        "seasons": [
            {
                "episodes": [
                    {
                        "id": "ep-1",
                        "locked": False,
                        "narrativeMap": {"locked": True} if locked else None,
                        "threads": [{"id": "thread-letter", "label": "The unsent letter"}],
                        "scenes": [
                            {
                                "id": "scene-1",
                                "act": 1,
                                "beats": [
                                    {
                                        "id": "beat-1-1",
                                        "scriptText": (
                                            "Nora finds the unsent letter in the lighthouse drawer."
                                        ),
                                    }
                                ],
                            },
                            {
                                "id": "scene-2",
                                "act": 2,
                                "beats": [
                                    {
                                        "id": "beat-2-1",
                                        "scriptText": (
                                            "Cass burns the envelope before Nora can read it."
                                        ),
                                    }
                                ],
                            },
                        ],
                    }
                ]
            }
        ],
    }


def _result(**overrides) -> InferredNarrativeMap:
    payload = {
        "dramaticQuestion": "Can Nora uncover why Cass hid the letter?",
        "centralConflict": "Nora seeks the truth while Cass protects a damaging secret.",
        "controllingIdea": "A relationship cannot survive the truth it refuses to face.",
        "themes": [
            {
                "label": "Truth and protection",
                "statement": "Love can become destructive when it hides the truth.",
                "evidence": [{"beatId": "beat-1-1"}],
            }
        ],
        "acts": [
            {
                "act": 1,
                "dramaticQuestion": "Will Nora discover the secret?",
                "escalation": "The letter gives Nora a tangible question to pursue.",
                "turnBeatId": "beat-1-1",
            },
            {
                "act": 2,
                "dramaticQuestion": "Can Cass keep the secret buried?",
                "escalation": "Cass destroys the evidence rather than explain it.",
                "turnBeatId": "beat-2-1",
            },
        ],
        "heroJourney": {
            "applies": True,
            "protagonistName": "Nora",
            "rationale": "Nora crosses from ordinary duty into a dangerous search for truth.",
            "stages": [
                {
                    "stage": "call_to_adventure",
                    "beatId": "beat-1-1",
                    "summary": "The letter calls Nora into the mystery.",
                }
            ],
        },
        "characterArcs": [
            {
                "characterName": "Nora",
                "want": "Read the letter.",
                "need": "Face the truth Cass has protected her from.",
                "internalConflict": "She fears what the letter says about their bond.",
                "externalPressure": "Cass controls the evidence.",
                "arcSummary": "Nora moves from curiosity to a commitment to truth.",
                "turningPoints": [
                    {
                        "beatId": "beat-1-1",
                        "change": "Curiosity becomes a concrete pursuit.",
                    }
                ],
            }
        ],
        "sceneTurns": [
            {
                "sceneId": "scene-1",
                "focalCharacterName": "Nora",
                "dramaticFunction": "Plant the mystery.",
                "conflict": "Nora encounters a secret she cannot ignore.",
                "stakes": "Her trust in Cass is threatened.",
                "turnBeatId": "beat-1-1",
                "turn": "A routine search becomes a quest for truth.",
            },
            {
                "sceneId": "scene-2",
                "focalCharacterName": "Cass",
                "dramaticFunction": "Escalate the cover-up.",
                "conflict": "Cass chooses secrecy over explanation.",
                "stakes": "The relationship may not survive the lie.",
                "turnBeatId": "beat-2-1",
                "turn": "The secret becomes an active betrayal.",
            },
        ],
        "threadMovements": [
            {
                "threadId": "thread-letter",
                "beatId": "beat-2-1",
                "phase": "escalation",
                "summary": "Cass makes the letter harder to recover.",
            }
        ],
    }
    payload.update(overrides)
    return InferredNarrativeMap.model_validate(payload)


def test_merge_resolves_people_and_persists_a_complete_grounded_map():
    doc = _doc()

    merge_narrative_map(doc, "ep-1", _result())

    narrative_map = doc["seasons"][0]["episodes"][0]["narrativeMap"]
    assert narrative_map["heroJourney"]["protagonistCharacterId"] == "char-nora"
    assert narrative_map["characterArcs"][0]["characterId"] == "char-nora"
    assert {row["sceneId"] for row in narrative_map["sceneTurns"]} == {
        "scene-1",
        "scene-2",
    }
    assert narrative_map["threadMovements"][0]["threadId"] == "thread-letter"
    assert narrative_map["themes"][0]["evidence"][0]["quote"] == (
        "Nora finds the unsent letter in the lighthouse drawer."
    )
    assert narrative_map["sceneTurns"][1]["evidenceQuote"] == (
        "Cass burns the envelope before Nora can read it."
    )


def test_synthesis_materializes_server_owned_threads_when_import_has_none():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["threads"] = []
    result = _result()
    synthesis = InferredNarrativeMapSynthesis.model_validate(
        {
            key: value
            for key, value in result.model_dump(by_alias=True).items()
            if key != "sceneTurns"
        }
    )
    provisional_id = synthesis.thread_movements[0].thread_id

    count = materialize_synthesized_threads(doc, "ep-1", synthesis)
    candidate = _result(
        **{
            **synthesis.model_dump(by_alias=True),
            "sceneTurns": result.model_dump(by_alias=True)["sceneTurns"],
        }
    )
    merge_narrative_map(doc, "ep-1", candidate)

    episode = doc["seasons"][0]["episodes"][0]
    thread = episode["threads"][0]
    assert count == 1
    assert thread["id"].startswith("thread-")
    assert thread["id"] != provisional_id
    assert thread["setupSceneId"] == "scene-2"
    assert thread["setupQuote"] == "Cass burns the envelope before Nora can read it."
    assert episode["narrativeMap"]["threadMovements"][0]["threadId"] == thread["id"]

    second_doc = _doc()
    second_doc["seasons"][0]["episodes"][0]["threads"] = []
    second_synthesis = InferredNarrativeMapSynthesis.model_validate(
        {
            key: value
            for key, value in result.model_dump(by_alias=True).items()
            if key != "sceneTurns"
        }
    )
    materialize_synthesized_threads(second_doc, "ep-1", second_synthesis)
    assert second_doc["seasons"][0]["episodes"][0]["threads"][0]["id"] == thread["id"]


def test_merge_rejects_an_unknown_evidence_beat():
    doc = _doc()
    bad = _result(
        themes=[
            {
                "label": "Invented",
                "statement": "This should not persist.",
                "evidence": [{"beatId": "beat-unknown"}],
            }
        ]
    )

    with pytest.raises(NarrativeMapValidationError) as error:
        merge_narrative_map(doc, "ep-1", bad)

    assert any(item["code"] == "unknown_beat" for item in error.value.diagnostics)
    assert doc["seasons"][0]["episodes"][0]["narrativeMap"] is None


def test_merge_rejects_placeholder_analysis_before_it_reaches_writers():
    doc = _doc()
    bad = _result(dramaticQuestion="<UNKNOWN>")

    with pytest.raises(NarrativeMapValidationError) as error:
        merge_narrative_map(doc, "ep-1", bad)

    assert any(item["code"] == "unusable_analysis_text" for item in error.value.diagnostics)
    assert doc["seasons"][0]["episodes"][0]["narrativeMap"] is None


def test_literal_placeholder_is_not_publishable_analysis():
    assert is_usable_analysis_text("placeholder") is False
    assert is_usable_analysis_text(
        "The scene advances the episode through Nora's discovery."
    ) is True


def test_merge_rejects_an_evidence_beat_without_source_text():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["scenes"][0]["beats"][0]["scriptText"] = ""

    with pytest.raises(NarrativeMapValidationError) as error:
        merge_narrative_map(doc, "ep-1", _result())

    assert any(item["code"] == "beat_has_no_source_text" for item in error.value.diagnostics)
    assert doc["seasons"][0]["episodes"][0]["narrativeMap"] is None


def test_merge_prefers_dialogue_or_action_over_teleplay_markup_for_evidence():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["scenes"][0]["beats"][0]["scriptText"] = (
        "INT. LIGHTHOUSE - NIGHT\n\nNORA\n\nThe letter was never meant for me."
    )

    merge_narrative_map(doc, "ep-1", _result())

    narrative_map = doc["seasons"][0]["episodes"][0]["narrativeMap"]
    assert narrative_map["themes"][0]["evidence"][0]["quote"] == (
        "The letter was never meant for me."
    )


def test_merge_rejects_partial_scene_turn_coverage():
    doc = _doc()
    bad = _result(sceneTurns=[_result().scene_turns[0].model_dump(by_alias=True)])

    with pytest.raises(NarrativeMapValidationError) as error:
        merge_narrative_map(doc, "ep-1", bad)

    assert any(item["code"] == "scene_turn_coverage_incomplete" for item in error.value.diagnostics)


def test_merge_rejects_an_act_turn_from_another_act():
    doc = _doc()
    acts = [item.model_dump(by_alias=True) for item in _result().acts]
    acts[0]["turnBeatId"] = "beat-2-1"
    bad = _result(acts=acts)

    with pytest.raises(NarrativeMapValidationError) as error:
        merge_narrative_map(doc, "ep-1", bad)

    assert any(item["code"] == "act_turn_beat_mismatch" for item in error.value.diagnostics)


def test_merge_rejects_unresolved_character_thread_and_hero_anchors():
    doc = _doc()
    scene_turns = [item.model_dump(by_alias=True) for item in _result().scene_turns]
    scene_turns[0]["focalCharacterName"] = "Unknown"
    bad = _result(
        heroJourney={
            "applies": False,
            "protagonistName": "Nora",
            "rationale": "The lens does not apply.",
            "stages": [],
        },
        sceneTurns=scene_turns,
        threadMovements=[
            {
                "threadId": "thread-unknown",
                "beatId": "beat-2-1",
                "phase": "escalation",
                "summary": "An invalid thread reference.",
            }
        ],
    )

    with pytest.raises(NarrativeMapValidationError) as error:
        merge_narrative_map(doc, "ep-1", bad)

    codes = {item["code"] for item in error.value.diagnostics}
    assert {
        "unknown_character",
        "unknown_thread",
        "hero_journey_not_applicable_has_anchors",
    } <= codes


def test_merge_preserves_a_locked_narrative_map():
    doc = _doc(locked=True)
    prior = dict(doc["seasons"][0]["episodes"][0]["narrativeMap"])

    merge_narrative_map(doc, "ep-1", _result())

    assert doc["seasons"][0]["episodes"][0]["narrativeMap"] == prior
