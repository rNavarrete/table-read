"""HTTP endpoint tests for project CRUD + snapshots.

T0.3 scope: GET /projects/{pid}, GET /projects/{pid}/ledger, undo root-only 409.
T1.1 scope: POST /projects, PATCH /projects/{pid}, real undo (non-root
restore), DELETE purge.
"""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

import routes
from llm.dependency import get_llm_client
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
MINIMAL_SERIES_BIBLE = {
    "existentialQuestion": {"text": "", "locked": False},
    "worldRules": [],
    "storiesToAvoid": [],
    "characters": [],
    "relationships": [],
    "audienceGoals": [],
    "narratorGoals": [],
    "worldQA": [],
}

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
NEW_PROJECT_HEADERS = {"Idempotency-Key": "00000000-0000-4000-8000-000000000001"}


def _clear_project_tables(db_session):
    for model in (
        SnapshotRow,
        LedgerFactRow,
        ChangeSetRow,
        ConsistencyFlagRow,
        SuggestionHistoryRow,
        ProjectRow,
    ):
        db_session.query(model).delete()
    db_session.commit()


def _parse_rfc3339_z(value: str) -> datetime:
    assert value.endswith("Z")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_list_projects_empty_db_returns_empty_array(db_session):
    _clear_project_tables(db_session)

    response = client.get("/api/v1/projects")

    assert response.status_code == 200
    assert response.json() == []


def test_list_projects_returns_seeded_summary_without_full_doc(seeded_project):
    response = client.get("/api/v1/projects")

    assert response.status_code == 200
    summaries = response.json()
    long_pour = next(item for item in summaries if item["id"] == PROJECT_ID)
    assert long_pour["title"] == "The Long Pour"
    assert long_pour["format"]["genre"] == "drama"
    assert long_pour["setupState"] == "ready"
    assert long_pour["pendingReviewCount"] == 1
    assert _parse_rfc3339_z(long_pour["updatedAt"]).tzinfo == UTC
    assert "premise" not in long_pour
    assert "seasons" not in long_pour


def test_list_projects_sorts_by_updated_at_desc(db_session, seeded_project):
    created = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers=NEW_PROJECT_HEADERS,
    ).json()
    db_session.get(ProjectRow, PROJECT_ID).updated_at = datetime(2026, 7, 10, 12, 0, 0)
    db_session.get(ProjectRow, created["id"]).updated_at = datetime(
        2026, 7, 10, 12, 0, 0
    ) + timedelta(minutes=5)
    db_session.commit()

    response = client.get("/api/v1/projects")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()[:2]] == [created["id"], PROJECT_ID]
    assert response.json()[0]["setupState"] == "incomplete"


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
    response = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers=NEW_PROJECT_HEADERS,
    )

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


def test_create_project_foundation_assigns_character_ids_and_snapshots(db_session):
    body = {
        **NEW_PROJECT_BODY,
        "foundation": {
            "existentialQuestion": "Can loyalty survive ambition?",
            "storiesToAvoid": ["Secret twin reveal"],
            "characters": [
                {"name": "Marta", "traits": "guarded, precise"},
                {"name": "Dane"},
            ],
        },
    }

    response = client.post(
        "/api/v1/projects",
        json=body,
        headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000002"},
    )

    assert response.status_code == 201
    project = response.json()
    bible = project["seriesBible"]
    assert bible["existentialQuestion"] == {
        "text": "Can loyalty survive ambition?",
        "locked": False,
    }
    assert bible["storiesToAvoid"] == ["Secret twin reveal"]
    assert [character["name"] for character in bible["characters"]] == ["Marta", "Dane"]
    assert [character["traits"] for character in bible["characters"]] == [
        "guarded, precise",
        "",
    ]
    for character in bible["characters"]:
        assert character["id"].startswith("char-")
        assert character["locked"] is False
        assert character["embodiment"] == ""
        assert character["presentation"] == ""
        assert character["hiding"] == ""
        assert character["seriesArc"] == ""

    root = db_session.get(SnapshotRow, project["headSnapshotId"])
    assert root.doc["seriesBible"] == bible


def test_create_project_does_not_resolve_llm_dependency(db_session):
    def fail_if_called():
        raise AssertionError("create project must not touch LLM")

    app.dependency_overrides[get_llm_client] = fail_if_called
    try:
        response = client.post(
            "/api/v1/projects",
            json=NEW_PROJECT_BODY,
            headers={"Idempotency-Key": "00000000-0000-4000-8000-000000000003"},
        )
    finally:
        app.dependency_overrides.pop(get_llm_client, None)

    assert response.status_code == 201


