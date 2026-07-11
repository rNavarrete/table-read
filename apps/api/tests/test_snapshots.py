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
    project = db_session.get(ProjectRow, PROJECT_ID)
    old_head = project.head_snapshot_id
    old_updated = project.updated_at  # naive UTC everywhere (repo convention)

    snap = snapshots.mutate(db_session, PROJECT_ID, "Direct edit", _retitle("New Title"))

    project = db_session.get(ProjectRow, PROJECT_ID)
    assert snap.parent_id == old_head
    assert project.head_snapshot_id == snap.id
    assert project.doc["title"] == "New Title"
    assert snap.doc["title"] == "New Title"
    assert snap.doc["headSnapshotId"] == snap.id
    assert project.doc["headSnapshotId"] == snap.id
    assert project.updated_at >= old_updated
    assert _snapshot_count(db_session) == 2  # root + this mutation


def test_mutate_cas_rejects_stale_expected_head(db_session, seeded_project):
    """Explicit expected_head that does not match live head → StaleHead, no write."""
    project = db_session.get(ProjectRow, PROJECT_ID)
    before_doc = copy.deepcopy(project.doc)
    before_head = project.head_snapshot_id
    before_count = _snapshot_count(db_session)

    with pytest.raises(snapshots.StaleHead):
        snapshots.mutate(
            db_session,
            PROJECT_ID,
            "Stale write",
            _retitle("Must Not Land"),
            expected_head_snapshot_id="snap-not-the-head",
        )

    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.doc == before_doc
    assert project.head_snapshot_id == before_head
    assert _snapshot_count(db_session) == before_count


def test_mutate_cas_second_writer_loses_race(db_session, seeded_project):
    """Two sessions that both observed H: only the first CAS wins; the second
    raises StaleHead and must not create another child of H."""
    from storage.db import SessionLocal

    project = db_session.get(ProjectRow, PROJECT_ID)
    shared_head = project.head_snapshot_id

    session_a = SessionLocal()
    session_b = SessionLocal()
    try:
        # Both sessions load H into their identity maps before either writes.
        assert session_a.get(ProjectRow, PROJECT_ID).head_snapshot_id == shared_head
        assert session_b.get(ProjectRow, PROJECT_ID).head_snapshot_id == shared_head

        snap_a = snapshots.mutate(
            session_a,
            PROJECT_ID,
            "Writer A",
            _retitle("From A"),
            expected_head_snapshot_id=shared_head,
        )
        assert snap_a.parent_id == shared_head

        with pytest.raises(snapshots.StaleHead) as exc_info:
            snapshots.mutate(
                session_b,
                PROJECT_ID,
                "Writer B",
                _retitle("From B"),
                expected_head_snapshot_id=shared_head,
            )
        assert exc_info.value.expected == shared_head
        assert exc_info.value.actual == snap_a.id
    finally:
        session_a.close()
        session_b.close()

    db_session.expire_all()
    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.head_snapshot_id == snap_a.id
    assert project.doc["title"] == "From A"
    # Exactly one child of H — B must not have appended a sibling.
    children = (
        db_session.query(SnapshotRow)
        .filter_by(project_id=PROJECT_ID, parent_id=shared_head)
        .all()
    )
    assert len(children) == 1
    assert children[0].id == snap_a.id


def test_mutate_with_held_row_refs_emits_no_sawarning(db_session, seeded_project):
    """Regression: rewriting retained facts must not warn about identity-map
    conflicts. SQLAlchemy's identity map is weak-referencing, so the SAWarning
    ("New instance conflicts with persistent instance") only fired when loaded
    rows happened to survive until flush — hold strong refs here to make the
    failure deterministic. (SAWarning is escalated to an error suite-wide via
    filterwarnings in pyproject.toml.)"""
    held_rows = db_session.query(LedgerFactRow).filter_by(project_id=PROJECT_ID).all()
    assert held_rows  # fixture has facts to retain through the rewrite

    snap = snapshots.mutate(db_session, PROJECT_ID, "Direct edit", _retitle("Held Refs"))
    assert snap.doc["title"] == "Held Refs"
    assert len(snap.ledger) == len(held_rows)  # all facts retained


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


def test_mutate_rejects_empty_instruction(db_session, seeded_project):
    with pytest.raises(snapshots.EmptyInstruction):
        snapshots.mutate(db_session, PROJECT_ID, "   ", _retitle("Nope"))
    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.doc["title"] == "The Long Pour"


def test_restore_to_ancestor_restores_doc_ledger_flags_byte_identical(
    db_session, seeded_project
):
    root = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).one()
    original_doc = json.dumps(root.doc)
    original_ledger = _ledger_wire(db_session)
    original_flags = [
        row.to_wire_dict()
        for row in db_session.query(ConsistencyFlagRow)
        .filter_by(project_id=PROJECT_ID)
        .all()
    ]

    snapshots.mutate(db_session, PROJECT_ID, "First edit", _retitle("A"))
    mid = db_session.get(ProjectRow, PROJECT_ID).head_snapshot_id
    snapshots.mutate(db_session, PROJECT_ID, "Second edit", _retitle("B"))
    project = db_session.get(ProjectRow, PROJECT_ID)
    assert project.doc["title"] == "B"

    snapshots.restore_to_snapshot(db_session, project, root.id)

    project = db_session.get(ProjectRow, PROJECT_ID)
    assert json.dumps(project.doc) == original_doc
    assert project.head_snapshot_id == root.id
    assert _ledger_wire(db_session) == original_ledger
    flags_now = [
        row.to_wire_dict()
        for row in db_session.query(ConsistencyFlagRow)
        .filter_by(project_id=PROJECT_ID)
        .all()
    ]
    assert flags_now == original_flags
    # append-only: A and B rows remain; head moved to root
    assert _snapshot_count(db_session) == 3
    assert mid is not None


def test_restore_non_ancestor_raises(db_session, seeded_project):
    snapshots.mutate(db_session, PROJECT_ID, "Edit A", _retitle("A"))
    project = db_session.get(ProjectRow, PROJECT_ID)
    snapshots.restore_parent(db_session, project)  # head → root; A is orphan fork tip
    snapshots.mutate(db_session, PROJECT_ID, "Edit B", _retitle("B"))
    orphan_a = (
        db_session.query(SnapshotRow)
        .filter_by(project_id=PROJECT_ID, instruction="Edit A")
        .one()
    )
    project = db_session.get(ProjectRow, PROJECT_ID)
    with pytest.raises(snapshots.RestoreRejected):
        snapshots.restore_to_snapshot(db_session, project, orphan_a.id)


def test_list_ancestor_snapshots_nearest_first(db_session, seeded_project):
    snapshots.mutate(db_session, PROJECT_ID, "Edit one", _retitle("A"))
    snap_a = db_session.get(ProjectRow, PROJECT_ID).head_snapshot_id
    snapshots.mutate(db_session, PROJECT_ID, "Edit two", _retitle("B"))

    ancestors = snapshots.list_ancestor_snapshots(db_session, PROJECT_ID, limit=20)
    assert ancestors[0]["id"] == snap_a
    assert ancestors[0]["instruction"] == "Edit one"
    assert ancestors[1]["instruction"] == (
        "fixture seed: The Long Pour, episode 1 in progress"
    )
    assert len(ancestors) == 2


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
