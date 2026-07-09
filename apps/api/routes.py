"""Project read/undo endpoints (data contract §4: `/api/v1`).

Scope note (task T0.3): only what the seed accept criteria need. `undo`
handles the root case (409 `VALIDATION`, "nothing to undo") only — actually
restoring a parent snapshot is T1.1 scope ("Project CRUD + snapshots"), and
no mutation endpoint exists yet that could produce a non-root snapshot to
restore from.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from errors import ApiError
from schemas import LedgerFact, Project
from storage.db import get_session
from storage.models import LedgerFactRow, ProjectRow, SnapshotRow

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


def _get_project_or_404(session: Session, pid: str) -> ProjectRow:
    project = session.get(ProjectRow, pid)
    if project is None:
        raise ApiError(404, "NOT_FOUND", f"project {pid!r} not found")
    return project


@router.get("/{pid}", response_model=Project)
def get_project(pid: str, session: Session = Depends(get_session)) -> dict:
    project = _get_project_or_404(session, pid)
    return project.doc


@router.get("/{pid}/ledger", response_model=list[LedgerFact])
def get_ledger(
    pid: str,
    status: str | None = None,
    character_id: str | None = Query(default=None, alias="characterId"),
    session: Session = Depends(get_session),
) -> list[dict]:
    _get_project_or_404(session, pid)
    facts = session.query(LedgerFactRow).filter_by(project_id=pid).all()
    if status is not None:
        facts = [f for f in facts if f.status == status]
    if character_id is not None:
        facts = [f for f in facts if character_id in f.known_by]
    return [f.to_wire_dict() for f in facts]


@router.post("/{pid}/undo", response_model=Project)
def undo(pid: str, session: Session = Depends(get_session)) -> dict:
    project = _get_project_or_404(session, pid)
    head = session.get(SnapshotRow, project.head_snapshot_id)
    if head is None or head.parent_id is None:
        raise ApiError(409, "VALIDATION", "nothing to undo")

    # Restoring a non-root snapshot (rewriting projects/ledger_facts/
    # consistency_flags from the parent, moving head) is T1.1 scope; no code
    # path can reach this today since nothing yet creates a non-root snapshot.
    raise NotImplementedError("undo beyond the root snapshot is T1.1 scope")
