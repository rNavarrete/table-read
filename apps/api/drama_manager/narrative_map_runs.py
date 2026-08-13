"""Durable, idempotent orchestration for evidence-grounded Narrative Maps.

The HTTP request only creates or resumes a run. Model work happens in a small
background executor and checkpoints after each verified scene chunk, so browser
refreshes and repeat clicks cannot launch a second expensive analysis for the
same saved screenplay. No writer-owned source text is logged from this module.
"""

from __future__ import annotations

import copy
import logging
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from drama_manager import render
from drama_manager.narrative_map import (
    NarrativeMapValidationError,
    materialize_synthesized_threads,
    merge_narrative_map,
)
from drama_manager.narrative_map_analysis import (
    NARRATIVE_MAP_ANALYSIS_VERSION,
    NarrativeMapAnalysisValidationError,
    NarrativeMapReadinessError,
    build_inferred_narrative_map,
    character_footprint,
    chunk_scene_sources,
    deterministic_non_narrative_packets,
    normalize_scene_packet_focal_characters,
    normalize_scene_packet_quality,
    partition_self_retracted_claims,
    prepare_narrative_map_source,
    repair_candidate_from_verification,
    reusable_scene_packets,
    source_backed_scene_fallback,
    synthesis_scene_spine,
    validate_scene_analysis_batch,
    validate_verification,
    verification_audit_evidence,
    verification_supports_local_repair,
)
from import_diagnostics import import_run_context
from llm.errors import LlmTimeoutError, SchemaInvalidLlmError
from llm.protocol import LlmClient
from schemas import InferredNarrativeMapSynthesis, NarrativeMapVerification
from storage import snapshots
from storage.db import SessionLocal
from storage.models import NarrativeMapRunRow, ProjectRow, SnapshotRow, _utcnow
from storage.snapshots import MutationState

_logger = logging.getLogger("drama_manager.narrative_map_runs")
_RUN_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="narrative-map")
_ACTIVE_RUN_IDS: set[str] = set()
_ACTIVE_RUN_LOCK = threading.Lock()
# Provider calls heartbeat durably while they run. If both the in-process
# ownership marker and heartbeat disappear, one minute is enough to classify
# the worker as interrupted without racing a healthy long synthesis.
_RUN_HEARTBEAT_SECONDS = 15.0
_RUN_RECOVERY_AGE = timedelta(minutes=1)
_TIMEOUT_RETRY_GRACE = timedelta(minutes=10)


def _utc_z(value: datetime) -> str:
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.isoformat().replace("+00:00", "Z")


def serialize_run(run: NarrativeMapRunRow) -> dict:
    """Return the safe public status shape; checkpoints stay server-internal."""
    error_message = run.error_message
    if _scene_packet_quality_repair_available(run):
        error_message = (
            "A saved scene-packet repair is available. It reuses every completed scene and "
            "the saved Opus synthesis; only one compact verification call remains."
        )
    elif _focal_character_repair_available(run):
        error_message = (
            "A local focal-character repair is available. Saved scene analysis and synthesis "
            "will be reused; only independent verification remains."
        )
    elif _thread_repair_available(run):
        error_message = (
            "A deterministic thread-reference repair is available. Saved scene analysis "
            "and synthesis will be reused; only independent verification remains."
        )
    elif _verifier_transport_repair_available(run):
        error_message = (
            "A corrected strict verifier is available. Saved scene analysis, synthesis, "
            "and materialized threads will be reused; only one verification call remains."
        )
    elif _verification_policy_repair_available(run):
        error_message = (
            "A no-cost local evidence repair is available. Only verifier-rejected claims "
            "will be removed; all completed analysis is reused and no model call will run."
        )
    return {
        "id": run.id,
        "projectId": run.project_id,
        "sourceSnapshotId": run.source_snapshot_id,
        "sourceHash": run.source_hash,
        "analysisVersion": run.analysis_version,
        "status": run.status,
        "phase": run.phase,
        "sceneCount": run.scene_count,
        "completedSceneCount": run.completed_scene_count,
        "attemptCount": run.attempt_count,
        "retryAllowed": _retry_allowed(run),
        "estimatedCostUsd": run.estimated_cost_usd,
        "actualInputTokens": run.actual_input_tokens,
        "actualOutputTokens": run.actual_output_tokens,
        "resultSnapshotId": run.result_snapshot_id,
        "errorCode": run.error_code,
        "errorMessage": error_message,
        "rejectionDiagnostics": _rejection_diagnostics(run),
        "createdAt": _utc_z(run.created_at),
        "updatedAt": _utc_z(run.updated_at),
    }


# Rule 5 lives at the logging boundary, not here: `_reject_run` logs
# `diagnostic_codes` and nothing else, so the reason never reaches a log file.
# This response goes to the writer, about their own script, and the reason is
# the only part they can act on — "not evidenced at beat-12-6 (that beat is
# Leo/Josh dialogue)" tells them something; the bare path does not.
_MAX_SURFACED_DIAGNOSTICS = 12


