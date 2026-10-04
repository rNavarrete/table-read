"""Durable checkpoints for atomic create-and-import.

Project rows remain atomic: nothing project-scoped is created until analysis
finishes. This pre-project run record stores only derived stage results and
lets a request with the same Idempotency-Key and request hash resume missing
work instead of paying to repeat completed model calls.
"""

from __future__ import annotations

import copy
import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from drama_manager import render
from storage.models import ImportRunRow, ImportRunUnitRow, ProjectRow

IMPORT_ANALYSIS_VERSION = "2026-10-04.2"
# Saved units hold verbatim script text, so an unfinished run is not kept
# indefinitely for a retry that may never come.
UNFINISHED_RUN_RETENTION = timedelta(days=7)
_MODELS_CONFIG = Path(__file__).resolve().parents[3] / "config" / "models.toml"
RUN_RECOVERY_AGE = timedelta(minutes=10)
_TIMEOUT_RETRY_GRACE = timedelta(minutes=10)


class ImportRunConflict(Exception):
    pass


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _touch(run: ImportRunRow, **changes: object) -> None:
    for name, value in changes.items():
        if name == "checkpoint" and isinstance(value, dict):
            value = copy.deepcopy(value)
        setattr(run, name, value)
    run.updated_at = _utcnow()


def _clear_units(session: Session, run_id: str) -> None:
    session.query(ImportRunUnitRow).filter_by(run_id=run_id).delete(
        synchronize_session=False
    )


def analysis_version() -> str:
    """A prompt or model-pin change invalidates every saved unit."""
    models_hash = hashlib.sha256(_MODELS_CONFIG.read_bytes()).hexdigest()[:12]
    return f"{IMPORT_ANALYSIS_VERSION}+{render.PROMPT_VERSION}+{models_hash}"


def _purge_expired_runs(session: Session) -> None:
    expired = [
        run_id
        for (run_id,) in session.query(ImportRunRow.id).filter(
            ImportRunRow.status != "completed",
            ImportRunRow.updated_at < _utcnow() - UNFINISHED_RUN_RETENTION,
        )
    ]
    session.query(ImportRunUnitRow).filter(ImportRunUnitRow.run_id.in_(expired)).delete(
        synchronize_session=False
    )
    session.query(ImportRunRow).filter(ImportRunRow.id.in_(expired)).delete(
        synchronize_session=False
    )
    session.commit()


def create_or_resume_run(
    session: Session,
    *,
    idempotency_key: str,
    request_hash: str,
    content: str,
) -> tuple[ImportRunRow, bool]:
    """Return ``(run, should_execute)`` without ever invoking the model."""
    _purge_expired_runs(session)
    version = analysis_version()
    existing = (
        session.query(ImportRunRow)
        .filter_by(idempotency_key=idempotency_key)
        .one_or_none()
    )
    source_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    if existing is None:
        run = ImportRunRow(
            id=f"import-{uuid4()}",
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            source_hash=source_hash,
            analysis_version=version,
            status="queued",
            phase="preparing",
            attempt_count=1,
            checkpoint={},
        )
        session.add(run)
        session.commit()
        return run, True

    request_changed = (
        existing.request_hash != request_hash or existing.source_hash != source_hash
    )
    completed_project_exists = (
        existing.result_project_id is not None
        and session.get(ProjectRow, existing.result_project_id) is not None
    )
    if existing.status == "completed" and not completed_project_exists:
        # Defensive recovery for a separately removed project (and isolated
        # test databases): the stale pre-project run cannot be replayed.
        _clear_units(session, existing.id)
        _touch(
            existing,
            request_hash=request_hash,
            source_hash=source_hash,
            analysis_version=version,
            status="queued",
            phase="preparing",
            scene_count=0,
            completed_scene_count=0,
            attempt_count=existing.attempt_count + 1,
            result_project_id=None,
            error_code=None,
            error_message=None,
            checkpoint={},
        )
        session.commit()
        return existing, True

    if existing.status == "failed" and request_changed:
        # Editing the source after a failed atomic import is allowed, but no
        # prior derived result is compatible with the new request.
        _clear_units(session, existing.id)
        _touch(
            existing,
            request_hash=request_hash,
            source_hash=source_hash,
            analysis_version=version,
            status="queued",
            phase="preparing",
            scene_count=0,
            completed_scene_count=0,
            attempt_count=existing.attempt_count + 1,
            result_project_id=None,
            error_code=None,
            error_message=None,
            checkpoint={},
        )
        session.commit()
        return existing, True

    if request_changed:
        raise ImportRunConflict(
            "Idempotency-Key was already used for a different import request"
        )

    if existing.analysis_version != version:
        _clear_units(session, existing.id)
        _touch(
            existing,
            analysis_version=version,
            status="queued",
            phase="preparing",
            scene_count=0,
            completed_scene_count=0,
            attempt_count=existing.attempt_count + 1,
            result_project_id=None,
            error_code=None,
            error_message=None,
            checkpoint={},
        )
        session.commit()
        return existing, True

    if (
        existing.status == "failed"
        and existing.error_code == "LLM_TIMEOUT"
        and existing.updated_at >= _utcnow() - _TIMEOUT_RETRY_GRACE
    ):
        return existing, False

    if existing.status == "failed":
        _touch(
            existing,
            status="queued",
            phase="resuming",
            attempt_count=existing.attempt_count + 1,
            error_code=None,
            error_message=None,
        )
        session.commit()
        return existing, True

    if (
        existing.status in {"queued", "running"}
        and existing.updated_at < _utcnow() - RUN_RECOVERY_AGE
    ):
        _touch(
            existing,
            status="queued",
            phase="resuming",
            attempt_count=existing.attempt_count + 1,
            error_code="WORKER_INTERRUPTED",
            error_message="The previous worker stopped; resuming saved checkpoints.",
        )
        session.commit()
        return existing, True

    return existing, False


