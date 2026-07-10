"""The snapshot write-path: the *only* place project doc/head is written.

CLAUDE.md hard rule 4: every mutation snapshots, and no direct doc writes
happen outside this helper. Every future generation/edit path (beat accept
T2.2, change-set apply T4.2, import T1.3, ledger mutations) routes through
`mutate` so the snapshot + head-bump invariant can never be forgotten.

Snapshot semantics (data contract §3, MVP: materialized, not deltas). A
snapshot stores the *complete* project-scoped versioned state — `doc`,
`ledger`, `flags` — as of the point it was written, and the live tables
always mirror the current head. Undo restores a *consistent world* (facts
and flags never outlive the content that established them).

  - `create_project` — project + root snapshot (`parent_id: null`, empty
    ledger/flags), one transaction. `headSnapshotId` is never null after.
  - `mutate(pid, instruction, fn)` — run `fn` over the current state, write
    one snapshot of the *new* state, bump head + `updated_at`, and rewrite
    the live `ledger_facts` / `consistency_flags` tables to match — all in a
    single transaction that rolls back whole on any failure. Head bump uses
    an atomic compare-and-swap on `head_snapshot_id` so concurrent writers
    cannot both succeed against the same parent.
  - `restore_parent` (undo) — restore doc/ledger/flags byte-identical from
    the current head's parent; move head to it; no new snapshot row. Same
    CAS on the head column.
  - `purge_project` (delete) — drop every project-scoped row across all six
    tables (embeddings included), one transaction.

No writer text is logged here (hard rule 5); this module logs nothing.
"""

from __future__ import annotations

import copy
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import update
from sqlalchemy.orm import Session

from storage.models import (
    ChangeSetRow,
    ConsistencyFlagRow,
    LedgerFactRow,
    ProjectRow,
    SnapshotRow,
    SuggestionHistoryRow,
    _utcnow,
)


@dataclass
class MutationState:
    """The full project-scoped versioned state a mutation reads and returns.

    All three are camelCase wire dicts (`Project`, `LedgerFact[]`,
    `ConsistencyFlag[]`) — the same shapes the snapshot row stores. A mutator
    receives the current state and returns the next one; it must not assume
    it may mutate `doc` in place (build a new dict), and it need not touch
    `ledger`/`flags` if its change doesn't affect them.
    """

    doc: dict
    ledger: list[dict]
    flags: list[dict]
    # The id the snapshot this mutation writes *will* have — minted before the
    # mutator runs so a mutator that creates flags/facts referencing the
    # triggering snapshot (import's ConsistencyFlag.sourceChange, T1.3; beat
    # accept, T2.2) can stamp it. Defaulted so existing mutators that don't
    # need it construct `MutationState(doc=, ledger=, flags=)` unchanged.
    snapshot_id: str = ""


Mutator = Callable[[MutationState], MutationState]


def create_project(
    session: Session,
    doc: dict,
    instruction: str,
    *,
    creation_idempotency_key: str | None = None,
    creation_request_hash: str | None = None,
) -> ProjectRow:
    """Create a project and its root snapshot atomically (data contract §4).

    Server-assigns the project id and root snapshot id, stamps them into the
    doc (`id`, `headSnapshotId`), and writes the root snapshot with empty
    ledger/flags. Returns the persisted `ProjectRow`.
    """
    project_id = _mint_id("proj")
    snapshot_id = _mint_id("snap")
    doc = copy.deepcopy(doc)
    doc["id"] = project_id
    doc["headSnapshotId"] = snapshot_id

    try:
        project = ProjectRow(
            id=project_id,
            doc=doc,
            head_snapshot_id=snapshot_id,
            creation_idempotency_key=creation_idempotency_key,
            creation_request_hash=creation_request_hash,
        )
        session.add(project)
        session.add(
            SnapshotRow(
                id=snapshot_id,
                project_id=project_id,
                parent_id=None,
                instruction=instruction,
                doc=copy.deepcopy(doc),
                ledger=[],
                flags=[],
                ts=_utcnow_iso(),
            )
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return project


class StaleHead(Exception):
    """Optimistic-concurrency failure: caller's expected head ≠ live head.

    Routes map this to 409 `CONFLICT_STALE_HEAD` (data contract §4)."""

    def __init__(self, expected: str | None, actual: str | None) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"expected headSnapshotId {expected!r} but project head is {actual!r}"
        )


