"""`MockLlmClient` -- deterministic, fixture-derived replays of every LLM
operation. Never touches the network (CLAUDE.md hard rule 1); this is the
only `LlmClient` any test may construct.

Keying strategy (see the task report for the full rationale): one canned
response *per operation name*, not per input. No prompt-rendering code exists
yet (`drama_manager/render.py` is a later task), so there is no comparable
"real" prompt text to hash against -- hashing today's placeholder inputs would
be brittle and would silently stop matching once real prompts exist. Each
default is hand-derived from the fixture project ("The Long Pour":
docs/tableread-fixture.json) so later tasks (T2.1+) get deterministic,
fixture-consistent mock output with zero setup. Tests that need a specific
scenario call `set_response(op, value)` to override the default for that op.
"""

from __future__ import annotations

import html
import json
import re
import threading
from collections.abc import Iterator

from pydantic import BaseModel

from llm.ops import OP_REGISTRY
from schemas import (
    BeatCandidate,
    BlastRadius,
    ConsistencyScan,
    InferredActBreaks,
    InferredNarrativeMap,
    InferredNarrativeMapSynthesis,
    InferredNarrativeSceneAnalysisBatch,
    InferredStoryOverview,
    InferredStructureCheck,
    InitialSceneSkeleton,
    InstructionSuggestions,
    LedgerExtraction,
    NarrativeMapVerification,
    NarrativePromises,
    RegeneratedElements,
    SegmentedScene,
    StoryEntities,
    StructureCheckVerification,
)


