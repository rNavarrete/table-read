"""Evidence-readiness and source-citation tests for Narrative Map analysis."""

from __future__ import annotations

import pytest

from drama_manager.narrative_map_analysis import (
    NarrativeMapAnalysisValidationError,
    NarrativeMapReadinessError,
    chunk_scene_sources,
    deterministic_non_narrative_packets,
    normalize_scene_packet_focal_characters,
    normalize_scene_packet_quality,
    prepare_narrative_map_source,
    repair_candidate_from_verification,
    reusable_scene_packets,
    source_backed_scene_fallback,
    synthesis_scene_spine,
    validate_scene_analysis_batch,
    verification_audit_evidence,
    verification_supports_local_repair,
)
from schemas import (
    InferredNarrativeMap,
    InferredNarrativeSceneAnalysisBatch,
    NarrativeMapVerification,
)


def _doc() -> dict:
    return {
        "format": {"genre": "drama"},
        "seriesBible": {"characters": [{"id": "char-nora", "name": "Nora", "aliases": []}]},
        "seasons": [
            {
                "episodes": [
                    {
                        "id": "ep-1",
                        "locked": False,
                        "narrativeMap": None,
                        "threads": [],
                        "scenes": [
                            {
                                "id": "scene-1",
                                "act": 0,
                                "location": "INT. LIGHTHOUSE - NIGHT",
                                "beats": [
                                    {
                                        "id": "beat-1-1",
                                        "scriptText": (
                                            "Nora finds the unsent letter in a locked drawer."
                                        ),
                                        "whatHappens": "",
                                        "audienceLearns": "",
                                        "audienceFeels": "",
                                    }
                                ],
                            }
                        ],
                    }
                ]
            }
        ],
    }


def _scene_packet(**overrides) -> InferredNarrativeSceneAnalysisBatch:
    payload = {
        "scenes": [
            {
                "sceneId": "scene-1",
                "summary": "Nora discovers evidence of a concealed relationship.",
                "focalCharacterName": "Nora",
                "dramaticFunction": "Plant the mystery that drives Nora's next choice.",
                "conflict": "Nora wants the truth but the locked drawer has kept it from her.",
                "stakes": "The discovery may change whom Nora believes she can trust.",
                "turnBeatId": "beat-1-1",
                "turn": (
                    "A private discovery turns Nora's ordinary search into a pursuit of the truth."
                ),
                "keyMoments": [
                    {
                        "beatId": "beat-1-1",
                        "summary": "Nora opens the drawer and sees the unsent letter.",
                        "dramaticFunction": "Introduce the episode's triggering evidence.",
                        "consequence": "Nora now has a concrete secret to investigate.",
                    }
                ],
            }
        ]
    }
    payload.update(overrides)
    return InferredNarrativeSceneAnalysisBatch.model_validate(payload)


def _candidate_map() -> InferredNarrativeMap:
    return InferredNarrativeMap.model_validate(
        {
            "dramaticQuestion": "Will Nora confront the keeper before the letter disappears?",
            "centralConflict": "Nora needs the truth while the keeper protects the secret.",
            "controllingIdea": "Truth requires Nora to risk the relationship that shelters her.",
            "themes": [
                {
                    "label": "Protection can become concealment",
                    "statement": "The locked drawer turns care into a barrier to the truth.",
                    "evidence": [{"beatId": "beat-1-1"}],
                },
                {
                    "label": "Evidence changes obligation",
                    "statement": "Finding the letter gives Nora a reason to act.",
                    "evidence": [{"beatId": "beat-1-1"}],
                },
            ],
            "acts": [
                {
                    "act": 0,
                    "dramaticQuestion": "Will Nora open the drawer?",
                    "escalation": "The hidden letter makes avoidance impossible.",
                    "turnBeatId": "beat-1-1",
                }
            ],
            "heroJourney": {
                "applies": False,
                "protagonistName": None,
                "rationale": "The scene is too brief to support a monomyth reading.",
                "stages": [],
            },
            "characterArcs": [],
            "sceneTurns": [
                {
                    "sceneId": "scene-1",
                    "focalCharacterName": "Nora",
                    "dramaticFunction": "Plant the central mystery.",
                    "conflict": "Nora needs evidence that the locked drawer conceals.",
                    "stakes": "The discovery may break Nora's trust in the keeper.",
                    "turnBeatId": "beat-1-1",
                    "turn": "The letter turns suspicion into evidence.",
                }
            ],
            "threadMovements": [
                {
                    "threadId": "thread-letter",
                    "beatId": "beat-1-1",
                    "phase": "setup",
                    "summary": "Nora finds the letter that starts the investigation.",
                }
            ],
        }
    )


