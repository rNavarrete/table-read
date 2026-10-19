"""Structure check prompts and the prompt-derived mock (spec 2026-10-11)."""

from __future__ import annotations

from drama_manager import render
from drama_manager.structure_stages import STRUCTURE_STAGES
from llm.mock import MockLlmClient

SPINE = {
    "storyOverview": {"logline": "L", "summary": "S", "beatSheet": []},
    "threads": [],
    "scenes": [
        {
            "sceneId": "scene-1",
            "act": 0,
            "heading": "INT. BAR - NIGHT",
            "whatHappens": "W",
            "audienceLearns": "A",
            "beats": [{"beatId": "beat-1-1", "whatHappens": "B"}],
        },
    ],
}
PROJECT = {"format": {"actCount": 4, "coldOpen": True, "tag": False}}


def test_check_prompt_carries_every_stage_and_the_spine():
    _, user = render.build_structure_check_prompt(PROJECT, "story_circle", SPINE, "n1")
    for stage, _label in STRUCTURE_STAGES["story_circle"]:
        assert f'"stage": "{stage}"' in user
    assert 'kind="scene_spine"' in user and '"beatId": "beat-1-1"' in user
    assert "structure_check_repairs" not in user


def test_retry_prompt_lists_the_problems():
    _, user = render.build_structure_check_prompt(
        PROJECT,
        "story_circle",
        SPINE,
        "n1",
        diagnostics=[{"code": "missing_stage", "stage": "circle_go"}],
    )
    assert 'kind="structure_check_repairs"' in user and "circle_go" in user


def test_only_save_the_cat_gets_the_feature_film_note():
    _, stc = render.build_structure_check_prompt(PROJECT, "save_the_cat", SPINE, "n1")
    _, hj = render.build_structure_check_prompt(PROJECT, "heros_journey", SPINE, "n1")
    assert "feature-film template" in stc and "feature-film template" not in hj


def test_mock_answers_every_required_stage_from_the_prompt():
    _, user = render.build_structure_check_prompt(PROJECT, "heros_journey", SPINE, "n1")
    result = MockLlmClient().check_structure(system="s", user_message=user, prompt_version="v")
    expected = [stage for stage, _ in STRUCTURE_STAGES["heros_journey"]]
    assert [str(s.stage) for s in result.stages] == expected
    assert {str(s.status) for s in result.stages} >= {"hit", "missing"}


def test_mock_verifier_supports_every_claim():
    claims = [
        {
            "stage": "circle_you",
            "label": "You",
            "status": "hit",
            "claim": "c",
            "beatId": "beat-1-1",
            "excerpt": "e",
        }
    ]
    _, user = render.build_structure_verification_prompt(PROJECT, "story_circle", claims, "n1")
    result = MockLlmClient().verify_structure_check(
        system="s", user_message=user, prompt_version="v"
    )
    assert [(str(v.stage), v.supported) for v in result.stages] == [("circle_you", True)]
