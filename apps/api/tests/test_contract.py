"""Fixture-validation tests for the Pydantic mirror (data contract sec 5 / task T0.2).

Must validate the real committed fixture file (docs/tableread-fixture.json,
"The Long Pour"), not a hand-rolled subset.
"""

import json
from pathlib import Path

from schemas import PersistedState

FIXTURE_PATH = Path(__file__).resolve().parents[3] / "docs" / "tableread-fixture.json"


def _load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


def test_fixture_validates_against_pydantic_contract():
    fixture = _load_fixture()
    # Raises pydantic.ValidationError on failure; pytest reports it as a
    # legible test failure with the full error list.
    PersistedState.model_validate(fixture)
