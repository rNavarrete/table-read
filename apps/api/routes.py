"""Project CRUD + snapshot endpoints (data contract §4: `/api/v1`).

Routes stay thin: every doc/head write goes through `storage/snapshots.py`
(CLAUDE.md hard rule 4). This module only shapes requests/responses and maps
storage errors to the contract's error envelope (§4).

Consistency-flag list lives on the projects router; dismiss is on the
sibling `flags_router` (`POST /api/v1/consistency-flags/{fid}/dismiss`) —
both are T4.4a. Change-set apply's scan wiring remains T4.2.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import UTC

import anthropic
from fastapi import APIRouter, Body, Depends, Header, Query, Response
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from drama_manager import (
    accept,
    candidates,
    change_sets,
    ledger_mutations,
    locks,
    scan,
)
from errors import ApiError
from fountain.export import to_fountain
from fountain.parse import CoverageError
from fountain.pipeline import run_import
from llm.dependency import get_llm_client, get_llm_client_provider
from llm.errors import SchemaInvalidLlmError
from llm.protocol import LlmClient
from schemas import (
    BeatCandidate,
    ChangeSet,
    ChangeSetApprovedRequest,
    ConsistencyFlag,
    LedgerBatchRequest,
    LedgerFact,
    LedgerFactEdit,
    Project,
    ProjectCreateRequest,
    ProjectSummary,
)
from storage import snapshots
from storage.db import get_session
from storage.models import ConsistencyFlagRow, LedgerFactRow, ProjectRow, SnapshotRow
from storage.patching import PatchError, apply_json_patch
from storage.snapshots import MutationState

_IMPORT_FORMATS = {"fountain", "text"}

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])
ledger_router = APIRouter(prefix="/api/v1/ledger", tags=["ledger"])
# Top-level flag mutations (data contract §4): `POST /consistency-flags/{fid}/dismiss`
# — not nested under `/projects/{pid}`, same shape as `/ledger/{factId}/*`.
flags_router = APIRouter(prefix="/api/v1/consistency-flags", tags=["consistency-flags"])
# Top-level Change Set mutations (data contract §4 Review): preview / apply /
# discard / flag — not nested under `/projects/{pid}` (create stays nested).
change_sets_router = APIRouter(prefix="/api/v1/change-sets", tags=["change-sets"])

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


def _expected_head(if_match: str | None) -> str | None:
    """Normalize `If-Match` for snapshot CAS. Empty / missing → None (server
    still CAS-guards against the observed head inside `mutate`)."""
    if if_match is None:
        return None
    value = if_match.strip()
    return value or None


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


def _series_bible_from_foundation(body: ProjectCreateRequest) -> dict:
    bible = _minimal_series_bible()
    foundation = body.foundation
    if foundation is None:
        return bible

    bible["existentialQuestion"]["text"] = foundation.existential_question or ""
    bible["storiesToAvoid"] = list(foundation.stories_to_avoid or [])
    bible["characters"] = [
        {
            "id": f"char-{uuid.uuid4().hex}",
            "name": seed.name,
            "locked": False,
            "embodiment": "",
            "presentation": "",
            "hiding": "",
            "traits": seed.traits or "",
            "seriesArc": "",
        }
        for seed in foundation.characters or []
    ]
    return bible


def _creation_request_hash(body: ProjectCreateRequest) -> str:
    canonical = json.dumps(
        body.model_dump(by_alias=True, mode="json", exclude_none=True),
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _has_usable_scene_skeleton(doc: dict) -> bool:
    return any(
        scene.get("beats")
        for season in doc.get("seasons", [])
        for episode in season.get("episodes", [])
        for scene in episode.get("scenes", [])
    )


def _rfc3339_utc_z(value) -> str:
    timestamp = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return timestamp.isoformat().replace("+00:00", "Z")


def _project_summary(session: Session, project: ProjectRow) -> dict:
    pending_count = (
        session.query(LedgerFactRow)
        .filter_by(project_id=project.id, status="pending_review")
        .count()
    )
    doc = project.doc
    return {
        "id": project.id,
        "title": doc["title"],
        "format": doc["format"],
        "updatedAt": _rfc3339_utc_z(project.updated_at),
        "pendingReviewCount": pending_count,
        "setupState": "ready" if _has_usable_scene_skeleton(doc) else "incomplete",
    }


def _resolve_create_idempotency(
    session: Session, idempotency_key: str, request_hash: str
) -> dict | None:
    existing = (
        session.query(ProjectRow)
        .filter_by(creation_idempotency_key=idempotency_key)
        .one_or_none()
    )
    if existing is None:
        return None
    if existing.creation_request_hash == request_hash:
        return existing.doc
    raise ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used for a different project request",
    )


@router.get("", response_model=list[ProjectSummary])
def list_projects(session: Session = Depends(get_session)) -> list[dict]:
    projects = session.query(ProjectRow).order_by(ProjectRow.updated_at.desc()).all()
    return [_project_summary(session, project) for project in projects]


@router.post("", response_model=Project, status_code=201)
def create_project(
    body: ProjectCreateRequest,
    session: Session = Depends(get_session),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
) -> dict:
    if not idempotency_key.strip():
        raise ApiError(400, "VALIDATION", "Idempotency-Key must not be empty")

    request_hash = _creation_request_hash(body)
    if existing_doc := _resolve_create_idempotency(
        session, idempotency_key, request_hash
    ):
        return existing_doc

    doc = {
        "id": None,  # server-assigned in snapshots.create_project
        "title": body.title,
        "format": body.format.model_dump(by_alias=True),
        "enabledComponents": list(_DEFAULT_ENABLED_COMPONENTS),
        "premise": body.premise,
        "seriesBible": _series_bible_from_foundation(body),
        "seasons": [],
        "headSnapshotId": None,  # server-assigned in snapshots.create_project
    }
    try:
        project = snapshots.create_project(
            session,
            doc,
            instruction="Project created",
            creation_idempotency_key=idempotency_key,
            creation_request_hash=request_hash,
        )
    except IntegrityError:
        session.rollback()
        if existing_doc := _resolve_create_idempotency(
            session, idempotency_key, request_hash
        ):
            return existing_doc
        raise
    return project.doc


@router.get("/{pid}", response_model=Project)
def get_project(pid: str, session: Session = Depends(get_session)) -> dict:
    project = _get_project_or_404(session, pid)
    return project.doc


@router.patch("/{pid}")
def patch_project(
    pid: str,
    patch: list = Body(...),
    session: Session = Depends(get_session),
    resolve_llm: Callable[[], LlmClient] = Depends(get_llm_client_provider),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    """Direct writer edit (data contract §4). Applies a JSON-patch and
    snapshots it. Two guards/branches §4 requires:

      - **Locks are sacred (rule 2):** a patch that writes into locked content
        or structure is rejected 409 `LOCKED_OBJECT` before anything persists
        (`locks.assert_no_locked_writes`). Unlocking and reindexing stay
        allowed — see that guard's rule.
      - **Structural plan fields** (scene `whatHappens`, `premise`, storyline
        summaries) additionally trigger `scan_consistency` and return
        `{project, consistencyFlags}` — the "Save field only" path skips
        Review, never the flagging promise. Every other edit returns the bare
        `Project` and never touches the model (so a title rename can't 503 on
        an unconfigured LLM; see `get_llm_client_provider`).

    Optimistic concurrency: when `If-Match` is the client's `headSnapshotId`,
    a 409 `CONFLICT_STALE_HEAD` is returned if the live head has moved (two
    tabs / concurrent editors). Omit the header only for legacy callers.
    """
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

    try:
        locks.assert_no_locked_writes(project.doc, new_doc)
    except locks.LockViolation as exc:
        raise ApiError(409, "LOCKED_OBJECT", str(exc)) from exc

    if scan.touches_structural_field(project.doc, new_doc):
        try:
            return scan.run_direct_edit_scan(
                session,
                project,
                new_doc,
                resolve_llm(),
                instruction="Direct structural edit",
                expected_head_snapshot_id=if_match,
            )
        except snapshots.StaleHead as exc:
            raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
        except SchemaInvalidLlmError as exc:
            raise ApiError(502, "SCHEMA_INVALID_LLM", str(exc)) from exc
        except anthropic.APIError as exc:
            raise ApiError(503, "LLM_UNAVAILABLE", "the language model is unavailable") from exc

    try:
        snapshots.mutate(
            session,
            pid,
            "Direct edit",
            lambda state: MutationState(
                doc=new_doc, ledger=state.ledger, flags=state.flags
            ),
            expected_head_snapshot_id=if_match,
        )
    except snapshots.StaleHead as exc:
        raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
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
    facts = session.query(LedgerFactRow).filter_by(project_id=pid).order_by(LedgerFactRow.id).all()
    if status is not None:
        facts = [f for f in facts if f.status == status]
    if character_id is not None:
        facts = [f for f in facts if character_id in f.known_by]
    return [f.to_wire_dict() for f in facts]


@router.get("/{pid}/consistency-flags", response_model=list[ConsistencyFlag])
def list_consistency_flags(
    pid: str,
    status: str | None = None,
    session: Session = Depends(get_session),
) -> list[dict]:
    """`GET /projects/{pid}/consistency-flags?status=open` (data contract §4)."""
    _get_project_or_404(session, pid)
    flags = session.query(ConsistencyFlagRow).filter_by(project_id=pid).all()
    if status is not None:
        flags = [f for f in flags if f.status == status]
    return [f.to_wire_dict() for f in flags]


@flags_router.post("/{fid}/dismiss", response_model=ConsistencyFlag)
def dismiss_consistency_flag(
    fid: str,
    session: Session = Depends(get_session),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    """`POST /consistency-flags/{fid}/dismiss` — versioned flag-only mutation.

    Flags live in snapshots (data contract §3); dismiss flips `status` to
    `dismissed` via `snapshots.mutate` and must not change `doc` or ledger
    (test plan line 27: flags never mutate project state).
    """
    row = session.get(ConsistencyFlagRow, fid)
    if row is None:
        raise ApiError(404, "NOT_FOUND", f"consistency flag {fid!r} not found")
    if row.status != "open":
        raise ApiError(
            409, "VALIDATION", f"consistency flag {fid!r} is not open"
        )

    project_id = row.project_id

    def mutator(state: MutationState) -> MutationState:
        # Doc + ledger pass through unchanged — only the matching flag's
        # status flips. Mutator must not mutate `doc` in place (snapshots.py).
        next_flags = [
            {**f, "status": "dismissed"} if f["id"] == fid else f
            for f in state.flags
        ]
        return MutationState(
            doc=state.doc,
            ledger=state.ledger,
            flags=next_flags,
            snapshot_id=state.snapshot_id,
        )

    try:
        snap = snapshots.mutate(
            session,
            project_id,
            instruction="Dismissed consistency flag",
            mutator=mutator,
            expected_head_snapshot_id=_expected_head(if_match),
        )
    except snapshots.StaleHead as exc:
        raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
    dismissed = next(f for f in snap.flags if f["id"] == fid)
    return dismissed


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
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    project = _get_project_or_404(session, pid)
    if format not in _IMPORT_FORMATS:
        raise ApiError(
            400, "VALIDATION", f"format must be one of {sorted(_IMPORT_FORMATS)}"
        )
    try:
        return run_import(
            session,
            project,
            content,
            llm,
            instruction=f"Imported {format} script",
            expected_head_snapshot_id=_expected_head(if_match),
        )
    except snapshots.StaleHead as exc:
        raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
    except locks.LockViolation as exc:
        # Import-as-replace into a target holding locked content or vouched
        # facts (rule 2, T3.2). Refused before any LLM call or mutation.
        raise ApiError(409, "LOCKED_OBJECT", str(exc)) from exc
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


@router.post("/{pid}/scenes/{sid}/candidates")
def generate_candidates(
    pid: str,
    sid: str,
    after_beat_id: str | None = Body(default=None, alias="afterBeatId"),
    instruction: str | None = Body(default=None),
    session: Session = Depends(get_session),
    llm: LlmClient = Depends(get_llm_client),
) -> StreamingResponse:
    """Write-mode candidate generation (data contract §4): streams
    `candidate_start`/`delta`/`candidate_done`|`candidate_failed` ×3, then
    `done`. Read-only w.r.t. the doc — generation persists nothing until Accept
    (T2.2). This POST *is* the explicit writer gesture (design doc §4.3 /
    CLAUDE.md rule 8): no polling, no proactive generation.

    Target ids are validated before the stream opens so bad ids are HTTP errors,
    not mid-stream SSE surprises; once streaming, every failure is SSE-shaped
    (candidate_failed). Doc + ledger are materialized here so the stream
    generator never touches the DB session after this handler returns."""
    project = _get_project_or_404(session, pid)
    doc = project.doc
    try:
        candidates.validate_target(doc, sid, after_beat_id)
    except candidates.SceneNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"scene {sid!r} not found") from exc
    except candidates.BeatNotFound as exc:
        raise ApiError(
            400, "VALIDATION", f"afterBeatId {after_beat_id!r} is not a beat of scene {sid!r}"
        ) from exc

    ledger = [
        row.to_wire_dict()
        for row in session.query(LedgerFactRow).filter_by(project_id=pid).all()
    ]
    events = candidates.generate_candidate_events(
        llm,
        doc,
        ledger,
        scene_id=sid,
        after_beat_id=after_beat_id,
        instruction=instruction or "",
    )
    return StreamingResponse(candidates.to_sse(events), media_type="text/event-stream")


@router.post("/{pid}/scenes/{sid}/candidates/tune")
def tune_candidate(
    pid: str,
    sid: str,
    candidate: BeatCandidate = Body(...),
    instruction: str = Body(...),
    session: Session = Depends(get_session),
    llm: LlmClient = Depends(get_llm_client),
) -> StreamingResponse:
    """Write-mode tune (data contract §4): re-generates a single candidate from
    the writer's `instruction`, streamed like generation (SSE: one
    `candidate_start`, `delta`s, `candidate_done`/`candidate_failed`, `done`).
    This POST is the explicit writer gesture (design doc §4.3 / CLAUDE.md rule
    8) — tuning happens only on the writer's action, never proactively.

    The scene id is validated before the stream opens so a bad id is an HTTP
    error, not a mid-stream SSE surprise; once streaming, every failure is
    SSE-shaped (candidate_failed)."""
    project = _get_project_or_404(session, pid)
    try:
        candidates.validate_target(project.doc, sid, None)
    except candidates.SceneNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"scene {sid!r} not found") from exc

    ledger = [
        row.to_wire_dict()
        for row in session.query(LedgerFactRow).filter_by(project_id=pid).all()
    ]
    events = candidates.generate_tune_events(
        llm,
        project.doc,
        ledger,
        scene_id=sid,
        current_candidate=candidate.model_dump(by_alias=True),
        instruction=instruction,
    )
    return StreamingResponse(candidates.to_sse(events), media_type="text/event-stream")


@router.post("/{pid}/scenes/{sid}/beats")
def accept_beat(
    pid: str,
    sid: str,
    candidate: BeatCandidate = Body(...),
    after_beat_id: str | None = Body(default=None, alias="afterBeatId"),
    session: Session = Depends(get_session),
    llm: LlmClient = Depends(get_llm_client),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    """Accept a beat candidate (data contract §4): inserts the beat, snapshots,
    and triggers ledger extraction + consistency scan in one transaction →
    `{project, newFacts, contradictions, consistencyFlags}`. This POST is the
    explicit writer gesture (design doc §4.3 / CLAUDE.md rule 8).

    Target ids are validated before any LLM call so bad ids are HTTP errors.
    The whole accept is atomic (drama_manager/accept.py): an extract/scan
    failure persists nothing and maps to SCHEMA_INVALID_LLM / LLM_UNAVAILABLE,
    exactly like import."""
    project = _get_project_or_404(session, pid)
    try:
        accept.validate_target(project.doc, sid, after_beat_id)
    except accept.SceneNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"scene {sid!r} not found") from exc
    except accept.BeatNotFound as exc:
        raise ApiError(
            400, "VALIDATION", f"afterBeatId {after_beat_id!r} is not a beat of scene {sid!r}"
        ) from exc

    try:
        return accept.run_accept(
            session,
            project,
            candidate,
            after_beat_id,
            llm,
            scene_id=sid,
            instruction="Accepted beat candidate",
            expected_head_snapshot_id=_expected_head(if_match),
        )
    except snapshots.StaleHead as exc:
        raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
    except locks.LockViolation as exc:
        raise ApiError(409, "LOCKED_OBJECT", str(exc)) from exc
    except SchemaInvalidLlmError as exc:
        raise ApiError(502, "SCHEMA_INVALID_LLM", str(exc)) from exc
    except anthropic.APIError as exc:
        raise ApiError(503, "LLM_UNAVAILABLE", "the language model is unavailable") from exc


@router.post("/{pid}/change-sets", response_model=ChangeSet, status_code=200)
def create_change_set(
    pid: str,
    target_object_id: str = Body(..., alias="targetObjectId"),
    instruction: str = Body(...),
    session: Session = Depends(get_session),
    llm: LlmClient = Depends(get_llm_client),
) -> dict:
    """Review-mode Change Set create (data contract §4 / T4.1): runs
    `classify_blast_radius`, server-annotates applyMode / locked / before /
    after / continuityFlags / approved, and persists a draft ChangeSet.
    Does not mutate the project doc and does not create a snapshot
    (change_sets are deliberately not versioned — data contract §3).

    This POST is the explicit writer gesture (design doc §4.3 / CLAUDE.md
    rule 8). Target id is validated before any LLM call."""
    project = _get_project_or_404(session, pid)
    ledger = [
        row.to_wire_dict()
        for row in session.query(LedgerFactRow).filter_by(project_id=pid).all()
    ]
    try:
        change_sets.validate_target(project.doc, ledger, target_object_id)
    except change_sets.TargetNotFound as exc:
        raise ApiError(
            404, "NOT_FOUND", f"targetObjectId {target_object_id!r} not found"
        ) from exc

    try:
        return change_sets.create_change_set(
            session,
            project,
            target_object_id=target_object_id,
            instruction=instruction,
            llm=llm,
        )
    except SchemaInvalidLlmError as exc:
        raise ApiError(502, "SCHEMA_INVALID_LLM", str(exc)) from exc
    except anthropic.APIError as exc:
        raise ApiError(503, "LLM_UNAVAILABLE", "the language model is unavailable") from exc


@router.get("/{pid}/change-sets", response_model=list[ChangeSet])
def list_change_sets(
    pid: str,
    status: str | None = None,
    session: Session = Depends(get_session),
) -> list[dict]:
    """`GET /projects/{pid}/change-sets?status=` (data contract §4)."""
    _get_project_or_404(session, pid)
    return change_sets.list_change_sets(session, pid, status=status)


@change_sets_router.get("/{cid}", response_model=ChangeSet)
def get_change_set(cid: str, session: Session = Depends(get_session)) -> dict:
    """`GET /change-sets/{cid}` (data contract §4)."""
    try:
        return change_sets.get_change_set(session, cid)
    except change_sets.ChangeSetNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"change set {cid!r} not found") from exc


@change_sets_router.post("/{cid}/preview", response_model=ChangeSet, status_code=200)
def preview_change_set(
    cid: str,
    body: ChangeSetApprovedRequest,
    session: Session = Depends(get_session),
    llm: LlmClient = Depends(get_llm_client),
) -> dict:
    """Review-mode preview (data contract §4 / T4.2): runs `regenerate_elements`,
    stores the typed `ChangeSetPreview` (`basedOnSnapshotId` = current head),
    and renders `after` display snippets. Does not mutate the project doc."""
    try:
        return change_sets.preview_change_set(
            session, cid, approved_object_ids=body.approved_object_ids, llm=llm
        )
    except change_sets.ChangeSetNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"change set {cid!r} not found") from exc
    except change_sets.ApplyRejected as exc:
        raise ApiError(409, exc.code, str(exc)) from exc
    except SchemaInvalidLlmError as exc:
        raise ApiError(502, "SCHEMA_INVALID_LLM", str(exc)) from exc
    except anthropic.APIError as exc:
        raise ApiError(503, "LLM_UNAVAILABLE", "the language model is unavailable") from exc


@change_sets_router.post("/{cid}/apply", status_code=200)
def apply_change_set(
    cid: str,
    body: ChangeSetApprovedRequest,
    session: Session = Depends(get_session),
    llm: LlmClient = Depends(get_llm_client),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    """Review-mode apply (data contract §4 / T4.2): writes the stored preview
    payload verbatim (zero regenerate calls), approved-only; snapshots,
    re-extracts ledger, scans untouched scenes. Returns
    `{project, changeSet, consistencyFlags}`."""
    try:
        return change_sets.apply_change_set(
            session,
            cid,
            approved_object_ids=body.approved_object_ids,
            llm=llm,
            expected_head_snapshot_id=_expected_head(if_match),
        )
    except change_sets.ChangeSetNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"change set {cid!r} not found") from exc
    except snapshots.StaleHead as exc:
        raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
    except change_sets.ApplyRejected as exc:
        raise ApiError(409, exc.code, str(exc)) from exc
    except locks.LockViolation as exc:
        raise ApiError(409, "LOCKED_OBJECT", str(exc)) from exc
    except SchemaInvalidLlmError as exc:
        raise ApiError(502, "SCHEMA_INVALID_LLM", str(exc)) from exc
    except anthropic.APIError as exc:
        raise ApiError(503, "LLM_UNAVAILABLE", "the language model is unavailable") from exc


@change_sets_router.post("/{cid}/discard", response_model=ChangeSet, status_code=200)
def discard_change_set(
    cid: str, session: Session = Depends(get_session)
) -> dict:
    """Mark the ChangeSet discarded; no project mutation (Review UI Agent E)."""
    try:
        return change_sets.discard_change_set(session, cid)
    except change_sets.ChangeSetNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"change set {cid!r} not found") from exc


@change_sets_router.post("/{cid}/flag", response_model=ChangeSet, status_code=200)
def flag_change_set(
    cid: str, session: Session = Depends(get_session)
) -> dict:
    """Mark the ChangeSet flagged (record concerns without applying)."""
    try:
        return change_sets.flag_change_set(session, cid)
    except change_sets.ChangeSetNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"change set {cid!r} not found") from exc


@router.post("/{pid}/undo", response_model=Project)
def undo(
    pid: str,
    session: Session = Depends(get_session),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    project = _get_project_or_404(session, pid)
    head = session.get(SnapshotRow, project.head_snapshot_id)
    if head is None or head.parent_id is None:
        raise ApiError(409, "VALIDATION", "nothing to undo")

    try:
        snapshots.restore_parent(
            session,
            project,
            expected_head_snapshot_id=_expected_head(if_match),
        )
    except snapshots.StaleHead as exc:
        raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
    return session.get(ProjectRow, pid).doc


@router.post("/{pid}/ledger/batch")
def batch_ledger(
    pid: str,
    body: LedgerBatchRequest,
    session: Session = Depends(get_session),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    """Batch confirm/reject (data contract §4). One snapshot for the whole
    batch; any invalid id fails the entire batch (400, nothing applied).
    Supersede-proposal semantics apply per id."""
    _get_project_or_404(session, pid)
    try:
        snapshots.mutate(
            session,
            pid,
            "Ledger batch review",
            lambda state: MutationState(
                doc=state.doc,
                ledger=ledger_mutations.apply_batch(
                    state.ledger,
                    confirm_ids=body.confirm_ids,
                    reject_ids=body.reject_ids,
                ),
                flags=state.flags,
            ),
            expected_head_snapshot_id=_expected_head(if_match),
        )
    except snapshots.StaleHead as exc:
        raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
    except ledger_mutations.FactNotFound as exc:
        raise ApiError(400, "VALIDATION", f"unknown fact id: {exc}") from exc
    except ledger_mutations.ConflictStaleProposal as exc:
        # Same code as single confirm; batch still applies nothing.
        raise ApiError(409, "CONFLICT_STALE_PROPOSAL", str(exc)) from exc
    except ledger_mutations.ValidationError as exc:
        raise ApiError(400, "VALIDATION", str(exc)) from exc

    facts = session.query(LedgerFactRow).filter_by(project_id=pid).all()
    return {"ledger": [f.to_wire_dict() for f in facts]}


def _fact_row_or_404(session: Session, fact_id: str) -> LedgerFactRow:
    row = session.get(LedgerFactRow, fact_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", f"fact {fact_id!r} not found")
    return row


def _mutate_ledger_fact(
    session: Session,
    fact_id: str,
    instruction: str,
    transform,
    *,
    expected_head_snapshot_id: str | None = None,
) -> dict:
    """Look up a fact, run `transform(ledger) -> ledger` inside one snapshot
    transaction, return the updated fact wire dict. Maps ledger_mutations
    errors to the contract envelope."""
    row = _fact_row_or_404(session, fact_id)
    pid = row.project_id
    try:
        snapshots.mutate(
            session,
            pid,
            instruction,
            lambda state: MutationState(
                doc=state.doc, ledger=transform(state.ledger), flags=state.flags
            ),
            expected_head_snapshot_id=expected_head_snapshot_id,
        )
    except snapshots.StaleHead as exc:
        raise ApiError(409, "CONFLICT_STALE_HEAD", str(exc)) from exc
    except ledger_mutations.FactNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"fact {fact_id!r} not found") from exc
    except ledger_mutations.ConflictStaleProposal as exc:
        raise ApiError(409, "CONFLICT_STALE_PROPOSAL", str(exc)) from exc
    except ledger_mutations.ValidationError as exc:
        raise ApiError(409, "VALIDATION", str(exc)) from exc

    updated = session.get(LedgerFactRow, fact_id)
    if updated is None:  # defensive: mutate rewrote the table
        raise ApiError(404, "NOT_FOUND", f"fact {fact_id!r} not found")
    return updated.to_wire_dict()


@ledger_router.post("/{fact_id}/confirm", response_model=LedgerFact)
def confirm_ledger_fact(
    fact_id: str,
    session: Session = Depends(get_session),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    """Confirm a pending_review fact (data contract §4 supersede semantics)."""
    return _mutate_ledger_fact(
        session,
        fact_id,
        "Ledger confirm",
        lambda ledger: ledger_mutations.confirm_fact(ledger, fact_id),
        expected_head_snapshot_id=_expected_head(if_match),
    )


@ledger_router.post("/{fact_id}/reject", response_model=LedgerFact)
def reject_ledger_fact(
    fact_id: str,
    session: Session = Depends(get_session),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    """Reject a pending_review fact; supersede target left untouched."""
    return _mutate_ledger_fact(
        session,
        fact_id,
        "Ledger reject",
        lambda ledger: ledger_mutations.reject_fact(ledger, fact_id),
        expected_head_snapshot_id=_expected_head(if_match),
    )


@ledger_router.patch("/{fact_id}", response_model=LedgerFact)
def edit_ledger_fact(
    fact_id: str,
    body: LedgerFactEdit,
    session: Session = Depends(get_session),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> dict:
    """Edit fact text and/or knownBy; provenance becomes writer_authored."""
    if body.fact is None and body.known_by is None:
        raise ApiError(400, "VALIDATION", "patch must include fact and/or knownBy")
    return _mutate_ledger_fact(
        session,
        fact_id,
        "Ledger edit",
        lambda ledger: ledger_mutations.edit_fact(
            ledger,
            fact_id,
            fact_text=body.fact,
            known_by=body.known_by,
        ),
        expected_head_snapshot_id=_expected_head(if_match),
    )
