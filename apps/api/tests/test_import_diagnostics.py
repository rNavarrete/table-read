"""Where the import diagnostics log lives: beside the dev DB, not in /tmp
(which is wiped), unless TABLEREAD_IMPORT_DIAGNOSTICS_LOG says otherwise; one
handler for every import logger; and a log that cannot open never stops boot."""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

import import_diagnostics


@pytest.fixture()
def log_at(monkeypatch):
    """Point the log at a path, and detach (and close) its handler afterwards."""
    paths: list[Path] = []

    def point(path: Path) -> Path:
        monkeypatch.setenv(import_diagnostics.IMPORT_DIAGNOSTICS_LOG_ENV, str(path))
        paths.append(path)
        return path

    yield point
    for name in import_diagnostics._IMPORT_LOGGER_NAMES:
        logger = logging.getLogger(name)
        for handler in list(logger.handlers):
            if getattr(handler, import_diagnostics._HANDLER_MARKER, None) in paths:
                logger.removeHandler(handler)
                handler.close()


def test_the_log_defaults_to_a_logs_dir_beside_the_dev_db():
    api_dir = Path(import_diagnostics.__file__).resolve().parent
    assert import_diagnostics.DEFAULT_IMPORT_DIAGNOSTICS_LOG == (
        api_dir / "logs" / "import-diagnostics.log"
    )


def test_configuring_creates_the_missing_log_dir(tmp_path, log_at):
    path = log_at(tmp_path / "not-yet" / "import-diagnostics.log")

    assert import_diagnostics.configure_import_diagnostics_logging() == path
    assert path.parent.is_dir()


def test_one_handler_serves_every_logger_so_a_rollover_moves_them_together(tmp_path, log_at):
    path = log_at(tmp_path / "import-diagnostics.log")
    import_diagnostics.configure_import_diagnostics_logging()
    import_diagnostics.configure_import_diagnostics_logging()  # idempotent
    names = import_diagnostics._IMPORT_LOGGER_NAMES
    handlers = {
        id(h)
        for name in names
        for h in logging.getLogger(name).handlers
        if getattr(h, import_diagnostics._HANDLER_MARKER, None) == path
    }
    assert len(handlers) == 1

    logging.getLogger("fountain.pipeline").info("before rollover")
    [handler] = [
        h
        for h in logging.getLogger(names[0]).handlers
        if getattr(h, import_diagnostics._HANDLER_MARKER, None) == path
    ]
    handler.doRollover()
    logging.getLogger("fountain.pipeline").info("pipeline after rollover")
    logging.getLogger("llm.anthropic_client").info("client after rollover")
    handler.flush()

    active = path.read_text()
    assert "pipeline after rollover" in active and "client after rollover" in active
    assert "before rollover" in Path(f"{path}.1").read_text()


def test_an_unwritable_log_dir_warns_and_boots_without_the_file(tmp_path, log_at, capsys):
    blocker = tmp_path / "a-file"
    blocker.write_text("")
    path = log_at(blocker / "logs" / "import-diagnostics.log")  # a dir under a file

    assert import_diagnostics.configure_import_diagnostics_logging() is None

    assert "import diagnostics log disabled" in capsys.readouterr().err
    for name in import_diagnostics._IMPORT_LOGGER_NAMES:
        assert all(
            getattr(h, import_diagnostics._HANDLER_MARKER, None) != path
            for h in logging.getLogger(name).handlers
        )
