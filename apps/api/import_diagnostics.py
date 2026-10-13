"""Privacy-safe, durable diagnostics for script-import attempts.

The import pipeline handles writer-owned source text, so this module never
accepts or formats that text. It only provides a correlation id, the import
unit a model call belongs to, and a small rotating log for the import and LLM
metadata loggers.
"""

from __future__ import annotations

import logging
import os
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import NamedTuple

IMPORT_DIAGNOSTICS_LOG_ENV = "TABLEREAD_IMPORT_DIAGNOSTICS_LOG"
# Beside the dev DB, not in /tmp (which macOS wipes, losing a run's evidence).
# Gitignored, and `uvicorn --reload` only restarts on `*.py` changes.
DEFAULT_IMPORT_DIAGNOSTICS_LOG = Path(__file__).resolve().parent / "logs" / "import-diagnostics.log"
_IMPORT_LOGGER_NAMES = (
    "drama_manager.narrative_map_runs",
    "fountain.create_import",
    "fountain.pipeline",
    "llm.anthropic_client",
    "llm.errors",
)
_HANDLER_MARKER = "_tableread_import_diagnostics"
_import_run_id: ContextVar[str | None] = ContextVar("import_run_id", default=None)


class ImportUnit(NamedTuple):
    """The import work a model call belongs to: its stage, the 0-based scene
    index for a per-scene unit (else None), and the ms it waited for a pool
    worker (None when it ran on the caller's thread)."""

    stage: str
    scene: int | None = None
    queue_ms: int | None = None


_import_unit: ContextVar[ImportUnit | None] = ContextVar("import_unit", default=None)


def new_import_run_id() -> str:
    """Mint a short correlation id that never encodes writer-owned content."""
    return f"import-{uuid.uuid4().hex[:12]}"


def new_map_run_id() -> str:
    """Mint a correlation id for an explicit post-import map analysis."""
    return f"map-{uuid.uuid4().hex[:12]}"


def current_import_run_id() -> str | None:
    return _import_run_id.get()


@contextmanager
def import_run_context(run_id: str) -> Iterator[None]:
    """Make a run id available to nested pipeline and LLM logging."""
    token = _import_run_id.set(run_id)
    try:
        yield
    finally:
        _import_run_id.reset(token)


def current_import_unit() -> ImportUnit | None:
    return _import_unit.get()


@contextmanager
def import_unit_context(unit: ImportUnit) -> Iterator[None]:
    """Tag the model calls made inside with `unit` (the `llm_call` line)."""
    token = _import_unit.set(unit)
    try:
        yield
    finally:
        _import_unit.reset(token)


def configure_import_diagnostics_logging() -> Path | None:
    """Attach one rotating diagnostic file handler, a single instance shared
    by every safe import logger, so a rollover moves all of them to the new
    file together. A log that cannot be opened is a warning on stderr, not a
    failed boot: the app runs without it (and returns None)."""
    configured_path = os.getenv(IMPORT_DIAGNOSTICS_LOG_ENV)
    path = Path(configured_path) if configured_path else DEFAULT_IMPORT_DIAGNOSTICS_LOG
    loggers = [logging.getLogger(name) for name in _IMPORT_LOGGER_NAMES]
    handler = next(
        (h for lg in loggers for h in lg.handlers if getattr(h, _HANDLER_MARKER, None) == path),
        None,
    )
    if handler is None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            handler = RotatingFileHandler(path, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
        except OSError as exc:
            print(
                f"warning: import diagnostics log disabled, cannot open {path}: "
                f"{type(exc).__name__}",
                file=sys.stderr,
            )
            return None
        handler.setLevel(logging.INFO)
        setattr(handler, _HANDLER_MARKER, path)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))

    for logger in loggers:
        logger.setLevel(logging.INFO)
        if any(getattr(h, _HANDLER_MARKER, None) == path for h in logger.handlers):
            continue
        logger.addHandler(handler)

    return path