def _default_responses() -> dict[str, BaseModel]:
    return {
        "generate_beat_candidates": BeatCandidate(
            label="Quiet reveal",
            beatPlan={
                "whatHappens": (
                    "Marta lays the printed transfer record on the counter without "
                    "a word; Dan keeps drying the same glass."
                ),
                "audienceLearns": "Marta has physical proof of the transfer.",
                "audienceFeels": "Tense anticipation.",
            },
            scriptText=(
                "Marta slides a folded printout across the counter.\n\n"
                "DAN\nWhat's this?\n\n"
                "MARTA\nYou tell me.\n\n"
                "Dan doesn't unfold it. He sets down the glass, very carefully."
            ),
            continuityConflicts=[],
        ),
        "tune_beat": BeatCandidate(
            label="Deflected ambush",
            beatPlan={
                "whatHappens": "Marta confronts Dan directly about the transfer; he deflects.",
                "audienceLearns": "Dan will lie rather than admit the transfer.",
                "audienceFeels": "Frustration.",
            },
            scriptText=(
                "MARTA\nI saw the transfer, Dan.\n\nDAN\nI don't know what you're talking about."
            ),
            continuityConflicts=[],
        ),
        # Prompt spec §3 worked example: marina edit of scene-2 → scene-2,
        # cross-scene beat-4-2 (Marta searches the bar), fact-02 (ice machine),
        # and speculative scene-5 (argument still staged around "your bar").
        "classify_blast_radius": BlastRadius(
            impacted=[
                {
                    "objectType": "scene",
                    "objectId": "scene-2",
                    "reason": "Scene premise changes from bar to marina.",
                    "confidence": "high",
                },
                {
                    "objectType": "beat",
                    "objectId": "beat-4-2",
                    "reason": (
                        "Marta searches the bar safe for the money that would no longer be there."
                    ),
                    "confidence": "high",
                },
                {
                    "objectType": "ledgerFact",
                    "objectId": "fact-02",
                    "reason": "Fact states the money is hidden in the bar's ice machine.",
                    "confidence": "high",
                },
                {
                    "objectType": "scene",
                    "objectId": "scene-5",
                    "reason": "The argument still references the bar as the money's hiding place.",
                    "confidence": "speculative",
                },
            ]
        ),
        "regenerate_elements": RegeneratedElements(
            beats=[
                {
                    "beatId": "beat-4-2",
                    "beatPlan": {
                        "whatHappens": (
                            "Marta searches the marina for the money that is no longer in the bar."
                        ),
                        "audienceLearns": "Marta is hunting the cash at the marina.",
                        "audienceFeels": "Dread.",
                    },
                    "scriptText": ("Marta cuts across the dark marina slips, flashlight low."),
                }
            ],
            scenes=[
                {
                    "sceneId": "scene-2",
                    "fields": {
                        "whatHappens": (
                            "Unable to sleep with Marta in the building, Dan moves "
                            "the cash to a marina locker instead of the ice machine."
                        ),
                        "audienceLearns": None,
                        "audienceFeels": None,
                        "location": "EXT. MARINA - NIGHT",
                        "time": None,
                        "socialSituation": None,
                    },
                }
            ],
            continuityConflicts=[],
        ),
        # T7.23: fact-03-shaped example ("Marta saw the transfer" — knownBy
        # starts as just Marta) plus a knowledgeEvents entry showing Dan
        # learning it later, by name — exercising the extract-time
        # knowledge-transition path (design doc T7.23 acceptance #2). T10.4:
        # Reyes suspects, with what he takes to be true instead.
        "extract_ledger_facts": LedgerExtraction(
            newFacts=[
                {
                    "fact": "Dan is arrested.",
                    "factType": "event",
                    "sourceSpan": {
                        "episodeId": "ep-1",
                        "sceneId": "scene-3",
                        "beatId": "beat-3-1",
                        "startLine": 1,
                        "endLine": 4,
                    },
                    "sourceText": "Dan doesn't unfold it. He sets down the glass, very carefully.",
                    "knownBy": ["char-marta"],
                    "knowledgeEvents": [
                        {
                            "sceneId": "scene-3",
                            "characterNames": ["Dan"],
                            "kind": "learns",
                            "quote": "Dan doesn't unfold it.",
                        },
                        {
                            "sceneId": "scene-3",
                            "characterNames": ["Reyes"],
                            "kind": "suspects",
                            "quote": "",
                            "belief": "Dan was only brought in for questioning",
                        },
                    ],
                    "audienceKnows": True,
                    "confidence": 0.9,
                }
            ],
            contradictions=[],
        ),
        "suggest_instructions": InstructionSuggestions(
            suggestions=[
                "Have Marta reveal she saw the transfer directly.",
                "Let Dan notice the printout before Marta says anything.",
                "Cut the scene short with an interruption from Reyes.",
            ]
        ),
        # The format is used only when an import works its format out from
        # the script. It is the fixture's, so the format-less act eval's
        # printed structure holds in a dry run; the single default start is
        # valid under it.
        "infer_act_breaks": InferredActBreaks(
            starts=[{"act": 0, "startSceneIndex": 0}],
            format={
                "genre": "drama",
                "runtimeMinutes": 60,
                "actCount": 4,
                "coldOpen": True,
                "tag": False,
                "serialization": 0.8,
            },
        ),
        # §5a infer_story_entities placeholder (T-continuity Task 1; Task 2
        # wires the real prompt call). Fixture-consistent: "Marta" resolves
        # against the existing char-marta, "Sal" is a non-speaking minor
        # character the merge step will mint.
        "infer_story_entities": StoryEntities(
            characters=[
                {
                    "name": "Marta",
                    "aliases": [],
                    "role": "principal",
                    "traits": "",
                    "evidence": [{"sceneId": "scene-1", "quote": "Marta wipes down the bar."}],
                },
                {
                    "name": "Sal",
                    "aliases": ["the regular"],
                    "role": "minor",
                    "traits": "A silent fixture at the end of the bar.",
                    "evidence": [{"sceneId": "scene-1", "quote": "Sal nods from his usual stool."}],
                },
            ],
            relationships=[
                {
                    "betweenNames": ["Marta", "Dan"],
                    "label": "co-owners",
                    "reallyLike": "",
                    "evidence": [
                        {"sceneId": "scene-1", "quote": "Marta and Dan run the place together."}
                    ],
                }
            ],
            worldElements=[
                {
                    "kind": "location",
                    "name": "The Long Pour",
                    "note": "The bar Marta and Dan co-own.",
                    "evidence": [{"sceneId": "scene-1", "quote": "INT. THE LONG POUR - NIGHT"}],
                }
            ],
        ),
        # §5b infer_narrative_promises placeholder (T7.19 Task 1; T7.20 wires
        # the real prompt call). Fixture-consistent: the setup is the same
        # ledger beat MockLlmClient's extract_ledger_facts example references
        # (Marta finds the $40,000 transfer); no payoff yet in this one-episode
        # fixture, so status stays "open". Two storylines (T10.2): a one-scene
        # import keeps A only (B's scene-2 does not exist there and is dropped);
        # two scenes or more keep both. Thread ledger (T10.3): planted in
        # scene-1, escalated in scene-3 (a one-scene import keeps the setup
        # only); open, so no closure level.
        "infer_narrative_promises": NarrativePromises(
            threads=[
                {
                    "label": "The missing $40,000",
                    "summary": "Marta has found the unexplained transfer but not confronted Dan.",
                    "status": "open",
                    "ownerNames": ["Marta", "Dan"],
                    "setupSceneId": "scene-1",
                    "payoffSceneId": None,
                    "setupBeatId": None,
                    "payoffBeatId": None,
                    "storyline": "A",
                    "movements": [
                        {
                            "sceneId": "scene-1",
                            "beatId": "beat-1-1",
                            "phase": "setup",
                            "summary": "Marta spots the transfer on the statement.",
                        },
                        {
                            "sceneId": "scene-3",
                            "beatId": "beat-3-1",
                            "phase": "escalation",
                            "summary": "Dan's cover story about the money slips.",
                        },
                    ],
                    "closureLevel": None,
                    "secondJob": "Shows Marta reads the books closer than Dan thinks.",
                }
            ],
            storylines=[
                {
                    "letter": "A",
                    "summary": "Marta pulls the thread on the missing $40,000.",
                    "characterNames": ["Marta", "Dan"],
                    "sceneIds": ["scene-1", "scene-3"],
                },
                {
                    "letter": "B",
                    "summary": "Dan keeps the money hidden from his sister.",
                    "characterNames": ["Dan"],
                    "sceneIds": ["scene-2"],
                },
            ],
            # Dan is the fixture's worked example of a stated/actual gap: he
            # says he is closing up, while what he is doing is keeping Marta
            # away from the ice machine.
            secrets=[
                {
                    "summary": "Dan hid the $40,000 in the bar's ice machine.",
                    "holderNames": ["Dan"],
                    "concealedFromNames": ["Marta"],
                    "audienceKnows": True,
                    "establishedSceneId": "scene-2",
                    "revealedSceneId": None,
                    "concealmentSceneIds": ["scene-3"],
                    "establishedBeatId": None,
                    "revealedBeatId": None,
                }
            ],
            sceneMotivations=[
                {
                    "sceneId": "scene-3",
                    "motivations": [
                        {
                            "characterName": "Marta",
                            "objective": "Get Dan to volunteer where the money went.",
                            "stakes": "Trusting her own brother again.",
                            "obstacle": "Dan deflects with easy charm.",
                            "statedObjective": "",
                            "concealed": False,
                        },
                        {
                            "characterName": "Dan",
                            "objective": "Keep Marta away from the ice machine.",
                            "stakes": "The money, and her knowing he took it.",
                            "obstacle": "Marta already saw the transfer.",
                            "statedObjective": "Close up the bar for the night.",
                            "concealed": True,
                        },
                    ],
                }
            ],
            worldRules=[
                {
                    "text": (
                        "The Long Pour is the last neutral ground in town: cops, "
                        "fishermen, and creditors all drink there."
                    ),
                    "limit": "The truce holds only inside the bar's doors.",
                    "cost": "",
                    "exception": "",
                    "evidenceSceneId": "scene-1",
                    "evidenceBeatId": None,
                }
            ],
        ),
        "infer_story_overview": InferredStoryOverview(
            logline=(
                "When a bartender finds an unexplained wire transfer, she must "
                "confront her co-owner brother before the lie destroys their bar."
            ),
            # T10.6: told out of order — scene-2 happens first, a flashback.
            # A one-scene import drops scene-2, and its lone rank is nulled.
            outline=[
                {
                    "sceneId": "scene-1",
                    "summary": "Marta discovers the blank-memo transfer printout.",
                    "storyOrder": 1,
                    "storyTime": "Night",
                    "anachrony": "none",
                },
                {
                    "sceneId": "scene-2",
                    "summary": "Dan hides the money in the ice machine.",
                    "storyOrder": 0,
                    "storyTime": "That afternoon",
                    "anachrony": "flashback",
                },
            ],
            beatSheet=[
                {
                    "beatId": "beat-1-1",
                    "label": "Act One Turn",
                    "summary": "Marta sees the $40,000 transfer.",
                    "sceneId": "scene-1",
                    "act": 1,
                }
            ],
            summary=(
                "Marta finds proof of a secret transfer at the Long Pour and "
                "realizes her brother may be lying.\n\n"
                "She presses for the truth as the bar's fragile truce threatens "
                "to collapse around them."
            ),
            dramaticQuestion="Will Marta get Dan to admit he took the money?",
            centralArgument="Trust survives only when the hidden cost is faced.",
            antiTheme="Family covers for family, whatever it costs.",
            characterArcs=[
                {
                    "characterName": "Marta",
                    "want": "To find out where the $40,000 went.",
                    "need": "To stop protecting Dan from the truth.",
                    "lie": "Family never lies to family.",
                    "ghost": "She covered for their father once and lost the bar.",
                    "continuumAxis": "trusting ↔ suspicious",
                    "stops": [
                        {"sceneId": "scene-1", "headAt": "Shaken, still assumes a mistake."},
                        {"sceneId": "scene-3", "headAt": "Suspicious, testing Dan."},
                    ],
                }
            ],
        ),
        "infer_narrative_map": InferredNarrativeMap(
            dramaticQuestion="Can Marta force the truth into the open?",
            centralConflict="Marta presses Dan while he protects a damaging secret.",
            controllingIdea="Trust survives only when the hidden cost is faced.",
            themes=[
                {
                    "label": "Trust under pressure",
                    "statement": "Secrecy corrodes a partnership when accountability is delayed.",
                    "evidence": [{"beatId": "beat-1-1"}],
                }
            ],
            acts=[
                {
                    "act": 1,
                    "dramaticQuestion": "Will Marta get Dan to explain the transfer?",
                    "escalation": "The proof turns suspicion into confrontation.",
                    "escalationEvidence": [{"beatId": "beat-1-1"}],
                    "turnBeatId": "beat-1-1",
                }
            ],
            heroJourney={
                "applies": False,
                "protagonistName": None,
                "rationale": (
                    "The fixture is a partial ensemble episode rather than a complete monomyth."
                ),
                "stages": [],
            },
            characterArcs=[],
            sceneTurns=[
                {
                    "sceneId": "scene-1",
                    "focalCharacterName": None,
                    "dramaticFunction": "Set the pressure.",
                    "conflict": "Marta challenges Dan's secrecy.",
                    "stakes": "Their partnership is at risk.",
                    "turnBeatId": "beat-1-1",
                    "turn": "Suspicion becomes a direct challenge.",
                }
            ],
            threadMovements=[],
        ),
        "segment_scene": SegmentedScene(
            segments=[
                {
                    "kind": "beat",
                    "startLine": 1,
                    "whatHappens": "Marta confronts Dan with the transfer record.",
                    "audienceLearns": "Marta has proof of the transfer.",
                    "audienceFeels": "Tense anticipation.",
                    # T10.1: the beat from the character's side, as names.
                    "actor": "Marta",
                    "actionVerb": "confronts",
                    "target": "Dan",
                    "reaction": "deflects to the bar's debts",
                }
            ],
            sceneValueAtStake="trust",
            sceneChargeIn="positive",
            sceneChargeOut="negative",
            sceneWhyNow="The transfer record surfaced this morning.",
        ),
        # §9.4 guided-setup scene skeleton: one diverse scene-addition set,
        # motivations referencing the fixture's own characters so tests can
        # exercise real character ids without a bespoke override.
        "generate_scene_skeleton": InitialSceneSkeleton(
            label="Cold open on the wire transfer",
            scenes=[
                {
                    "act": 1,
                    "location": "INT. THE LONG POUR - MORNING",
                    "time": "MORNING",
                    "socialSituation": "Marta corners Dan before the bar opens.",
                    "whatHappens": (
                        "Marta demands Dan explain the wire transfer before "
                        "the morning delivery arrives."
                    ),
                    "audienceLearns": "Marta has already seen the paperwork.",
                    "audienceFeels": "Coiled tension.",
                    "motivations": [
                        {
                            "characterId": "char-marta",
                            "objective": "Get Dan to admit the transfer.",
                            "stakes": "The bar's survival.",
                            "obstacle": "Dan's practiced calm.",
                        }
                    ],
                    "beatPlanSeeds": [
                        {
                            "whatHappens": "Marta slides the printout across the bar.",
                            "audienceLearns": "The transfer amount.",
                            "audienceFeels": "Dread.",
                        }
                    ],
                },
                {
                    "act": 1,
                    "location": "EXT. MARINA - DAY",
                    "time": "DAY",
                    "socialSituation": "Dan meets Reyes at the marina to explain himself.",
                    "whatHappens": "Dan tries to buy time from Reyes.",
                    "audienceLearns": "Reyes is owed the money, not a bank.",
                    "audienceFeels": "Rising dread.",
                    "motivations": [
                        {
                            "characterId": "char-dan",
                            "objective": "Delay Reyes without confessing.",
                            "stakes": "His own safety.",
                            "obstacle": "Reyes's patience is gone.",
                        }
                    ],
                    "beatPlanSeeds": [
                        {
                            "whatHappens": "Dan offers a partial payment.",
                            "audienceLearns": "Dan doesn't have the full amount.",
                            "audienceFeels": "Anxiety.",
                        }
                    ],
                },
            ],
        ),
        "scan_consistency": ConsistencyScan(
            flags=[
                {
                    "objectType": "scene",
                    "objectId": "scene-5",
                    "factId": None,
                    "explanation": (
                        "The argument's stakes reference the bar as the money's "
                        "hiding place, which is no longer true."
                    ),
                    "severity": "tension",
                }
            ]
        ),
        "infer_narrative_scene_analysis": InferredNarrativeSceneAnalysisBatch(
            scenes=[
                {
                    "sceneId": "scene-1",
                    "summary": "Marta's discovery creates immediate pressure.",
                    "focalCharacterName": "Marta",
                    "dramaticFunction": "Establish the episode's central pressure.",
                    "conflict": "Marta must decide how to confront Dan about the transfer.",
                    "stakes": "Their partnership could fracture if the transfer is exposed.",
                    "turnBeatId": "beat-1-1",
                    "turn": "Marta's private discovery becomes a problem she cannot ignore.",
                    "keyMoments": [
                        {
                            "beatId": "beat-1-1",
                            "summary": "Marta sees the unexplained transfer.",
                            "dramaticFunction": "Plant the episode's central question.",
                            "consequence": "It gives Marta a concrete reason to confront Dan.",
                        }
                    ],
                }
            ]
        ),
        "infer_narrative_map_synthesis": InferredNarrativeMapSynthesis(
            dramaticQuestion="Will Marta expose the transfer before Dan can explain it away?",
            centralConflict=(
                "Marta needs the truth while Dan tries to contain the transfer's consequences."
            ),
            controllingIdea="Pressure reveals whether loyalty protects people or protects a lie.",
            themes=[
                {
                    "label": "Loyalty under pressure",
                    "statement": "Loyalty becomes a liability when it prevents the truth.",
                    "evidence": [{"beatId": "beat-1-1"}],
                }
            ],
            acts=[
                {
                    "act": 0,
                    "dramaticQuestion": "What does Marta do with the transfer?",
                    "escalation": (
                        "The unexplained transaction gives her a concrete reason to challenge Dan."
                    ),
                    "escalationEvidence": [{"beatId": "beat-1-1"}],
                    "turnBeatId": "beat-1-1",
                }
            ],
            heroJourney={
                "applies": False,
                "protagonistName": None,
                "rationale": (
                    "This fixture is better read as an ensemble pressure story than a complete "
                    "monomyth."
                ),
                "stages": [],
            },
            characterArcs=[],
            threadMovements=[],
        ),
        "verify_narrative_map": NarrativeMapVerification(
            approved=True,
            unsupportedClaims=[],
            missingSceneIds=[],
            advisories=[],
        ),
        "check_structure": InferredStructureCheck(applies=True, rationale="Mock.", stages=[]),
        "verify_structure_check": StructureCheckVerification(stages=[]),
    }