def mutate(
    session: Session,
    project_id: str,
    instruction: str,
    mutator: Mutator,
    *,
    expected_head_snapshot_id: str | None = None,
) -> SnapshotRow:
    """Apply a mutation as one transaction, returning the new snapshot row.

    Reads the current state, hands it to `mutator`, then in a single
    transaction: writes a snapshot of the new state (`parent_id` = old head),
    sets `projects.doc`, bumps `head_snapshot_id` + `updated_at` via an
    atomic `UPDATE … WHERE head_snapshot_id = :expected` (rowcount must be 1),
    and rewrites the live ledger/flags tables. Any failure rolls back the
    whole transaction — the snapshot and the head bump are never split.

    When `expected_head_snapshot_id` is set, that value is the CAS predicate
    (client's `If-Match`). When omitted, the CAS still runs against the head
    observed at read time so two concurrent writers that both loaded H cannot
    both commit children of H.
    """
    project = session.get(ProjectRow, project_id)
    if project is None:  # defensive: routes 404 before calling
        raise LookupError(f"project {project_id!r} not found")

    observed_head = project.head_snapshot_id
    cas_expected = (
        expected_head_snapshot_id
        if expected_head_snapshot_id is not None
        else observed_head
    )
    # Fast-fail when the client sent a stale If-Match before doing LLM work
    # in the mutator. The UPDATE below is still the authoritative race guard.
    if (
        expected_head_snapshot_id is not None
        and observed_head != expected_head_snapshot_id
    ):
        raise StaleHead(expected_head_snapshot_id, observed_head)

    # Mint the new snapshot id up front so the mutator can reference it (e.g.
    # stamp it as a ConsistencyFlag's sourceChange) before the row is written.
    snapshot_id = _mint_id("snap")
    current = MutationState(
        doc=copy.deepcopy(project.doc),
        ledger=[row.to_wire_dict() for row in _ledger_rows(session, project_id)],
        flags=[row.to_wire_dict() for row in _flag_rows(session, project_id)],
        snapshot_id=snapshot_id,
    )
    new_state = mutator(current)

    # id / headSnapshotId are server-owned identity — stamp them onto the new
    # doc regardless of what the mutator produced.
    new_state.doc["id"] = project_id
    new_state.doc["headSnapshotId"] = snapshot_id

    try:
        snapshot = SnapshotRow(
            id=snapshot_id,
            project_id=project_id,
            parent_id=cas_expected,
            instruction=instruction,
            doc=copy.deepcopy(new_state.doc),
            ledger=new_state.ledger,
            flags=new_state.flags,
            ts=_utcnow_iso(),
        )
        session.add(snapshot)
        _cas_bump_head(
            session,
            project_id,
            expected_head=cas_expected,
            new_head=snapshot_id,
            new_doc=new_state.doc,
        )
        _rewrite_ledger(session, project_id, new_state.ledger)
        _rewrite_flags(session, project_id, new_state.flags)
        session.commit()
    except StaleHead:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    # Refresh the identity-mapped ProjectRow so later reads in this session
    # see the CAS-written head/doc (UPDATE bypasses the ORM attribute cache).
    session.refresh(project)
    return snapshot


def restore_parent(
    session: Session,
    project: ProjectRow,
    *,
    expected_head_snapshot_id: str | None = None,
) -> ProjectRow:
    """Undo: restore state from the current head's parent snapshot (§3).

    Restores `projects.doc`, `ledger_facts`, and `consistency_flags`
    byte-identical from the parent snapshot and moves head to it, in one
    transaction, via the same CAS as `mutate`. No new snapshot row is written
    (a later mutation forks the tree). The caller guarantees a parent exists
    (undo-at-root is a 409).
    """
    observed_head = project.head_snapshot_id
    cas_expected = (
        expected_head_snapshot_id
        if expected_head_snapshot_id is not None
        else observed_head
    )
    if (
        expected_head_snapshot_id is not None
        and observed_head != expected_head_snapshot_id
    ):
        raise StaleHead(expected_head_snapshot_id, observed_head)

    head = session.get(SnapshotRow, cas_expected)
    if head is None or head.parent_id is None:
        # Defensive: routes already 409 when there is nothing to undo.
        raise LookupError(f"no parent for head {cas_expected!r}")
    parent = session.get(SnapshotRow, head.parent_id)
    if parent is None:
        raise LookupError(f"parent snapshot {head.parent_id!r} not found")

    restored_doc = copy.deepcopy(parent.doc)
    try:
        _cas_bump_head(
            session,
            project.id,
            expected_head=cas_expected,
            new_head=parent.id,
            new_doc=restored_doc,
        )
        _rewrite_ledger(session, project.id, parent.ledger)
        _rewrite_flags(session, project.id, parent.flags)
        session.commit()
    except StaleHead:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    session.refresh(project)
    return project