def test_raw_screenplay_is_sufficient_when_import_semantics_are_empty():
    source = prepare_narrative_map_source(_doc())

    assert source.scene_count == 1
    assert source.semantic_coverage == 0
    assert source.scene_sources[0]["beats"][0]["scriptText"].startswith("Nora finds")


def test_verifier_rejected_arc_claim_is_cleared_without_rewriting_it():
    payload = _candidate_map().model_dump(by_alias=True)
    payload["characterArcs"] = [
        {
            "characterName": "Nora",
            "want": "Learn who wrote the letter.",
            "need": "Accept what the evidence reveals.",
            "internalConflict": "She fears the truth will break a trusted bond.",
            "externalPressure": "The keeper controls access to the lighthouse records.",
            "arcSummary": "Nora talks her way into the keeper's confidence.",
            "turningPoints": [
                {
                    "beatId": "beat-1-1",
                    "change": "The letter gives Nora a reason to investigate.",
                }
            ],
        }
    ]
    candidate = InferredNarrativeMap.model_validate(payload)
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": [
                "characterArcs[0].arcSummary - recruitment is not supported"
            ],
            "missingSceneIds": [],
            "issues": [],
        }
    )

    repaired, repairs = repair_candidate_from_verification(candidate, verdict)

    assert verification_supports_local_repair(verdict) is True
    # The disputed reading goes; the character, her other readings and her
    # turning points stay. Deleting the arc used to lose all of it.
    assert len(repaired.character_arcs) == 1
    arc = repaired.character_arcs[0]
    assert arc.arc_summary == ""
    assert arc.character_name == "Nora"
    assert arc.internal_conflict, "an undisputed reading is untouched"
    assert len(arc.turning_points) == 1
    assert repairs == [
        {
            "action": "clear_character_arc_claim",
            "path": "characterArcs[0].arcSummary - recruitment is not supported",
            "characterName": "Nora",
            "field": "arcSummary",
        }
    ]


def test_front_matter_and_establishing_blocks_are_not_dramatic_scenes():
    doc = _doc()
    episode = doc["seasons"][0]["episodes"][0]
    original = episode["scenes"][0]
    episode["storyOverview"] = {
        "outline": [
            {"sceneId": "scene-front", "summary": "Title page: final draft information."},
            {"sceneId": "scene-cast", "summary": "Sets and cast list for the pilot."},
            {"sceneId": "scene-est", "summary": "Establishing the White House at dawn."},
            {"sceneId": "scene-1", "summary": "Nora finds a concealed letter."},
        ]
    }
    episode["scenes"] = [
        {
            **original,
            "id": "scene-front",
            "beats": [
                {
                    **original["beats"][0],
                    "id": "beat-front",
                    "scriptText": 'THE WEST WING\n"Pilot"\nWritten by Aaron\nFINAL DRAFT',
                }
            ],
        },
        {
            **original,
            "id": "scene-cast",
            "beats": [
                {
                    **original["beats"][0],
                    "id": "beat-cast",
                    "scriptText": "INT. GLASS OFFICE BUILDING\nCAST\nSAM\nLEO\nFADE IN:",
                }
            ],
        },
        {
            **original,
            "id": "scene-est",
            "beats": [
                {
                    **original["beats"][0],
                    "id": "beat-est",
                    "scriptText": "EXT. WHITE HOUSE - ESTABLISHING - DAWN",
                }
            ],
        },
        original,
    ]

    source = prepare_narrative_map_source(doc)
    kinds = {scene["sceneId"]: scene["sourceKind"] for scene in source.scene_sources}
    packets = deterministic_non_narrative_packets(source.scene_sources)

    assert kinds == {
        "scene-front": "front_matter",
        "scene-cast": "front_matter",
        "scene-est": "establishing",
        "scene-1": "narrative",
    }
    assert [packet["sceneId"] for packet in packets] == [
        "scene-front",
        "scene-cast",
        "scene-est",
    ]
    assert all(packet["focalCharacterName"] is None for packet in packets)
    assert all(packet["keyMoments"][0]["sourceQuote"] for packet in packets)
    assert "No story conflict" in packets[0]["conflict"]
    assert "No direct conflict" in packets[2]["conflict"]


