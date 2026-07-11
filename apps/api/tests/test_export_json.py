"""JSON export of the persisted-state envelope (adoption A6).

`GET /projects/{pid}/export.json` returns the fixture shape; round-trip
through purge + `seed_envelope` restores project doc and ledger byte-identical.
"""

from __future__ import annotations

import copy

from fastapi.testclient import TestClient

from main import app
from schemas import PersistedState
from storage import snapshots
from storage.models import LedgerFactRow, ProjectRow
from storage.seed import seed_envelope

client = TestClient(app)

PROJECT_ID = "proj-longpour"


def test_export_json_returns_persisted_state_envelope(seeded_project, db_session):
    resp = client.get(f"/api/v1/projects/{PROJECT_ID}/export.json")
    assert resp.status_code == 200
    body = resp.json()
    PersistedState.model_validate(body)
    assert body["project"]["id"] == PROJECT_ID
    assert body["project"]["title"] == "The Long Pour"
    assert len(body["ledger"]) >= 1
    assert len(body["snapshots"]) >= 1
    assert "consistencyFlags" in body
    assert "changeSets" in body
    assert "suggestionHistory" in body


def test_export_json_missing_project_returns_404():
    resp = client.get("/api/v1/projects/nope/export.json")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_export_json_round_trip_purge_reseed_restores_doc_and_ledger(
    seeded_project, db_session
):
    exported = client.get(f"/api/v1/projects/{PROJECT_ID}/export.json").json()
    before_doc = copy.deepcopy(exported["project"])
    before_ledger = copy.deepcopy(exported["ledger"])

    snapshots.purge_project(db_session, PROJECT_ID)
    assert db_session.get(ProjectRow, PROJECT_ID) is None
    assert (
        db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count()
        == 0
    )

    seed_envelope(db_session, exported)

    restored = client.get(f"/api/v1/projects/{PROJECT_ID}/export.json").json()
    assert restored["project"] == before_doc
    assert restored["ledger"] == before_ledger
