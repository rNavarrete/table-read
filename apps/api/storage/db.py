"""SQLAlchemy engine/session setup (data contract §3: SQLite via SQLAlchemy, MVP).

`DATABASE_URL` picks the dev DB by default (a sqlite file alongside this
package) but is overridable via env var — the test suite's conftest sets it
to a throwaway temp file before this module is ever imported, so tests
never touch the dev DB (CLAUDE.md hard rule).
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "tableread.db"
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def ensure_storage_schema() -> None:
    """Apply storage-only compatibility upgrades for existing dev SQLite DBs.

    `Base.metadata.create_all()` creates new tables but does not alter old ones.
    Keep this narrow until the repo grows a full migration system.
    """
    inspector = inspect(engine)
    with engine.begin() as connection:
        if inspector.has_table("projects"):
            columns = {column["name"] for column in inspector.get_columns("projects")}
            if "creation_idempotency_key" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE projects ADD COLUMN creation_idempotency_key VARCHAR"
                    )
                )
            if "creation_request_hash" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE projects ADD COLUMN creation_request_hash VARCHAR"
                    )
                )

            indexes = {index["name"] for index in inspector.get_indexes("projects")}
            if "ux_projects_creation_idempotency_key" not in indexes:
                connection.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS "
                        "ux_projects_creation_idempotency_key "
                        "ON projects (creation_idempotency_key)"
                    )
                )

        # T7.23: existing dev DBs predate LedgerFact.knowledgeEvents.
        if inspector.has_table("ledger_facts"):
            fact_columns = {
                column["name"] for column in inspector.get_columns("ledger_facts")
            }
            if "knowledge_events" not in fact_columns:
                connection.execute(
                    text(
                        "ALTER TABLE ledger_facts ADD COLUMN knowledge_events JSON "
                        "DEFAULT '[]'"
                    )
                )
            # T10.8: and the exposition audit's two nullable columns.
            for column in ("delivery", "needed_by_scene_id"):
                if column not in fact_columns:
                    connection.execute(
                        text(f"ALTER TABLE ledger_facts ADD COLUMN {column} VARCHAR")
                    )
