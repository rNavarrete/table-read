"""Atomic create-and-import (data contract §9.3): `POST /projects/import` in
routes.py streams these events. This module builds the initial (unwritten)
project doc, runs `fountain/pipeline.analyze_import`'s LLM/parsing stages —
emitting `stage` SSE frames as stages begin and `progress` frames as scene
work completes — then writes the project row and its **one** root snapshot
(already carrying the imported doc/ledger/flags) in a single transaction
(`storage/snapshots.create_project_with_state`).

Every stage that can fail runs before that single project write, so a fault
leaves zero project-scoped rows (no project, snapshot, facts, or flags).
Pre-project ``ImportRunRow`` checkpoints deliberately survive so the same
request can resume completed model work without weakening project atomicity.

Failure shaping: once the stream has emitted its first `stage` or `progress`
frame, the HTTP response is already 200 — a route-layer `ApiError` mapping is
no longer possible, so every *known* failure mode (coverage, locks,
schema-invalid LLM output, LLM transport, idempotency conflict) is caught here
and turned into one terminal `failed {error}` event instead. Anything else (an
injected/unexpected fault, e.g. a monkeypatched storage internal in tests) propagates
out of the generator uncaught — same contract as `pipeline.run_import`'s
mid-transaction fault test — because pytest asserting "zero rows changed"
needs the real exception, not a swallowed one.

No writer text is logged here (hard rule 5): only ids/counts/stage names.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Generator
from time import monotonic

import anthropic
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from drama_manager import locks
from fountain import import_runs
from fountain.parse import CoverageError
from fountain.pipeline import ImportStageProgress, ImportStageStarted, analyze_import
from import_diagnostics import import_run_context, new_import_run_id
from llm.errors import LlmTimeoutError, SchemaInvalidLlmError, log_llm_unavailable
from llm.protocol import LlmClient
from sse import format_sse
from storage import snapshots
from storage.models import ImportRunRow, SnapshotRow
from storage.project_scaffold import initial_project_doc

_logger = logging.getLogger("fountain.create_import")


def _stage_frame(name: str) -> str:
    return format_sse("stage", {"type": "stage", "name": name})


def _progress_frame(stage: str, done: int, total: int) -> str:
    return format_sse(
        "progress",
        {"type": "progress", "stage": stage, "done": done, "total": total},
    )


def _failed_frame(code: str, message: str) -> str:
    return format_sse("failed", {"type": "failed", "error": {"code": code, "message": message}})


def _complete_frame(result: dict) -> str:
    return format_sse("complete", {"type": "complete", "result": result})


def _root_snapshot(session: Session, project_id: str) -> SnapshotRow:
    return (
        session.query(SnapshotRow)
        .filter_by(project_id=project_id, parent_id=None)
        .one()
    )


def _result_from_snapshot(snap: SnapshotRow) -> dict:
    return {"project": snap.doc, "newFacts": snap.ledger, "consistencyFlags": snap.flags}


def _elapsed_ms(started_at: float) -> int:
    return round((monotonic() - started_at) * 1000)


def _log_import_failed(
    run_id: str,
    stage: str,
    started_at: float,
    code: str,
    exc: BaseException,
) -> None:
    """Log only stable metadata; exception messages may carry source text."""
    _logger.warning(
        "import_failed run_id=%s stage=%s elapsed_ms=%d error_code=%s cause=%s op=%s "
        "timeout_seconds=%s",
        run_id,
        stage,
        _elapsed_ms(started_at),
        code,
        type(exc).__name__,
        getattr(exc, "op", None),
        getattr(exc, "timeout_seconds", None),
    )


def replay_events(session: Session, project_id: str) -> Generator[str, None, None]:
    """Idempotent SSE replay (data contract §9.3): same `Idempotency-Key` +
    same canonical request hash after a prior success re-emits the terminal
    `complete` event carrying the original import result (from the project's
    root snapshot — the state exactly as imported, regardless of any later
    edits), running no analysis and touching no LLM."""
    yield _complete_frame(_result_from_snapshot(_root_snapshot(session, project_id)))


def create_and_import_events(
    session: Session,
    *,
    title: str,
    format_dict: dict,
    premise: str,
    source_format: str,
    content: str,
    llm: LlmClient,
    creation_idempotency_key: str,
    creation_request_hash: str,
    import_run_id: str | None = None,
    import_run: ImportRunRow | None = None,
    should_execute: bool = True,
) -> Generator[str, None, None]:
    """Yield SSE wire frames for the create-and-import stream: a `stage`
    frame per named stage (data contract §9.3), then exactly one terminal
    `complete {result}` or `failed {error}`. See the module docstring for the
    atomicity and failure-shaping rules."""
    run_id = (
        import_run.id
        if import_run is not None
        else (import_run_id or new_import_run_id())
    )
    started_at = monotonic()
    current_stage = "preparing"
    source_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    _logger.info(
        "import_started run_id=%s source_format=%s source_chars=%d source_hash=%s",
        run_id,
        source_format,
        len(content),
        source_hash,
    )
    if import_run is not None and not should_execute:
        if import_run.error_code == "LLM_TIMEOUT":
            yield _failed_frame(
                "RETRY_PAUSED",
                "retry is temporarily paused because the timed-out provider "
                "request may still be running; saved progress is safe",
            )
            return
        yield _failed_frame(
            "IMPORT_IN_PROGRESS",
            "this import is already running; wait for the active attempt to finish",
        )
        return

    try:
        checkpoint: dict = {}
        checkpoint_writer = None
        if import_run is not None:
            import_runs.mark_running(session, import_run)
            checkpoint = import_runs.load_checkpoint(session, import_run)

            def persist_checkpoint(
                stage: str, value: dict | list, unit_index: int | None
            ) -> None:
                import_runs.save_checkpoint(
                    session,
                    import_run,
                    stage=stage,
                    value=value,
                    unit_index=unit_index,
                )

            checkpoint_writer = persist_checkpoint

        doc = initial_project_doc(title, format_dict, premise)

        analysis_gen = analyze_import(
            doc,
            [],
            content,
            llm,
            checkpoint=checkpoint,
            checkpoint_writer=checkpoint_writer,
        )
        try:
            while True:
                # Streaming resumes generators in a fresh context after each
                # SSE frame, so scope the correlation context to each advance.
                with import_run_context(run_id):
                    event = next(analysis_gen)
                if isinstance(event, ImportStageStarted):
                    current_stage = event.name
                    _logger.info(
                        "import_stage_started run_id=%s stage=%s elapsed_ms=%d",
                        run_id,
                        current_stage,
                        _elapsed_ms(started_at),
                    )
                    yield _stage_frame(event.name)
                elif isinstance(event, ImportStageProgress):
                    _logger.info(
                        "import_stage_progress run_id=%s stage=%s done=%d total=%d "
                        "elapsed_ms=%d",
                        run_id,
                        event.stage,
                        event.done,
                        event.total,
                        _elapsed_ms(started_at),
                    )
                    yield _progress_frame(event.stage, event.done, event.total)
                else:
                    raise TypeError(f"unknown import progress event: {type(event).__name__}")
        except StopIteration as stop:
            analysis = stop.value

        current_stage = "saving"
        _logger.info(
            "import_stage_started run_id=%s stage=%s elapsed_ms=%d",
            run_id,
            current_stage,
            _elapsed_ms(started_at),
        )
        yield _stage_frame("saving")
        yield _progress_frame("saving", 0, 1)

        project_id = snapshots.mint_project_id()
        snapshot_id = snapshots.mint_snapshot_id()
        flags = [{**f, "sourceChange": snapshot_id} for f in analysis.raw_flags]

        try:
            snap = snapshots.create_project_with_state(
                session,
                project_id,
                snapshot_id,
                analysis.new_doc,
                analysis.new_facts,
                flags,
                f"Imported {source_format} script",
                creation_idempotency_key=creation_idempotency_key,
                creation_request_hash=creation_request_hash,
            )
        except IntegrityError:
            # A concurrent request for the same Idempotency-Key won the
            # unique-constraint race (mirrors routes.create_project's
            # unique-race handling, T4's idempotency semantics). Resolve to
            # that request's result rather than surfacing a spurious failure.
            session.rollback()
            existing = snapshots.resolve_creation_idempotency(
                session, creation_idempotency_key, creation_request_hash
            )
            if existing is None:
                raise
            snap = _root_snapshot(session, existing.id)

        result = _result_from_snapshot(snap)
        _logger.info(
            "import_completed run_id=%s project=%s snapshot=%s facts=%d flags=%d elapsed_ms=%d",
            run_id,
            snap.project_id,
            snap.id,
            len(snap.ledger),
            len(snap.flags),
            _elapsed_ms(started_at),
        )
        if import_run is not None:
            import_runs.mark_completed(
                session,
                import_run,
                project_id=snap.project_id,
            )
        yield _progress_frame("saving", 1, 1)
    except CoverageError as exc:
        _log_import_failed(run_id, current_stage, started_at, "VALIDATION", exc)
        if import_run is not None:
            import_runs.mark_failed(
                session,
                import_run,
                phase=current_stage,
                code="VALIDATION",
                message=str(exc),
            )
        yield _failed_frame("VALIDATION", str(exc))
        return
    except locks.LockViolation as exc:
        _log_import_failed(run_id, current_stage, started_at, "LOCKED_OBJECT", exc)
        if import_run is not None:
            import_runs.mark_failed(
                session,
                import_run,
                phase=current_stage,
                code="LOCKED_OBJECT",
                message=str(exc),
            )
        yield _failed_frame("LOCKED_OBJECT", str(exc))
        return
    except SchemaInvalidLlmError as exc:
        _log_import_failed(run_id, current_stage, started_at, "SCHEMA_INVALID_LLM", exc)
        if import_run is not None:
            import_runs.mark_failed(
                session,
                import_run,
                phase=current_stage,
                code="SCHEMA_INVALID_LLM",
                message=str(exc),
            )
        yield _failed_frame("SCHEMA_INVALID_LLM", str(exc))
        return
    except (anthropic.APIError, LlmTimeoutError) as exc:
        # SSE already started (HTTP 200): surface LLM_UNAVAILABLE as a terminal
        # event. Log class/status/op only — never message/body (hard rule 5).
        _log_import_failed(run_id, current_stage, started_at, "LLM_UNAVAILABLE", exc)
        with import_run_context(run_id):
            log_llm_unavailable(_logger, exc, where="create_and_import")
        if import_run is not None:
            stored_code = (
                "LLM_TIMEOUT" if isinstance(exc, LlmTimeoutError) else "LLM_UNAVAILABLE"
            )
            import_runs.mark_failed(
                session,
                import_run,
                phase=current_stage,
                code=stored_code,
                message="the language model is unavailable",
            )
        yield _failed_frame("LLM_UNAVAILABLE", "the language model is unavailable")
        return
    except snapshots.IdempotencyConflict as exc:
        _log_import_failed(run_id, current_stage, started_at, "IDEMPOTENCY_CONFLICT", exc)
        if import_run is not None:
            import_runs.mark_failed(
                session,
                import_run,
                phase=current_stage,
                code="IDEMPOTENCY_CONFLICT",
                message=str(exc),
            )
        yield _failed_frame("IDEMPOTENCY_CONFLICT", str(exc))
        return
    except Exception as exc:
        _log_import_failed(run_id, current_stage, started_at, "UNEXPECTED", exc)
        if import_run is not None:
            session.rollback()
            refreshed = session.get(ImportRunRow, import_run.id)
            if refreshed is not None:
                import_runs.mark_failed(
                    session,
                    refreshed,
                    phase=current_stage,
                    code="UNEXPECTED",
                    message="unexpected import failure",
                )
        raise
    except BaseException:
        if import_run is not None:
            session.rollback()
            refreshed = session.get(ImportRunRow, import_run.id)
            if refreshed is not None:
                import_runs.mark_failed(
                    session,
                    refreshed,
                    phase=current_stage,
                    code="WORKER_INTERRUPTED",
                    message="the import worker stopped; saved checkpoints are retained",
                )
        raise

    yield _complete_frame(result)