def _source_data_value(user_message: str, kind: str):
    match = re.search(
        rf'<source_data_[^\s>]+ kind="{re.escape(kind)}">\n(.*?)\n</source_data_[^>]+>',
        user_message,
        flags=re.DOTALL,
    )
    if match is None:
        return None
    return json.loads(html.unescape(match.group(1)))


def _mock_structure_check(user_message: str) -> InferredStructureCheck:
    """Deterministic, prompt-derived answer so e2e (no set_response hook) renders
    every status: stage i is hit / thin / missing by i % 3, citing beats in order."""
    stages = _source_data_value(user_message, "required_stages")
    scenes = _source_data_value(user_message, "scene_spine")
    if not stages or scenes is None:
        raise ValueError("structure blocks missing")
    beats = [beat["beatId"] for scene in scenes for beat in scene.get("beats") or []]
    out = []
    for index, item in enumerate(stages):
        status = ("hit", "thin", "missing")[index % 3]
        beat_id = beats[index % len(beats)] if beats and status != "missing" else None
        if beat_id is None:
            status = "missing"
        out.append(
            {
                "stage": item["stage"],
                "status": status,
                "beatId": beat_id,
                "reason": f"Mock {status} for {item['label']}.",
            }
        )
    return InferredStructureCheck.model_validate(
        {"applies": True, "rationale": "Mock structure check.", "stages": out}
    )