def test_create_project_idempotency_replays_same_request(db_session):
    _clear_project_tables(db_session)
    headers = {"Idempotency-Key": "00000000-0000-4000-8000-000000000004"}

    first = client.post("/api/v1/projects", json=NEW_PROJECT_BODY, headers=headers)
    second = client.post("/api/v1/projects", json=NEW_PROJECT_BODY, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json() == first.json()
    assert db_session.query(ProjectRow).count() == 1
    assert db_session.query(SnapshotRow).count() == 1


def test_create_project_idempotency_conflicts_on_different_request(db_session):
    _clear_project_tables(db_session)
    headers = {"Idempotency-Key": "00000000-0000-4000-8000-000000000005"}
    first = client.post("/api/v1/projects", json=NEW_PROJECT_BODY, headers=headers)
    changed_body = {**NEW_PROJECT_BODY, "title": "Different Show"}

    conflict = client.post("/api/v1/projects", json=changed_body, headers=headers)

    assert first.status_code == 201
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert db_session.query(ProjectRow).count() == 1


def test_create_project_idempotency_replays_after_unique_race(db_session, monkeypatch):
    _clear_project_tables(db_session)
    headers = {"Idempotency-Key": "00000000-0000-4000-8000-000000000006"}
    raced_doc = {
        "id": "proj-raced",
        "title": "Test Show",
        "format": NEW_PROJECT_BODY["format"],
        "enabledComponents": ["continuity_ledger"],
        "premise": "A test premise.",
        "seriesBible": MINIMAL_SERIES_BIBLE,
        "seasons": [],
        "headSnapshotId": "snap-raced",
    }

    def race_then_integrity_error(
        session,
        doc,
        instruction,
        *,
        creation_idempotency_key=None,
        creation_request_hash=None,
    ):
        session.add(
            ProjectRow(
                id=raced_doc["id"],
                doc=raced_doc,
                head_snapshot_id=raced_doc["headSnapshotId"],
                creation_idempotency_key=creation_idempotency_key,
                creation_request_hash=creation_request_hash,
            )
        )
        session.add(
            SnapshotRow(
                id=raced_doc["headSnapshotId"],
                project_id=raced_doc["id"],
                parent_id=None,
                instruction=instruction,
                doc=raced_doc,
                ledger=[],
                flags=[],
                ts="2026-07-10T00:00:00Z",
            )
        )
        session.commit()
        raise IntegrityError("unique race", params=None, orig=Exception("unique"))

    monkeypatch.setattr(routes.snapshots, "create_project", race_then_integrity_error)

    response = client.post("/api/v1/projects", json=NEW_PROJECT_BODY, headers=headers)

    assert response.status_code == 201
    assert response.json() == raced_doc
    assert db_session.query(ProjectRow).count() == 1
    assert db_session.query(SnapshotRow).count() == 1


def test_create_project_idempotency_conflicts_after_unique_race(db_session, monkeypatch):
    _clear_project_tables(db_session)
    headers = {"Idempotency-Key": "00000000-0000-4000-8000-000000000007"}
    raced_doc = {
        "id": "proj-raced-conflict",
        "title": "Different Show",
        "format": NEW_PROJECT_BODY["format"],
        "enabledComponents": ["continuity_ledger"],
        "premise": "A different premise.",
        "seriesBible": MINIMAL_SERIES_BIBLE,
        "seasons": [],
        "headSnapshotId": "snap-raced-conflict",
    }

    def race_then_integrity_error(
        session,
        doc,
        instruction,
        *,
        creation_idempotency_key=None,
        creation_request_hash=None,
    ):
        session.add(
            ProjectRow(
                id=raced_doc["id"],
                doc=raced_doc,
                head_snapshot_id=raced_doc["headSnapshotId"],
                creation_idempotency_key=creation_idempotency_key,
                creation_request_hash="different-request-hash",
            )
        )
        session.add(
            SnapshotRow(
                id=raced_doc["headSnapshotId"],
                project_id=raced_doc["id"],
                parent_id=None,
                instruction=instruction,
                doc=raced_doc,
                ledger=[],
                flags=[],
                ts="2026-07-10T00:00:00Z",
            )
        )
        session.commit()
        raise IntegrityError("unique race", params=None, orig=Exception("unique"))

    monkeypatch.setattr(routes.snapshots, "create_project", race_then_integrity_error)

    response = client.post("/api/v1/projects", json=NEW_PROJECT_BODY, headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert db_session.query(ProjectRow).count() == 1
    assert db_session.query(SnapshotRow).count() == 1


def test_create_project_missing_field_returns_envelope_422(db_session):
    body = dict(NEW_PROJECT_BODY)
    del body["premise"]
    response = client.post("/api/v1/projects", json=body, headers=NEW_PROJECT_HEADERS)

    assert response.status_code == 422
    # request-validation errors still speak the contract envelope (§4)
    assert response.json()["error"]["code"] == "VALIDATION"


def test_created_project_undo_at_root_returns_409(db_session):
    project = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers=NEW_PROJECT_HEADERS,
    ).json()
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


def test_patch_stale_if_match_returns_409_conflict_stale_head(seeded_project, db_session):
    """If-Match with a non-current headSnapshotId → CONFLICT_STALE_HEAD, no write."""
    before = client.get(f"/api/v1/projects/{PROJECT_ID}").json()
    before_snaps = (
        db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    )

    response = client.patch(
        f"/api/v1/projects/{PROJECT_ID}",
        json=[{"op": "replace", "path": "/title", "value": "Stale write"}],
        headers={"If-Match": "snap-not-the-head"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CONFLICT_STALE_HEAD"
    assert client.get(f"/api/v1/projects/{PROJECT_ID}").json() == before
    assert (
        db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
        == before_snaps
    )


def test_patch_matching_if_match_succeeds(seeded_project):
    head = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["headSnapshotId"]
    response = client.patch(
        f"/api/v1/projects/{PROJECT_ID}",
        json=[{"op": "replace", "path": "/title", "value": "Matched"}],
        headers={"If-Match": head},
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Matched"


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
    project = client.post(
        "/api/v1/projects",
        json=NEW_PROJECT_BODY,
        headers=NEW_PROJECT_HEADERS,
    ).json()
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
