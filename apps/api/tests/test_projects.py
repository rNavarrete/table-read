"""HTTP endpoint tests for project CRUD + snapshots.

T0.3 scope: GET /projects/{pid}, GET /projects/{pid}/ledger, undo root-only 409.
T1.1 scope: POST /projects, PATCH /projects/{pid}, real undo (non-root
restore), DELETE purge.
"""

from fastapi.testclient import TestClient

from main import app
from storage.models import (
    ChangeSetRow,
    ConsistencyFlagRow,
    LedgerFactRow,
    ProjectRow,
    SnapshotRow,
    SuggestionHistoryRow,
)

client = TestClient(app)

PROJECT_ID = "proj-longpour"

NEW_PROJECT_BODY = {
    "title": "Test Show",
    "format": {
        "genre": "drama",
        "runtimeMinutes": 30,
        "actCount": 3,
        "coldOpen": False,
        "tag": False,
        "serialization": 0.5,
    },
    "premise": "A test premise.",
}


def test_get_project_returns_seeded_fixture(seeded_project):
    response = client.get(f"/api/v1/projects/{PROJECT_ID}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == PROJECT_ID
    assert body["title"] == "The Long Pour"
    assert body["headSnapshotId"] == "snap-root"


def test_get_project_missing_returns_404():
    response = client.get("/api/v1/projects/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_get_ledger_returns_all_8_facts(seeded_project):
    response = client.get(f"/api/v1/projects/{PROJECT_ID}/ledger")

    assert response.status_code == 200
    facts = response.json()
    assert len(facts) == 8
    assert {f["id"] for f in facts} == {f"fact-0{i}" for i in range(1, 9)}


def test_get_ledger_filters_by_status(seeded_project):
    url = f"/api/v1/projects/{PROJECT_ID}/ledger"
    response = client.get(url, params={"status": "pending_review"})

    assert response.status_code == 200
    facts = response.json()
    assert [f["id"] for f in facts] == ["fact-06"]


def test_get_ledger_filters_by_character_id(seeded_project):
    url = f"/api/v1/projects/{PROJECT_ID}/ledger"
    response = client.get(url, params={"characterId": "char-reyes"})

    assert response.status_code == 200
    facts = response.json()
    assert {f["id"] for f in facts} == {"fact-05", "fact-06"}


def test_get_ledger_returns_deterministic_order(seeded_project):
    """Ledger order must be deterministic (by id) for consistent scene grouping."""
    url = f"/api/v1/projects/{PROJECT_ID}/ledger"
    response = client.get(url)

    assert response.status_code == 200
    facts = response.json()
    fact_ids = [f["id"] for f in facts]
    # ids are ordered lexicographically (fact-01, fact-02, ..., fact-08)
    assert fact_ids == sorted(fact_ids)


def test_undo_at_root_returns_409(seeded_project):
    response = client.post(f"/api/v1/projects/{PROJECT_ID}/undo")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VALIDATION"


def test_undo_missing_project_returns_404():
    response = client.post("/api/v1/projects/does-not-exist/undo")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


# ── POST /projects ──────────────────────────────────────────────────────────


def test_create_project_returns_project_with_root_snapshot(db_session):
    response = client.post("/api/v1/projects", json=NEW_PROJECT_BODY)

    assert response.status_code == 201
    project = response.json()
    assert project["id"].startswith("proj-")
    assert project["title"] == "Test Show"
    assert project["premise"] == "A test premise."
    assert project["format"]["runtimeMinutes"] == 30
    # headSnapshotId is never null after creation (contract §4)
    assert project["headSnapshotId"] is not None
    # minimal scaffold: empty bible collections, no seasons yet
    assert project["seasons"] == []
    assert project["seriesBible"]["characters"] == []
    assert project["enabledComponents"]  # sensible default set

    root = db_session.get(SnapshotRow, project["headSnapshotId"])
    assert root is not None
    assert root.parent_id is None
    assert root.ledger == []
    assert root.flags == []


def test_create_project_missing_field_returns_envelope_422(db_session):
    body = dict(NEW_PROJECT_BODY)
    del body["premise"]
    response = client.post("/api/v1/projects", json=body)

    assert response.status_code == 422
    # request-validation errors still speak the contract envelope (§4)
    assert response.json()["error"]["code"] == "VALIDATION"


def test_created_project_undo_at_root_returns_409(db_session):
    project = client.post("/api/v1/projects", json=NEW_PROJECT_BODY).json()
    response = client.post(f"/api/v1/projects/{project['id']}/undo")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VALIDATION"


# ── PATCH /projects/{pid} ───────────────────────────────────────────────────


def test_patch_applies_edit_and_snapshots(seeded_project, db_session):
    patch = [{"op": "replace", "path": "/title", "value": "Renamed"}]
    response = client.patch(f"/api/v1/projects/{PROJECT_ID}", json=patch)

    assert response.status_code == 200
    assert response.json()["title"] == "Renamed"

    snaps = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    assert snaps == 2  # root + this patch
    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.head_snapshot_id != "snap-root"


def test_patch_then_undo_restores_byte_identical(seeded_project):
    original = client.get(f"/api/v1/projects/{PROJECT_ID}").json()

    client.patch(
        f"/api/v1/projects/{PROJECT_ID}",
        json=[{"op": "replace", "path": "/title", "value": "X"}],
    )
    undone = client.post(f"/api/v1/projects/{PROJECT_ID}/undo")

    assert undone.status_code == 200
    assert undone.json() == original


def test_patch_invalid_document_returns_400(seeded_project):
    # runtimeMinutes must be a positive int; -5 fails Project validation
    patch = [{"op": "replace", "path": "/format/runtimeMinutes", "value": -5}]
    response = client.patch(f"/api/v1/projects/{PROJECT_ID}", json=patch)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION"


def test_patch_unsupported_op_returns_400(seeded_project):
    patch = [{"op": "move", "from": "/title", "path": "/premise"}]
    response = client.patch(f"/api/v1/projects/{PROJECT_ID}", json=patch)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION"


def test_patch_missing_project_returns_404():
    response = client.patch(
        "/api/v1/projects/nope",
        json=[{"op": "replace", "path": "/title", "value": "x"}],
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


# ── DELETE /projects/{pid} ──────────────────────────────────────────────────


def test_delete_purges_project(db_session):
    project = client.post("/api/v1/projects", json=NEW_PROJECT_BODY).json()
    pid = project["id"]

    response = client.delete(f"/api/v1/projects/{pid}")
    assert response.status_code == 204

    assert client.get(f"/api/v1/projects/{pid}").status_code == 404
    assert db_session.query(ProjectRow).filter_by(id=pid).count() == 0
    assert db_session.query(SnapshotRow).filter_by(project_id=pid).count() == 0


def test_delete_purges_all_six_tables_plus_embeddings(seeded_project, db_session):
    """T6.3 / T1.1: HTTP DELETE must clear every project-scoped row across
    all six tables plus suggestion_history embeddings (data contract §4)."""
    # Populate the tables the fixture leaves empty so purge is proven against
    # non-empty change_sets / consistency_flags / suggestion_history (embeddings).
    db_session.add(
        ChangeSetRow(id="cs-1", project_id=PROJECT_ID, doc={"id": "cs-1"}, status="draft")
    )
    db_session.add(
        ConsistencyFlagRow(
            id="flag-1",
            project_id=PROJECT_ID,
            object_type="scene",
            object_id="scene-1",
            fact_id=None,
            explanation="x",
            severity="tension",
            status="open",
            source_change="snap-root",
        )
    )
    db_session.add(
        SuggestionHistoryRow(
            id="sug-1", project_id=PROJECT_ID, text="idea", embedding=[0.1, 0.2, 0.3]
        )
    )
    db_session.commit()

    # Precondition: every table has at least one row for this project.
    assert db_session.query(ProjectRow).filter_by(id=PROJECT_ID).count() == 1
    assert db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count() >= 1
    assert db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).count() >= 1
    assert db_session.query(ChangeSetRow).filter_by(project_id=PROJECT_ID).count() == 1
    assert db_session.query(ConsistencyFlagRow).filter_by(project_id=PROJECT_ID).count() == 1
    assert db_session.query(SuggestionHistoryRow).filter_by(project_id=PROJECT_ID).count() == 1

    response = client.delete(f"/api/v1/projects/{PROJECT_ID}")
    assert response.status_code == 204

    assert client.get(f"/api/v1/projects/{PROJECT_ID}").status_code == 404
    assert db_session.query(ProjectRow).filter_by(id=PROJECT_ID).count() == 0
    for model in (
        SnapshotRow,
        LedgerFactRow,
        ChangeSetRow,
        ConsistencyFlagRow,
        SuggestionHistoryRow,
    ):
        assert db_session.query(model).filter_by(project_id=PROJECT_ID).count() == 0


def test_delete_missing_project_returns_404():
    response = client.delete("/api/v1/projects/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
