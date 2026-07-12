"""Atomic create-and-import (data contract §9.3): `POST /projects/import` in
routes.py streams these events. This module builds the initial (unwritten)
project doc, runs `fountain/pipeline.analyze_import`'s LLM/parsing stages —
emitting a `stage` SSE frame as each begins — then writes the project row and
its **one** root snapshot (already carrying the imported doc/ledger/flags)
in a single transaction (`storage/snapshots.create_project_with_state`).

Every stage that can fail runs before that single write, so a fault at any
point — analysis or the write itself — leaves zero project-scoped rows
(no project, no snapshot, no facts, no flags; CLAUDE.md hard rule 4). This
is why the doc/ledger/flags are assembled entirely in memory here: there is
no "create an empty project, then import into it" step to roll back.

Failure shaping: once the stream has emitted its first `stage` frame, the
HTTP response is already 200 — a route-layer `ApiError` mapping is no longer
possible, so every *known* failure mode (coverage, locks, schema-invalid LLM
output, LLM transport, idempotency conflict) is caught here and turned into
one terminal `failed {error}` event instead. Anything else (an injected/
unexpected fault, e.g. a monkeypatched storage internal in tests) propagates
out of the generator uncaught — same contract as `pipeline.run_import`'s
mid-transaction fault test — because pytest asserting "zero rows changed"
needs the real exception, not a swallowed one.

No writer text is logged here (hard rule 5): only ids/counts/stage names.
"""

from __future__ import annotations

import logging
from collections.abc import Generator

import anthropic
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from drama_manager import locks
from fountain.parse import CoverageError
from fountain.pipeline import ImportStageProgress, ImportStageStarted, analyze_import
from llm.errors import LlmTimeoutError, SchemaInvalidLlmError
from llm.protocol import LlmClient
from sse import format_sse
from storage import snapshots
from storage.models import SnapshotRow
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
) -> Generator[str, None, None]:
    """Yield SSE wire frames for the create-and-import stream: a `stage`
    frame per named stage (data contract §9.3), then exactly one terminal
    `complete {result}` or `failed {error}`. See the module docstring for the
    atomicity and failure-shaping rules."""
    try:
        doc = initial_project_doc(title, format_dict, premise)

        analysis_gen = analyze_import(doc, [], content, llm)
        try:
            while True:
                event = next(analysis_gen)
                if isinstance(event, ImportStageStarted):
                    yield _stage_frame(event.name)
                elif isinstance(event, ImportStageProgress):
                    yield _progress_frame(event.stage, event.done, event.total)
                else:
                    raise TypeError(f"unknown import progress event: {type(event).__name__}")
        except StopIteration as stop:
            analysis = stop.value

        yield _stage_frame("saving")

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
            "create_and_import project=%s snapshot=%s facts=%d flags=%d",
            snap.project_id,
            snap.id,
            len(snap.ledger),
            len(snap.flags),
        )
    except CoverageError as exc:
        yield _failed_frame("VALIDATION", str(exc))
        return
    except locks.LockViolation as exc:
        yield _failed_frame("LOCKED_OBJECT", str(exc))
        return
    except SchemaInvalidLlmError as exc:
        yield _failed_frame("SCHEMA_INVALID_LLM", str(exc))
        return
    except (anthropic.APIError, LlmTimeoutError):
        yield _failed_frame("LLM_UNAVAILABLE", "the language model is unavailable")
        return
    except snapshots.IdempotencyConflict as exc:
        yield _failed_frame("IDEMPOTENCY_CONFLICT", str(exc))
        return

    yield _complete_frame(result)
