"""SQLAlchemy ORM models — the six project-scoped tables (data contract §3).

Columns generally mirror the matching contract type (`schemas.py`)
field-for-field; nested structures (`sourceSpan`, `knownBy`, embeddings, and
the fully materialized snapshot `doc`/`ledger`/`flags`) are stored as JSON
blobs rather than decomposed further, matching §3's "materialized, not
deltas" snapshot semantics. `project_id` columns are storage-only plumbing
(not part of any wire schema) needed to scope rows to a project; §3 lists
one explicitly for `snapshots`, `change_sets`, and `suggestion_history`, and
this module adds the same for `ledger_facts` and `consistency_flags` since
those tables need it too and the wire shape (scoped by URL) doesn't carry it.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from storage.db import Base


def _utcnow() -> datetime:
    """Naive UTC — the repo-wide DB timestamp convention (controller ruling, T1.1).

    SQLite round-trips datetimes as naive, so storing tz-aware values creates a
    mixed world where fresh in-memory and DB-read timestamps can't be compared
    (TypeError). All DB timestamps are naive UTC; shared by these column
    defaults and the snapshot write-path (storage/snapshots.py).
    """
    return datetime.now(UTC).replace(tzinfo=None)


class ProjectRow(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(primary_key=True)
    doc: Mapped[dict] = mapped_column(JSON)
    head_snapshot_id: Mapped[str | None] = mapped_column(default=None)
    creation_idempotency_key: Mapped[str | None] = mapped_column(
        unique=True, default=None
    )
    creation_request_hash: Mapped[str | None] = mapped_column(default=None)
    # §3 "timestamps": server-managed, set on insert. T1.1's mutation
    # transaction is expected to bump updated_at on each mutation; T0.3 only
    # needs the columns populated at seed/create time.
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=_utcnow)


class SnapshotRow(Base):
    __tablename__ = "snapshots"

    id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    parent_id: Mapped[str | None] = mapped_column(default=None)
    instruction: Mapped[str]
    doc: Mapped[dict] = mapped_column(JSON)
    ledger: Mapped[list] = mapped_column(JSON)
    flags: Mapped[list] = mapped_column(JSON)
    ts: Mapped[str]


class LedgerFactRow(Base):
    __tablename__ = "ledger_facts"

    id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    fact: Mapped[str]
    fact_type: Mapped[str]
    source_span: Mapped[dict] = mapped_column(JSON)
    source_text: Mapped[str]
    known_by: Mapped[list] = mapped_column(JSON)
    audience_knows: Mapped[bool]
    provenance: Mapped[str]
    confidence: Mapped[float]
    status: Mapped[str] = mapped_column(index=True)
    supersedes: Mapped[str | None] = mapped_column(default=None)
    superseded_by: Mapped[str | None] = mapped_column(default=None)

    def to_wire_dict(self) -> dict:
        """camelCase dict matching the `LedgerFact` contract shape (schemas.py)."""
        return {
            "id": self.id,
            "fact": self.fact,
            "factType": self.fact_type,
            "sourceSpan": self.source_span,
            "sourceText": self.source_text,
            "knownBy": self.known_by,
            "audienceKnows": self.audience_knows,
            "provenance": self.provenance,
            "confidence": self.confidence,
            "status": self.status,
            "supersedes": self.supersedes,
            "supersededBy": self.superseded_by,
        }

    @classmethod
    def from_wire_dict(cls, project_id: str, data: dict) -> LedgerFactRow:
        """Rebuild a row from a `LedgerFact` wire dict (inverse of to_wire_dict)."""
        return cls(
            id=data["id"],
            project_id=project_id,
            fact=data["fact"],
            fact_type=data["factType"],
            source_span=data["sourceSpan"],
            source_text=data["sourceText"],
            known_by=data["knownBy"],
            audience_knows=data["audienceKnows"],
            provenance=data["provenance"],
            confidence=data["confidence"],
            status=data["status"],
            supersedes=data["supersedes"],
            superseded_by=data["supersededBy"],
        )


class ChangeSetRow(Base):
    __tablename__ = "change_sets"

    id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    doc: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(index=True)


class ConsistencyFlagRow(Base):
    __tablename__ = "consistency_flags"

    id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    object_type: Mapped[str]
    object_id: Mapped[str]
    fact_id: Mapped[str | None] = mapped_column(default=None)
    explanation: Mapped[str]
    severity: Mapped[str]
    status: Mapped[str] = mapped_column(index=True)
    source_change: Mapped[str]

    def to_wire_dict(self) -> dict:
        """camelCase dict matching the `ConsistencyFlag` contract shape (schemas.py)."""
        return {
            "id": self.id,
            "objectType": self.object_type,
            "objectId": self.object_id,
            "factId": self.fact_id,
            "explanation": self.explanation,
            "severity": self.severity,
            "status": self.status,
            "sourceChange": self.source_change,
        }

    @classmethod
    def from_wire_dict(cls, project_id: str, data: dict) -> ConsistencyFlagRow:
        """Rebuild a row from a `ConsistencyFlag` wire dict (inverse of to_wire_dict)."""
        return cls(
            id=data["id"],
            project_id=project_id,
            object_type=data["objectType"],
            object_id=data["objectId"],
            fact_id=data["factId"],
            explanation=data["explanation"],
            severity=data["severity"],
            status=data["status"],
            source_change=data["sourceChange"],
        )


class SuggestionHistoryRow(Base):
    __tablename__ = "suggestion_history"

    id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    text: Mapped[str]
    embedding: Mapped[list | None] = mapped_column(JSON, default=None)
