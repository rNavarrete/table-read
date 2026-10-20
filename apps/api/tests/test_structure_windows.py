"""T10.5 structure windows: server-derived position, window and placement."""

from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from drama_manager import render
from drama_manager.structure_checks import beat_positions, place_stages
from drama_manager.structure_stages import STAGE_DEFINITIONS, STAGE_WINDOWS, STRUCTURE_STAGES
from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from schemas import InferredStructureCheck, StructureCheckVerification
from storage.models import ProjectRow

client = TestClient(app)
PID = "proj-longpour"
TP = [stage for stage, _ in STRUCTURE_STAGES["turning_points"]]


def test_window_constants_are_pinned():
    """Mirrored in apps/web/src/ledger/structure/stages.ts (pinned there too)."""
    assert STAGE_WINDOWS == {
        "turning_points": {
            "tp_opportunity": (11, 7),
            "tp_change_of_plans": (32, 11),
            "tp_point_of_no_return": (51, 12),
            "tp_major_setback": (74, 8),
            "tp_climax": (89, 5),
        },
        "save_the_cat": {
            "catalyst": (10.9, 8),
            "break_into_two": (22.7, 8),
            "midpoint": (50, 8),
            "all_is_lost": (68.2, 8),
            "break_into_three": (77.3, 8),
        },
    }
    assert TP == [
        "tp_opportunity",
        "tp_change_of_plans",
        "tp_point_of_no_return",
        "tp_major_setback",
        "tp_climax",
    ]


def test_positions_are_beat_midpoints_in_the_writers_order():
    """Scenes by (act, index), beats by index; plan-only beats take no length."""
    episode = {
        "scenes": [
            {
                "id": "scene-b",
                "act": 1,
                "index": 1,
                "beats": [
                    {"id": "beat-b-2", "index": 1, "scriptText": "x" * 40},
                    {"id": "beat-b-1", "index": 0, "scriptText": "x" * 20},
                ],
            },
            {
                "id": "scene-a",
                "act": 1,
                "index": 0,
                "beats": [
                    {"id": "beat-a-1", "index": 0, "scriptText": "x" * 30},
                    {"id": "beat-a-2", "index": 1},
                ],
            },
            {
                "id": "scene-c",
                "act": 0,
                "index": 9,
                "beats": [{"id": "beat-c-1", "index": 0, "scriptText": "x" * 10}],
            },
        ]
    }
    # Order: c-1 (10), a-1 (30), a-2 (0), b-1 (20), b-2 (40); total 100.
    assert beat_positions(episode) == {
        "beat-c-1": 5.0,
        "beat-a-1": 25.0,
        "beat-a-2": 40.0,
        "beat-b-1": 50.0,
        "beat-b-2": 80.0,
    }
    assert beat_positions({"scenes": [{"id": "s", "beats": [{"id": "b"}]}]}) == {}


def _stage(stage: str, status: str = "hit", beat: str | None = None) -> dict:
    return {"stage": stage, "status": status, "beatId": beat if status != "missing" else None}


def _placed(lens: str, stages: list[dict], positions: dict[str, float]) -> dict[str, tuple]:
    return {
        s["stage"]: (s["positionPct"], s["expectedPct"], s["windowPct"], s["placement"])
        for s in place_stages(lens, stages, positions)
    }


def test_turning_points_in_window_early_late_and_inclusive_edges():
    positions = {"b1": 4.0, "b2": 44.0, "b3": 39.0, "b4": 66.0, "b5": 84.0}
    got = _placed(
        "turning_points",
        [_stage(s, "hit" if i % 2 else "thin", f"b{i + 1}") for i, s in enumerate(TP)],
        positions,
    )
    assert got["tp_opportunity"] == (4.0, 11, 7, "in_window")  # 11 - 7, inclusive
    assert got["tp_change_of_plans"] == (44.0, 32, 11, "late")
    assert got["tp_point_of_no_return"][3] == "out_of_order"  # before the change of plans
    assert got["tp_major_setback"] == (66.0, 74, 8, "in_window")
    assert got["tp_climax"] == (84.0, 89, 5, "in_window")


