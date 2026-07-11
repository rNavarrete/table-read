"""Assemble a project's persisted-state envelope for JSON export (adoption A6).

Shape matches `PersistedState` / `docs/tableread-fixture.json`: project,
ledger, snapshots, consistencyFlags, changeSets, suggestionHistory. Used by
`GET /projects/{pid}/export.json` — privacy §7.1 "export-everything".
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from schemas import PersistedState
from storage.models import (
    ChangeSetRow,
    ConsistencyFlagRow,
    LedgerFactRow,
    ProjectRow,
    SnapshotRow,
    SuggestionHistoryRow,
)


def export_persisted_state(session: Session, project_id: str) -> dict:
    """Build the fixture-shaped envelope for one project. Raises KeyError if
    the project row is missing (caller maps to 404)."""
    project = session.get(ProjectRow, project_id)
    if project is None:
        raise KeyError(project_id)

    snapshots = (
        session.query(SnapshotRow)
        .filter_by(project_id=project_id)
        .order_by(SnapshotRow.ts.asc())
        .all()
    )
    ledger = (
        session.query(LedgerFactRow).filter_by(project_id=project_id).all()
    )
    flags = (
        session.query(ConsistencyFlagRow).filter_by(project_id=project_id).all()
    )
    change_sets = (
        session.query(ChangeSetRow).filter_by(project_id=project_id).all()
    )
    suggestions = (
        session.query(SuggestionHistoryRow)
        .filter_by(project_id=project_id)
        .all()
    )

    envelope = {
        "project": project.doc,
        "ledger": [row.to_wire_dict() for row in ledger],
        "snapshots": [
            {
                "id": snap.id,
                "parentId": snap.parent_id,
                "instruction": snap.instruction,
                "doc": snap.doc,
                "ledger": snap.ledger,
                "flags": snap.flags,
                "ts": snap.ts,
            }
            for snap in snapshots
        ],
        "consistencyFlags": [row.to_wire_dict() for row in flags],
        "changeSets": [row.doc for row in change_sets],
        "suggestionHistory": [
            {
                "id": entry.id,
                "projectId": entry.project_id,
                "text": entry.text,
                "embedding": entry.embedding,
            }
            for entry in suggestions
        ],
    }
    # Validate before returning so a drifted store fails loudly at export
    # time rather than shipping an un-importable file.
    return PersistedState.model_validate(envelope).model_dump(
        by_alias=True, mode="json"
    )