def _mock_structure_verification(user_message: str) -> StructureCheckVerification:
    claims = _source_data_value(user_message, "claims")
    if claims is None:
        raise ValueError("claims block missing")
    return StructureCheckVerification.model_validate(
        {
            "stages": [
                {"stage": claim["stage"], "reason": "Mock supported.", "supported": True}
                for claim in claims
            ]
        }
    )


def _mock_narrative_map(user_message: str) -> InferredNarrativeMap:
    """Build a source-valid default map for arbitrary import test scripts."""
    scene_spine = _source_data_value(user_message, "scene_spine") or []
    first_by_act: dict[int, tuple[dict, dict]] = {}
    scene_turns: list[dict] = []
    first_beat: dict | None = None

    for scene in scene_spine:
        beats = scene.get("beats") or []
        if not beats:
            continue
        beat = beats[0]
        # The production map prompt carries beat-plan semantics and ids, not
        # duplicate screenplay text; merge_narrative_map validates the actual
        # source excerpt from the persisted project doc.
        if not beat.get("beatId"):
            continue
        first_beat = first_beat or beat
        first_by_act.setdefault(int(scene.get("act", 0)), (scene, beat))
        scene_turns.append(
            {
                "sceneId": scene["sceneId"],
                "focalCharacterName": None,
                "dramaticFunction": "Advance the immediate dramatic pressure.",
                "conflict": "The scene tests what each character will do next.",
                "stakes": "The episode's unresolved pressure intensifies.",
                "turnBeatId": beat["beatId"],
                "turn": str(beat.get("whatHappens") or "A new story beat changes the scene."),
            }
        )

    if first_beat is None or not scene_turns:
        # Empty input cannot produce source-grounded coverage; production import rejects it.
        return _default_responses()["infer_narrative_map"]  # pragma: no cover

    acts = []
    for act, (_scene, beat) in sorted(first_by_act.items()):
        acts.append(
            {
                "act": act,
                "dramaticQuestion": "What will the characters risk to change the situation?",
                "escalation": str(beat.get("whatHappens") or "The pressure advances."),
                "escalationEvidence": [{"beatId": beat["beatId"]}],
                "turnBeatId": beat["beatId"],
            }
        )
    return InferredNarrativeMap(
        dramaticQuestion="What choice will resolve the episode's central pressure?",
        centralConflict="The characters pursue incompatible goals under escalating pressure.",
        controllingIdea="The script tests what its characters are willing to risk.",
        themes=[
            {
                "label": "Pressure and choice",
                "statement": "Character is revealed by the choices made under pressure.",
                "evidence": [{"beatId": first_beat["beatId"]}],
            }
        ],
        acts=acts,
        heroJourney={
            "applies": False,
            "protagonistName": None,
            "rationale": "The mock does not impose a Hero's Journey on arbitrary source text.",
            "stages": [],
        },
        characterArcs=[],
        sceneTurns=scene_turns,
        threadMovements=[],
    )