def test_an_episode_with_no_source_at_all_is_a_hard_readiness_failure():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["scenes"][0]["beats"][0]["scriptText"] = ""

    with pytest.raises(NarrativeMapReadinessError) as error:
        prepare_narrative_map_source(doc)

    assert error.value.diagnostics[0]["code"] == "no_source_backed_scenes"


def test_an_unwritten_scene_does_not_block_mapping_the_written_ones():
    """A stub scene is a normal draft state — the UI spec documents it — and
    blocking the whole episode on one abandons the writer for no gain."""
    doc = _doc()
    episode = doc["seasons"][0]["episodes"][0]
    episode["scenes"].append(
        {"id": "scene-2", "act": 1, "location": "EXT. PIER - DAY", "beats": []}
    )
    episode["scenes"].append(
        {
            "id": "scene-3",
            "act": 1,
            "location": "INT. OFFICE - DAY",
            "beats": [{"id": "beat-3-1", "scriptText": "   ", "whatHappens": ""}],
        }
    )

    source = prepare_narrative_map_source(doc)

    assert [scene["sceneId"] for scene in source.scene_sources] == ["scene-1"]
    assert source.stub_scene_ids == ["scene-2", "scene-3"], "recorded, not silently dropped"


def test_one_unwritten_beat_does_not_disqualify_its_scene():
    doc = _doc()
    scene = doc["seasons"][0]["episodes"][0]["scenes"][0]
    scene["beats"].append({"id": "beat-1-2", "scriptText": "", "whatHappens": ""})

    source = prepare_narrative_map_source(doc)

    assert source.stub_scene_ids == []
    assert [beat["beatId"] for beat in source.scene_sources[0]["beats"]] == ["beat-1-1"]


def test_scene_packet_attaches_a_server_owned_quote_from_its_beat():
    source = prepare_narrative_map_source(_doc())
    packets = validate_scene_analysis_batch(source.scene_sources, _scene_packet())

    assert packets[0]["turnBeatId"] == "beat-1-1"
    assert packets[0]["keyMoments"][0]["sourceQuote"].startswith("Nora finds")


def test_synthesis_scene_spine_keeps_evidence_addresses_but_bounds_prose():
    source = prepare_narrative_map_source(_doc())
    packet = validate_scene_analysis_batch(source.scene_sources, _scene_packet())[0]
    packet["summary"] = "s" * 500
    packet["turn"] = "t" * 500
    packet["keyMoments"][0]["summary"] = "m" * 500

    spine = synthesis_scene_spine([packet])

    assert spine == [
        {
            "sceneId": "scene-1",
            "act": 0,
            "sourceKind": "narrative",
            "analysisStatus": "accepted",
            "summary": "s" * 220,
            "focalCharacterName": "Nora",
            "turnBeatId": "beat-1-1",
            "turn": "t" * 220,
            "keyMoment": {"beatId": "beat-1-1", "summary": "m" * 180},
        }
    ]


def test_focal_character_normalization_uses_aliases_and_omits_unknown_labels():
    source = prepare_narrative_map_source(_doc())
    packet = validate_scene_analysis_batch(source.scene_sources, _scene_packet())[0]
    known = dict(packet)
    unknown = dict(packet)
    known["focalCharacterName"] = "N"
    unknown["sceneId"] = "scene-2"
    unknown["focalCharacterName"] = "Unresolved Person"

    packets, repaired_scene_ids = normalize_scene_packet_focal_characters(
        [known, unknown],
        [{"id": "char-nora", "name": "Nora", "aliases": ["N"]}],
    )

    assert packets[0]["focalCharacterName"] == "Nora"
    assert packets[1]["focalCharacterName"] is None
    assert repaired_scene_ids == ["scene-2"]


def test_single_scene_packet_normalizes_model_ids_from_authoritative_source():
    source = prepare_narrative_map_source(_doc())
    packet = _scene_packet().model_dump(by_alias=True)
    packet["scenes"][0]["sceneId"] = "invented-scene-id"
    packet["scenes"][0]["turnBeatId"] = "invented-turn-beat-id"
    packet["scenes"][0]["keyMoments"][0]["beatId"] = "invented-moment-beat-id"

    packets = validate_scene_analysis_batch(
        source.scene_sources,
        InferredNarrativeSceneAnalysisBatch.model_validate(packet),
    )

    assert packets[0]["sceneId"] == "scene-1"
    assert packets[0]["turnBeatId"] == "beat-1-1"
    assert packets[0]["keyMoments"][0]["beatId"] == "beat-1-1"


