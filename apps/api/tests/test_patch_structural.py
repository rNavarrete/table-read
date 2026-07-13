"""Structural-PATCH consistency scan — the polymorphic PATCH response (data
contract §4; test plan line 19). A patch touching a structural plan field
(scene `whatHappens`, `premise`, storyline summaries) triggers
`scan_consistency` and returns `{project, consistencyFlags}`; every other edit
returns the bare `Project` and never touches the model. Both snapshot.

MockLlmClient is injected by overriding the PATCH route's lazy provider
`get_llm_client_provider` (hard rule 1).
"""

from __future__ import annotations

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client_provider
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from main import app
from schemas import ConsistencyScan
from storage.models import SnapshotRow

client = TestClient(app)

PROJECT_ID = "proj-longpour"
SCENE_3_WHATHAPPENS = "/seasons/0/episodes/0/scenes/2/whatHappens"
SCENE_3_LOCATION = "/seasons/0/episodes/0/scenes/2/location"
SCENE_3_ACT = "/seasons/0/episodes/0/scenes/2/act"


def scan(flags=None) -> ConsistencyScan:
    return ConsistencyScan.model_validate({"flags": flags or []})


def _flag(object_id: str, object_type: str = "scene") -> dict:
    return {
        "objectType": object_type,
        "objectId": object_id,
        "factId": None,
        "explanation": "The stakes reference the bar, no longer true.",
        "severity": "tension",
    }


@pytest.fixture()
def mock_llm():
    """Inject a MockLlmClient as the PATCH route's LLM provider."""
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client_provider] = lambda: (lambda: llm)
    yield llm
    app.dependency_overrides.pop(get_llm_client_provider, None)


def _snaps(db_session) -> int:
    return db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()


def _patch(patch: list):
    return client.patch(f"/api/v1/projects/{PROJECT_ID}", json=patch)


# ── structural PATCH: scans, returns flags, snapshots ─────────────────────────


def test_structural_whathappens_edit_returns_project_and_flags(
    seeded_project, db_session, mock_llm
):
    mock_llm.set_response("scan_consistency", scan([_flag("scene-5")]))
    before = _snaps(db_session)

    resp = _patch([{"op": "replace", "path": SCENE_3_WHATHAPPENS, "value": "A new summary."}])

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"project", "consistencyFlags"}
    assert body["project"]["seasons"][0]["episodes"][0]["scenes"][2]["whatHappens"] == (
        "A new summary."
    )
    # the untouched, unlocked flag survives, persisted `open` with a sourceChange
    flags = body["consistencyFlags"]
    assert [f["objectId"] for f in flags] == ["scene-5"]
    assert flags[0]["status"] == "open"
    assert flags[0]["sourceChange"] == body["project"]["headSnapshotId"]
    assert _snaps(db_session) == before + 1  # exactly one snapshot


def test_structural_scan_drops_a_flag_on_the_edited_scene(seeded_project, mock_llm):
    # A flag referencing the scene we just edited is not "untouched" → dropped
    # (test plan line 27), so the edit can't flag itself.
    mock_llm.set_response("scan_consistency", scan([_flag("scene-3"), _flag("scene-5")]))
    body = _patch(
        [{"op": "replace", "path": SCENE_3_WHATHAPPENS, "value": "Another summary."}]
    ).json()
    assert [f["objectId"] for f in body["consistencyFlags"]] == ["scene-5"]


def test_premise_edit_is_structural(seeded_project, mock_llm):
    mock_llm.set_response("scan_consistency", scan([_flag("scene-2")]))
    resp = _patch([{"op": "replace", "path": "/premise", "value": "A new premise."}])
    assert resp.status_code == 200
    assert set(resp.json()) == {"project", "consistencyFlags"}


# ── non-structural PATCH: silent (no scan, bare Project) ──────────────────────


def test_location_edit_is_silent_bare_project(seeded_project, db_session, mock_llm):
    before = _snaps(db_session)
    resp = _patch([{"op": "replace", "path": SCENE_3_LOCATION, "value": "INT. MARINA - DAY"}])

    assert resp.status_code == 200
    body = resp.json()
    # bare Project (no consistencyFlags wrapper) — the flagging promise only
    # attaches to structural fields (§4).
    assert "consistencyFlags" not in body
    assert body["id"] == PROJECT_ID
    assert body["seasons"][0]["episodes"][0]["scenes"][2]["location"] == "INT. MARINA - DAY"
    assert _snaps(db_session) == before + 1  # still snapshots


def test_non_structural_edit_never_calls_the_model(seeded_project):
    # No provider override here: a non-structural PATCH must not resolve the LLM
    # at all (so a title rename can't 503 on an unconfigured client). If it did
    # resolve, the keyless/flagless test env would raise 503.
    resp = _patch([{"op": "replace", "path": "/title", "value": "Renamed"}])
    assert resp.status_code == 200
    assert resp.json()["title"] == "Renamed"


def test_act_edit_is_silent_snapshotted_and_never_calls_model(
    seeded_project, db_session
):
    before = _snaps(db_session)
    resp = _patch([{"op": "replace", "path": SCENE_3_ACT, "value": 2}])

    assert resp.status_code == 200
    assert "consistencyFlags" not in resp.json()
    assert resp.json()["seasons"][0]["episodes"][0]["scenes"][2]["act"] == 2
    assert _snaps(db_session) == before + 1


# ── atomicity: a scan LLM failure persists nothing (T2.2 precedent, rule 9) ───


def test_structural_scan_schema_invalid_is_atomic(seeded_project, db_session, mock_llm):
    before_doc = client.get(f"/api/v1/projects/{PROJECT_ID}").json()
    before_snaps = _snaps(db_session)

    def _boom(**_kw):
        raise SchemaInvalidLlmError("scan failed validation after retry")

    mock_llm.scan_consistency = _boom
    resp = _patch([{"op": "replace", "path": SCENE_3_WHATHAPPENS, "value": "Doomed edit."}])

    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "SCHEMA_INVALID_LLM"
    # nothing persisted: doc identical, no new snapshot
    assert client.get(f"/api/v1/projects/{PROJECT_ID}").json() == before_doc
    assert _snaps(db_session) == before_snaps


def test_structural_scan_transport_error_maps_to_503(seeded_project, mock_llm):
    def _boom(**_kw):
        raise anthropic.APIConnectionError(request=httpx.Request("POST", "https://api"))

    mock_llm.scan_consistency = _boom
    resp = _patch([{"op": "replace", "path": SCENE_3_WHATHAPPENS, "value": "Doomed edit."}])
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "LLM_UNAVAILABLE"