def _mock_narrative_scene_analysis(user_message: str) -> InferredNarrativeSceneAnalysisBatch:
    """Produce deterministic, source-backed packets for Narrative Map tests."""
    scene_sources = _source_data_value(user_message, "narrative_scene_sources") or []
    analyses: list[dict] = []
    for scene in scene_sources:
        beats = scene.get("beats") or []
        if not beats:
            continue
        beat = beats[0]
        beat_id = beat.get("beatId")
        scene_id = scene.get("sceneId")
        script_text = str(beat.get("scriptText") or "")
        if not beat_id or not scene_id or not script_text.strip():
            continue
        semantic_summary = str(beat.get("whatHappens") or "").strip()
        # Import recovery can leave placeholder one-letter semantic fields
        # while preserving the screenplay. Prefer a semantic summary only
        # when it is publishable; otherwise heal the packet from raw source.
        summary = (
            semantic_summary if len(semantic_summary) >= 8 else _short_source_quote(script_text)
        )
        analyses.append(
            {
                "sceneId": scene_id,
                "summary": summary,
                "focalCharacterName": None,
                "dramaticFunction": "Establish the scene's immediate dramatic pressure.",
                "conflict": f"The scene's action centers on: {summary}",
                "stakes": "The immediate situation changes if the action is not resolved.",
                "turnBeatId": beat_id,
                "turn": summary,
                "keyMoments": [
                    {
                        "beatId": beat_id,
                        "summary": summary,
                        "dramaticFunction": "Advance the scene's immediate situation.",
                        "consequence": "It establishes the next pressure in the episode.",
                    }
                ],
            }
        )
    if not analyses:
        raise ValueError("narrative scene analysis requires source-backed scenes")
    return InferredNarrativeSceneAnalysisBatch.model_validate({"scenes": analyses})