def _rejection_diagnostics(run: NarrativeMapRunRow) -> list[dict]:
    """Why the evidence gate rejected this run, for the writer to read.

    These were already recorded on the run's checkpoint and shown nowhere: the
    panel said only "the evidence gate rejected this analysis", so a rejection
    that had just cost a full analysis gave no way to tell an over-claiming
    synthesis from a genuinely unsupportable script — the reasons had to be
    read out of SQLite by hand.
    """
    checkpoint = run.checkpoint if isinstance(run.checkpoint, dict) else {}
    raw = checkpoint.get("rejectionDiagnostics")
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for entry in raw[:_MAX_SURFACED_DIAGNOSTICS]:
        if not isinstance(entry, dict):
            continue
        path = str(entry.get("path") or "").strip()
        if path:
            out.append(
                {
                    "code": str(entry.get("code") or "rejected"),
                    "path": path,
                    "reason": str(entry.get("reason") or "").strip(),
                }
            )
    return out


def _retry_allowed(run: NarrativeMapRunRow) -> bool:
    if run.status in {"queued", "running", "completed"}:
        return False
    if run.analysis_version != NARRATIVE_MAP_ANALYSIS_VERSION:
        return True
    if run.status == "stale":
        return True
    if _scene_packet_quality_repair_available(run):
        return True
    if _focal_character_repair_available(run):
        return True
    if _thread_repair_available(run):
        return True
    if _verifier_transport_repair_available(run):
        return True
    if _verification_policy_repair_available(run):
        return True
    return (
        run.error_code in {"LLM_TIMEOUT", "WORKER_INTERRUPTED"}
        and run.updated_at < _utcnow() - _TIMEOUT_RETRY_GRACE
    )


def _scene_packet_quality_repair_available(run: NarrativeMapRunRow) -> bool:
    """Return whether a rejected scene-turn filler can be repaired locally."""
    checkpoint = run.checkpoint or {}
    diagnostics = checkpoint.get("rejectionDiagnostics") or []
    blocking_paths = [
        str(item.get("path") or "")
        for item in diagnostics
        if isinstance(item, dict) and item.get("code") == "verifier_rejected"
    ]
    return (
        run.status == "rejected"
        and run.error_code == "EVIDENCE_REJECTED"
        and isinstance(checkpoint.get("synthesis"), dict)
        and isinstance(checkpoint.get("verification"), dict)
        and bool(blocking_paths)
        and all(path.startswith("sceneTurns[") for path in blocking_paths)
    )


def _focal_character_repair_available(run: NarrativeMapRunRow) -> bool:
    checkpoint = run.checkpoint or {}
    diagnostics = checkpoint.get("rejectionDiagnostics") or []
    return (
        run.status == "rejected"
        and run.error_code == "EVIDENCE_REJECTED"
        and isinstance(checkpoint.get("synthesis"), dict)
        and bool(diagnostics)
        and all(
            isinstance(item, dict)
            and item.get("code") == "unknown_character"
            and str(item.get("path") or "").startswith("sceneTurns[")
            for item in diagnostics
        )
    )


def _thread_repair_available(run: NarrativeMapRunRow) -> bool:
    checkpoint = run.checkpoint or {}
    diagnostics = checkpoint.get("rejectionDiagnostics") or []
    synthesis = checkpoint.get("synthesis")
    return (
        run.status == "rejected"
        and run.error_code == "EVIDENCE_REJECTED"
        and isinstance(synthesis, dict)
        and bool(synthesis.get("threadMovements"))
        and bool(diagnostics)
        and all(
            isinstance(item, dict) and item.get("code") == "unknown_thread" for item in diagnostics
        )
    )


def _verifier_transport_repair_available(run: NarrativeMapRunRow) -> bool:
    checkpoint = run.checkpoint or {}
    return (
        run.status == "failed"
        and run.error_code == "SCHEMA_INVALID_LLM"
        and isinstance(checkpoint.get("synthesis"), dict)
        and checkpoint.get("threadRepairVersion") == 1
        and not checkpoint.get("verification")
    )


def _verification_policy_repair_available(run: NarrativeMapRunRow) -> bool:
    checkpoint = run.checkpoint or {}
    verification = checkpoint.get("verification")
    if not isinstance(verification, dict):
        return False
    try:
        verdict = NarrativeMapVerification.model_validate(verification)
    except ValueError:
        return False
    diagnostics = checkpoint.get("rejectionDiagnostics") or []
    return (
        run.status == "rejected"
        and run.error_code == "EVIDENCE_REJECTED"
        and isinstance(checkpoint.get("synthesis"), dict)
        and bool(diagnostics)
        and all(
            isinstance(item, dict)
            and item.get("code")
            in {
                "verifier_rejected",
                "verifier_issue",
                "verification_repair_path_unresolved",
                "verification_repair_path_unsupported",
            }
            for item in diagnostics
        )
        and verification_supports_local_repair(verdict)
    )


