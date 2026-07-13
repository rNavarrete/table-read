"""Fixture-validation tests for the Pydantic mirror (data contract sec 5 / task T0.2).

Must validate the real committed fixture file (docs/tableread-fixture.json,
"The Long Pour"), not a hand-rolled subset.
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from schemas import PersistedState, ProjectSummary

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


def test_inferred_act_breaks_contract():
    from schemas import InferredActBreaks

    value = InferredActBreaks.model_validate(
        {"starts": [{"act": 1, "startSceneIndex": 0}]}
    )
    assert value.starts[0].act == 1
    assert value.starts[0].start_scene_index == 0
    with pytest.raises(ValidationError):
        InferredActBreaks.model_validate({"starts": []})