def _mock_narrative_map_synthesis(user_message: str) -> InferredNarrativeMapSynthesis:
    """Keep default map-run tests grounded to packet ids instead of fixtures."""
    packets = _source_data_value(user_message, "narrative_scene_packets") or []
    first = packets[0] if packets else None
    if not first:
        raise ValueError("narrative map synthesis requires scene packets")

    first_beat_id = first["turnBeatId"]
    first_summary = first["summary"]
    acts: list[dict] = []
    seen_acts: set[int] = set()
    for packet in packets:
        act = int(packet.get("act", 0))
        if act in seen_acts:
            continue
        seen_acts.add(act)
        acts.append(
            {
                "act": act,
                "dramaticQuestion": (
                    f"How will the pressure created by {packet['summary']} develop?"
                ),
                "escalation": packet["turn"],
                "escalationEvidence": [{"beatId": packet["turnBeatId"]}],
                "turnBeatId": packet["turnBeatId"],
            }
        )
    return InferredNarrativeMapSynthesis.model_validate(
        {
            "dramaticQuestion": f"What follows from {first_summary}?",
            "centralConflict": (f"The episode's immediate pressure begins with {first_summary}."),
            "controllingIdea": (
                "The episode tests how characters respond when immediate pressure changes "
                "their choices."
            ),
            "themes": [
                {
                    "label": "Pressure and choice",
                    "statement": (
                        "The story follows how immediate pressure changes a character's choices."
                    ),
                    "evidence": [{"beatId": first_beat_id}],
                }
            ],
            "acts": acts,
            "heroJourney": {
                "applies": False,
                "protagonistName": None,
                "rationale": (
                    "The available episode material is analyzed as scene-based dramatic pressure, "
                    "not forced into a monomyth."
                ),
                "stages": [],
            },
            "characterArcs": [],
            "threadMovements": [],
        }
    )


def _short_source_quote(script_text: str) -> str:
    for line in script_text.splitlines():
        if line.strip():
            return line.strip()[:200]
    return script_text.strip()[:200]