def _run_key(project_id: str, source_hash: str) -> str:
    return f"{project_id}:{NARRATIVE_MAP_ANALYSIS_VERSION}:{source_hash}"


def _touch(run: NarrativeMapRunRow, **changes: object) -> None:
    for name, value in changes.items():
        if name == "checkpoint" and isinstance(value, dict):
            # SQLAlchemy JSON columns do not detect nested in-place mutation.
            # Assign a fresh object at every durable phase boundary.
            value = copy.deepcopy(value)
        setattr(run, name, value)
    run.updated_at = _utcnow()


def _is_recoverable_interruption(run: NarrativeMapRunRow) -> bool:
    with _ACTIVE_RUN_LOCK:
        if run.id in _ACTIVE_RUN_IDS:
            return False
    return run.status in {"queued", "running"} and run.updated_at < _utcnow() - _RUN_RECOVERY_AGE


def _call_with_run_heartbeat[T](run_id: str, call: Callable[[], T]) -> T:
    """Keep a durable liveness timestamp fresh during one provider call."""

    stop = threading.Event()

    def heartbeat() -> None:
        while not stop.wait(_RUN_HEARTBEAT_SECONDS):
            session = SessionLocal()
            try:
                run = session.get(NarrativeMapRunRow, run_id)
                if run is None or run.status not in {"queued", "running"}:
                    return
                _touch(run)
                session.commit()
            except Exception:
                session.rollback()
                _logger.exception("narrative_map_heartbeat_failed run_id=%s", run_id)
            finally:
                session.close()

    thread = threading.Thread(
        target=heartbeat,
        name=f"narrative-map-heartbeat-{run_id[-8:]}",
        daemon=True,
    )
    thread.start()
    try:
        return call()
    finally:
        stop.set()
        thread.join(timeout=1.0)


def mark_interrupted_run(session: Session, run: NarrativeMapRunRow) -> bool:
    """Turn a stale worker-owned status into an explicit, checkpoint-safe failure."""
    if not _is_recoverable_interruption(run):
        return False
    _touch(
        run,
        status="failed",
        phase="failed",
        error_code="WORKER_INTERRUPTED",
        error_message=(
            "The analysis worker restarted. Saved scene checkpoints are safe; "
            "resume to continue from the last completed scene."
        ),
    )
    session.commit()
    _logger.warning(
        "narrative_map_worker_interrupted run_id=%s completed=%d total=%d",
        run.id,
        run.completed_scene_count,
        run.scene_count,
    )
    return True


