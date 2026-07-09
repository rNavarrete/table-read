"""Project CRUD + snapshot endpoints (data contract §4: `/api/v1`).

Routes stay thin: every doc/head write goes through `storage/snapshots.py`
(CLAUDE.md hard rule 4). This module only shapes requests/responses and maps
storage errors to the contract's error envelope (§4).

Scope note (T1.1): PATCH here applies a JSON-patch and snapshots it. The
structural-field `scan_consistency` trigger and locked-range enforcement that
data contract §4 also describes for PATCH are owned by later tasks — direct
edits + the Review affordance are T3.2, and consistency-scan plumbing is
T4.4 (build plan). T1.1 has no LLM and no locks module yet, so it ships the
snapshot-creating PATCH those tasks build on.
"""

from __future__ import annotations

import anthropic
from fastapi import APIRouter, Body, Depends, Query, Response
from fastapi.responses import PlainTextResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from errors import ApiError
from fountain.export import to_fountain
from fountain.parse import CoverageError
from fountain.pipeline import run_import
from llm.dependency import get_llm_client
from llm.errors import SchemaInvalidLlmError
from llm.protocol import LlmClient
from schemas import LedgerFact, Project, ShowFormat
from storage import snapshots
from storage.db import get_session
from storage.models import LedgerFactRow, ProjectRow, SnapshotRow
from storage.patching import PatchError, apply_json_patch
from storage.snapshots import MutationState

_IMPORT_FORMATS = {"fountain", "text"}

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])

# Default component set for a new project (design doc §5 / fixture). The
# writer toggles these in show-format settings later.
_DEFAULT_ENABLED_COMPONENTS = [
    "existential_question",
    "audience_goals",
    "motivations",
    "desiderata",
    "continuity_ledger",
]


def _get_project_or_404(session: Session, pid: str) -> ProjectRow:
    project = session.get(ProjectRow, pid)
    if project is None:
        raise ApiError(404, "NOT_FOUND", f"project {pid!r} not found")
    return project


def _minimal_series_bible() -> dict:
    """A scaffolded but empty `SeriesBible` (data contract §4 POST /projects)."""
    return {
        "existentialQuestion": {"text": "", "locked": False},
        "worldRules": [],
        "storiesToAvoid": [],
        "characters": [],
        "relationships": [],
        "audienceGoals": [],
        "narratorGoals": [],
        "worldQA": [],
    }


@router.post("", response_model=Project, status_code=201)
def create_project(
    title: str = Body(...),
    format: ShowFormat = Body(...),
    premise: str = Body(...),
    session: Session = Depends(get_session),
) -> dict:
    doc = {
        "id": None,  # server-assigned in snapshots.create_project
        "title": title,
        "format": format.model_dump(by_alias=True),
        "enabledComponents": list(_DEFAULT_ENABLED_COMPONENTS),
        "premise": premise,
        "seriesBible": _minimal_series_bible(),
        "seasons": [],
        "headSnapshotId": None,  # server-assigned in snapshots.create_project
    }
    project = snapshots.create_project(session, doc, instruction="Project created")
    return project.doc


@router.get("/{pid}", response_model=Project)
def get_project(pid: str, session: Session = Depends(get_session)) -> dict:
    project = _get_project_or_404(session, pid)
    return project.doc


@router.patch("/{pid}", response_model=Project)
def patch_project(
    pid: str,
    patch: list = Body(...),
    session: Session = Depends(get_session),
) -> dict:
    project = _get_project_or_404(session, pid)
    try:
        new_doc = apply_json_patch(project.doc, patch)
        Project.model_validate(new_doc)
    except PatchError as exc:
        raise ApiError(400, "VALIDATION", str(exc)) from exc
    except ValidationError as exc:
        raise ApiError(
            400, "VALIDATION", "patch produced an invalid project document"
        ) from exc

    snapshots.mutate(
        session,
        pid,
        "Direct edit",
        lambda state: MutationState(doc=new_doc, ledger=state.ledger, flags=state.flags),
    )
    return session.get(ProjectRow, pid).doc


@router.delete("/{pid}", status_code=204)
def delete_project(pid: str, session: Session = Depends(get_session)) -> Response:
    _get_project_or_404(session, pid)
    snapshots.purge_project(session, pid)
    return Response(status_code=204)


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


@router.get("/{pid}/export.fountain", response_class=PlainTextResponse)
def export_fountain(pid: str, session: Session = Depends(get_session)) -> str:
    project = _get_project_or_404(session, pid)
    return to_fountain(project.doc)


@router.post("/{pid}/import")
def import_script(
    pid: str,
    format: str = Body(...),
    content: str = Body(...),
    session: Session = Depends(get_session),
    llm: LlmClient = Depends(get_llm_client),
) -> dict:
    project = _get_project_or_404(session, pid)
    if format not in _IMPORT_FORMATS:
        raise ApiError(
            400, "VALIDATION", f"format must be one of {sorted(_IMPORT_FORMATS)}"
        )
    try:
        return run_import(session, project, content, llm, instruction=f"Imported {format} script")
    except CoverageError as exc:
        # §7 coverage failure: the two-stage parse could not cover the source
        # exactly. Nothing was persisted (the failure precedes the mutate()).
        raise ApiError(400, "VALIDATION", str(exc)) from exc
    except SchemaInvalidLlmError as exc:
        raise ApiError(502, "SCHEMA_INVALID_LLM", str(exc)) from exc
    except anthropic.APIError as exc:
        # errors.py: mapping SDK transport failures to LLM_UNAVAILABLE is the
        # route layer's job. Log the type only, never prompt/response content.
        raise ApiError(503, "LLM_UNAVAILABLE", "the language model is unavailable") from exc


@router.post("/{pid}/undo", response_model=Project)
def undo(pid: str, session: Session = Depends(get_session)) -> dict:
    project = _get_project_or_404(session, pid)
    head = session.get(SnapshotRow, project.head_snapshot_id)
    if head is None or head.parent_id is None:
        raise ApiError(409, "VALIDATION", "nothing to undo")

    snapshots.restore_parent(session, project)
    return session.get(ProjectRow, pid).doc
