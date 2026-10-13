"""Where the import diagnostics log lives: beside the dev DB, not in /tmp
(which is wiped), unless TABLEREAD_IMPORT_DIAGNOSTICS_LOG says otherwise."""

from __future__ import annotations

import logging
from pathlib import Path

import import_diagnostics


def test_the_log_defaults_to_a_logs_dir_beside_the_dev_db():
    api_dir = Path(import_diagnostics.__file__).resolve().parent
    assert import_diagnostics.DEFAULT_IMPORT_DIAGNOSTICS_LOG == (
        api_dir / "logs" / "import-diagnostics.log"
    )


def test_configuring_creates_the_missing_log_dir(tmp_path, monkeypatch):
    path = tmp_path / "not-yet" / "import-diagnostics.log"
    monkeypatch.setenv(import_diagnostics.IMPORT_DIAGNOSTICS_LOG_ENV, str(path))

    try:
        assert import_diagnostics.configure_import_diagnostics_logging() == path
        assert path.parent.is_dir()
    finally:
        for name in import_diagnostics._IMPORT_LOGGER_NAMES:
            logger = logging.getLogger(name)
            for handler in list(logger.handlers):
                if getattr(handler, import_diagnostics._HANDLER_MARKER, None) == path:
                    logger.removeHandler(handler)
                    handler.close()