def test_scene_packet_rejects_placeholders_even_when_schema_valid():
    source = prepare_narrative_map_source(_doc())
    bad = _scene_packet(
        scenes=[
            {
                **_scene_packet().scenes[0].model_dump(by_alias=True),
                "summary": "<UNKNOWN>",
            }
        ]
    )

    with pytest.raises(NarrativeMapAnalysisValidationError) as error:
        validate_scene_analysis_batch(source.scene_sources, bad)

    assert any(item["code"] == "unusable_analysis_text" for item in error.value.diagnostics)


def test_source_backed_fallback_preserves_outline_after_placeholder_response():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["storyOverview"] = {
        "outline": [
            {
                "sceneId": "scene-1",
                "summary": "Nora discovers an unsent letter hidden in the locked drawer.",
            }
        ]
    }
    source_scene = prepare_narrative_map_source(doc).scene_sources[0]
    bad = _scene_packet(
        scenes=[
            {
                **_scene_packet().scenes[0].model_dump(by_alias=True),
                "summary": "<UNKNOWN>",
                "dramaticFunction": "<UNKNOWN>",
                "conflict": "<UNKNOWN>",
                "stakes": "<UNKNOWN>",
                "turn": "<UNKNOWN>",
                "keyMoments": [
                    {
                        "beatId": "beat-1-1",
                        "summary": "<UNKNOWN>",
                        "dramaticFunction": "<UNKNOWN>",
                        "consequence": "<UNKNOWN>",
                    }
                ],
            }
        ]
    )
    diagnostics = [{"code": "unusable_analysis_text", "path": "scenes[0].summary"}]

    packet = source_backed_scene_fallback(source_scene, bad, diagnostics)

    assert packet is not None
    assert packet["analysisStatus"] == "source_fallback"
    assert packet["summary"].startswith("Nora discovers")
    assert packet["turnBeatId"] == "beat-1-1"
    assert packet["keyMoments"][0]["sourceQuote"].startswith("Nora finds")


def test_checkpoint_packet_placeholder_is_repaired_from_saved_source_without_a_model_call():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["storyOverview"] = {
        "outline": [
            {
                "sceneId": "scene-1",
                "summary": "Nora discovers an unsent letter hidden in the locked drawer.",
            }
        ]
    }
    source = prepare_narrative_map_source(doc)
    packet = validate_scene_analysis_batch(source.scene_sources, _scene_packet())[0]
    packet["dramaticFunction"] = "placeholder"
    packet["conflict"] = "placeholder"

    repaired, repaired_scene_ids = normalize_scene_packet_quality([packet], source.scene_sources)

    assert repaired_scene_ids == ["scene-1"]
    assert repaired[0]["analysisStatus"] == "source_fallback"
    assert repaired[0]["dramaticFunction"] != "placeholder"
    assert repaired[0]["conflict"] != "placeholder"
    assert repaired[0]["turnBeatId"] == "beat-1-1"


def test_verification_evidence_is_bounded_to_candidate_citations():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["scenes"][0]["beats"][0]["scriptText"] = "x" * 2_000
    source = prepare_narrative_map_source(doc)
    packet = validate_scene_analysis_batch(source.scene_sources, _scene_packet())[0]

    evidence = verification_audit_evidence(
        source.scene_sources,
        [packet],
        _candidate_map().model_dump(by_alias=True),
    )

    assert evidence["serverCheckedSceneIds"] == ["scene-1"]
    assert evidence["candidateBeatIds"] == ["beat-1-1"]
    assert [item["beatId"] for item in evidence["sourceBeats"]] == ["beat-1-1"]
    assert len(evidence["sourceBeats"][0]["scriptExcerpt"]) <= 525
    assert evidence["sourceBeats"][0]["sourceQuotes"]


def test_prior_checkpoint_is_reused_only_after_current_source_validation():
    source = prepare_narrative_map_source(_doc())
    valid = validate_scene_analysis_batch(source.scene_sources, _scene_packet())[0]
    invalid = {
        **valid,
        "summary": "<UNKNOWN>",
    }

    assert reusable_scene_packets(source.scene_sources, [invalid]) == []
    assert reusable_scene_packets(source.scene_sources, [invalid, valid]) == [valid]