def create_or_resume_run(
    session: Session,
    project: ProjectRow,
    *,
    source_snapshot_id: str,
) -> tuple[NarrativeMapRunRow, bool]:
    """Create at most one active run per source hash or resume safe failures.

    Returns `(run, should_enqueue)`. An interrupted process is recoverable from
    its checkpoint; a timed-out provider call is intentionally held for a grace
    period because the local timeout wrapper cannot prove the provider stopped.
    """
    source_snapshot = session.get(SnapshotRow, source_snapshot_id)
    if source_snapshot is None or source_snapshot.project_id != project.id:
        raise LookupError(source_snapshot_id)
    source = prepare_narrative_map_source(source_snapshot.doc)
    key = _run_key(project.id, source.source_hash)
    existing = session.query(NarrativeMapRunRow).filter_by(run_key=key).one_or_none()
    if existing is not None:
        if _is_recoverable_interruption(existing):
            _touch(
                existing,
                status="queued",
                phase="readiness",
                error_code="WORKER_INTERRUPTED",
                error_message="The previous analysis worker stopped. Resuming saved checkpoints.",
                attempt_count=existing.attempt_count + 1,
            )
            session.commit()
            return existing, True
        if (
            existing.status == "failed"
            and existing.error_code in {"LLM_TIMEOUT", "WORKER_INTERRUPTED"}
            and existing.updated_at < _utcnow() - _TIMEOUT_RETRY_GRACE
        ):
            _touch(
                existing,
                status="queued",
                phase="readiness",
                error_code=None,
                error_message=None,
                attempt_count=existing.attempt_count + 1,
            )
            session.commit()
            return existing, True
        if _scene_packet_quality_repair_available(existing):
            checkpoint = dict(existing.checkpoint or {})
            checkpoint.pop("rejectionDiagnostics", None)
            checkpoint.pop("verification", None)
            checkpoint.pop("verificationAdjudication", None)
            checkpoint["scenePacketRepairVersion"] = 1
            _touch(
                existing,
                status="queued",
                phase="readiness",
                error_code=None,
                error_message=None,
                attempt_count=existing.attempt_count + 1,
                checkpoint=checkpoint,
            )
            session.commit()
            return existing, True
        if _focal_character_repair_available(existing):
            checkpoint = dict(existing.checkpoint or {})
            checkpoint.pop("rejectionDiagnostics", None)
            checkpoint["focalCharacterRepairVersion"] = 1
            _touch(
                existing,
                status="queued",
                phase="readiness",
                error_code=None,
                error_message=None,
                attempt_count=existing.attempt_count + 1,
                checkpoint=checkpoint,
            )
            session.commit()
            return existing, True
        if _thread_repair_available(existing):
            checkpoint = dict(existing.checkpoint or {})
            checkpoint.pop("rejectionDiagnostics", None)
            checkpoint["threadRepairVersion"] = 1
            _touch(
                existing,
                status="queued",
                phase="readiness",
                error_code=None,
                error_message=None,
                attempt_count=existing.attempt_count + 1,
                checkpoint=checkpoint,
            )
            session.commit()
            return existing, True
        if _verifier_transport_repair_available(existing):
            checkpoint = dict(existing.checkpoint or {})
            checkpoint["verifierTransportVersion"] = 1
            _touch(
                existing,
                status="queued",
                phase="readiness",
                error_code=None,
                error_message=None,
                attempt_count=existing.attempt_count + 1,
                checkpoint=checkpoint,
            )
            session.commit()
            return existing, True
        if _verification_policy_repair_available(existing):
            checkpoint = dict(existing.checkpoint or {})
            checkpoint.pop("rejectionDiagnostics", None)
            checkpoint["verificationPolicyVersion"] = 2
            _touch(
                existing,
                status="queued",
                phase="readiness",
                error_code=None,
                error_message=None,
                attempt_count=existing.attempt_count + 1,
                checkpoint=checkpoint,
            )
            session.commit()
            return existing, True
        return existing, False

    prior_packets: list[dict] = []
    prior_runs = (
        session.query(NarrativeMapRunRow)
        .filter_by(project_id=project.id, source_hash=source.source_hash)
        .order_by(NarrativeMapRunRow.updated_at.desc())
        .all()
    )
    for prior_run in prior_runs:
        for packet in (prior_run.checkpoint or {}).get("scenePackets", []):
            if isinstance(packet, dict) and packet.get("sceneId"):
                prior_packets.append(packet)
    deterministic_packets = deterministic_non_narrative_packets(source.scene_sources)
    narrative_sources = [
        scene for scene in source.scene_sources if scene.get("sourceKind") == "narrative"
    ]
    reused_packets = reusable_scene_packets(narrative_sources, prior_packets)
    seeded_by_scene = {
        packet["sceneId"]: packet for packet in [*deterministic_packets, *reused_packets]
    }
    seeded_packets = [
        seeded_by_scene[scene["sceneId"]]
        for scene in source.scene_sources
        if scene["sceneId"] in seeded_by_scene
    ]
    checkpoint = {"scenePackets": seeded_packets} if seeded_packets else {}

    run = NarrativeMapRunRow(
        id=f"nmap-{uuid.uuid4().hex}",
        project_id=project.id,
        run_key=key,
        source_snapshot_id=source_snapshot_id,
        source_hash=source.source_hash,
        analysis_version=NARRATIVE_MAP_ANALYSIS_VERSION,
        status="queued",
        phase="readiness",
        scene_count=source.scene_count,
        completed_scene_count=len(seeded_packets),
        attempt_count=1,
        checkpoint=checkpoint,
    )
    try:
        session.add(run)
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.query(NarrativeMapRunRow).filter_by(run_key=key).one()
        return existing, False
    if deterministic_packets:
        _logger.info(
            "narrative_map_non_narrative_packets_seeded run_id=%s count=%d total=%d",
            run.id,
            len(deterministic_packets),
            source.scene_count,
        )
    if reused_packets:
        _logger.info(
            "narrative_map_prior_checkpoints_reused run_id=%s completed=%d total=%d",
            run.id,
            len(reused_packets),
            source.scene_count,
        )
    return run, True


def enqueue_run(run_id: str, llm: LlmClient) -> None:
    """Schedule a run once per process; DB idempotency handles all other races."""
    with _ACTIVE_RUN_LOCK:
        if run_id in _ACTIVE_RUN_IDS:
            return
        _ACTIVE_RUN_IDS.add(run_id)

    def worker() -> None:
        try:
            with import_run_context(run_id):
                execute_run(run_id, llm)
        finally:
            with _ACTIVE_RUN_LOCK:
                _ACTIVE_RUN_IDS.discard(run_id)

    _RUN_EXECUTOR.submit(worker)


