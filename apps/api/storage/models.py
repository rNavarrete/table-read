"""SQLAlchemy ORM models — the six project-scoped tables (data contract §3).

Columns generally mirror the matching contract type (`schemas.py`)
field-for-field; nested structures (`sourceSpan`, `knownBy`, embeddings, and
the fully materialized snapshot `doc`/`ledger`/`flags`) are stored as JSON
blobs rather than decomposed further, matching §3's "materialized, not
deltas" snapshot semantics. `project_id` columns are storage-only plumbing
(not part of any wire schema) needed to scope rows to a project; §3 lists
one explicitly for `snapshots` and `change_sets`, and this module adds the
same for `ledger_facts`, `consistency_flags`, and `suggestion_history` since
those tables need it too and the wire shape (scoped by URL) doesn't carry it.
"""

from __future__ import annotations

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from storage.db import Base


class ProjectRow(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(primary_key=True)
    doc: Mapped[dict] = mapped_column(JSON)
    head_snapshot_id: Mapped[str | None] = mapped_column(default=None)


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


class SuggestionHistoryRow(Base):
    __tablename__ = "suggestion_history"

    id: Mapped[str] = mapped_column(primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    text: Mapped[str]
    embedding: Mapped[list | None] = mapped_column(JSON, default=None)
