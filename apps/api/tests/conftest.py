"""Shared pytest fixtures for the API test suite.

Sets DATABASE_URL to a throwaway sqlite file before any test module gets a
chance to import `main`/`storage.db`, so the entire test session runs
against a disposable database and never touches the real dev DB
(apps/api/tableread.db) — CLAUDE.md hard rule: never use the dev DB in
tests. The import diagnostics log goes there too, so test runs never write
into the dev server's log (apps/api/logs/), and the import concurrency caps
a developer may export are dropped, so every test sees the defaults (and a
test that pins `pipeline.IMPORT_LLM_CONCURRENCY` pins every stage).
`storage.db`/`storage.seed`
imports are deferred into the fixture bodies (not module level) purely to
keep this side-effecting env var assignment ahead of them without violating
import-order lint rules.
"""

import os
import socket
import tempfile

import pytest

_tmp_dir = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_dir.name}/test.db"
os.environ["TABLEREAD_IMPORT_DIAGNOSTICS_LOG"] = f"{_tmp_dir.name}/import-diagnostics.log"
for _name in (
    "TABLEREAD_IMPORT_CONCURRENCY",
    "TABLEREAD_IMPORT_CONCURRENCY_SONNET",
    "TABLEREAD_IMPORT_CONCURRENCY_HAIKU",
):
    os.environ.pop(_name, None)


@pytest.fixture(autouse=True)
def _block_real_network(monkeypatch):
    """CLAUDE.md hard rule 1: never call the Anthropic API (or any other
    real network endpoint) in tests. Blocks socket-level connections for the
    duration of every test in the suite; FastAPI's TestClient talks to the
    app in-process via ASGI (no real socket) and MockLlmClient / the
    AnthropicClient tests' fake `sdk_client` never touch this layer, so this
    guard never fires for legitimate test code -- only if something starts a
    real connection (see tests/test_llm_factory.py)."""

    def _blocked(*_args, **_kwargs):
        raise AssertionError("network access attempted during tests (CLAUDE.md hard rule 1)")

    monkeypatch.setattr(socket.socket, "connect", _blocked)


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


def _clear_locks(doc: dict) -> None:
    """Recursively clear every `locked`/`scriptLocked` flag in a project doc."""
    for season in doc.get("seasons", []):
        season["locked"] = False
        for episode in season.get("episodes", []):
            episode["locked"] = False
            for scene in episode.get("scenes", []):
                scene["locked"] = False
                for beat in scene.get("beats", []):
                    beat["locked"] = False
                    beat["scriptLocked"] = False


@pytest.fixture()
def unlocked_project(db_session):
    """The fixture seeded with all locks cleared and every ledger fact set to
    `pending_review` — an *import-writable* target.

    T3.2's import-as-replace guard (drama_manager/locks.assert_import_target_
    writable) refuses a target holding locked content or vouched (non
    pending_review) facts, because import wipes the episode's scenes and the
    whole ledger. The T1.3 import tests exercise import *mechanics* (parse,
    coverage, transaction atomicity), which are orthogonal to the target's lock
    state, so they run against this writable variant. The dedicated
    lock-interaction test (test_import.py) uses the locked `seeded_project`.
    """
    import copy

    from storage.seed import load_fixture, seed_envelope

    envelope = copy.deepcopy(load_fixture())
    _clear_locks(envelope["project"])
    for fact in envelope["ledger"]:
        fact["status"] = "pending_review"
    for snap in envelope["snapshots"]:
        _clear_locks(snap["doc"])
        for fact in snap.get("ledger", []):
            fact["status"] = "pending_review"
    seed_envelope(db_session, envelope)
    return envelope
