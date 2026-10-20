"""Fixture-validation tests for the Pydantic mirror (data contract sec 5 / task T0.2).

Must validate the real committed fixture file (docs/tableread-fixture.json,
"The Long Pour"), not a hand-rolled subset.
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from schemas import (
    Beat,
    ExtractedFact,
    KnowledgeEvent,
    LedgerFact,
    PersistedState,
    ProjectSummary,
    Scene,
    SegmentedScene,
)

FIXTURE_PATH = Path(__file__).resolve().parents[3] / "docs" / "tableread-fixture.json"


def _load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


def test_fixture_validates_against_pydantic_contract():
    fixture = _load_fixture()
    # Raises pydantic.ValidationError on failure; pytest reports it as a
    # legible test failure with the full error list.
    PersistedState.model_validate(fixture)


def test_project_summary_contract_accepts_dashboard_shape():
    ProjectSummary.model_validate(
        {
            "id": "proj-longpour",
            "title": "The Long Pour",
            "format": {
                "genre": "drama",
                "runtimeMinutes": 60,
                "actCount": 4,
                "coldOpen": True,
                "tag": False,
                "serialization": 0.8,
            },
            "updatedAt": "2026-07-10T19:00:00Z",
            "pendingReviewCount": 1,
            "setupState": "ready",
        }
    )


def test_inferred_act_breaks_accepts_integral_json_numbers():
    from schemas import InferredActBreaks

    value = InferredActBreaks.model_validate(
        {"starts": [{"act": 1.0, "startSceneIndex": 0.0}]}
    )
    assert value.starts[0].act == 1
    assert value.starts[0].start_scene_index == 0


@pytest.mark.parametrize(
    "start",
    [
        {"act": "1", "startSceneIndex": 0},
        {"act": 1, "startSceneIndex": "0"},
        {"act": True, "startSceneIndex": 0},
        {"act": 1, "startSceneIndex": False},
        {"act": 1.5, "startSceneIndex": 0},
        {"act": 1, "startSceneIndex": 0.5},
        {"act": -1, "startSceneIndex": 0},
        {"act": 1, "startSceneIndex": -1},
    ],
)
def test_inferred_act_breaks_rejects_invalid_start_primitives(start):
    from schemas import InferredActBreaks

    with pytest.raises(ValidationError):
        InferredActBreaks.model_validate({"starts": [start]})


def test_inferred_act_breaks_rejects_empty_starts():
    from schemas import InferredActBreaks

    with pytest.raises(ValidationError):
        InferredActBreaks.model_validate({"starts": []})


# ── T10.1 scene turn and beat actions ───────────────────────────────────────

_PRE_T10_1_SCENE = {
    "id": "scene-3",
    "index": 2,
    "act": 1,
    "location": "INT. BAR - NIGHT",
    "time": "NIGHT",
    "socialSituation": "",
    "whatHappens": "",
    "audienceLearns": "",
    "audienceFeels": "",
    "motivations": [],
    "beats": [
        {
            "id": "beat-3-1",
            "index": 0,
            "whatHappens": "w",
            "audienceLearns": "l",
            "audienceFeels": "f",
        }
    ],
}


def test_pre_t10_1_scene_loads_with_turn_and_action_defaults():
    scene = Scene.model_validate(_PRE_T10_1_SCENE)
    assert (scene.value_at_stake, scene.charge_in, scene.charge_out, scene.why_now) == (
        "",
        None,
        None,
        "",
    )
    beat = scene.beats[0]
    assert (
        beat.actor_character_id,
        beat.action_verb,
        beat.target_character_id,
        beat.reaction,
    ) == (None, "", None, "")


def test_scene_turn_and_beat_actions_round_trip_and_reject_unknown_charge():
    full = {
        **_PRE_T10_1_SCENE,
        "valueAtStake": "trust",
        "chargeIn": "negative",
        "chargeOut": "mixed",
        "whyNow": "The audit lands tomorrow.",
        "beats": [
            {
                **_PRE_T10_1_SCENE["beats"][0],
                "actorCharacterId": "char-marta",
                "actionVerb": "probes",
                "targetCharacterId": "char-dan",
                "reaction": "deflects",
            }
        ],
    }
    dumped = Scene.model_validate(full).model_dump(by_alias=True, mode="json")
    assert {k: dumped[k] for k in ("valueAtStake", "chargeIn", "chargeOut", "whyNow")} == {
        "valueAtStake": "trust",
        "chargeIn": "negative",
        "chargeOut": "mixed",
        "whyNow": "The audit lands tomorrow.",
    }
    assert dumped["beats"][0]["actionVerb"] == "probes"
    assert dumped["beats"][0]["targetCharacterId"] == "char-dan"
    with pytest.raises(ValidationError):
        Scene.model_validate({**full, "chargeIn": "up"})


def test_pre_0_52_segment_scene_response_parses_with_defaults():
    parsed = SegmentedScene.model_validate(
        {
            "segments": [
                {
                    "kind": "beat",
                    "startLine": 1,
                    "whatHappens": "w",
                    "audienceLearns": "l",
                    "audienceFeels": "f",
                }
            ],
            "sceneWhatHappens": "s",
        }
    )
    beat = parsed.segments[0]
    assert (beat.actor, beat.action_verb, beat.target, beat.reaction) == ("", "", "", "")
    assert (
        parsed.scene_value_at_stake,
        parsed.scene_charge_in,
        parsed.scene_charge_out,
        parsed.scene_why_now,
    ) == ("", None, None, "")



def test_pre_t10_9_beat_reads_as_not_read_and_readings_round_trip():
    beat = Scene.model_validate(_PRE_T10_1_SCENE).beats[0]
    assert (beat.kernel, beat.pressure_choice) == (None, None)
    read = {**_PRE_T10_1_SCENE["beats"][0], "kernel": True, "pressureChoice": False}
    dumped = Beat.model_validate(read).model_dump(by_alias=True, mode="json")
    assert (dumped["kernel"], dumped["pressureChoice"]) == (True, False)
    with pytest.raises(ValidationError):
        Beat.model_validate({**read, "kernel": "maybe"})


def test_pre_0_60_segment_defaults_to_false_and_keeps_returned_values():
    segment = {
        "kind": "beat",
        "startLine": 1,
        "whatHappens": "w",
        "audienceLearns": "l",
        "audienceFeels": "f",
    }
    parsed = SegmentedScene.model_validate(
        {"segments": [segment, {**segment, "startLine": 2, "kernel": True, "pressureChoice": True}]}
    )
    assert [(s.kernel, s.pressure_choice) for s in parsed.segments] == [
        (False, False),
        (True, True),
    ]

_PRE_T10_4_EXTRACTED_FACT = {
    "fact": "Dan hid the money.",
    "factType": "event",
    "sourceSpan": {
        "episodeId": "ep-1",
        "sceneId": "scene-2",
        "beatId": "beat-2-1",
        "startLine": 1,
        "endLine": 1,
    },
    "sourceText": "",
    "knownBy": ["Dan"],
    "knowledgeEvents": [{"sceneId": "scene-3", "characterNames": ["Marta"], "kind": "suspects"}],
    "audienceKnows": True,
    "confidence": 0.9,
}


def test_pre_t10_4_knowledge_and_extraction_load_with_defaults():
    event = KnowledgeEvent.model_validate({"sceneId": "scene-3", "kind": "misinformed"})
    assert event.belief == ""
    fact = ExtractedFact.model_validate(_PRE_T10_4_EXTRACTED_FACT)
    assert fact.knowledge_events[0].belief == ""


def test_belief_round_trips():
    extracted = {
        **_PRE_T10_4_EXTRACTED_FACT,
        "knowledgeEvents": [
            {
                "sceneId": "scene-3",
                "characterNames": ["Marta"],
                "kind": "suspects",
                "quote": "",
                "belief": "the money went to the bank",
            }
        ],
    }
    dumped = ExtractedFact.model_validate(extracted).model_dump(by_alias=True, mode="json")
    assert dumped["knowledgeEvents"][0]["belief"] == "the money went to the bank"


_PRE_T10_8_LEDGER_FACT = {
    "id": "fact-1",
    "fact": "Dan hid the money.",
    "factType": "event",
    "sourceSpan": {"episodeId": "ep-1", "sceneId": "scene-2", "beatId": "beat-2-1"},
    "knownBy": [],
    "provenance": "inferred",
    "confidence": 0.9,
    "status": "active",
    "supersedes": None,
    "supersededBy": None,
}


def test_pre_t10_8_facts_load_with_null_delivery_and_need():
    for model, payload in (
        (ExtractedFact, _PRE_T10_4_EXTRACTED_FACT),
        (LedgerFact, _PRE_T10_8_LEDGER_FACT),
    ):
        parsed = model.model_validate(payload)
        assert (parsed.delivery, parsed.needed_by_scene_id) == (None, None)


def test_delivery_and_need_round_trip_and_reject_an_unknown_delivery():
    read = {"delivery": "implied", "neededBySceneId": "scene-5"}
    for model, payload in (
        (ExtractedFact, _PRE_T10_4_EXTRACTED_FACT),
        (LedgerFact, _PRE_T10_8_LEDGER_FACT),
    ):
        dumped = model.model_validate({**payload, **read}).model_dump(by_alias=True, mode="json")
        assert {key: dumped[key] for key in read} == read
        with pytest.raises(ValidationError):
            model.model_validate({**payload, "delivery": "told"})