def test_scene_analysis_requests_are_single_scene_for_exact_coverage_and_checkpointing():
    doc = _doc()
    original = doc["seasons"][0]["episodes"][0]["scenes"][0]
    doc["seasons"][0]["episodes"][0]["scenes"] = [
        original,
        {
            **original,
            "id": "scene-2",
            "beats": [
                {
                    **original["beats"][0],
                    "id": "beat-2-1",
                    "scriptText": "Nora confronts the keeper about the hidden letter.",
                }
            ],
        },
    ]

    chunks = chunk_scene_sources(prepare_narrative_map_source(doc).scene_sources)

    assert [[scene["sceneId"] for scene in chunk] for chunk in chunks] == [
        ["scene-1"],
        ["scene-2"],
    ]


def test_cached_verifier_repair_prunes_only_named_optional_claims():
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": [
                "themes[0].evidence[0] overstates the cited beat",
                "threadMovements[thread-letter, beatId beat-1-1].summary is interpretive",
                "characterArcs (empty despite a possible arc)",
            ],
            "missingSceneIds": [],
            "issues": [
                {
                    "path": "sceneTurns",
                    "reason": "All scene turns are present; this is advisory only.",
                }
            ],
        }
    )

    assert verification_supports_local_repair(verdict) is True
    repaired, repairs = repair_candidate_from_verification(_candidate_map(), verdict)

    assert [theme.label for theme in repaired.themes] == ["Evidence changes obligation"]
    assert repaired.thread_movements == []
    assert repaired.character_arcs == []
    assert {repair["action"] for repair in repairs} == {
        "remove_theme",
        "remove_thread_movement",
        "record_coverage_advisory",
        "record_verifier_advisory",
    }


def test_cached_verifier_repair_fails_closed_for_missing_scenes_or_unknown_paths():
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": ["acts[0].dramaticQuestion"],
            "missingSceneIds": ["scene-2"],
            "issues": [],
        }
    )

    assert verification_supports_local_repair(verdict) is False
    with pytest.raises(NarrativeMapAnalysisValidationError):
        repair_candidate_from_verification(_candidate_map(), verdict)


def test_cached_verifier_repair_uses_stable_beat_when_old_thread_id_is_stale():
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": [
                "threadMovements[thread-old-random-id, beatId beat-1-1].summary is unsupported"
            ],
            "missingSceneIds": [],
            "issues": [],
        }
    )

    repaired, repairs = repair_candidate_from_verification(_candidate_map(), verdict)

    assert repaired.thread_movements == []
    assert repairs == [
        {
            "action": "remove_thread_movements_for_beat",
            "path": (
                "threadMovements[thread-old-random-id, beatId beat-1-1].summary is unsupported"
            ),
            "beatId": "beat-1-1",
            "count": 1,
        }
    ]


# ── verifier path forms ─────────────────────────────────────────────────────
#
# The verifier writes its paths as prose and addresses list entries by whatever
# reads naturally — a theme's label, a character's name, a thread's id — where
# this module originally required an array index. A real West Wing run was
# discarded whole over three rejections, one of which
# (`threadMovements[thread-b8f3...].beatId=beat-16-1`) the local repair was
# built to absorb and simply could not parse.


def test_character_arc_addressed_by_name_is_repairable():
    payload = _candidate_map().model_dump(by_alias=True)
    payload["characterArcs"] = [
        {
            "characterName": "Mandy",
            "want": "Be taken seriously as a threat to this White House.",
            "need": "Hold a line between old friendship and new employer.",
            "internalConflict": "She warns Josh as a friend while withholding her source.",
            "externalPressure": "Russell's payroll and a carton-choked office.",
            "arcSummary": "Mandy sets up opposite her former colleagues.",
            "turningPoints": [
                {"beatId": "beat-1-1", "change": "Josh calls before her phones are connected."}
            ],
        }
    ]
    candidate = InferredNarrativeMap.model_validate(payload)
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": ["characterArcs[Mandy].turningPoints[beat-15-4]"],
            "missingSceneIds": [],
            "issues": [],
        }
    )

    assert verification_supports_local_repair(verdict) is True
    repaired, repairs = repair_candidate_from_verification(candidate, verdict)
    assert repaired.character_arcs == []
    assert repairs[0]["action"] == "remove_character_arc"
    assert repairs[0]["characterName"] == "Mandy"


