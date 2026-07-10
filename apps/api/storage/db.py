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
    The project-creation idempotency columns are storage plumbing, so keep this
    narrow until the repo grows a full migration system.
    """
    inspector = inspect(engine)
    if not inspector.has_table("projects"):
        return

    columns = {column["name"] for column in inspector.get_columns("projects")}
    with engine.begin() as connection:
        if "creation_idempotency_key" not in columns:
            connection.execute(
                text("ALTER TABLE projects ADD COLUMN creation_idempotency_key VARCHAR")
            )
        if "creation_request_hash" not in columns:
            connection.execute(
                text("ALTER TABLE projects ADD COLUMN creation_request_hash VARCHAR")
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