def execute_run(run_id: str, llm: LlmClient) -> None:
    """Process one durable run. Safe to call directly from deterministic tests."""
    session = SessionLocal()
    try:
        run = session.get(NarrativeMapRunRow, run_id)
        if run is None or run.status == "completed":
            return
        _touch(run, status="running", phase="readiness", error_code=None, error_message=None)
        session.commit()
        _logger.info(
            "narrative_map_run_started run_id=%s project_id=%s attempt=%d",
            run.id,
            run.project_id,
            run.attempt_count,
        )

        source_snapshot = session.get(SnapshotRow, run.source_snapshot_id)
        if source_snapshot is None:
            raise NarrativeMapReadinessError([{"code": "source_snapshot_missing"}])
        source_doc = copy.deepcopy(source_snapshot.doc)
        source = prepare_narrative_map_source(source_doc)
        if source.source_hash != run.source_hash:
            raise NarrativeMapReadinessError([{"code": "source_hash_mismatch"}])

        checkpoint = dict(run.checkpoint or {})
        packets_by_scene = {
            packet["sceneId"]: packet
            for packet in checkpoint.get("scenePackets", [])
            if isinstance(packet, dict) and packet.get("sceneId")
        }
        _touch(
            run,
            phase="scene_analysis",
            completed_scene_count=len(packets_by_scene),
            checkpoint=checkpoint,
        )
        session.commit()

        for chunk in chunk_scene_sources(source.scene_sources):
            pending = [scene for scene in chunk if scene["sceneId"] not in packets_by_scene]
            if not pending:
                continue
            scene_id = pending[0]["sceneId"]
            diagnostics: list[dict] = []
            used_source_fallback = False
            _logger.info(
                "narrative_map_scene_call run_id=%s scene_id=%s attempt=1",
                run.id,
                scene_id,
            )
            system, user = render.build_narrative_scene_analysis_prompt(
                source_doc,
                pending,
                source.known_cast,
                render.new_nonce(),
            )
            result = _call_with_run_heartbeat(
                run.id,
                lambda: llm.infer_narrative_scene_analysis(
                    system=system,
                    user_message=user,
                    prompt_version=render.PROMPT_VERSION,
                ),
            )
            try:
                validated_packets = validate_scene_analysis_batch(pending, result)
            except NarrativeMapAnalysisValidationError as exc:
                diagnostics = exc.diagnostics
                diagnostic_codes = ",".join(
                    sorted(
                        {
                            str(item.get("code", "unknown"))
                            for item in diagnostics
                            if isinstance(item, dict)
                        }
                    )
                )
                _logger.warning(
                    "narrative_map_scene_rejected "
                    "run_id=%s scene_id=%s attempt=1 diagnostic_codes=%s",
                    run.id,
                    scene_id,
                    diagnostic_codes,
                )
                fallback = source_backed_scene_fallback(pending[0], result, diagnostics)
                if fallback is None:
                    raise
                validated_packets = [fallback]
                used_source_fallback = True
                _logger.warning(
                    "narrative_map_scene_source_fallback run_id=%s scene_id=%s diagnostic_codes=%s",
                    run.id,
                    scene_id,
                    diagnostic_codes,
                )
            else:
                normalized_fields: set[str] = set()
                analysis = result.scenes[0]
                packet = validated_packets[0]
                if analysis.scene_id != packet["sceneId"]:
                    normalized_fields.add("scene_id")
                if analysis.turn_beat_id != packet["turnBeatId"]:
                    normalized_fields.add("turn_beat_id")
                if any(
                    moment.beat_id != grounded["beatId"]
                    for moment, grounded in zip(
                        analysis.key_moments, packet["keyMoments"], strict=False
                    )
                ):
                    normalized_fields.add("moment_beat_id")
                if normalized_fields:
                    _logger.info(
                        "narrative_map_scene_anchors_normalized run_id=%s scene_id=%s fields=%s",
                        run.id,
                        scene_id,
                        ",".join(sorted(normalized_fields)),
                    )
            for packet in validated_packets:
                packets_by_scene[packet["sceneId"]] = packet
            if used_source_fallback:
                fallback_scene_ids = list(checkpoint.get("fallbackSceneIds") or [])
                if scene_id not in fallback_scene_ids:
                    fallback_scene_ids.append(scene_id)
                checkpoint["fallbackSceneIds"] = fallback_scene_ids
            checkpoint["scenePackets"] = [
                packets_by_scene[scene["sceneId"]]
                for scene in source.scene_sources
                if scene["sceneId"] in packets_by_scene
            ]
            _touch(
                run,
                phase="scene_analysis",
                completed_scene_count=len(packets_by_scene),
                checkpoint=checkpoint,
            )
            session.commit()
            _logger.info(
                "narrative_map_scene_checkpointed run_id=%s scene_id=%s completed=%d total=%d",
                run.id,
                scene_id,
                len(packets_by_scene),
                source.scene_count,
            )

        scene_packets = [packets_by_scene[scene["sceneId"]] for scene in source.scene_sources]
        mapped_doc = _synthesize_and_verify(
            session, run, source_doc, source, scene_packets, checkpoint, llm
        )

        _touch(run, phase="saving", checkpoint=checkpoint)
        session.commit()
        try:
            snapshot = snapshots.mutate(
                session,
                run.project_id,
                "Generated verified narrative map",
                lambda state: MutationState(
                    doc=mapped_doc,
                    ledger=state.ledger,
                    flags=state.flags,
                    snapshot_id=state.snapshot_id,
                ),
                expected_head_snapshot_id=run.source_snapshot_id,
            )
        except snapshots.StaleHead:
            snapshot = _apply_to_moved_head(session, run, source, mapped_doc)
            if snapshot is None:
                _touch(
                    run,
                    status="stale",
                    phase="failed",
                    error_code="SOURCE_STALE",
                    error_message=(
                        "The script changed while the map was being verified. "
                        "No map was applied."
                    ),
                    checkpoint=checkpoint,
                )
                session.commit()
                return

        _touch(
            run,
            status="completed",
            phase="complete",
            result_snapshot_id=snapshot.id,
            checkpoint=checkpoint,
        )
        session.commit()
        _logger.info(
            "narrative_map_run_complete run_id=%s scenes=%d chunks=%d",
            run.id,
            source.scene_count,
            len(chunk_scene_sources(source.scene_sources)),
        )
    except NarrativeMapReadinessError as exc:
        _reject_run(
            session,
            run_id,
            "SOURCE_NOT_READY",
            "The saved script is missing source text required for an evidence-grounded map.",
            exc.diagnostics,
        )
    except (NarrativeMapAnalysisValidationError, NarrativeMapValidationError) as exc:
        diagnostics = getattr(exc, "diagnostics", [])
        _reject_run(
            session,
            run_id,
            "EVIDENCE_REJECTED",
            (
                "The evidence gate rejected this analysis. No Narrative Map was saved, "
                "and same-version retry is blocked to prevent another charge."
            ),
            diagnostics,
        )
    except LlmTimeoutError:
        _fail_run(
            session,
            run_id,
            "LLM_TIMEOUT",
            (
                "Analysis did not finish in time. Saved checkpoints are retained; retry is "
                "delayed to prevent duplicate provider work."
            ),
        )
    except SchemaInvalidLlmError:
        _fail_run(
            session,
            run_id,
            "SCHEMA_INVALID_LLM",
            "The model returned an invalid analysis shape. No Narrative Map was saved.",
        )
    except Exception:
        _logger.exception("narrative_map_run_failed run_id=%s", run_id)
        _fail_run(
            session,
            run_id,
            "LLM_UNAVAILABLE",
            "Narrative Map analysis could not complete. Saved checkpoints are retained.",
        )
    finally:
        session.close()