def test_theme_addressed_by_label_is_repairable():
    payload = _candidate_map().model_dump(by_alias=True)
    payload["themes"] = [
        {
            "label": "Loyalty across shifting teams",
            "statement": "Loyalty is tested when the teams change.",
            "evidence": [{"beatId": "beat-1-1"}],
        },
        {
            "label": "Competence under pressure",
            "statement": "Pressure exposes who can actually do the work.",
            "evidence": [{"beatId": "beat-1-1"}],
        },
    ]
    candidate = InferredNarrativeMap.model_validate(payload)
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": ["themes[Loyalty across shifting teams].evidence[beat-10-1]"],
            "missingSceneIds": [],
            "issues": [],
        }
    )

    assert verification_supports_local_repair(verdict) is True
    repaired, _repairs = repair_candidate_from_verification(candidate, verdict)
    assert [theme.label for theme in repaired.themes] == ["Competence under pressure"]


def test_thread_movement_in_dotted_form_is_repairable():
    """The exact path that sank the West Wing map."""
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": ["threadMovements[thread-b8f342b76ceb].beatId=beat-16-1"],
            "missingSceneIds": [],
            "issues": [],
        }
    )
    assert verification_supports_local_repair(verdict) is True


def test_structural_coverage_still_fails_closed():
    """An act's escalation is interpretive prose and is droppable; the turn
    itself is not. A rejection that disputes a turn beat — with no escalation
    claim named — would leave an act with no turn or a scene uncovered."""
    for path in (
        "acts[1].turnBeatId=beat-6-5",
        "sceneTurns[scene-16].turnBeatId=beat-16-2",
    ):
        verdict = NarrativeMapVerification.model_validate(
            {
                "approved": False,
                "unsupportedPaths": [path],
                "missingSceneIds": [],
                "issues": [],
            }
        )
        assert verification_supports_local_repair(verdict) is False, path


def test_an_unresolvable_name_fails_closed_rather_than_removing_the_wrong_entry():
    payload = _candidate_map().model_dump(by_alias=True)
    payload["themes"] = [
        {
            "label": "Competence under pressure",
            "statement": "Pressure exposes who can do the work.",
            "evidence": [{"beatId": "beat-1-1"}],
        }
    ]
    candidate = InferredNarrativeMap.model_validate(payload)
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": ["themes[A theme this map does not have]"],
            "missingSceneIds": [],
            "issues": [],
        }
    )
    with pytest.raises(NarrativeMapAnalysisValidationError) as excinfo:
        repair_candidate_from_verification(candidate, verdict)
    assert excinfo.value.diagnostics[0]["code"] == "verification_repair_path_unresolved"


def test_rejected_act_escalation_is_cleared_and_the_act_survives():
    """The verifier disputes the reading, not the turn — so the act keeps its
    number, dramatic question and turn beat, and only the prose goes."""
    payload = _candidate_map().model_dump(by_alias=True)
    payload["acts"] = [
        {
            "act": 1,
            "dramaticQuestion": "Is Josh going to be fired for insulting Mary Marsh?",
            "escalation": "Leo converts a bad soundcheck into a lost alliance with Caldwell.",
            "turnBeatId": "beat-1-1",
        }
    ]
    candidate = InferredNarrativeMap.model_validate(payload)
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": [
                "acts[1].turnBeatId=beat-1-1 escalation claim of 'lost alliance with Caldwell'"
            ],
            "missingSceneIds": [],
            "issues": [],
        }
    )

    assert verification_supports_local_repair(verdict) is True
    repaired, repairs = repair_candidate_from_verification(candidate, verdict)

    assert len(repaired.acts) == 1, "act coverage must survive"
    assert repaired.acts[0].escalation == ""
    assert repaired.acts[0].act == 1
    assert repaired.acts[0].turn_beat_id == "beat-1-1"
    assert repaired.acts[0].dramatic_question  # untouched
    assert repairs == [
        {
            "action": "clear_act_escalation",
            "path": verdict.unsupported_paths[0],
            "act": 1,
        }
    ]