def purge_project(session: Session, project_id: str) -> None:
    """Delete every project-scoped row across all six tables (data contract §4).

    Covers `snapshots`, `ledger_facts`, `change_sets` (including stored
    previews), `consistency_flags`, `suggestion_history` (embeddings live in
    its `embedding` column — no separate store), and finally `projects`. One
    transaction; rolls back whole on failure.
    """
    try:
        for model in (
            SnapshotRow,
            LedgerFactRow,
            ChangeSetRow,
            ConsistencyFlagRow,
            SuggestionHistoryRow,
        ):
            session.query(model).filter_by(project_id=project_id).delete(
                synchronize_session=False
            )
        session.query(ProjectRow).filter_by(id=project_id).delete(
            synchronize_session=False
        )
        session.commit()
    except Exception:
        session.rollback()
        raise


# ── internals ───────────────────────────────────────────────────────────────


def _cas_bump_head(
    session: Session,
    project_id: str,
    *,
    expected_head: str | None,
    new_head: str,
    new_doc: dict,
) -> None:
    """Atomically set head/doc when `head_snapshot_id` still equals `expected_head`.

    Raises `StaleHead` when zero rows match (another writer won the race, or
    the client's If-Match was already stale). This is the only place the live
    head column is advanced for mutate/undo — identity-map assignment alone
    cannot serialize concurrent sessions.
    """
    result = session.execute(
        update(ProjectRow)
        .where(ProjectRow.id == project_id)
        .where(ProjectRow.head_snapshot_id == expected_head)
        .values(
            doc=new_doc,
            head_snapshot_id=new_head,
            updated_at=_utcnow(),
        )
    )
    if result.rowcount != 1:
        actual = session.get(ProjectRow, project_id)
        raise StaleHead(
            expected_head, actual.head_snapshot_id if actual is not None else None
        )


def _ledger_rows(session: Session, project_id: str) -> list[LedgerFactRow]:
    return session.query(LedgerFactRow).filter_by(project_id=project_id).all()


def _flag_rows(session: Session, project_id: str) -> list[ConsistencyFlagRow]:
    return session.query(ConsistencyFlagRow).filter_by(project_id=project_id).all()


# The rewrite deletes use synchronize_session="fetch" so any matching rows
# still held in the session's (weak) identity map are evicted before rows with
# the same primary keys are re-inserted. With =False, a mutation retaining
# existing facts/flags emits SAWarning ("New instance conflicts with
# persistent instance") whenever the loaded rows haven't been GC'd yet —
# nondeterministic warning noise the test suite now escalates to errors.


def _rewrite_ledger(session: Session, project_id: str, ledger: list[dict]) -> None:
    session.query(LedgerFactRow).filter_by(project_id=project_id).delete(
        synchronize_session="fetch"
    )
    for fact in ledger:
        session.add(LedgerFactRow.from_wire_dict(project_id, fact))


def _rewrite_flags(session: Session, project_id: str, flags: list[dict]) -> None:
    session.query(ConsistencyFlagRow).filter_by(project_id=project_id).delete(
        synchronize_session="fetch"
    )
    for flag in flags:
        session.add(ConsistencyFlagRow.from_wire_dict(project_id, flag))


def _mint_id(prefix: str) -> str:
    """Server-assigned kebab id (clients never mint ids; CLAUDE.md conventions)."""
    return f"{prefix}-{uuid.uuid4().hex}"


def _utcnow_iso() -> str:
    # _utcnow (storage/models.py) is naive UTC by repo convention; the "Z"
    # suffix makes the snapshot `ts` string explicit UTC, matching the fixture.
    return _utcnow().isoformat() + "Z"
