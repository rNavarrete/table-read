"""Shared pytest fixtures for the API test suite.

Sets DATABASE_URL to a throwaway sqlite file before any test module gets a
chance to import `main`/`storage.db`, so the entire test session runs
against a disposable database and never touches the real dev DB
(apps/api/tableread.db) — CLAUDE.md hard rule: never use the dev DB in
tests. `storage.db`/`storage.seed` imports are deferred into the fixture
bodies (not module level) purely to keep this side-effecting env var
assignment ahead of them without violating import-order lint rules.
"""

import os
import tempfile

import pytest

_tmp_dir = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_dir.name}/test.db"


@pytest.fixture()
def db_session():
    from storage.db import Base, SessionLocal, engine

    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def seeded_project(db_session):
    """Seed the real committed fixture and return its parsed envelope."""
    from storage.seed import load_fixture, seed_envelope

    envelope = load_fixture()
    seed_envelope(db_session, envelope)
    return envelope