def test_act_escalation_repair_resolves_by_act_number_not_list_position():
    """A cold open makes act numbers 0-based, so acts[1] is the second entry
    here only by number — position would silently clear the wrong act."""
    payload = _candidate_map().model_dump(by_alias=True)
    payload["acts"] = [
        {"act": 0, "dramaticQuestion": "Cold open.", "escalation": "Keep me.",
         "turnBeatId": "beat-1-1"},
        {"act": 1, "dramaticQuestion": "Act one.", "escalation": "Clear me.",
         "turnBeatId": "beat-1-1"},
    ]
    candidate = InferredNarrativeMap.model_validate(payload)
    verdict = NarrativeMapVerification.model_validate(
        {"approved": False, "unsupportedPaths": ["acts[1] escalation unsupported"],
         "missingSceneIds": [], "issues": []}
    )
    repaired, _ = repair_candidate_from_verification(candidate, verdict)
    assert repaired.acts[0].escalation == "Keep me."
    assert repaired.acts[1].escalation == ""


def test_act_rejection_without_an_escalation_claim_is_not_repairable():
    verdict = NarrativeMapVerification.model_validate(
        {"approved": False, "unsupportedPaths": ["acts[1].turnBeatId=beat-6-5"],
         "missingSceneIds": [], "issues": []}
    )
    assert verification_supports_local_repair(verdict) is False


def test_rejected_scene_turn_prose_is_cleared_and_the_scene_stays_covered():
    """Rejections here cluster on establishing shots — a scene with no drama
    in it cannot support a dramatic-function claim, but it is still a scene the
    map has to cover."""
    candidate = _candidate_map()
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": ["sceneTurns[0].dramaticFunction (scene-1)"],
            "missingSceneIds": [],
            "issues": [],
        }
    )

    assert verification_supports_local_repair(verdict) is True
    repaired, repairs = repair_candidate_from_verification(candidate, verdict)

    assert len(repaired.scene_turns) == 1, "scene coverage must survive"
    assert repaired.scene_turns[0].dramatic_function == ""
    assert repaired.scene_turns[0].turn_beat_id == "beat-1-1"
    assert repaired.scene_turns[0].turn, "the turn itself is untouched"
    assert repairs[0]["action"] == "clear_scene_turn_claim"
    assert repairs[0]["sceneId"] == "scene-1"


def test_scene_turn_prose_repair_resolves_by_scene_id():
    candidate = _candidate_map()
    verdict = NarrativeMapVerification.model_validate(
        {"approved": False, "unsupportedPaths": ["sceneTurns[scene-1].stakes"],
         "missingSceneIds": [], "issues": []}
    )
    repaired, _ = repair_candidate_from_verification(candidate, verdict)
    assert repaired.scene_turns[0].stakes == ""
    assert repaired.scene_turns[0].dramatic_function, "only the named field clears"


def test_scene_turn_turn_beat_rejection_is_not_repairable():
    verdict = NarrativeMapVerification.model_validate(
        {"approved": False, "unsupportedPaths": ["sceneTurns[0].turnBeatId=beat-1-1"],
         "missingSceneIds": [], "issues": []}
    )
    assert verification_supports_local_repair(verdict) is False


def test_cleared_prose_passes_the_publishable_text_gate():
    """A server-cleared field means no claim was made. The gate exists to stop
    placeholders like 'could not analyze' shipping as analysis, not to force a
    claim the verifier just rejected."""
    from drama_manager.narrative_map import _validate_analysis_quality

    candidate = _candidate_map()
    verdict = NarrativeMapVerification.model_validate(
        {"approved": False, "unsupportedPaths": ["sceneTurns[0].dramaticFunction"],
         "missingSceneIds": [], "issues": []}
    )
    repaired, _ = repair_candidate_from_verification(candidate, verdict)
    diagnostics: list[dict] = []
    _validate_analysis_quality(repaired, diagnostics)
    assert diagnostics == [], diagnostics


def test_placeholder_prose_still_fails_the_gate():
    from drama_manager.narrative_map import _validate_analysis_quality

    payload = _candidate_map().model_dump(by_alias=True)
    payload["sceneTurns"][0]["dramaticFunction"] = "unknown"
    diagnostics: list[dict] = []
    _validate_analysis_quality(InferredNarrativeMap.model_validate(payload), diagnostics)
    assert [d["code"] for d in diagnostics] == ["unusable_analysis_text"]


