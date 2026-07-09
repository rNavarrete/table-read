"""Seed logic tests (task T0.3).

Exercises storage.seed against the real committed fixture (docs/tableread-fixture.json,
"The Long Pour") — asserts the snapshots table ends up with exactly the root row, that
its doc/ledger match the live projects/ledger_facts tables (accept criterion 3), and
that re-seeding is idempotent (replace, not duplicate).
"""

from storage.models import (
    ChangeSetRow,
    ConsistencyFlagRow,
    LedgerFactRow,
    ProjectRow,
    SnapshotRow,
    SuggestionHistoryRow,
)
from storage.seed import load_fixture, seed_envelope


def test_seed_writes_exactly_one_root_snapshot_matching_live_stores(db_session, seeded_project):
    project_id = seeded_project["project"]["id"]

    snapshots = db_session.query(SnapshotRow).filter_by(project_id=project_id).all()
    assert len(snapshots) == 1

    root = snapshots[0]
    assert root.id == "snap-root"
    assert root.parent_id is None

    project = db_session.get(ProjectRow, project_id)
    assert root.doc == project.doc

    live_ledger = [
        row.to_wire_dict()
        for row in db_session.query(LedgerFactRow)
        .filter_by(project_id=project_id)
        .order_by(LedgerFactRow.id)
        .all()
    ]
    snapshot_ledger = sorted(root.ledger, key=lambda f: f["id"])
    assert live_ledger == snapshot_ledger


def test_seed_populates_project_timestamps(seeded_project, db_session):
    project = db_session.get(ProjectRow, seeded_project["project"]["id"])
    assert project.created_at is not None
    assert project.updated_at is not None


def test_seed_writes_8_ledger_facts_from_fixture(seeded_project, db_session):
    project_id = seeded_project["project"]["id"]
    facts = db_session.query(LedgerFactRow).filter_by(project_id=project_id).all()
    assert len(facts) == 8
    assert {f.id for f in facts} == {f"fact-0{i}" for i in range(1, 9)}


def test_seed_writes_empty_stores_verbatim(seeded_project, db_session):
    project_id = seeded_project["project"]["id"]

    assert db_session.query(ConsistencyFlagRow).filter_by(project_id=project_id).count() == 0
    assert db_session.query(ChangeSetRow).filter_by(project_id=project_id).count() == 0
    assert db_session.query(SuggestionHistoryRow).filter_by(project_id=project_id).count() == 0


def test_seed_is_idempotent_replace(db_session):
    envelope = load_fixture()
    seed_envelope(db_session, envelope)
    seed_envelope(db_session, envelope)  # re-seed: should replace, not duplicate

    project_id = envelope["project"]["id"]
    assert db_session.query(ProjectRow).filter_by(id=project_id).count() == 1
    assert db_session.query(SnapshotRow).filter_by(project_id=project_id).count() == 1
    assert db_session.query(LedgerFactRow).filter_by(project_id=project_id).count() == 8