def _apply_to_moved_head(
    session: Session,
    run: NarrativeMapRunRow,
    source,
    mapped_doc: dict,
) -> SnapshotRow | None:
    """Re-apply a verified map when the head moved but the script did not.

    `expected_head_snapshot_id` is the right guard for "the writer edited the
    script mid-run", but a moved head does not by itself mean that. Saving a
    map moves the head, so a completed run could never be repaired again: the
    retry raced its own output and was reported to the writer as a script
    change they had not made.

    `source_hash` is the honest test, because it covers format, cast and
    scenes only — the map itself is deliberately outside it. When the hash
    still matches, the analysis is valid for the current head and only needs
    re-applying on top of it, so the map is lifted onto the live document
    rather than the stale copy it was built from (which would revert whatever
    else moved the head). A changed hash, an unreadable head, or a lock that
    appeared meanwhile all return None and fail closed as before.
    """
    project = session.get(ProjectRow, run.project_id)
    if project is None:
        return None
    head = session.get(SnapshotRow, project.head_snapshot_id)
    if head is None:
        return None
    try:
        current = prepare_narrative_map_source(head.doc)
    except NarrativeMapReadinessError:
        return None
    if current.source_hash != run.source_hash:
        return None  # the script really did change

    live_doc = copy.deepcopy(head.doc)
    episode = _episode_by_id(live_doc, source.episode_id)
    mapped_episode = _episode_by_id(mapped_doc, source.episode_id)
    if episode is None or mapped_episode is None:
        return None
    existing = episode.get("narrativeMap")
    if episode.get("locked") or (isinstance(existing, dict) and existing.get("locked")):
        return None
    episode["narrativeMap"] = copy.deepcopy(mapped_episode.get("narrativeMap"))

    snapshot = snapshots.mutate(
        session,
        run.project_id,
        "Generated verified narrative map",
        lambda state: MutationState(
            doc=live_doc,
            ledger=state.ledger,
            flags=state.flags,
            snapshot_id=state.snapshot_id,
        ),
        expected_head_snapshot_id=project.head_snapshot_id,
    )
    # Later retries compare against the snapshot this map actually applies to.
    run.source_snapshot_id = snapshot.id
    _logger.info(
        "narrative_map_reapplied_to_moved_head run_id=%s snapshot=%s",
        run.id,
        snapshot.id,
    )
    return snapshot