class MockLlmClient:
    """See module docstring for the keying strategy."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._responses: dict[str, BaseModel] = _default_responses()
        # Per-op FIFO queues for multi-call scenarios (e.g. import calls
        # segment_scene / extract_ledger_facts once per scene): each call pops
        # the next queued response, falling back to the single default when the
        # queue is empty. Left empty, the mock behaves exactly as before.
        self._queues: dict[str, list[BaseModel]] = {}
        self._explicit_responses: set[str] = set()
        # Per-call raw-fragment streams for stream_beat_candidate (§8a harness):
        # each entry is the exact list of raw tool-input JSON fragments one
        # streamed call should yield, so tests can force mid-escape splits,
        # out-of-order fields, or missing scriptText. Empty → the streaming
        # method serializes the normal generate_beat_candidates response.
        # Cached-prefix payloads seen by ops that support one, so tests can
        # assert byte-stability across a run (a drifting prefix is a silent
        # 0%-cache-hit bug with no other symptom).
        self.last_cache_prefix: str | None = None
        # Keyed by op: segmentation and extraction each carry their own
        # whole-script prefix, and a shared list would conflate them.
        self.cache_prefixes_by_op: dict[str, list[str | None]] = {}
        self._candidate_streams: list[list[str]] = []
        # Same mechanism for stream_tune_beat (§8a: tune streams too). Empty →
        # the streamed value is derived from the tune_beat op response.
        self._tune_streams: list[list[str]] = []
        # Per-op invocation counters (T4.2: apply must record zero
        # `regenerate_elements` calls — the stored preview is applied verbatim).
        self._invocations: dict[str, int] = {name: 0 for name in OP_REGISTRY}
        assert self._responses.keys() == OP_REGISTRY.keys(), (
            "MockLlmClient default responses must cover every op in OP_REGISTRY"
        )

    def invocation_count(self, op: str) -> int:
        """Calls to `op` so far; `"prewarm_cache:" + op` counts its prewarms."""
        if op.removeprefix("prewarm_cache:") not in OP_REGISTRY:
            raise KeyError(f"unknown LLM operation {op!r}")
        with self._lock:
            return self._invocations.get(op, 0)

    def total_invocations(self) -> int:
        with self._lock:
            return sum(self._invocations.values())

    def reset_invocation_counts(self) -> None:
        with self._lock:
            for name in self._invocations:
                self._invocations[name] = 0

    def set_response(self, op: str, response: BaseModel) -> None:
        if op not in OP_REGISTRY:
            raise KeyError(f"unknown LLM operation {op!r}")
        with self._lock:
            self._responses[op] = response
            self._explicit_responses.add(op)

    def set_responses(self, op: str, responses: list[BaseModel]) -> None:
        """Queue a sequence of responses for ``op``, returned one per call in
        order (then falling back to the default). For pipelines that call the
        same op multiple times with different inputs."""
        if op not in OP_REGISTRY:
            raise KeyError(f"unknown LLM operation {op!r}")
        with self._lock:
            self._queues[op] = list(responses)

    def _call(self, op: str, *, system: str, user_message: str, prompt_version: str) -> BaseModel:
        del system, user_message, prompt_version  # mock never inspects prompt content
        with self._lock:
            self._invocations[op] = self._invocations.get(op, 0) + 1
            queue = self._queues.get(op)
            if queue:
                return queue.pop(0)
            return self._responses[op]

    def prewarm_cache(
        self,
        op: str,
        *,
        system: str,
        user_message: str,
        cache_prefix: str | None = None,
    ) -> None:
        """Records the prewarm under `"prewarm_cache:" + op`; makes no call."""
        del system, user_message, cache_prefix  # mock never inspects prompt content
        if op not in OP_REGISTRY:
            raise KeyError(f"unknown LLM operation {op!r}")
        key = f"prewarm_cache:{op}"
        with self._lock:
            self._invocations[key] = self._invocations.get(key, 0) + 1

    def set_candidate_streams(self, streams: list[list[str]]) -> None:
        """Queue raw-fragment streams for `stream_beat_candidate`, one list of
        fragments per streamed call, returned in order. For §8a streaming-
        contract tests (mid-escape splits, late/absent scriptText). When unset,
        the streamed value is derived from the normal generate_beat_candidates
        response (default or `set_responses` queue)."""
        self._candidate_streams = [list(frags) for frags in streams]

    def set_tune_streams(self, streams: list[list[str]]) -> None:
        """Queue raw-fragment streams for `stream_tune_beat`, one list of
        fragments per streamed call (the tune analogue of `set_candidate_streams`).
        When unset, the streamed value is derived from the `tune_beat` op response."""
        self._tune_streams = [list(frags) for frags in streams]

    def generate_beat_candidates(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BeatCandidate:
        return self._call(
            "generate_beat_candidates",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def stream_beat_candidate(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> Iterator[str]:
        if self._candidate_streams:
            yield from self._candidate_streams.pop(0)
            return
        candidate = self._call(
            "generate_beat_candidates",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )
        # Serialize the canned candidate to its camelCase wire JSON as a single
        # fragment; the caller's incremental parser handles it identically to a
        # multi-fragment stream. Distinct `set_responses` entries → distinct
        # streamed cards (diversity).
        yield candidate.model_dump_json(by_alias=True)

    def tune_beat(self, *, system: str, user_message: str, prompt_version: str) -> BeatCandidate:
        return self._call(
            "tune_beat", system=system, user_message=user_message, prompt_version=prompt_version
        )

    def stream_tune_beat(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> Iterator[str]:
        if self._tune_streams:
            yield from self._tune_streams.pop(0)
            return
        candidate = self._call(
            "tune_beat", system=system, user_message=user_message, prompt_version=prompt_version
        )
        # Serialize the canned tune result to camelCase wire JSON as one fragment;
        # the caller's incremental parser handles it identically to a multi-fragment
        # stream. `set_responses("tune_beat", [...])` → distinct streamed cards.
        yield candidate.model_dump_json(by_alias=True)

    def classify_blast_radius(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BlastRadius:
        return self._call(
            "classify_blast_radius",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def regenerate_elements(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> RegeneratedElements:
        return self._call(
            "regenerate_elements",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def extract_ledger_facts(
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> LedgerExtraction:
        # cache_prefix is accepted for protocol parity and recorded so tests can
        # assert it stays byte-identical across a run; the mock makes no calls.
        self.last_cache_prefix = cache_prefix
        self.cache_prefixes_by_op.setdefault(
            "extract_ledger_facts", []
        ).append(cache_prefix)
        return self._call(
            "extract_ledger_facts",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def suggest_instructions(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InstructionSuggestions:
        return self._call(
            "suggest_instructions",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_act_breaks(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredActBreaks:
        return self._call(
            "infer_act_breaks",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_story_entities(
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> StoryEntities:
        self.cache_prefixes_by_op.setdefault(
            "infer_story_entities", []
        ).append(cache_prefix)
        return self._call(
            "infer_story_entities",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_narrative_promises(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> NarrativePromises:
        return self._call(
            "infer_narrative_promises",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_story_overview(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredStoryOverview:
        return self._call(
            "infer_story_overview",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def infer_narrative_map(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredNarrativeMap:
        del system, prompt_version
        with self._lock:
            self._invocations["infer_narrative_map"] += 1
            queue = self._queues.get("infer_narrative_map")
            if queue:
                return queue.pop(0)
            if "infer_narrative_map" in self._explicit_responses:
                return self._responses["infer_narrative_map"]
        return _mock_narrative_map(user_message)

    def infer_narrative_scene_analysis(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredNarrativeSceneAnalysisBatch:
        del system, prompt_version
        with self._lock:
            self._invocations["infer_narrative_scene_analysis"] += 1
            queue = self._queues.get("infer_narrative_scene_analysis")
            if queue:
                return queue.pop(0)  # type: ignore[return-value]
            if "infer_narrative_scene_analysis" in self._explicit_responses:
                return self._responses["infer_narrative_scene_analysis"]  # type: ignore[return-value]
        try:
            return _mock_narrative_scene_analysis(user_message)
        except ValueError:
            # Generic protocol tests intentionally do not carry screenplay
            # source. Product-path calls still use the dynamic grounded mock.
            return _default_responses()["infer_narrative_scene_analysis"]  # type: ignore[return-value]

    def infer_narrative_map_synthesis(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredNarrativeMapSynthesis:
        del system, prompt_version
        with self._lock:
            self._invocations["infer_narrative_map_synthesis"] += 1
            queue = self._queues.get("infer_narrative_map_synthesis")
            if queue:
                return queue.pop(0)  # type: ignore[return-value]
            if "infer_narrative_map_synthesis" in self._explicit_responses:
                return self._responses["infer_narrative_map_synthesis"]  # type: ignore[return-value]
        try:
            return _mock_narrative_map_synthesis(user_message)
        except ValueError:
            return _default_responses()["infer_narrative_map_synthesis"]  # type: ignore[return-value]

    def verify_narrative_map(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> NarrativeMapVerification:
        del system, user_message, prompt_version
        with self._lock:
            self._invocations["verify_narrative_map"] += 1
            queue = self._queues.get("verify_narrative_map")
            if queue:
                return queue.pop(0)  # type: ignore[return-value]
            if "verify_narrative_map" in self._explicit_responses:
                return self._responses["verify_narrative_map"]  # type: ignore[return-value]
        return NarrativeMapVerification(
            approved=True,
            unsupportedClaims=[],
            missingSceneIds=[],
            advisories=[],
        )

    def check_structure(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredStructureCheck:
        del system, prompt_version
        with self._lock:
            self._invocations["check_structure"] += 1
            queue = self._queues.get("check_structure")
            if queue:
                return queue.pop(0)  # type: ignore[return-value]
            if "check_structure" in self._explicit_responses:
                return self._responses["check_structure"]  # type: ignore[return-value]
        try:
            return _mock_structure_check(user_message)
        except ValueError:
            # Generic protocol tests send no structure blocks.
            return _default_responses()["check_structure"]  # type: ignore[return-value]

    def verify_structure_check(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> StructureCheckVerification:
        del system, prompt_version
        with self._lock:
            self._invocations["verify_structure_check"] += 1
            queue = self._queues.get("verify_structure_check")
            if queue:
                return queue.pop(0)  # type: ignore[return-value]
            if "verify_structure_check" in self._explicit_responses:
                return self._responses["verify_structure_check"]  # type: ignore[return-value]
        try:
            return _mock_structure_verification(user_message)
        except ValueError:
            # Generic protocol tests send no structure blocks.
            return _default_responses()["verify_structure_check"]  # type: ignore[return-value]

    def segment_scene(
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> SegmentedScene:
        self.last_cache_prefix = cache_prefix
        self.cache_prefixes_by_op.setdefault("segment_scene", []).append(
            cache_prefix
        )
        return self._call(
            "segment_scene", system=system, user_message=user_message, prompt_version=prompt_version
        )

    def scan_consistency(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> ConsistencyScan:
        return self._call(
            "scan_consistency",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def generate_scene_skeleton(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InitialSceneSkeleton:
        return self._call(
            "generate_scene_skeleton",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )
