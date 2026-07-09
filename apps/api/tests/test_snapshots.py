"""Unit tests for the snapshot transaction helper (storage/snapshots.py).

This is the one write-path every future mutation routes through
(CLAUDE.md hard rule 4), so its atomicity and byte-identical undo are the
load-bearing guarantees. Tests run directly against the helper (not HTTP) so
the mid-transaction fault injection can hit a real internal write step.
"""

import copy
import json

import pytest

from storage import snapshots
from storage.models import (
    ChangeSetRow,
    ConsistencyFlagRow,
    LedgerFactRow,
    ProjectRow,
    SnapshotRow,
    SuggestionHistoryRow,
)

PROJECT_ID = "proj-longpour"


def _retitle(new_title: str):
    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        doc = copy.deepcopy(state.doc)
        doc["title"] = new_title
        return snapshots.MutationState(doc=doc, ledger=state.ledger, flags=state.flags)

    return mutator


def _snapshot_count(session) -> int:
    return session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()


def _ledger_wire(session):
    rows = session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).all()
    return sorted((r.to_wire_dict() for r in rows), key=lambda f: f["id"])


# ── create_project (root snapshot) ──────────────────────────────────────────


def test_create_project_creates_project_and_root_snapshot(db_session):
    doc = {
        "id": None,
        "title": "Fresh",
        "headSnapshotId": None,
        "seasons": [],
    }
    project = snapshots.create_project(db_session, doc, instruction="Project created")

    assert project.id.startswith("proj-")
    assert project.head_snapshot_id is not None
    # invariant: doc.id / doc.headSnapshotId stamped by the server
    assert project.doc["id"] == project.id
    assert project.doc["headSnapshotId"] == project.head_snapshot_id

    snaps = db_session.query(SnapshotRow).filter_by(project_id=project.id).all()
    assert len(snaps) == 1
    root = snaps[0]
    assert root.id == project.head_snapshot_id
    assert root.parent_id is None
    assert root.ledger == []
    assert root.flags == []
    # snapshot's embedded doc.headSnapshotId points at itself (matches fixture)
    assert root.doc["headSnapshotId"] == root.id


# ── mutate: snapshot + head bump in one transaction ─────────────────────────


def test_mutate_creates_snapshot_and_bumps_head(db_session, seeded_project):
    # Read updated_at from the DB (naive, SQLite round-trip) both times so the
    # before/after comparison is apples-to-apples — the point is that the
    # transaction bumps it.
    db_session.expire_all()
    project = db_session.get(ProjectRow, PROJECT_ID)
    old_head = project.head_snapshot_id
    old_updated = project.updated_at

    snap = snapshots.mutate(db_session, PROJECT_ID, "Direct edit", _retitle("New Title"))

    db_session.expire_all()
    project = db_session.get(ProjectRow, PROJECT_ID)
    assert snap.parent_id == old_head
    assert project.head_snapshot_id == snap.id
    assert project.doc["title"] == "New Title"
    assert snap.doc["title"] == "New Title"
    assert snap.doc["headSnapshotId"] == snap.id
    assert project.doc["headSnapshotId"] == snap.id
    assert project.updated_at >= old_updated
    assert _snapshot_count(db_session) == 2  # root + this mutation


def test_mutate_rewrites_ledger_to_new_state(db_session, seeded_project):
    """The live ledger_facts table always mirrors the head snapshot's ledger."""
    before = _ledger_wire(db_session)

    def drop_first_fact(state):
        return snapshots.MutationState(doc=state.doc, ledger=state.ledger[1:], flags=state.flags)

    snap = snapshots.mutate(db_session, PROJECT_ID, "Direct edit", drop_first_fact)

    after = _ledger_wire(db_session)
    assert len(after) == len(before) - 1
    assert sorted(snap.ledger, key=lambda f: f["id"]) == after


# ── mutate: atomicity under mid-transaction failure ─────────────────────────


def test_mutate_is_atomic_when_a_write_step_fails(db_session, seeded_project, monkeypatch):
    project = db_session.get(ProjectRow, PROJECT_ID)
    original_doc = copy.deepcopy(project.doc)
    original_head = project.head_snapshot_id
    original_snap_count = _snapshot_count(db_session)
    original_ledger = _ledger_wire(db_session)

    def boom(*args, **kwargs):
        raise RuntimeError("injected mid-transaction failure")

    # _rewrite_flags runs LAST — after the snapshot row, doc reassignment,
    # head bump and ledger rewrite are all staged in the session. If the
    # helper is truly atomic, the failure must roll every one of those back.
    monkeypatch.setattr(snapshots, "_rewrite_flags", boom)

    with pytest.raises(RuntimeError, match="injected"):
        snapshots.mutate(db_session, PROJECT_ID, "Direct edit", _retitle("Must Not Persist"))

    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.doc == original_doc
    assert project.doc["title"] != "Must Not Persist"
    assert project.head_snapshot_id == original_head
    assert _snapshot_count(db_session) == original_snap_count
    assert _ledger_wire(db_session) == original_ledger


# ── undo: byte-identical restore of the prior state ─────────────────────────


def test_restore_parent_restores_doc_byte_identical(db_session, seeded_project):
    root = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).one()
    original_doc_json = json.dumps(root.doc)
    original_ledger = _ledger_wire(db_session)

    snapshots.mutate(db_session, PROJECT_ID, "Direct edit", _retitle("Changed"))
    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.doc["title"] == "Changed"

    project = db_session.get(ProjectRow, PROJECT_ID)
    snapshots.restore_parent(db_session, project)

    project = db_session.get(ProjectRow, PROJECT_ID)
    # byte-identical: same value AND same serialized bytes (key order/unicode)
    assert json.dumps(project.doc) == original_doc_json
    assert project.head_snapshot_id == root.id
    assert _ledger_wire(db_session) == original_ledger
    # undo creates no new snapshot row (contract §3): root + the mutation only
    assert _snapshot_count(db_session) == 2


def test_undo_then_edit_forks_from_restored_snapshot(db_session, seeded_project):
    root = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).one()

    snapshots.mutate(db_session, PROJECT_ID, "Direct edit", _retitle("A"))
    project = db_session.get(ProjectRow, PROJECT_ID)
    snapshots.restore_parent(db_session, project)  # head back to root

    fork = snapshots.mutate(db_session, PROJECT_ID, "Direct edit", _retitle("B"))
    assert fork.parent_id == root.id  # forked from the restored snapshot
    assert _snapshot_count(db_session) == 3  # root + A + B (append-only)


# ── purge: zero project-scoped rows across all six tables + embeddings ───────


def test_purge_removes_all_six_tables_including_embeddings(db_session, seeded_project):
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

    snapshots.purge_project(db_session, PROJECT_ID)

    assert db_session.query(ProjectRow).filter_by(id=PROJECT_ID).count() == 0
    for model in (
        SnapshotRow,
        LedgerFactRow,
        ChangeSetRow,
        ConsistencyFlagRow,
        SuggestionHistoryRow,
    ):
        assert db_session.query(model).filter_by(project_id=PROJECT_ID).count() == 0
