"""Consistency-flag list + dismiss (T4.4a / data contract §4).

Test plan line 27: dismiss works; flags never mutate project state.
List is `GET /projects/{pid}/consistency-flags?status=open`; dismiss is the
top-level `POST /consistency-flags/{fid}/dismiss` (versioned mutation —
flags live in snapshots; doc + ledger must stay byte-identical).
"""

from __future__ import annotations

import copy

from fastapi.testclient import TestClient

from main import app
from storage.models import ConsistencyFlagRow, ProjectRow, SnapshotRow

client = TestClient(app)

PROJECT_ID = "proj-longpour"

_OPEN_FLAG = {
    "id": "flag-scene5-tension",
    "objectType": "scene",
    "objectId": "scene-5",
    "factId": None,
    "explanation": "Scene 5 still stages the argument around the bar's finances.",
    "severity": "tension",
    "status": "open",
    "sourceChange": "snap-root",
}

_DISMISSED_FLAG = {
    **_OPEN_FLAG,
    "id": "flag-already-dismissed",
    "objectId": "scene-1",
    "status": "dismissed",
}


def _insert_flags(db_session, *flags: dict) -> None:
    """Seed live `consistency_flags` *and* the current head snapshot's
    materialized `flags` so dismiss→undo restores the pre-dismiss world
    (data contract §3: undo restores flags byte-identical from parent)."""
    project = db_session.get(ProjectRow, PROJECT_ID)
    head = db_session.get(SnapshotRow, project.head_snapshot_id)
    for flag in flags:
        db_session.add(ConsistencyFlagRow.from_wire_dict(PROJECT_ID, flag))
    head.flags = list(head.flags or []) + [copy.deepcopy(f) for f in flags]
    db_session.commit()


def test_list_open_flags_filters_by_status(seeded_project, db_session):
    _insert_flags(db_session, _OPEN_FLAG, _DISMISSED_FLAG)

    response = client.get(
        f"/api/v1/projects/{PROJECT_ID}/consistency-flags",
        params={"status": "open"},
    )

    assert response.status_code == 200
    flags = response.json()
    assert [f["id"] for f in flags] == ["flag-scene5-tension"]
    assert flags[0]["status"] == "open"
    assert flags[0]["objectId"] == "scene-5"


def test_list_flags_missing_project_returns_404():
    response = client.get(
        "/api/v1/projects/does-not-exist/consistency-flags",
        params={"status": "open"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_dismiss_sets_status_and_snapshots_without_mutating_doc(
    seeded_project, db_session
):
    _insert_flags(db_session, _OPEN_FLAG)
    project_before = db_session.get(ProjectRow, PROJECT_ID)
    doc_before = copy.deepcopy(project_before.doc)
    head_before = project_before.head_snapshot_id
    snaps_before = (
        db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    )

    response = client.post(
        f"/api/v1/consistency-flags/{_OPEN_FLAG['id']}/dismiss"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == _OPEN_FLAG["id"]
    assert body["status"] == "dismissed"
    # Response must not include writer explanation text in a way that
    # implies we rewrote it — status flip only; other fields preserved.
    assert body["objectId"] == _OPEN_FLAG["objectId"]
    assert body["severity"] == _OPEN_FLAG["severity"]

    db_session.expire_all()
    row = db_session.get(ConsistencyFlagRow, _OPEN_FLAG["id"])
    assert row is not None
    assert row.status == "dismissed"

    project_after = db_session.get(ProjectRow, PROJECT_ID)
    # headSnapshotId is stamped by mutate; every other project field must be
    # byte-identical — flags never mutate narrative project state.
    assert project_after.head_snapshot_id != head_before
    doc_after = copy.deepcopy(project_after.doc)
    doc_before_cmp = copy.deepcopy(doc_before)
    doc_after.pop("headSnapshotId")
    doc_before_cmp.pop("headSnapshotId")
    assert doc_after == doc_before_cmp
    assert (
        db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
        == snaps_before + 1
    )

    new_snap = db_session.get(SnapshotRow, project_after.head_snapshot_id)
    assert new_snap is not None
    assert new_snap.parent_id == head_before
    snap_doc = copy.deepcopy(new_snap.doc)
    snap_doc.pop("headSnapshotId")
    assert snap_doc == doc_before_cmp
    dismissed = next(f for f in new_snap.flags if f["id"] == _OPEN_FLAG["id"])
    assert dismissed["status"] == "dismissed"


def test_dismiss_then_list_open_excludes_flag(seeded_project, db_session):
    _insert_flags(db_session, _OPEN_FLAG)

    assert (
        client.post(
            f"/api/v1/consistency-flags/{_OPEN_FLAG['id']}/dismiss"
        ).status_code
        == 200
    )

    open_flags = client.get(
        f"/api/v1/projects/{PROJECT_ID}/consistency-flags",
        params={"status": "open"},
    ).json()
    assert open_flags == []


def test_dismiss_missing_flag_returns_404(seeded_project):
    response = client.post("/api/v1/consistency-flags/flag-missing/dismiss")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_dismiss_already_dismissed_returns_409(seeded_project, db_session):
    _insert_flags(db_session, _DISMISSED_FLAG)
    snaps_before = (
        db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    )

    response = client.post(
        f"/api/v1/consistency-flags/{_DISMISSED_FLAG['id']}/dismiss"
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VALIDATION"
    assert (
        db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
        == snaps_before
    )


def test_dismiss_undo_restores_open_flag(seeded_project, db_session):
    _insert_flags(db_session, _OPEN_FLAG)

    assert (
        client.post(
            f"/api/v1/consistency-flags/{_OPEN_FLAG['id']}/dismiss"
        ).status_code
        == 200
    )
    assert (
        client.post(f"/api/v1/projects/{PROJECT_ID}/undo").status_code == 200
    )

    db_session.expire_all()
    row = db_session.get(ConsistencyFlagRow, _OPEN_FLAG["id"])
    assert row is not None
    assert row.status == "open"

    open_flags = client.get(
        f"/api/v1/projects/{PROJECT_ID}/consistency-flags",
        params={"status": "open"},
    ).json()
    assert [f["id"] for f in open_flags] == ["flag-scene5-tension"]