def _episode_by_id(doc: dict, episode_id: str) -> dict | None:
    return next(
        (
            episode
            for season in doc.get("seasons") or []
            for episode in season.get("episodes") or []
            if episode.get("id") == episode_id
        ),
        None,
    )


def _synthesize_and_verify(
    session: Session,
    run: NarrativeMapRunRow,
    source_doc: dict,
    source,
    scene_packets: list[dict],
    checkpoint: dict,
    llm: LlmClient,
) -> dict:
    # Semantic retries are deliberately not automatic: synthesis and verification
    # are the two most expensive calls in a map run, and repeating the same
    # evidence/prompt after a deterministic rejection is duplicate spend.
    scene_packets, focal_character_repaired_ids = normalize_scene_packet_focal_characters(
        scene_packets, source.known_cast
    )
    scene_packets, quality_repaired_ids = normalize_scene_packet_quality(
        scene_packets, source.scene_sources
    )
    repaired_scene_ids = sorted({*focal_character_repaired_ids, *quality_repaired_ids})
    if repaired_scene_ids:
        checkpoint["scenePackets"] = scene_packets
        if focal_character_repaired_ids:
            checkpoint["focalCharacterRepairVersion"] = 1
            checkpoint["focalCharacterRepairSceneIds"] = focal_character_repaired_ids
        if quality_repaired_ids:
            checkpoint["scenePacketRepairVersion"] = 1
            checkpoint["scenePacketRepairSceneIds"] = quality_repaired_ids
            # A repaired candidate must receive a fresh independent verdict.
            checkpoint.pop("verification", None)
            checkpoint.pop("verificationAdjudication", None)
        _touch(run, phase="scene_analysis", checkpoint=checkpoint)
        session.commit()
        _logger.info(
            "narrative_map_scene_packet_normalized run_id=%s focal_repairs=%d quality_repairs=%d",
            run.id,
            len(focal_character_repaired_ids),
            len(quality_repaired_ids),
        )

    cached_synthesis = checkpoint.get("synthesis")
    _touch(run, phase="synthesis", checkpoint=checkpoint)
    session.commit()
    if cached_synthesis:
        synthesis = InferredNarrativeMapSynthesis.model_validate(cached_synthesis)
    else:
        system, user = render.build_narrative_map_synthesis_prompt(
            source_doc,
            synthesis_scene_spine(scene_packets),
            source.known_cast,
            source.threads,
            source.story_overview,
            render.new_nonce(),
            character_footprint=character_footprint(scene_packets),
        )
        synthesis = _call_with_run_heartbeat(
            run.id,
            lambda: llm.infer_narrative_map_synthesis(
                system=system,
                user_message=user,
                prompt_version=render.PROMPT_VERSION,
            ),
        )
        checkpoint["synthesis"] = synthesis.model_dump(by_alias=True)
        checkpoint["synthesisAttempts"] = 1
        _touch(run, phase="synthesis", checkpoint=checkpoint)
        session.commit()

    candidate_synthesis = synthesis.model_copy(deep=True)
    materialized_thread_count = materialize_synthesized_threads(
        source_doc,
        source.episode_id,
        candidate_synthesis,
    )
    if materialized_thread_count:
        checkpoint["threadRepairVersion"] = 1
    candidate = build_inferred_narrative_map(candidate_synthesis, scene_packets)
    cached_verification = checkpoint.get("verification")
    use_local_verification_repair = checkpoint.get("verificationPolicyVersion") == 2 and isinstance(
        cached_verification, dict
    )
    if use_local_verification_repair:
        verification = NarrativeMapVerification.model_validate(cached_verification)
        verification, self_retracted = partition_self_retracted_claims(verification)
        if self_retracted:
            checkpoint["selfRetractedClaims"] = self_retracted
        candidate = _apply_local_verification_repair(candidate, verification, checkpoint)
    candidate_doc = copy.deepcopy(source_doc)
    try:
        merge_narrative_map(candidate_doc, source.episode_id, candidate)
    except NarrativeMapValidationError as exc:
        raise NarrativeMapAnalysisValidationError(exc.diagnostics) from None

    _touch(run, phase="verification", checkpoint=checkpoint)
    session.commit()
    if use_local_verification_repair:
        _logger.info(
            "narrative_map_local_verification_repair run_id=%s removed_claims=%d provider_calls=0",
            run.id,
            checkpoint["verificationAdjudication"]["removedClaimCount"],
        )
        return candidate_doc

    candidate_payload = candidate.model_dump(by_alias=True)
    audit_evidence = verification_audit_evidence(
        source.scene_sources, scene_packets, candidate_payload
    )
    _logger.info(
        "narrative_map_verification_evidence_prepared run_id=%s cited_beats=%d evidence_chars=%d",
        run.id,
        len(audit_evidence["sourceBeats"]),
        sum(len(item["scriptExcerpt"]) for item in audit_evidence["sourceBeats"]),
    )
    system, user = render.build_narrative_map_verification_prompt(
        source_doc,
        audit_evidence,
        candidate_payload,
        render.new_nonce(),
        story_threads=next(
            (
                episode.get("threads") or []
                for season in candidate_doc.get("seasons") or []
                for episode in season.get("episodes") or []
                if episode.get("id") == source.episode_id
            ),
            [],
        ),
    )
    verification = _call_with_run_heartbeat(
        run.id,
        lambda: llm.verify_narrative_map(
            system=system,
            user_message=user,
            prompt_version=render.PROMPT_VERSION,
        ),
    )
    verification, self_retracted = partition_self_retracted_claims(verification)
    if self_retracted:
        checkpoint["selfRetractedClaims"] = self_retracted
        _logger.info(
            "narrative_map_self_retracted_claims run_id=%s moved_to_advisories=%d",
            run.id,
            len(self_retracted),
        )
    checkpoint["verification"] = verification.model_dump(by_alias=True)
    _touch(run, phase="verification", checkpoint=checkpoint)
    session.commit()

    # A first-pass rejection whose every claim is prunable is not a reason to
    # throw the analysis away. This repair used to run only on a *resumed* run,
    # because the policy flag that gated it is set at resume time — so a writer
    # was told "no map, and a retry is blocked to prevent another charge" for a
    # map that the second attempt then published for free. Measured on the West
    # Wing pilot: three blocking claims, all prunable, zero provider calls to
    # resolve them. Anything unprunable still fails closed below.
    if verification_supports_local_repair(verification):
        candidate = _apply_local_verification_repair(candidate, verification, checkpoint)
        candidate_doc = copy.deepcopy(source_doc)
        try:
            merge_narrative_map(candidate_doc, source.episode_id, candidate)
        except NarrativeMapValidationError as exc:
            raise NarrativeMapAnalysisValidationError(exc.diagnostics) from None
        _touch(run, phase="verification", checkpoint=checkpoint)
        session.commit()
        _logger.info(
            "narrative_map_local_verification_repair run_id=%s removed_claims=%d provider_calls=0",
            run.id,
            checkpoint["verificationAdjudication"]["removedClaimCount"],
        )
        return candidate_doc

    validate_verification(verification)
    return candidate_doc