def load_checkpoint(session: Session, run: ImportRunRow) -> dict:
    checkpoint = copy.deepcopy(run.checkpoint or {})
    units = (
        session.query(ImportRunUnitRow)
        .filter_by(run_id=run.id)
        .order_by(ImportRunUnitRow.stage, ImportRunUnitRow.unit_index)
        .all()
    )
    for unit in units:
        checkpoint.setdefault(unit.stage, {})[str(unit.unit_index)] = copy.deepcopy(
            unit.payload
        )
    return checkpoint


def mark_running(session: Session, run: ImportRunRow) -> None:
    _touch(
        run,
        status="running",
        phase="preparing",
        error_code=None,
        error_message=None,
    )
    session.commit()


def save_checkpoint(
    session: Session,
    run: ImportRunRow,
    *,
    stage: str,
    value: dict | list,
    unit_index: int | None = None,
) -> None:
    """Persist one completed unit before its progress event is emitted."""
    if unit_index is None:
        checkpoint = copy.deepcopy(run.checkpoint or {})
        checkpoint[stage] = copy.deepcopy(value)
        changes: dict[str, object] = {
            "status": "running",
            "phase": stage,
            "checkpoint": checkpoint,
        }
        if stage == "parsing_scenes" and isinstance(value, dict):
            changes["scene_count"] = int(value.get("sceneCount") or 0)
        _touch(run, **changes)
    else:
        unit_id = f"{run.id}:{stage}:{unit_index}"
        unit = session.get(ImportRunUnitRow, unit_id)
        if unit is None:
            unit = ImportRunUnitRow(
                id=unit_id,
                run_id=run.id,
                stage=stage,
                unit_index=unit_index,
                payload=copy.deepcopy(value),
            )
            session.add(unit)
        else:
            unit.payload = copy.deepcopy(value)
            unit.updated_at = _utcnow()
        completed = run.completed_scene_count
        if stage == "segmenting_beats":
            session.flush()
            completed = (
                session.query(ImportRunUnitRow)
                .filter_by(run_id=run.id, stage="segmenting_beats")
                .count()
            )
        _touch(
            run,
            status="running",
            phase=stage,
            completed_scene_count=completed,
        )
    session.commit()


def mark_failed(
    session: Session,
    run: ImportRunRow,
    *,
    phase: str,
    code: str,
    message: str,
) -> None:
    _touch(
        run,
        status="failed",
        phase=phase,
        error_code=code,
        error_message=message,
    )
    session.commit()


def mark_completed(
    session: Session, run: ImportRunRow, *, project_id: str
) -> None:
    _clear_units(session, run.id)
    _touch(
        run,
        status="completed",
        phase="completed",
        result_project_id=project_id,
        completed_scene_count=run.scene_count,
        error_code=None,
        error_message=None,
        checkpoint={},
    )
    session.commit()