def _arc(**overrides) -> dict:
    payload = {
        "characterName": "C.J.",
        "want": "Control the story so the day is about a bicycle.",
        "need": "Be told the truth by her own colleagues first.",
        "internalConflict": "She sells certainty from the podium about matters "
        "her own staff won't confirm.",
        "externalPressure": "A gaggle that only wants the firing question.",
        "arcSummary": "C.J. holds the podium while the story moves without her.",
        "turningPoints": [
            {"beatId": "beat-1-1", "change": "She takes the podium."},
            {"beatId": "beat-9-3", "change": "She makes it the story she owes an answer to."},
        ],
    }
    payload.update(overrides)
    return payload


def _map_with_arc(**overrides) -> InferredNarrativeMap:
    payload = _candidate_map().model_dump(by_alias=True)
    payload["characterArcs"] = [_arc(**overrides)]
    return InferredNarrativeMap.model_validate(payload)


def test_disputed_turning_point_drops_only_that_point():
    """The exact loss from the West Wing run: C.J.'s whole arc was deleted
    over one turning point the verifier could not support."""
    candidate = _map_with_arc()
    verdict = NarrativeMapVerification.model_validate(
        {
            "approved": False,
            "unsupportedPaths": [
                "characterArcs[3].turningPoints (beat-9-3 characterized as C.J. "
                "'making it the story she owes an answer to')"
            ],
            "missingSceneIds": [],
            "issues": [],
        }
    )
    # Addressed by name, since the index refers to the full run's arc list.
    verdict.unsupported_paths = [
        verdict.unsupported_paths[0].replace("characterArcs[3]", "characterArcs[C.J.]")
    ]

    repaired, repairs = repair_candidate_from_verification(candidate, verdict)

    assert len(repaired.character_arcs) == 1, "the arc survives"
    arc = repaired.character_arcs[0]
    assert [p.beat_id for p in arc.turning_points] == ["beat-1-1"]
    assert arc.internal_conflict.startswith("She sells certainty")
    assert repairs[0]["action"] == "drop_character_arc_turning_point"
    assert repairs[0]["beatIds"] == ["beat-9-3"]


def test_dropping_the_last_turning_point_removes_the_arc():
    """`turningPoints` is min(1) in the contract, so an arc that would be left
    with none cannot be kept."""
    candidate = _map_with_arc(
        turningPoints=[{"beatId": "beat-9-3", "change": "Her only turning point."}]
    )
    verdict = NarrativeMapVerification.model_validate(
        {"approved": False,
         "unsupportedPaths": ["characterArcs[C.J.].turningPoints (beat-9-3 unsupported)"],
         "missingSceneIds": [], "issues": []}
    )
    repaired, repairs = repair_candidate_from_verification(candidate, verdict)
    assert repaired.character_arcs == []
    assert repairs[0]["action"] == "remove_character_arc"


def test_turning_point_rejection_naming_no_beat_removes_the_arc():
    """Nothing identifiable to drop means the rejection is of the turning
    points generally — fall back rather than guess which one."""
    candidate = _map_with_arc()
    verdict = NarrativeMapVerification.model_validate(
        {"approved": False,
         "unsupportedPaths": ["characterArcs[C.J.].turningPoints are not supported"],
         "missingSceneIds": [], "issues": []}
    )
    repaired, repairs = repair_candidate_from_verification(candidate, verdict)
    assert repaired.character_arcs == []
    assert repairs[0]["action"] == "remove_character_arc"


def test_cleared_arc_claim_passes_the_publishable_text_gate():
    from drama_manager.narrative_map import _validate_analysis_quality

    candidate = _map_with_arc()
    verdict = NarrativeMapVerification.model_validate(
        {"approved": False, "unsupportedPaths": ["characterArcs[C.J.].internalConflict"],
         "missingSceneIds": [], "issues": []}
    )
    repaired, _ = repair_candidate_from_verification(candidate, verdict)
    assert repaired.character_arcs[0].internal_conflict == ""
    diagnostics: list[dict] = []
    _validate_analysis_quality(repaired, diagnostics)
    assert diagnostics == [], diagnostics


def test_a_bare_character_arc_rejection_still_removes_the_whole_arc():
    candidate = _map_with_arc()
    verdict = NarrativeMapVerification.model_validate(
        {"approved": False, "unsupportedPaths": ["characterArcs[C.J.] is unsupported"],
         "missingSceneIds": [], "issues": []}
    )
    repaired, repairs = repair_candidate_from_verification(candidate, verdict)
    assert repaired.character_arcs == []
    assert repairs[0]["action"] == "remove_character_arc"