def test_out_of_order_beats_the_window_and_compares_with_every_earlier_placed_stage():
    positions = {"b1": 12.0, "b2": 60.0, "b3": 50.0, "b4": 55.0, "b5": 3.0}
    stages = [_stage(s, beat=f"b{i + 1}") for i, s in enumerate(TP)]
    got = _placed("turning_points", stages, positions)
    assert [got[s][3] for s in TP] == [
        "in_window",
        "late",
        "out_of_order",
        "out_of_order",
        "out_of_order",
    ]
    # b3 at 50 would be in window (51 ± 12); order wins.


def test_missing_and_unverified_stages_are_not_placed_and_not_compared():
    positions = {"b1": 40.0, "b2": 30.0}
    stages = [
        _stage("tp_opportunity", "unverified", "b1"),
        _stage("tp_change_of_plans", "hit", "b2"),
        _stage("tp_point_of_no_return", "missing"),
    ]
    got = _placed("turning_points", stages, positions)
    # Unverified keeps its position, gets no placement, and does not make
    # the later change of plans out of order.
    assert got["tp_opportunity"] == (40.0, 11, 7, None)
    assert got["tp_change_of_plans"] == (30.0, 32, 11, "in_window")
    assert got["tp_point_of_no_return"] == (None, 51, 12, None)


def test_functional_lenses_and_save_the_cats_other_beats_are_unplaced():
    positions = {"b1": 90.0, "b2": 10.0}
    circle = _placed(
        "story_circle",
        [_stage("circle_you", beat="b1"), _stage("circle_need", beat="b2")],
        positions,
    )
    assert circle == {
        "circle_you": (90.0, None, None, None),
        "circle_need": (10.0, None, None, None),
    }
    hj = _placed("heros_journey", [_stage("ordinary_world", beat="b1")], positions)
    assert hj["ordinary_world"] == (90.0, None, None, None)
    stc = _placed(
        "save_the_cat",
        [_stage("debate", beat="b1"), _stage("catalyst", beat="b2")],
        positions,
    )
    # An unplaced beat neither gets a placement nor puts a placed one out of order.
    assert stc == {"debate": (90.0, None, None, None), "catalyst": (10.0, 10.9, 8, "in_window")}


def test_no_script_text_means_no_position_or_placement():
    got = _placed("turning_points", [_stage("tp_opportunity", beat="b1")], {})
    assert got["tp_opportunity"] == (None, 11, 7, None)


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def test_a_turning_points_check_saves_placed_stages(
    seeded_project, db_session, mock_llm, monkeypatch
):
    seen: dict = {}
    real = render.build_structure_verification_prompt

    def spy(project, lens, claims, nonce):
        seen["claims"] = claims
        return real(project, lens, claims, nonce)

    monkeypatch.setattr(render, "build_structure_verification_prompt", spy)
    cited = {"tp_opportunity": "beat-1-1", "tp_change_of_plans": "beat-2-1"}
    mock_llm.set_response(
        "check_structure",
        InferredStructureCheck.model_validate(
            {
                "applies": True,
                "rationale": "Marta's story.",
                "stages": [
                    {
                        "stage": s,
                        "status": "hit" if s in cited else "missing",
                        "beatId": cited.get(s),
                        "reason": "r",
                    }
                    for s in TP
                ],
            }
        ),
    )
    mock_llm.set_response(
        "verify_structure_check",
        StructureCheckVerification.model_validate(
            {"stages": [{"stage": s, "reason": "ok", "supported": True} for s in cited]}
        ),
    )
    res = client.post(f"/api/v1/projects/{PID}/structure-checks/turning_points", json={})
    assert res.status_code == 200
    (check,) = res.json()["seasons"][0]["episodes"][0]["structureChecks"]
    assert [s["stage"] for s in check["stages"]] == TP
    db_session.expire_all()
    episode = copy.deepcopy(db_session.get(ProjectRow, PID).doc)["seasons"][0]["episodes"][0]
    positions = beat_positions(episode)
    by = {s["stage"]: s for s in check["stages"]}
    opp = by["tp_opportunity"]
    assert opp["positionPct"] == positions["beat-1-1"]
    assert (opp["expectedPct"], opp["windowPct"]) == (11, 7) and opp["placement"]
    assert by["tp_climax"]["positionPct"] is None and by["tp_climax"]["placement"] is None
    assert seen["claims"][0]["definition"] == STAGE_DEFINITIONS["tp_opportunity"]
