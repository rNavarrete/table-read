"""Guided-setup scene-skeleton generation (drama_manager/scene_skeleton.py) —
new-project-flow design spec §6/§9.4. All against `MockLlmClient` (hard rule
1).
"""

from __future__ import annotations

import copy

import pytest

from drama_manager import scene_skeleton
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from schemas import InitialSceneSkeleton
from storage.seed import load_fixture


def _doc() -> dict:
    return copy.deepcopy(load_fixture()["project"])


def _skeleton(label: str, character_id: str = "char-marta") -> InitialSceneSkeleton:
    return InitialSceneSkeleton(
        label=label,
        scenes=[
            {
                "act": 1,
                "location": "INT. THE LONG POUR - MORNING",
                "time": "MORNING",
                "socialSituation": "Marta corners Dan before the bar opens.",
                "whatHappens": f"{label}: Marta confronts Dan.",
                "audienceLearns": "Marta has proof.",
                "audienceFeels": "Tense.",
                "motivations": [
                    {
                        "characterId": character_id,
                        "objective": "Get Dan to admit it.",
                        "stakes": "The bar.",
                        "obstacle": "Dan's calm.",
                    }
                ],
                "beatPlanSeeds": [
                    {
                        "whatHappens": "Marta slides the printout across the bar.",
                        "audienceLearns": "The amount.",
                        "audienceFeels": "Dread.",
                    }
                ],
            }
        ],
    )


# ── the three-candidate convergent loop (product-wide convergence rule) ─────


def test_generates_exactly_three_candidates_bound_to_head_snapshot():
    mock = MockLlmClient()
    mock.set_responses(
        "generate_scene_skeleton",
        [_skeleton("Cold open A"), _skeleton("Cold open B"), _skeleton("Cold open C")],
    )
    doc = _doc()
    candidates = scene_skeleton.generate_candidates(doc, mock)

    assert len(candidates) == 3
    assert [c["label"] for c in candidates] == ["Cold open A", "Cold open B", "Cold open C"]
    for candidate in candidates:
        assert candidate["basedOnSnapshotId"] == doc["headSnapshotId"]
    # every candidate gets its own id, and every candidate is distinct
    assert len({c["candidateId"] for c in candidates}) == 3


def test_each_scene_gets_a_server_assigned_proposal_id_not_a_final_scene_id():
    mock = MockLlmClient()
    mock.set_responses(
        "generate_scene_skeleton",
        [_skeleton("A"), _skeleton("B"), _skeleton("C")],
    )
    candidates = scene_skeleton.generate_candidates(_doc(), mock)

    all_proposal_ids: set[str] = set()
    fixture_scene_ids = {
        s["id"]
        for season in load_fixture()["project"]["seasons"]
        for episode in season["episodes"]
        for s in episode["scenes"]
    }
    for candidate in candidates:
        for scene in candidate["scenes"]:
            assert "proposalId" in scene
            assert scene["proposalId"] not in fixture_scene_ids
            all_proposal_ids.add(scene["proposalId"])
    # every proposalId across all three candidates is unique
    assert len(all_proposal_ids) == 3


def test_no_scene_id_or_script_text_field_in_a_scene_addition():
    mock = MockLlmClient()
    mock.set_responses("generate_scene_skeleton", [_skeleton("A"), _skeleton("B"), _skeleton("C")])
    candidates = scene_skeleton.generate_candidates(_doc(), mock)
    for candidate in candidates:
        for scene in candidate["scenes"]:
            assert "id" not in scene
            assert "scriptText" not in scene
            assert scene["storyline"] == "A"


def test_diversity_avoid_list_carries_prior_labels_into_later_calls():
    class _Recording(MockLlmClient):
        def __init__(self) -> None:
            super().__init__()
            self.user_messages: list[str] = []

        def generate_scene_skeleton(self, *, system, user_message, prompt_version):
            self.user_messages.append(user_message)
            return super().generate_scene_skeleton(
                system=system, user_message=user_message, prompt_version=prompt_version
            )

    mock = _Recording()
    mock.set_responses(
        "generate_scene_skeleton",
        [_skeleton("Cold open A"), _skeleton("Cold open B"), _skeleton("Cold open C")],
    )
    scene_skeleton.generate_candidates(_doc(), mock)

    assert len(mock.user_messages) == 3
    assert "Cold open A" not in mock.user_messages[0]
    assert "Cold open A" in mock.user_messages[1]
    assert "Cold open A" in mock.user_messages[2] and "Cold open B" in mock.user_messages[2]


# ── unknown character id → SCHEMA_INVALID_LLM (never fabricated) ────────────


def test_unknown_character_id_in_motivation_raises_schema_invalid(caplog):
    mock = MockLlmClient()
    mock.set_response("generate_scene_skeleton", _skeleton("A", character_id="char-nope"))
    with caplog.at_level("INFO"):
        with pytest.raises(SchemaInvalidLlmError):
            scene_skeleton.generate_candidates(_doc(), mock, count=1)
    # hard rule 5: log ids only, never plan/script text
    joined = " ".join(r.message for r in caplog.records)
    assert "char-nope" in joined
    assert "Marta confronts Dan" not in joined


def test_placeholder_scene_raises_schema_invalid():
    mock = MockLlmClient()
    junk = InitialSceneSkeleton(
        label="placeholder",
        scenes=[
            {
                "act": 1,
                "location": "placeholder",
                "time": "DAY",
                "socialSituation": "",
                "whatHappens": "placeholder",
                "audienceLearns": "",
                "audienceFeels": "",
                "motivations": [],
                "beatPlanSeeds": [],
            }
        ],
    )
    mock.set_response("generate_scene_skeleton", junk)
    with pytest.raises(SchemaInvalidLlmError):
        scene_skeleton.generate_candidates(_doc(), mock, count=1)


def test_scene_without_motivations_is_unusable():
    scene = {
        "location": "INT. BAR - NIGHT",
        "whatHappens": "Something happens.",
        "motivations": [],
    }
    assert scene_skeleton.scene_proposal_is_usable(scene) is False
    assert scene_skeleton.scene_proposal_is_usable(
        {
            **scene,
            "motivations": [
                {
                    "characterId": "char-marta",
                    "objective": "x",
                    "stakes": "y",
                    "obstacle": "z",
                }
            ],
        }
    )