def _apply_local_verification_repair(candidate, verification, checkpoint: dict):
    """Prune verifier-rejected optional claims and record that it cost nothing.

    Shared by the first-pass and resumed paths so a map's fate does not depend
    on which attempt surfaced the verdict.
    """
    before = len(candidate.themes) + len(candidate.thread_movements)
    repaired, repairs = repair_candidate_from_verification(candidate, verification)
    checkpoint["verificationRepairs"] = repairs
    checkpoint["verificationAdjudication"] = {
        "policyVersion": 2,
        "providerCalls": 0,
        "removedClaimCount": before - len(repaired.themes) - len(repaired.thread_movements),
        "coverageAdvisories": [
            repair
            for repair in repairs
            if repair.get("action") in {"record_coverage_advisory", "record_verifier_advisory"}
        ],
    }
    return repaired


def _reject_run(
    session: Session, run_id: str, code: str, message: str, diagnostics: list[dict]
) -> None:
    run = session.get(NarrativeMapRunRow, run_id)
    if run is None:
        return
    checkpoint = dict(run.checkpoint or {})
    checkpoint["rejectionDiagnostics"] = diagnostics
    _touch(
        run,
        status="rejected",
        phase="failed",
        error_code=code,
        error_message=message,
        checkpoint=checkpoint,
    )
    session.commit()
    diagnostic_codes = ",".join(
        sorted({str(item.get("code", "unknown")) for item in diagnostics if isinstance(item, dict)})
    )
    _logger.warning(
        "narrative_map_run_rejected run_id=%s code=%s phase=%s completed=%d diagnostic_codes=%s",
        run_id,
        code,
        run.phase,
        run.completed_scene_count,
        diagnostic_codes,
    )


def _fail_run(session: Session, run_id: str, code: str, message: str) -> None:
    run = session.get(NarrativeMapRunRow, run_id)
    if run is None:
        return
    _touch(run, status="failed", phase="failed", error_code=code, error_message=message)
    session.commit()
    _logger.warning("narrative_map_run_failed run_id=%s code=%s", run_id, code)
